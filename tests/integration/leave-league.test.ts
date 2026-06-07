import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAnonClient,
  createAuthedClient,
  createServiceRoleClient,
} from "./setup";

const admin = createServiceRoleClient();
const createdUserIds: string[] = [];
const createdLeagueIds: string[] = [];

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

function uniqueInvite(): string {
  return `INV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createAuthedUser(): Promise<{ id: string; token: string }> {
  const email = uniqueEmail("leave");
  const password = "Password123!";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  expect(error).toBeNull();
  const id = data.user!.id;
  createdUserIds.push(id);

  const anon = createAnonClient();
  const { data: signIn, error: signInError } =
    await anon.auth.signInWithPassword({ email, password });
  expect(signInError).toBeNull();
  return { id, token: signIn.session!.access_token };
}

async function createLeagueWith(
  members: { id: string; role: "admin" | "member" }[],
): Promise<string> {
  const { data: league, error } = await admin
    .from("leagues")
    .insert({
      name: "Liga Leave",
      created_by: members[0]!.id,
      invite_code: uniqueInvite(),
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  const leagueId = league!.id;
  createdLeagueIds.push(leagueId);

  const { error: memberError } = await admin.from("league_members").insert(
    members.map((m) => ({
      league_id: leagueId,
      user_id: m.id,
      role: m.role,
      wager_balance: 100,
    })),
  );
  expect(memberError).toBeNull();
  return leagueId;
}

async function memberExists(leagueId: string, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();
  return data != null;
}

afterAll(async () => {
  for (const id of createdLeagueIds) {
    await admin.from("leagues").delete().eq("id", id);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await admin.auth.admin.deleteUser(id);
  }
});

describe("fn_leave_league", () => {
  let adminUser: { id: string; token: string };
  let memberUser: { id: string; token: string };

  beforeEach(async () => {
    adminUser = await createAuthedUser();
    memberUser = await createAuthedUser();
  });

  it("un miembro normal puede abandonar la liga y se limpia su membresía", async () => {
    const leagueId = await createLeagueWith([
      { id: adminUser.id, role: "admin" },
      { id: memberUser.id, role: "member" },
    ]);

    const client = createAuthedClient(memberUser.token);
    const { error } = await client.rpc("fn_leave_league", {
      p_league_id: leagueId,
    });

    expect(error).toBeNull();
    expect(await memberExists(leagueId, memberUser.id)).toBe(false);
    expect(await memberExists(leagueId, adminUser.id)).toBe(true);
  });

  it("el único admin NO puede abandonar la liga", async () => {
    const leagueId = await createLeagueWith([
      { id: adminUser.id, role: "admin" },
      { id: memberUser.id, role: "member" },
    ]);

    const client = createAuthedClient(adminUser.token);
    const { error } = await client.rpc("fn_leave_league", {
      p_league_id: leagueId,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
    expect(await memberExists(leagueId, adminUser.id)).toBe(true);
  });

  it("un admin puede salir si queda otro admin", async () => {
    const leagueId = await createLeagueWith([
      { id: adminUser.id, role: "admin" },
      { id: memberUser.id, role: "admin" },
    ]);

    const client = createAuthedClient(adminUser.token);
    const { error } = await client.rpc("fn_leave_league", {
      p_league_id: leagueId,
    });

    expect(error).toBeNull();
    expect(await memberExists(leagueId, adminUser.id)).toBe(false);
    expect(await memberExists(leagueId, memberUser.id)).toBe(true);
  });

  it("rechaza abandonar una liga de la que no eres miembro", async () => {
    const leagueId = await createLeagueWith([
      { id: adminUser.id, role: "admin" },
    ]);

    const client = createAuthedClient(memberUser.token);
    const { error } = await client.rpc("fn_leave_league", {
      p_league_id: leagueId,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("P0002");
  });
});

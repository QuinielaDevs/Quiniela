import { afterAll, describe, expect, it } from "vitest";
import {
  createAnonClient,
  createAuthedClient,
  createServiceRoleClient,
} from "./setup";

const admin = createServiceRoleClient();
const createdUserIds: string[] = [];

afterAll(async () => {
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await admin.auth.admin.deleteUser(id);
  }
});

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

function uniqueInvite(): string {
  return `JOIN${Date.now().toString(36).toUpperCase()}${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
}

async function createAuthedUser(): Promise<{ id: string; token: string }> {
  const email = uniqueEmail("join");
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

async function createLeagueFixture(ownerId: string, inviteCode = uniqueInvite()) {
  const { data, error } = await admin
    .from("leagues")
    .insert({
      name: "Liga Invitada",
      created_by: ownerId,
      invite_code: inviteCode,
      requires_payment: true,
      payment_amount: 10,
      payment_instructions: "Zelle: cris@test.local",
      rules: { predictionMode: "dual" },
    })
    .select("id, invite_code")
    .single();

  expect(error).toBeNull();
  return data!;
}

describe("fn_join_league_by_invite", () => {
  it("une a un usuario autenticado como miembro pendiente", async () => {
    const owner = await createAuthedUser();
    const invited = await createAuthedUser();
    const league = await createLeagueFixture(owner.id);
    const invitedClient = createAuthedClient(invited.token);

    const { data, error } = await invitedClient
      .rpc("fn_join_league_by_invite", {
        p_invite_code: league.invite_code.toLowerCase(),
      })
      .single();

    expect(error).toBeNull();
    expect(data).toMatchObject({
      league_id: league.id,
      user_id: invited.id,
      role: "member",
      payment_status: "pending",
    });
  });

  it("es idempotente y no duplica membresías", async () => {
    const owner = await createAuthedUser();
    const invited = await createAuthedUser();
    const league = await createLeagueFixture(owner.id);
    const invitedClient = createAuthedClient(invited.token);

    const first = await invitedClient.rpc("fn_join_league_by_invite", {
      p_invite_code: league.invite_code,
    });
    expect(first.error).toBeNull();

    const second = await invitedClient.rpc("fn_join_league_by_invite", {
      p_invite_code: league.invite_code,
    });
    expect(second.error).toBeNull();

    const { data: rows, error } = await admin
      .from("league_members")
      .select("id")
      .eq("league_id", league.id)
      .eq("user_id", invited.id);

    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
  });

  it("rechaza códigos inválidos sin crear membresías", async () => {
    const invited = await createAuthedUser();
    const invitedClient = createAuthedClient(invited.token);

    const { error } = await invitedClient.rpc("fn_join_league_by_invite", {
      p_invite_code: "NOPE9999",
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("22023");
    expect(error?.message).toContain("Invitación inválida");

    const { data: rows } = await admin
      .from("league_members")
      .select("id")
      .eq("user_id", invited.id);
    expect(rows).toHaveLength(0);
  });

  it("bloquea llamadas anónimas", async () => {
    const owner = await createAuthedUser();
    const league = await createLeagueFixture(owner.id);
    const anon = createAnonClient();

    const { error } = await anon.rpc("fn_join_league_by_invite", {
      p_invite_code: league.invite_code,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });
});

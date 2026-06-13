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

  it("al salir se cancelan sus duelos pending/active y se reembolsa el escrow (BUG-002)", async () => {
    const leagueId = await createLeagueWith([
      { id: adminUser.id, role: "admin" },
      { id: memberUser.id, role: "member" },
    ]);

    // Partido futuro (catálogo global: prefijo test_, se borra al final).
    const { data: match, error: matchError } = await admin
      .from("matches")
      .insert({
        home_team: `test_leave_h_${Date.now()}`,
        away_team: `test_leave_a_${Date.now()}`,
        match_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        status: "scheduled",
        matchday: 1,
        stage: "group",
      })
      .select("id")
      .single();
    expect(matchError).toBeNull();

    try {
      // Duelo directo ACTIVO entre admin (creador) y member (retado), con el
      // escrow de ambos retenido en el ledger: balances 100 → 90 y dos
      // transacciones de retención de -10 referenciando el reto.
      const { data: challenge, error: challengeError } = await admin
        .from("challenges")
        .insert({
          league_id: leagueId,
          match_id: match!.id,
          creator_id: adminUser.id,
          challenged_id: memberUser.id,
          type: "direct",
          status: "active",
          points_bet: 10,
        })
        .select("id")
        .single();
      expect(challengeError).toBeNull();

      await admin.from("challenge_participants").insert([
        { challenge_id: challenge!.id, user_id: adminUser.id, prediction_home: 2, prediction_away: 1 },
        { challenge_id: challenge!.id, user_id: memberUser.id, prediction_home: 0, prediction_away: 0 },
      ]);
      for (const uid of [adminUser.id, memberUser.id]) {
        await admin
          .from("league_members")
          .update({ wager_balance: 90 })
          .eq("league_id", leagueId)
          .eq("user_id", uid);
        await admin.from("point_transactions").insert({
          user_id: uid,
          league_id: leagueId,
          amount: -10,
          description: "challenge_escrow_hold",
          reference_id: challenge!.id,
        });
      }

      const client = createAuthedClient(memberUser.token);
      const { error } = await client.rpc("fn_leave_league", {
        p_league_id: leagueId,
      });
      expect(error).toBeNull();
      expect(await memberExists(leagueId, memberUser.id)).toBe(false);

      // El duelo queda cancelado y la contraparte recupera su escrow.
      const { data: chal } = await admin
        .from("challenges")
        .select("status")
        .eq("id", challenge!.id)
        .single();
      expect(chal!.status).toBe("canceled");

      const { data: adminMember } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", adminUser.id)
        .single();
      expect(Number(adminMember!.wager_balance)).toBe(100);

      // El ledger del reto queda en neto 0 para AMBOS: al saliente también se
      // le inserta su fila de reembolso aunque su membresía ya no exista.
      const { data: txs } = await admin
        .from("point_transactions")
        .select("user_id, amount")
        .eq("reference_id", challenge!.id);
      const net = (uid: string) =>
        txs!
          .filter((t) => t.user_id === uid)
          .reduce((sum, t) => sum + Number(t.amount), 0);
      expect(net(adminUser.id)).toBe(0);
      expect(net(memberUser.id)).toBe(0);
    } finally {
      // challenges.match_id es ON DELETE CASCADE: borrar el partido se lleva el reto.
      await admin.from("matches").delete().eq("id", match!.id);
    }
  });
});

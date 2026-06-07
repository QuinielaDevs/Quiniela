import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createAnonClient,
  createAuthedClient,
  createServiceRoleClient,
} from "./setup";

const admin = createServiceRoleClient();
const createdUserIds: string[] = [];
const createdLeagueIds: string[] = [];
const createdMatchIds: string[] = [];
const createdChallengeIds: string[] = [];

const DAY_MS = 24 * 60 * 60 * 1000;
const KICKOFF_LOCKED = "P0004";

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

function uniqueInvite(): string {
  return `INV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createAuthedUser(): Promise<{ id: string; token: string }> {
  const email = uniqueEmail("challenge-lock");
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
  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  expect(signInError).toBeNull();

  return { id, token: signIn.session!.access_token };
}

async function insertMatch(matchTimeIso: string): Promise<string> {
  const { data, error } = await admin
    .from("matches")
    .insert({
      home_team: "Argentina",
      away_team: "México",
      match_time: matchTimeIso,
      status: "scheduled",
    })
    .select("id")
    .single();

  expect(error).toBeNull();
  createdMatchIds.push(data!.id);
  return data!.id;
}

let userA: { id: string; token: string };
let userB: { id: string; token: string };
let leagueId: string;

beforeAll(async () => {
  userA = await createAuthedUser();
  userB = await createAuthedUser();

  const { data: league, error: leagueError } = await admin
    .from("leagues")
    .insert({
      name: "Liga Duelos Kickoff",
      created_by: userA.id,
      invite_code: uniqueInvite(),
    })
    .select("id")
    .single();
  expect(leagueError).toBeNull();
  leagueId = league!.id;
  createdLeagueIds.push(leagueId);

  const { error: memberError } = await admin.from("league_members").insert([
    {
      league_id: leagueId,
      user_id: userA.id,
      role: "admin",
      wager_balance: 100,
    },
    {
      league_id: leagueId,
      user_id: userB.id,
      role: "member",
      wager_balance: 100,
    },
  ]);
  expect(memberError).toBeNull();
});

afterEach(async () => {
  for (const id of createdChallengeIds.splice(0)) {
    await admin.from("point_transactions").delete().eq("reference_id", id);
    await admin.from("challenge_participants").delete().eq("challenge_id", id);
    await admin.from("challenges").delete().eq("id", id);
  }

  for (const id of createdMatchIds.splice(0)) {
    await admin.from("matches").delete().eq("id", id);
  }

  await admin
    .from("league_members")
    .update({ wager_balance: 100 })
    .eq("league_id", leagueId);
});

afterAll(async () => {
  for (const id of createdLeagueIds) {
    await admin.from("leagues").delete().eq("id", id);
  }

  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await admin.auth.admin.deleteUser(id);
  }
});

describe("challenge RPCs: bloqueo por kickoff", () => {
  it("no permite crear un desafío cuando el kickoff ya pasó", async () => {
    const matchId = await insertMatch(
      new Date(Date.now() - 5_000).toISOString(),
    );
    const clientA = createAuthedClient(userA.token);

    const { data, error } = await clientA.rpc("create_challenge", {
      p_league_id: leagueId,
      p_match_id: matchId,
      p_points_bet: 10,
      p_type: "direct",
      p_challenged_id: userB.id,
      p_prediction_home: 2,
      p_prediction_away: 1,
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.code).toBe(KICKOFF_LOCKED);
  });

  it("no permite aceptar un desafío si el partido empezó después de crearlo", async () => {
    const matchId = await insertMatch(
      new Date(Date.now() + DAY_MS).toISOString(),
    );
    const clientA = createAuthedClient(userA.token);
    const clientB = createAuthedClient(userB.token);

    const { data: challengeId, error: createError } = await clientA.rpc(
      "create_challenge",
      {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 10,
        p_type: "direct",
        p_challenged_id: userB.id,
        p_prediction_home: 2,
        p_prediction_away: 1,
      },
    );
    expect(createError).toBeNull();
    createdChallengeIds.push(challengeId as string);

    const { error: updateError } = await admin
      .from("matches")
      .update({ match_time: new Date(Date.now() - 5_000).toISOString() })
      .eq("id", matchId);
    expect(updateError).toBeNull();

    const { error } = await clientB.rpc("accept_challenge", {
      p_challenge_id: challengeId,
      p_prediction_home: 0,
      p_prediction_away: 0,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe(KICKOFF_LOCKED);
  });
});

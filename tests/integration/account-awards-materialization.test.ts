import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAnonClient,
  createAuthedClient,
  createServiceRoleClient,
} from "./setup";
import { materializeCurrentMemberAwards } from "@/app/account/account-awards";

const admin = createServiceRoleClient();
const createdUserIds: string[] = [];
const createdLeagueIds: string[] = [];
const createdMatchIds: string[] = [];

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

function uniqueInvite(): string {
  return `MAT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createAuthedUser(): Promise<{ id: string; token: string }> {
  const email = uniqueEmail("materialize");
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
  const { data: signIn, error: sErr } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  expect(sErr).toBeNull();
  return { id, token: signIn.session!.access_token };
}

let user: { id: string; token: string };
let leagueId: string;
let matchOneId: string;
let matchTwoId: string;
const CLOSED_MATCHDAY = 99;
const OPEN_MATCHDAY = 100;

beforeAll(async () => {
  user = await createAuthedUser();

  const { data: league, error: lErr } = await admin
    .from("leagues")
    .insert({
      name: "Liga Materializacion",
      created_by: user.id,
      invite_code: uniqueInvite(),
    })
    .select("id")
    .single();
  expect(lErr).toBeNull();
  leagueId = league!.id;
  createdLeagueIds.push(leagueId);

  const { error: memberErr } = await admin.from("league_members").insert({
    league_id: leagueId,
    user_id: user.id,
    role: "admin",
    joined_at: "2026-06-01T00:00:00.000Z",
  });
  expect(memberErr).toBeNull();

  const { data: matches, error: matchErr } = await admin
    .from("matches")
    .insert([
      {
        home_team: "Brasil",
        away_team: "Ecuador",
        match_time: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        status: "finished",
        home_score: 3,
        away_score: 1,
        matchday: CLOSED_MATCHDAY,
      },
      {
        home_team: "Francia",
        away_team: "Croacia",
        match_time: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
        status: "finished",
        home_score: 0,
        away_score: 0,
        matchday: CLOSED_MATCHDAY,
      },
      {
        home_team: "Argentina",
        away_team: "Japon",
        match_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        status: "scheduled",
        matchday: OPEN_MATCHDAY,
      },
    ])
    .select("id, home_team, matchday")
    .order("matchday", { ascending: true });
  expect(matchErr).toBeNull();
  expect(matches).toHaveLength(3);
  matchOneId = matches!.find((match) => match.home_team === "Brasil")!.id;
  matchTwoId = matches!.find((match) => match.home_team === "Francia")!.id;
  createdMatchIds.push(...matches!.map((m) => m.id));

  const { error: predErr } = await admin.from("predictions").insert([
    {
      league_id: leagueId,
      match_id: matchOneId,
      user_id: user.id,
      home_score_pred: 3,
      away_score_pred: 1,
      multiplier: 1,
    },
    {
      league_id: leagueId,
      match_id: matchTwoId,
      user_id: user.id,
      home_score_pred: 0,
      away_score_pred: 0,
      multiplier: 1,
    },
  ]);
  expect(predErr).toBeNull();
});

afterAll(async () => {
  if (createdLeagueIds.length > 0) {
    await admin.from("leagues").delete().in("id", createdLeagueIds);
  }
  if (createdMatchIds.length > 0) {
    await admin.from("matches").delete().in("id", createdMatchIds);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
});

describe("materializeCurrentMemberAwards", () => {
  it("materializa premios propios para jornadas cerradas y es idempotente", async () => {
    const authed = createAuthedClient(user.token);

    const first = await materializeCurrentMemberAwards({
      supabase: authed,
      leagueId,
      userId: user.id,
    });
    expect(first.errors).toEqual([]);
    expect(first.closedMatchdays).toContain(CLOSED_MATCHDAY);
    expect(first.predictedClosedMatchdays).toEqual([CLOSED_MATCHDAY]);
    expect(first.materializedMatchdays).toEqual([CLOSED_MATCHDAY]);

    const { data: badgesAfterFirst } = await authed
      .from("member_badges")
      .select("badge_type, matchday")
      .eq("league_id", leagueId)
      .eq("user_id", user.id);
    const { data: profilesAfterFirst } = await authed
      .from("member_game_profiles")
      .select("profile_type, matchday")
      .eq("league_id", leagueId)
      .eq("user_id", user.id);

    expect(badgesAfterFirst).toEqual([
      { badge_type: "nostradamus", matchday: CLOSED_MATCHDAY },
    ]);
    expect(profilesAfterFirst).toEqual([
      { profile_type: "conservador", matchday: CLOSED_MATCHDAY },
    ]);

    const second = await materializeCurrentMemberAwards({
      supabase: authed,
      leagueId,
      userId: user.id,
    });
    expect(second.errors).toEqual([]);
    expect(second.materializedMatchdays).toEqual([]);

    const { count: badgeCount } = await authed
      .from("member_badges")
      .select("id", { count: "exact", head: true })
      .eq("league_id", leagueId)
      .eq("user_id", user.id);
    const { count: profileCount } = await authed
      .from("member_game_profiles")
      .select("id", { count: "exact", head: true })
      .eq("league_id", leagueId)
      .eq("user_id", user.id);

    expect(badgeCount).toBe(1);
    expect(profileCount).toBe(1);
  });
});

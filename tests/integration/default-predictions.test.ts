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

const DAY_MS = 24 * 60 * 60 * 1000;

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

function uniqueInvite(): string {
  return `INV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueBracketSlot(): number {
  return Math.floor(10_000 + Math.random() * 1_000_000);
}

async function createAuthedUser(): Promise<{ id: string; token: string }> {
  const email = uniqueEmail("default-pred");
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

type MatchOverrides = {
  matchTimeIso?: string;
  homeCode?: string | null;
  awayCode?: string | null;
  bracketSlot?: number | null;
  status?: string;
};

async function insertMatch(overrides: MatchOverrides = {}): Promise<string> {
  const {
    matchTimeIso = new Date(Date.now() + DAY_MS).toISOString(),
    homeCode = "ARG",
    awayCode = "MEX",
    bracketSlot = null,
    status = "scheduled",
  } = overrides;

  const { data, error } = await admin
    .from("matches")
    .insert({
      home_team: "Argentina",
      away_team: "México",
      home_team_code: homeCode,
      away_team_code: awayCode,
      match_time: matchTimeIso,
      status,
      bracket_slot: bracketSlot,
    })
    .select("id")
    .single();

  expect(error).toBeNull();
  createdMatchIds.push(data!.id);
  return data!.id;
}

async function addLeagueMember(userId: string): Promise<void> {
  const { error } = await admin.from("league_members").insert({
    league_id: leagueId,
    user_id: userId,
    role: "member",
    wager_balance: 100,
  });
  expect(error).toBeNull();
}

let user: { id: string; token: string };
let leagueId: string;

beforeAll(async () => {
  // Limpiar predicciones residuales de corridas anteriores para que
  // `fn_ensure_default_predictions` no se active sobre partidos de seeds
  // viejos (que ya no se generan desde que se deshabilitó el seed SQL —
  // ver docs/zafronix-api-unification.md §5).
  const { data: allMatches } = await admin.from("matches").select("id");
  if (allMatches && allMatches.length > 0) {
    const ids = allMatches.map((m) => m.id);
    await admin.from("predictions").delete().in("match_id", ids);
  }

  user = await createAuthedUser();

  const { data: league, error: leagueError } = await admin
    .from("leagues")
    .insert({
      name: "Liga Default Preds",
      created_by: user.id,
      invite_code: uniqueInvite(),
    })
    .select("id")
    .single();
  expect(leagueError).toBeNull();
  leagueId = league!.id;
  createdLeagueIds.push(leagueId);

  const { error: memberError } = await admin.from("league_members").insert({
    league_id: leagueId,
    user_id: user.id,
    role: "admin",
    wager_balance: 100,
  });
  expect(memberError).toBeNull();

  const client = createAuthedClient(user.token);
  const { error: baselineError } = await client.rpc(
    "fn_ensure_default_predictions",
    { p_league_id: leagueId },
  );
  expect(baselineError).toBeNull();
});

afterEach(async () => {
  for (const id of createdMatchIds.splice(0)) {
    await admin.from("predictions").delete().eq("match_id", id);
    await admin.from("matches").delete().eq("id", id);
  }
});

afterAll(async () => {
  for (const id of createdLeagueIds) {
    await admin.from("predictions").delete().eq("league_id", id);
    await admin.from("leagues").delete().eq("id", id);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await admin.auth.admin.deleteUser(id);
  }
});

describe("fn_ensure_default_predictions", () => {
  it("crea un 0-0 solo para partidos editables, no para bloqueados ni TBD", async () => {
    const editableId = await insertMatch({
      matchTimeIso: new Date(Date.now() + DAY_MS).toISOString(),
    });
    const lockedId = await insertMatch({
      matchTimeIso: new Date(Date.now() - 5_000).toISOString(),
    });
    const tbdId = await insertMatch({
      matchTimeIso: new Date(Date.now() + DAY_MS).toISOString(),
      homeCode: null,
      awayCode: null,
      bracketSlot: uniqueBracketSlot(),
    });

    const client = createAuthedClient(user.token);
    const { data: inserted, error } = await client.rpc(
      "fn_ensure_default_predictions",
      { p_league_id: leagueId },
    );

    expect(error).toBeNull();
    expect(inserted).toBe(1);

    const { data: preds } = await admin
      .from("predictions")
      .select("match_id, home_score_pred, away_score_pred, multiplier")
      .eq("league_id", leagueId)
      .eq("user_id", user.id);

    const byMatch = new Map((preds ?? []).map((p) => [p.match_id, p]));
    expect(byMatch.has(editableId)).toBe(true);
    expect(byMatch.get(editableId)!.home_score_pred).toBe(0);
    expect(byMatch.get(editableId)!.away_score_pred).toBe(0);
    expect(Number(byMatch.get(editableId)!.multiplier)).toBeGreaterThanOrEqual(
      1,
    );
    expect(byMatch.has(lockedId)).toBe(false);
    expect(byMatch.has(tbdId)).toBe(false);
  });

  it("es idempotente y no sobrescribe una predicción existente", async () => {
    const matchId = await insertMatch({
      matchTimeIso: new Date(Date.now() + DAY_MS).toISOString(),
    });

    const client = createAuthedClient(user.token);

    // El usuario ya guardó un 3-1 real.
    const { error: saveError } = await client.rpc("fn_save_prediction", {
      p_league_id: leagueId,
      p_match_id: matchId,
      p_home_score_pred: 3,
      p_away_score_pred: 1,
    });
    expect(saveError).toBeNull();

    const { data: inserted, error } = await client.rpc(
      "fn_ensure_default_predictions",
      { p_league_id: leagueId },
    );
    expect(error).toBeNull();
    expect(inserted).toBe(0);

    const { data: pred } = await admin
      .from("predictions")
      .select("home_score_pred, away_score_pred")
      .eq("league_id", leagueId)
      .eq("user_id", user.id)
      .eq("match_id", matchId)
      .single();

    expect(pred!.home_score_pred).toBe(3);
    expect(pred!.away_score_pred).toBe(1);
  });

  it("rechaza a quien no es miembro de la liga", async () => {
    const outsider = await createAuthedUser();
    const client = createAuthedClient(outsider.token);

    const { error } = await client.rpc("fn_ensure_default_predictions", {
      p_league_id: leagueId,
    });

    expect(error).not.toBeNull();
  });

  it("materializa 0-0 para todos los miembros cuando un slot knockout deja de ser TBD", async () => {
    const teammate = await createAuthedUser();
    await addLeagueMember(teammate.id);

    const matchId = await insertMatch({
      matchTimeIso: new Date(Date.now() + DAY_MS).toISOString(),
      homeCode: null,
      awayCode: null,
      bracketSlot: uniqueBracketSlot(),
    });

    const { error: updateError } = await admin
      .from("matches")
      .update({
        home_team: "Argentina",
        away_team: "México",
        home_team_code: "ARG",
        away_team_code: "MEX",
      })
      .eq("id", matchId);
    expect(updateError).toBeNull();

    const { data: preds, error: predError } = await admin
      .from("predictions")
      .select("user_id, home_score_pred, away_score_pred")
      .eq("league_id", leagueId)
      .eq("match_id", matchId);

    expect(predError).toBeNull();
    const byUser = new Map((preds ?? []).map((p) => [p.user_id, p]));
    expect(byUser.get(user.id)?.home_score_pred).toBe(0);
    expect(byUser.get(user.id)?.away_score_pred).toBe(0);
    expect(byUser.get(teammate.id)?.home_score_pred).toBe(0);
    expect(byUser.get(teammate.id)?.away_score_pred).toBe(0);
  });

  it("materializa defaults antes del accrual cuando un partido pasa a finished", async () => {
    const missingUser = await createAuthedUser();
    await addLeagueMember(missingUser.id);

    const matchId = await insertMatch({
      matchTimeIso: new Date(Date.now() + DAY_MS).toISOString(),
      bracketSlot: uniqueBracketSlot(),
    });

    const client = createAuthedClient(user.token);
    const { error: saveError } = await client.rpc("fn_save_prediction", {
      p_league_id: leagueId,
      p_match_id: matchId,
      p_home_score_pred: 2,
      p_away_score_pred: 1,
    });
    expect(saveError).toBeNull();

    const { error: finishError } = await admin
      .from("matches")
      .update({
        home_score: 0,
        away_score: 0,
        status: "finished",
      })
      .eq("id", matchId);
    expect(finishError).toBeNull();

    const { data: preds, error: predError } = await admin
      .from("predictions")
      .select(
        "user_id, home_score_pred, away_score_pred, points_earned, evaluated_at",
      )
      .eq("league_id", leagueId)
      .eq("match_id", matchId);
    expect(predError).toBeNull();

    const byUser = new Map((preds ?? []).map((p) => [p.user_id, p]));
    expect(byUser.get(user.id)?.home_score_pred).toBe(2);
    expect(byUser.get(user.id)?.away_score_pred).toBe(1);
    expect(Number(byUser.get(user.id)?.points_earned ?? 0)).toBe(0);

    const defaultPred = byUser.get(missingUser.id);
    expect(defaultPred?.home_score_pred).toBe(0);
    expect(defaultPred?.away_score_pred).toBe(0);
    expect(Number(defaultPred?.points_earned ?? 0)).toBe(5);
    expect(defaultPred?.evaluated_at).not.toBeNull();

    const { data: member, error: memberError } = await admin
      .from("league_members")
      .select("wager_balance")
      .eq("league_id", leagueId)
      .eq("user_id", missingUser.id)
      .single();
    expect(memberError).toBeNull();
    expect(Number(member!.wager_balance)).toBe(105);
  });
});

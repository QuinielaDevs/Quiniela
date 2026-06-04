import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAnonClient,
  createAuthedClient,
  createServiceRoleClient,
} from "./setup";
import {
  buildStandings,
  type StandingMatch,
  type StandingMember,
  type StandingPrediction,
} from "@/utils/standings";

// Story 3.1 — la tabla de posiciones se construye on-the-fly desde partidos
// `finished` + predicciones, leídas con la SESIÓN del usuario (no service_role).
// Aquí validamos que la RLS de 2.1 permite a un miembro leer las predicciones de
// sus rivales para un partido finished (desbloqueado por tiempo) y que
// buildStandings produce el orden esperado con esos datos reales.

const admin = createServiceRoleClient();
const createdUserIds: string[] = [];
const createdLeagueIds: string[] = [];
const createdMatchIds: string[] = [];

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

function uniqueInvite(): string {
  return `INV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createAuthedUser(): Promise<{ id: string; token: string }> {
  const email = uniqueEmail("stand");
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

let userA: { id: string; token: string }; // miembro que mira la tabla
let userB: { id: string; token: string }; // rival de la misma liga
let leagueId: string;
let finishedMatchId: string;

beforeAll(async () => {
  userA = await createAuthedUser();
  userB = await createAuthedUser();

  const { data: league, error: lErr } = await admin
    .from("leagues")
    .insert({
      name: "Liga Standings",
      created_by: userA.id,
      invite_code: uniqueInvite(),
    })
    .select("id")
    .single();
  expect(lErr).toBeNull();
  leagueId = league!.id;
  createdLeagueIds.push(leagueId);

  // A entra antes que B (criterio de desempate joined_at).
  const { error: mAErr } = await admin.from("league_members").insert({
    league_id: leagueId,
    user_id: userA.id,
    role: "admin",
    joined_at: "2026-06-01T00:00:00.000Z",
  });
  expect(mAErr).toBeNull();
  const { error: mBErr } = await admin.from("league_members").insert({
    league_id: leagueId,
    user_id: userB.id,
    role: "member",
    joined_at: "2026-06-02T00:00:00.000Z",
  });
  expect(mBErr).toBeNull();

  // Partido finished (desbloqueado por tiempo) con resultado real 2-1.
  const { data: match, error: matchErr } = await admin
    .from("matches")
    .insert({
      home_team: "Brasil",
      away_team: "Ecuador",
      match_time: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      status: "finished",
      home_score: 2,
      away_score: 1,
      matchday: 1,
    })
    .select("id")
    .single();
  expect(matchErr).toBeNull();
  finishedMatchId = match!.id;
  createdMatchIds.push(finishedMatchId);

  // Predicciones insertadas con service_role (bypassa RLS y el kickoff-lock,
  // que de otro modo impediría escribir sobre un partido ya iniciado).
  // A: marcador exacto (5 base). B: resultado acertado distinto (2 base).
  const { error: pErr } = await admin.from("predictions").insert([
    {
      league_id: leagueId,
      match_id: finishedMatchId,
      user_id: userA.id,
      home_score_pred: 2,
      away_score_pred: 1,
      multiplier: 1,
    },
    {
      league_id: leagueId,
      match_id: finishedMatchId,
      user_id: userB.id,
      home_score_pred: 3,
      away_score_pred: 0,
      multiplier: 1,
    },
  ]);
  expect(pErr).toBeNull();
});

afterAll(async () => {
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
  if (createdMatchIds.length > 0) {
    await admin.from("matches").delete().in("id", createdMatchIds);
  }
  if (createdLeagueIds.length > 0) {
    await admin.from("leagues").delete().in("id", createdLeagueIds);
  }
});

describe("standings read (RLS + buildStandings)", () => {
  it("un miembro lee las predicciones de sus rivales para un partido finished y arma la tabla", async () => {
    const authed = createAuthedClient(userA.token);

    // Mismas lecturas que hace src/app/standings/page.tsx, bajo la sesión de A.
    const [{ data: memberRows }, { data: finished }, { data: predRows }] =
      await Promise.all([
        authed
          .from("league_members")
          .select(
            "user_id, payment_status, joined_at, profiles(display_name, avatar_url)",
          )
          .eq("league_id", leagueId),
        authed
          .from("matches")
          .select("id, status, matchday, home_score, away_score")
          .eq("status", "finished"),
        authed
          .from("predictions")
          .select("user_id, match_id, home_score_pred, away_score_pred, multiplier")
          .eq("league_id", leagueId),
      ]);

    // A ve a ambos miembros y AMBAS predicciones (finished → desbloqueado).
    expect(memberRows).toHaveLength(2);
    const predForLeague = (predRows ?? []).filter(
      (p) => p.match_id === finishedMatchId,
    );
    expect(predForLeague).toHaveLength(2);

    const members: StandingMember[] = (
      memberRows as unknown as Array<{
        user_id: string;
        payment_status: "pending" | "paid";
        joined_at: string;
        profiles: { display_name: string; avatar_url: string } | null;
      }>
    ).map((m) => ({
      userId: m.user_id,
      displayName: m.profiles?.display_name ?? "Jugador Anónimo",
      avatarUrl: m.profiles?.avatar_url ?? "/assets/avatars/default-player.svg",
      paymentStatus: m.payment_status,
      joinedAt: m.joined_at,
    }));

    const matches: StandingMatch[] = (finished ?? [])
      .filter((m) => m.id === finishedMatchId)
      .map((m) => ({
        id: m.id,
        status: m.status,
        matchday: m.matchday,
        homeScore: m.home_score,
        awayScore: m.away_score,
      }));

    const predictions: StandingPrediction[] = predForLeague.map((p) => ({
      userId: p.user_id,
      matchId: p.match_id,
      homeScorePred: p.home_score_pred,
      awayScorePred: p.away_score_pred,
      multiplier: p.multiplier,
    }));

    const rows = buildStandings(members, matches, predictions);

    // A (exacto, 5) por encima de B (resultado, 2).
    expect(rows[0]).toMatchObject({ userId: userA.id, totalPoints: 5, rank: 1 });
    expect(rows[1]).toMatchObject({ userId: userB.id, totalPoints: 2, rank: 2 });
  });
});

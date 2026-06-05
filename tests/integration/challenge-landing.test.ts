import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

function uniqueInvite(): string {
  return `INV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createAuthedUser(): Promise<{ id: string; token: string }> {
  const email = uniqueEmail("challenge");
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

// Forma del payload de fn_get_challenge_landing que estos tests inspeccionan.
type LandingRow = {
  creator_prediction_home: number | null;
  creator_prediction_away: number | null;
  challenged_prediction_home: number | null;
  challenged_prediction_away: number | null;
  [key: string]: unknown;
};

// Fixtures
let userA: { id: string; token: string }; // Creador del reto
let userB: { id: string; token: string }; // Rival retado
let userC: { id: string; token: string }; // Miembro de la liga (no participante)
let leagueId: string;
let matchFutureId: string; // Partido en el futuro (bloqueado)
let challengeDirectId: string;

beforeAll(async () => {
  userA = await createAuthedUser();
  userB = await createAuthedUser();
  userC = await createAuthedUser();

  // 1) Crear Liga y añadir miembros A, B y C
  const { data: league, error: lErr } = await admin
    .from("leagues")
    .insert({
      name: "Liga Duelos Test",
      created_by: userA.id,
      invite_code: uniqueInvite(),
    })
    .select("id")
    .single();
  expect(lErr).toBeNull();
  leagueId = league!.id;
  createdLeagueIds.push(leagueId);

  const { error: lmErr } = await admin.from("league_members").insert([
    { league_id: leagueId, user_id: userA.id, role: "admin", wager_balance: 100 },
    { league_id: leagueId, user_id: userB.id, role: "member", wager_balance: 100 },
    { league_id: leagueId, user_id: userC.id, role: "member", wager_balance: 100 },
  ]);
  expect(lmErr).toBeNull();

  // 2) Crear partido a futuro (24h de antelación)
  const { data: match, error: mErr } = await admin
    .from("matches")
    .insert({
      home_team: "Argentina",
      away_team: "Francia",
      home_team_code: "ARG",
      away_team_code: "FRA",
      match_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      status: "scheduled",
    })
    .select("id")
    .single();
  expect(mErr).toBeNull();
  matchFutureId = match!.id;
  createdMatchIds.push(matchFutureId);

  // 3) Crear desafío directo de A retando a B usando la RPC create_challenge
  // Esto deduce puntos y agrega a A como participante con su predicción (ej: 2-1)
  const clientA = createAuthedClient(userA.token);
  const { data: challengeId, error: cErr } = await clientA.rpc("create_challenge", {
    p_league_id: leagueId,
    p_match_id: matchFutureId,
    p_points_bet: 10,
    p_type: "direct",
    p_challenged_id: userB.id,
    p_prediction_home: 2,
    p_prediction_away: 1,
  });
  expect(cErr).toBeNull();
  challengeDirectId = challengeId as string;
  createdChallengeIds.push(challengeDirectId);
});

afterAll(async () => {
  for (const id of createdChallengeIds) {
    await admin.from("challenges").delete().eq("id", id);
  }
  for (const id of createdMatchIds) {
    await admin.from("matches").delete().eq("id", id);
  }
  for (const id of createdLeagueIds) {
    await admin.from("leagues").delete().eq("id", id);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await admin.auth.admin.deleteUser(id);
  }
});

describe("fn_get_challenge_landing - Gate de Confidencialidad", () => {
  it("(a) Permite a usuario anon ver metadatos pero las predicciones vienen NULL antes del kickoff", async () => {
    const anon = createAnonClient();
    const { data, error } = await anon.rpc("fn_get_challenge_landing", {
      p_challenge_id: challengeDirectId,
    }).single();

    expect(error).toBeNull();
    expect(data).toMatchObject({
      challenge_id: challengeDirectId,
      points_bet: 10,
      type: "direct",
      status: "pending",
      league_name: "Liga Duelos Test",
      home_team: "Argentina",
      away_team: "Francia",
      creator_display_name: "Jugador Anónimo",
      creator_prediction_home: null,
      creator_prediction_away: null,
      challenged_prediction_home: null,
      challenged_prediction_away: null,
    });
  });

  it("(b) Creador ve su propia predicción pero la del rival es NULL; simétricamente el retado ve la suya pero la del creador es NULL", async () => {
    // 1. Creador (User A) consulta
    const clientA = createAuthedClient(userA.token);
    const { data: rawA, error: errA } = await clientA.rpc("fn_get_challenge_landing", {
      p_challenge_id: challengeDirectId,
    }).single();
    expect(errA).toBeNull();
    const dataA = rawA as unknown as LandingRow;
    expect(dataA.creator_prediction_home).toBe(2);
    expect(dataA.creator_prediction_away).toBe(1);
    expect(dataA.challenged_prediction_home).toBeNull();

    // 2. El retado (User B) acepta el duelo con marcador 1-3
    const clientB = createAuthedClient(userB.token);
    const { error: accErr } = await clientB.rpc("accept_challenge", {
      p_challenge_id: challengeDirectId,
      p_prediction_home: 1,
      p_prediction_away: 3,
    });
    expect(accErr).toBeNull();

    // 3. Retado (User B) consulta -> ve su predicción (1-3) pero no la del creador (NULL)
    const { data: rawB, error: errB } = await clientB.rpc("fn_get_challenge_landing", {
      p_challenge_id: challengeDirectId,
    }).single();
    expect(errB).toBeNull();
    const dataB = rawB as unknown as LandingRow;
    expect(dataB.challenged_prediction_home).toBe(1);
    expect(dataB.challenged_prediction_away).toBe(3);
    expect(dataB.creator_prediction_home).toBeNull();

    // 4. Creador (User A) vuelve a consultar -> ve su predicción (2-1) pero no la del rival (NULL)
    const { data: rawA2, error: errA2 } = await clientA.rpc("fn_get_challenge_landing", {
      p_challenge_id: challengeDirectId,
    }).single();
    expect(errA2).toBeNull();
    const dataA2 = rawA2 as unknown as LandingRow;
    expect(dataA2.creator_prediction_home).toBe(2);
    expect(dataA2.creator_prediction_away).toBe(1);
    expect(dataA2.challenged_prediction_home).toBeNull();
  });

  it("(c) Tras match_time - 1 min, ambas predicciones son visibles para cualquier rol, inclusive anon", async () => {
    // Mover kickoff del partido al pasado (kickoff hace 2 minutos)
    const pastKickoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { error: updErr } = await admin
      .from("matches")
      .update({ match_time: pastKickoff, status: "live" })
      .eq("id", matchFutureId);
    expect(updErr).toBeNull();

    // Consultar como anónimo
    const anon = createAnonClient();
    const { data: rawData, error } = await anon.rpc("fn_get_challenge_landing", {
      p_challenge_id: challengeDirectId,
    }).single();

    expect(error).toBeNull();
    const data = rawData as unknown as LandingRow;
    expect(data.creator_prediction_home).toBe(2);
    expect(data.creator_prediction_away).toBe(1);
    expect(data.challenged_prediction_home).toBe(1);
    expect(data.challenged_prediction_away).toBe(3);
  });

  it("(d) Query directa a challenge_participants por un miembro de la liga no expone predicciones antes de kickoff", async () => {
    // Restaurar partido a futuro
    const futureKickoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error: updErr } = await admin
      .from("matches")
      .update({ match_time: futureKickoff, status: "scheduled" })
      .eq("id", matchFutureId);
    expect(updErr).toBeNull();

    // User C es miembro de la liga pero no es participante del duelo. Intenta consultar directamente challenge_participants
    const clientC = createAuthedClient(userC.token);
    const { data, error } = await clientC
      .from("challenge_participants")
      .select("user_id, prediction_home, prediction_away")
      .eq("challenge_id", challengeDirectId);

    expect(error).toBeNull();
    // La nueva política RLS "participants_select_gated" le permite ver solo SUS filas (ninguna, ya que no participa)
    // o filas ajenas sólo si fn_match_unlocked es true.
    // Como el partido está bloqueado, debe recibir un array vacío para User A y User B.
    expect(data).toHaveLength(0);
  });

  it("(e) Frontera del umbral: a falta de 61 segundos (futuro) está protegido; a falta de 59 segundos (futuro) ya está liberado", async () => {
    // Caso 1: now() + 61s -> Aún oculto (fn_match_unlocked devuelve false)
    const kickoff61s = new Date(Date.now() + 61 * 1000).toISOString();
    const { error: updErr1 } = await admin
      .from("matches")
      .update({ match_time: kickoff61s })
      .eq("id", matchFutureId);
    expect(updErr1).toBeNull();

    const anon = createAnonClient();
    const { data: rawData61s } = await anon.rpc("fn_get_challenge_landing", {
      p_challenge_id: challengeDirectId,
    }).single();
    const data61s = rawData61s as unknown as LandingRow;
    expect(data61s.creator_prediction_home).toBeNull();
    expect(data61s.challenged_prediction_home).toBeNull();

    // Caso 2: now() + 59s (menos de 1 minuto para kickoff) -> Desbloqueado (fn_match_unlocked devuelve true)
    const kickoff59s = new Date(Date.now() + 59 * 1000).toISOString();
    const { error: updErr2 } = await admin
      .from("matches")
      .update({ match_time: kickoff59s })
      .eq("id", matchFutureId);
    expect(updErr2).toBeNull();

    const { data: rawData59s } = await anon.rpc("fn_get_challenge_landing", {
      p_challenge_id: challengeDirectId,
    }).single();
    const data59s = rawData59s as unknown as LandingRow;
    expect(data59s.creator_prediction_home).toBe(2);
    expect(data59s.challenged_prediction_home).toBe(1);
  });
});

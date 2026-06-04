import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAnonClient,
  createAuthedClient,
  createServiceRoleClient,
} from "./setup";

// Story 2.1 — AC #2/#3: time-gating de RLS sobre `predictions`.
// Regla: un usuario solo puede leer la predicción de OTRO miembro de su liga
// cuando el partido está desbloqueado por tiempo (now() >= match_time - 1 min).
// Antes del umbral, RLS oculta la fila (SELECT devuelve 0 filas, sin error).
// El dueño ve siempre la suya; un usuario ajeno a la liga o anónimo nunca ve nada.
//
// IMPORTANTE sobre la semántica de RLS: un SELECT filtrado por RLS NO da error,
// simplemente devuelve menos filas. Por eso afirmamos `data.length`, no `error`.

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

/** Crea un usuario confirmado y devuelve {id, token} autenticado (mismo patrón que schema-rls.test.ts). */
async function createAuthedUser(): Promise<{ id: string; token: string }> {
  const email = uniqueEmail("pred");
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

// Fixtures compartidos por todo el archivo.
let userA: { id: string; token: string }; // dueño de las predicciones
let userB: { id: string; token: string }; // rival de la MISMA liga
let userC: { id: string; token: string }; // ajeno a la liga
let leagueId: string;
let futureMatchId: string; // match_time en el futuro → bloqueado
let unlockedMatchId: string; // match_time en el pasado → desbloqueado

beforeAll(async () => {
  userA = await createAuthedUser();
  userB = await createAuthedUser();
  userC = await createAuthedUser();

  // Liga + membresías con service_role (bypassa RLS). A y B miembros; C fuera.
  const { data: league, error: lErr } = await admin
    .from("leagues")
    .insert({
      name: "Liga Time-Gating",
      created_by: userA.id,
      invite_code: uniqueInvite(),
    })
    .select("id")
    .single();
  expect(lErr).toBeNull();
  leagueId = league!.id;
  createdLeagueIds.push(leagueId);

  const { error: mErr } = await admin.from("league_members").insert([
    { league_id: leagueId, user_id: userA.id, role: "admin" },
    { league_id: leagueId, user_id: userB.id, role: "member" },
  ]);
  expect(mErr).toBeNull();

  // Dos partidos: uno futuro (bloqueado) y uno ya iniciado (desbloqueado).
  const { data: matches, error: matchErr } = await admin
    .from("matches")
    .insert([
      {
        home_team: "Argentina",
        away_team: "México",
        match_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        status: "scheduled",
      },
      {
        home_team: "Brasil",
        away_team: "Ecuador",
        match_time: new Date(Date.now() - 60 * 1000).toISOString(),
        status: "live",
      },
    ])
    .select("id, match_time");
  expect(matchErr).toBeNull();
  // Ordenar por match_time: el más temprano es el desbloqueado (pasado).
  const sorted = [...matches!].sort(
    (a, b) =>
      new Date(a.match_time).getTime() - new Date(b.match_time).getTime(),
  );
  unlockedMatchId = sorted[0]!.id;
  futureMatchId = sorted[1]!.id;
  createdMatchIds.push(unlockedMatchId, futureMatchId);

  // userA crea su predicción del partido FUTURO (editable → insert permitido).
  const clientA = createAuthedClient(userA.token);
  const { error: pErr } = await clientA.from("predictions").insert({
    league_id: leagueId,
    match_id: futureMatchId,
    user_id: userA.id,
    home_score_pred: 2,
    away_score_pred: 1,
  });
  expect(pErr).toBeNull();

  // El partido desbloqueado ya pasó match_time - 1min: desde Story 2.4 la
  // ESCRITURA directa del cliente está bloqueada por la política de kickoff
  // (fn_match_editable). Sembramos esta predicción con service_role (bypassa
  // RLS) solo como fixture para el test de LECTURA desbloqueada.
  const { error: pErr2 } = await admin.from("predictions").insert({
    league_id: leagueId,
    match_id: unlockedMatchId,
    user_id: userA.id,
    home_score_pred: 0,
    away_score_pred: 3,
  });
  expect(pErr2).toBeNull();
});

afterAll(async () => {
  // Borrar matches y liga con service_role; los usuarios arrastran sus
  // predicciones/membresías vía FK on delete cascade al eliminar el usuario.
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

describe("RLS predictions: bloqueo antes del kickoff (AC #2)", () => {
  it("un rival de la misma liga NO ve la predicción ajena antes de match_time - 1min", async () => {
    const clientB = createAuthedClient(userB.token);
    const { data, error } = await clientB
      .from("predictions")
      .select("id")
      .eq("user_id", userA.id)
      .eq("match_id", futureMatchId);

    expect(error).toBeNull(); // RLS no da error en SELECT: solo oculta filas
    expect(data).toHaveLength(0);
  });
});

describe("RLS predictions: liberación al desbloquear (AC #2)", () => {
  it("un rival de la misma liga SÍ ve la predicción ajena cuando el partido está desbloqueado", async () => {
    const clientB = createAuthedClient(userB.token);
    const { data, error } = await clientB
      .from("predictions")
      .select("id, home_score_pred, away_score_pred")
      .eq("user_id", userA.id)
      .eq("match_id", unlockedMatchId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]!.home_score_pred).toBe(0);
    expect(data![0]!.away_score_pred).toBe(3);
  });
});

describe("RLS predictions: dueño y terceros (AC #3)", () => {
  it("el dueño ve su propia predicción incluso antes del kickoff", async () => {
    const clientA = createAuthedClient(userA.token);
    const { data, error } = await clientA
      .from("predictions")
      .select("id")
      .eq("user_id", userA.id)
      .eq("match_id", futureMatchId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("un usuario AJENO a la liga no ve la predicción ni siquiera con el partido desbloqueado", async () => {
    const clientC = createAuthedClient(userC.token);
    const { data, error } = await clientC
      .from("predictions")
      .select("id")
      .eq("user_id", userA.id)
      .eq("match_id", unlockedMatchId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("un usuario anónimo (anon) no ve ninguna predicción", async () => {
    const anon = createAnonClient();
    const { data, error } = await anon
      .from("predictions")
      .select("id")
      .eq("user_id", userA.id);

    // anon no tiene política de SELECT → 0 filas (sin error de RLS en SELECT).
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});

// Código de error de Postgres para violación de privilegio/RLS en ESCRITURA
// (RLS with_check fallido o privilegio de columna ausente → 42501).
const PERMISSION_DENIED = "42501";

describe("RLS predictions: denegación de ESCRITURA (hardening de review)", () => {
  let otherLeagueId: string; // liga donde userA NO es miembro

  beforeAll(async () => {
    const { data: other, error } = await admin
      .from("leagues")
      .insert({
        name: "Liga Ajena",
        created_by: userC.id,
        invite_code: uniqueInvite(),
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    otherLeagueId = other!.id;
    createdLeagueIds.push(otherLeagueId);
    await admin
      .from("league_members")
      .insert({ league_id: otherLeagueId, user_id: userC.id, role: "admin" });
  });

  it("un NO-miembro no puede insertar una predicción en la liga (RLS with_check)", async () => {
    const clientC = createAuthedClient(userC.token);
    const { error } = await clientC.from("predictions").insert({
      league_id: leagueId, // userC NO pertenece a esta liga
      match_id: futureMatchId,
      user_id: userC.id,
      home_score_pred: 1,
      away_score_pred: 0,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("anon no puede insertar una predicción", async () => {
    const anon = createAnonClient();
    const { error } = await anon.from("predictions").insert({
      league_id: leagueId,
      match_id: futureMatchId,
      user_id: userA.id,
      home_score_pred: 1,
      away_score_pred: 0,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("un usuario no puede reubicar su predicción a una liga ajena", async () => {
    // Doble defensa: league_id es inmutable (no se concede UPDATE de esa columna)
    // y, aunque se concediera, el with_check exige fn_user_in_league(league_id).
    const clientA = createAuthedClient(userA.token);
    const { error } = await clientA
      .from("predictions")
      .update({ league_id: otherLeagueId }) // liga donde A no es miembro
      .eq("user_id", userA.id)
      .eq("match_id", futureMatchId);
    expect(error).not.toBeNull();
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("un usuario no puede escribir points_earned (privilegio de columna revocado)", async () => {
    const clientA = createAuthedClient(userA.token);
    const { error } = await clientA
      .from("predictions")
      .update({ points_earned: 999 })
      .eq("user_id", userA.id)
      .eq("match_id", futureMatchId);
    expect(error).not.toBeNull();
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("un usuario no puede escribir multiplier (privilegio de columna revocado)", async () => {
    const clientA = createAuthedClient(userA.token);
    const { error } = await clientA
      .from("predictions")
      .update({ multiplier: 5 })
      .eq("user_id", userA.id)
      .eq("match_id", futureMatchId);
    expect(error).not.toBeNull();
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("el dueño SÍ puede editar su propio marcador (no rompimos la ruta válida)", async () => {
    const clientA = createAuthedClient(userA.token);
    const { error } = await clientA
      .from("predictions")
      .update({ home_score_pred: 4, away_score_pred: 0 })
      .eq("user_id", userA.id)
      .eq("match_id", futureMatchId);
    expect(error).toBeNull();
  });
});

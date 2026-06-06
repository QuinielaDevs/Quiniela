import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createAnonClient,
  createAuthedClient,
  createServiceRoleClient,
} from "./setup";
import type { Prediction } from "@/types";

function runSql(sql: string): void {
  const containerName = `supabase_db_${basename(process.cwd()).toLowerCase()}`;
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    { input: sql, encoding: "utf8" },
  );
}

// `.rpc(...).single()` infiere la fila como {}; la RPC retorna public.predictions.
function asPrediction(row: unknown): Prediction {
  return row as Prediction;
}

// Story 2.4 — RPC fn_save_prediction (server-authoritative):
//  - calcula y persiste `multiplier` con now() del servidor (lotes de días);
//  - recalcula a la baja al editar cuando el kickoff está más cerca;
//  - el rol `authenticated` NO puede escribir `multiplier` directamente;
//  - bloquea escritura (RPC y directa) tras match_time - 1 minuto;
//  - el dueño conserva la lectura de su propia predicción.

const admin = createServiceRoleClient();
const createdUserIds: string[] = [];
const createdLeagueIds: string[] = [];
const createdMatchIds: string[] = [];

const PERMISSION_DENIED = "42501";
const DAY_MS = 24 * 60 * 60 * 1000;

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}
function uniqueInvite(): string {
  return `INV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createAuthedUser(): Promise<{ id: string; token: string }> {
  const email = uniqueEmail("save");
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

async function insertMatchWithMatchday(
  matchTimeIso: string,
  matchday: number,
): Promise<string> {
  const { data, error } = await admin
    .from("matches")
    .insert({
      home_team: "Argentina",
      away_team: "México",
      match_time: matchTimeIso,
      status: "scheduled",
      matchday,
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  createdMatchIds.push(data!.id);
  return data!.id;
}

async function insertTbdKnockoutMatch(matchTimeIso: string): Promise<string> {
  const { data, error } = await admin
    .from("matches")
    .insert({
      external_ref: `test-tbd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      home_team: "Por definir",
      away_team: "Por definir",
      home_team_code: null,
      away_team_code: null,
      match_time: matchTimeIso,
      status: "scheduled",
      stage: "round-32",
      bracket_slot: Math.floor(10_000 + Math.random() * 1_000_000),
      home_source: "1A",
      away_source: "2B",
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  createdMatchIds.push(data!.id);
  return data!.id;
}

let userA: { id: string; token: string };
let userB: { id: string; token: string }; // NO miembro
let leagueId: string;

beforeAll(async () => {
  userA = await createAuthedUser();
  userB = await createAuthedUser();

  const { data: league, error: lErr } = await admin
    .from("leagues")
    .insert({
      name: "Liga Multiplicador",
      created_by: userA.id,
      invite_code: uniqueInvite(),
    })
    .select("id")
    .single();
  expect(lErr).toBeNull();
  leagueId = league!.id;
  createdLeagueIds.push(leagueId);

  const { error: mErr } = await admin
    .from("league_members")
    .insert({ league_id: leagueId, user_id: userA.id, role: "admin" });
  expect(mErr).toBeNull();

  // Shift all matches 100 days into the future so seeded matches don't lock min(match_time) near-current time
  runSql("update public.matches set match_time = match_time + interval '100 days';");
});

afterAll(async () => {
  // Restore matches
  runSql("update public.matches set match_time = match_time - interval '100 days';");

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

afterEach(async () => {
  for (const id of createdMatchIds) {
    await admin.from("matches").delete().eq("id", id);
  }
  createdMatchIds.length = 0;
});

describe("fn_save_prediction: multiplicador y upsert", () => {
  it("guarda una prediccion futura (>=35d) con multiplier 2.50 y recalcula a la baja al acercarse el kickoff", async () => {
    const matchId = await insertMatch(
      new Date(Date.now() + 40 * DAY_MS).toISOString(),
    );
    const clientA = createAuthedClient(userA.token);

    const { data: created, error: e1 } = await clientA
      .rpc("fn_save_prediction", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_home_score_pred: 2,
        p_away_score_pred: 1,
      })
      .single();
    expect(e1).toBeNull();
    const createdRow = asPrediction(created);
    expect(Number(createdRow.multiplier)).toBe(2.5);
    expect(createdRow.home_score_pred).toBe(2);

    // Simula que el kickoff se acerca: ahora a 10 días → al re-guardar baja a 1.30.
    const { error: upErr } = await admin
      .from("matches")
      .update({ match_time: new Date(Date.now() + 10 * DAY_MS).toISOString() })
      .eq("id", matchId);
    expect(upErr).toBeNull();

    const { data: edited, error: e2 } = await clientA
      .rpc("fn_save_prediction", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_home_score_pred: 3,
        p_away_score_pred: 0,
      })
      .single();
    expect(e2).toBeNull();
    const editedRow = asPrediction(edited);
    expect(Number(editedRow.multiplier)).toBe(1.3);
    expect(editedRow.home_score_pred).toBe(3);
    expect(editedRow.away_score_pred).toBe(0);
    // Mismo registro (upsert sobre unique(league_id,user_id,match_id)).
    expect(editedRow.id).toBe(createdRow.id);
  });

  it("Jornada 1 es línea base: multiplier 1.00 aunque la antelación sea >=35d", async () => {
    const matchId = await insertMatchWithMatchday(
      new Date(Date.now() + 40 * DAY_MS).toISOString(),
      1,
    );
    const clientA = createAuthedClient(userA.token);

    const { data, error } = await clientA
      .rpc("fn_save_prediction", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_home_score_pred: 2,
        p_away_score_pred: 1,
      })
      .single();
    expect(error).toBeNull();
    // Sin la regla de Jornada 1 sería 2.50 (40 días de antelación); con ella, 1.00.
    expect(Number(asPrediction(data).multiplier)).toBe(1.0);
  });

  it("Jornada 2 sí escala por antelación (>=35d → 2.50)", async () => {
    const matchId = await insertMatchWithMatchday(
      new Date(Date.now() + 40 * DAY_MS).toISOString(),
      2,
    );
    const clientA = createAuthedClient(userA.token);

    const { data, error } = await clientA
      .rpc("fn_save_prediction", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_home_score_pred: 0,
        p_away_score_pred: 0,
      })
      .single();
    expect(error).toBeNull();
    expect(Number(asPrediction(data).multiplier)).toBe(2.5);
  });

  it("el dueño conserva la lectura de su propia prediccion", async () => {
    const matchId = await insertMatch(
      new Date(Date.now() + 20 * DAY_MS).toISOString(),
    );
    const clientA = createAuthedClient(userA.token);
    await clientA
      .rpc("fn_save_prediction", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_home_score_pred: 1,
        p_away_score_pred: 1,
      })
      .single();

    const { data, error } = await clientA
      .from("predictions")
      .select("id, multiplier")
      .eq("user_id", userA.id)
      .eq("match_id", matchId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(Number(data![0]!.multiplier)).toBe(1.6); // 20 días → 1.60
  });

  it("un NO miembro no puede guardar via RPC", async () => {
    const matchId = await insertMatch(
      new Date(Date.now() + 5 * DAY_MS).toISOString(),
    );
    const clientB = createAuthedClient(userB.token);
    const { error } = await clientB
      .rpc("fn_save_prediction", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_home_score_pred: 0,
        p_away_score_pred: 0,
      })
      .single();
    expect(error).not.toBeNull();
  });
});

describe("fn_save_prediction: bloqueo por kickoff (cierra diferido de 2.1)", () => {
  it("la RPC falla para knockout TBD aunque el kickoff sea futuro", async () => {
    const matchId = await insertTbdKnockoutMatch(
      new Date(Date.now() + 20 * DAY_MS).toISOString(),
    );
    const clientA = createAuthedClient(userA.token);

    const { error } = await clientA
      .rpc("fn_save_prediction", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_home_score_pred: 1,
        p_away_score_pred: 0,
      })
      .single();

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toContain("cerrado");
  });

  it("la RPC falla cuando el kickoff ya ocurrió (exact match_time threshold)", async () => {
    const matchId = await insertMatch(
      new Date(Date.now() - 5 * 1000).toISOString(), // 5s en el pasado
    );
    const clientA = createAuthedClient(userA.token);
    const { error } = await clientA
      .rpc("fn_save_prediction", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_home_score_pred: 1,
        p_away_score_pred: 0,
      })
      .single();
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toContain("cerrado");
  });

  it("la escritura DIRECTA (insert) tambien falla tras el umbral de kickoff", async () => {
    const matchId = await insertMatch(
      new Date(Date.now() - 5 * 1000).toISOString(), // 5s en el pasado
    );
    const clientA = createAuthedClient(userA.token);
    const { error } = await clientA.from("predictions").insert({
      league_id: leagueId,
      match_id: matchId,
      user_id: userA.id,
      home_score_pred: 1,
      away_score_pred: 0,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("el rol authenticated no puede escribir multiplier por la RPC ni directo", async () => {
    const matchId = await insertMatch(
      new Date(Date.now() + 15 * DAY_MS).toISOString(),
    );
    const clientA = createAuthedClient(userA.token);
    // La RPC ignora cualquier intento del cliente de fijar multiplier (no es
    // parámetro); el valor lo calcula el servidor.
    const { data, error } = await clientA
      .rpc("fn_save_prediction", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_home_score_pred: 2,
        p_away_score_pred: 2,
      })
      .single();
    expect(error).toBeNull();
    expect(Number(asPrediction(data).multiplier)).toBe(1.6); // 15 días → 1.60, no manipulable

    // Update directo de multiplier sigue denegado por privilegio de columna.
    const { error: tamper } = await clientA
      .from("predictions")
      .update({ multiplier: 5 })
      .eq("user_id", userA.id)
      .eq("match_id", matchId);
    expect(tamper).not.toBeNull();
    expect(tamper?.code).toBe(PERMISSION_DENIED);
  });
});

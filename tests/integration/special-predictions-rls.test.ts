import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAnonClient,
  createAuthedClient,
  createServiceRoleClient,
} from "./setup";

// Story 6.1 — RLS, FK compuesta y trigger de los Premios Especiales.
// Reutiliza el patrón de schema-rls.test.ts: service_role para fixtures (bypassa
// RLS), createAuthedUser() para una identidad real bajo RLS.
//
// Recordatorio: las predicciones son POR LIGA. La escritura exige, además de
// user_id = auth.uid(), pertenecer a la liga (fn_user_in_league) → cada usuario
// crea su liga y se une como 'member' antes de pronosticar.

const admin = createServiceRoleClient();
const createdUserIds: string[] = [];
const createdCandidateIds: string[] = [];

beforeAll(async () => {
  await admin
    .from("matches")
    .update({ match_time: new Date(Date.now() + 86400 * 30 * 1000).toISOString() })
    .eq("stage", "final");
});

afterAll(async () => {
  // Borrar usuarios cascadea profiles → leagues/league_members/special_predictions.
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await admin.auth.admin.deleteUser(id);
  }
  // Los candidatos los crea el admin (sin vínculo a usuario); ya sin predicciones
  // que los referencien (on delete restrict), se pueden borrar.
  if (createdCandidateIds.length > 0) {
    await admin.from("award_candidates").delete().in("id", createdCandidateIds);
  }
});

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

function uniqueInvite(): string {
  return `INV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Crea un usuario confirmado y devuelve {id, token} autenticado. */
async function createAuthedUser(): Promise<{ id: string; token: string }> {
  const email = uniqueEmail("award");
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

/** Crea un candidato vía service_role (el catálogo lo gestiona el admin). */
async function createCandidate(
  category: "champion" | "top_scorer" | "mvp",
  name: string,
): Promise<string> {
  const { data, error } = await admin
    .from("award_candidates")
    .insert({ category, name })
    .select("id")
    .single();
  expect(error).toBeNull();
  createdCandidateIds.push(data!.id);
  return data!.id;
}

/** Crea una liga del usuario y lo une como 'member'; devuelve el league_id. */
async function createLeagueWithMembership(user: {
  id: string;
  token: string;
}): Promise<string> {
  const client = createAuthedClient(user.token);
  const { data: league, error: lErr } = await client
    .from("leagues")
    .insert({
      name: "Liga Premios",
      created_by: user.id,
      invite_code: uniqueInvite(),
    })
    .select("id")
    .single();
  expect(lErr).toBeNull();

  const { error: mErr } = await client.from("league_members").insert({
    league_id: league!.id,
    user_id: user.id,
    role: "member",
  });
  expect(mErr).toBeNull();
  return league!.id;
}

// Violación de RLS ("new row violates row-level security policy").
const RLS_VIOLATION = "42501";
// Violación de FK (foreign_key_violation) — distinta de RLS.
const FK_VIOLATION = "23503";

describe("award_candidates: catálogo de solo lectura", () => {
  it("authenticated puede leer candidatos activos", async () => {
    const c1 = await createCandidate("champion", "Selección Test A");
    const user = await createAuthedUser();
    const client = createAuthedClient(user.token);

    const { data, error } = await client
      .from("award_candidates")
      .select("id, category, name")
      .eq("id", c1);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]!.category).toBe("champion");
  });

  it("authenticated NO puede insertar candidatos (bloqueado por RLS)", async () => {
    const user = await createAuthedUser();
    const client = createAuthedClient(user.token);

    const { error } = await client
      .from("award_candidates")
      .insert({ category: "champion", name: "Candidato Pirata" });

    expect(error).not.toBeNull();
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("authenticated NO puede actualizar candidatos (bloqueado por RLS)", async () => {
    const c1 = await createCandidate("mvp", "Jugador Test MVP");
    const user = await createAuthedUser();
    const client = createAuthedClient(user.token);

    const { error } = await client
      .from("award_candidates")
      .update({ name: "Hackeado" })
      .eq("id", c1);

    // Sin política de update, RLS no expone filas para actualizar: la operación
    // afecta 0 filas SIN error. Verificamos que el nombre NO cambió.
    expect(error).toBeNull();
    const { data } = await admin
      .from("award_candidates")
      .select("name")
      .eq("id", c1)
      .single();
    expect(data!.name).toBe("Jugador Test MVP");
  });
});

describe("special_predictions: privadas, por usuario y por liga", () => {
  it("un usuario hace upsert de su predicción y la lee", async () => {
    const user = await createAuthedUser();
    const leagueId = await createLeagueWithMembership(user);
    const candidateId = await createCandidate("champion", "Campeón Elegido");
    const client = createAuthedClient(user.token);

    const { error: upErr } = await client.from("special_predictions").upsert(
      {
        user_id: user.id,
        league_id: leagueId,
        category: "champion",
        candidate_id: candidateId,
      },
      { onConflict: "user_id,league_id,category" },
    );
    expect(upErr).toBeNull();

    const { data, error } = await client
      .from("special_predictions")
      .select("candidate_id, category, league_id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]!.candidate_id).toBe(candidateId);
  });

  it("un usuario NO puede leer la predicción de otro usuario", async () => {
    const userA = await createAuthedUser();
    const leagueId = await createLeagueWithMembership(userA);
    const candidateId = await createCandidate("mvp", "MVP de A");
    const clientA = createAuthedClient(userA.token);

    await clientA.from("special_predictions").insert({
      user_id: userA.id,
      league_id: leagueId,
      category: "mvp",
      candidate_id: candidateId,
    });

    // Otro usuario (sin acceso a la liga ni a la fila) no ve nada.
    const userB = await createAuthedUser();
    const clientB = createAuthedClient(userB.token);
    const { data, error } = await clientB
      .from("special_predictions")
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("un usuario NO puede insertar una predicción con user_id ajeno (RLS)", async () => {
    const userA = await createAuthedUser();
    const leagueId = await createLeagueWithMembership(userA);
    const candidateId = await createCandidate("champion", "Campeón Ajeno");
    const userB = await createAuthedUser();
    const clientB = createAuthedClient(userB.token);

    const { error } = await clientB.from("special_predictions").insert({
      user_id: userA.id, // distinto de auth.uid() → with_check falla
      league_id: leagueId,
      category: "champion",
      candidate_id: candidateId,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("al abandonar o ser expulsado de una liga (delete de league_members), se eliminan automáticamente sus special_predictions asociadas (trigger)", async () => {
    const user = await createAuthedUser();
    const leagueId = await createLeagueWithMembership(user);
    const candidateId = await createCandidate("champion", "Campeón Test Limpieza");
    const client = createAuthedClient(user.token);

    // 1. Insertamos la predicción
    const { error: insErr } = await client.from("special_predictions").insert({
      user_id: user.id,
      league_id: leagueId,
      category: "champion",
      candidate_id: candidateId,
    });
    expect(insErr).toBeNull();

    // Confirmamos que existe
    const { data: beforeDel } = await admin
      .from("special_predictions")
      .select("id")
      .eq("user_id", user.id)
      .eq("league_id", leagueId);
    expect(beforeDel).toHaveLength(1);

    // 2. Eliminamos al miembro de la liga (simula abandono o expulsión)
    const { error: delErr } = await admin
      .from("league_members")
      .delete()
      .eq("user_id", user.id)
      .eq("league_id", leagueId);
    expect(delErr).toBeNull();

    // 3. Confirmamos que la predicción fue eliminada en cascada por el trigger
    const { data: afterDel } = await admin
      .from("special_predictions")
      .select("id")
      .eq("user_id", user.id)
      .eq("league_id", leagueId);
    expect(afterDel).toHaveLength(0);
  });
});

describe("integridad de categoría (FK compuesta) y trigger de predicted_at", () => {
  it("rechaza un candidato cuya categoría NO coincide (FK, no RLS)", async () => {
    const user = await createAuthedUser();
    const leagueId = await createLeagueWithMembership(user);
    // Candidato de top_scorer usado como 'champion' → FK compuesta debe romper.
    const scorerId = await createCandidate("top_scorer", "Goleador X");
    const client = createAuthedClient(user.token);

    const { error } = await client.from("special_predictions").insert({
      user_id: user.id,
      league_id: leagueId,
      category: "champion",
      candidate_id: scorerId,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe(FK_VIOLATION);
    expect(error?.code).not.toBe(RLS_VIOLATION);
  });

  it("predicted_at se refresca al cambiar de candidato (trigger)", async () => {
    const user = await createAuthedUser();
    const leagueId = await createLeagueWithMembership(user);
    const first = await createCandidate("mvp", "MVP Inicial");
    const second = await createCandidate("mvp", "MVP Nuevo");
    const client = createAuthedClient(user.token);

    const { data: inserted, error: insErr } = await client
      .from("special_predictions")
      .insert({
        user_id: user.id,
        league_id: leagueId,
        category: "mvp",
        candidate_id: first,
      })
      .select("id, predicted_at")
      .single();
    expect(insErr).toBeNull();
    const before = new Date(inserted!.predicted_at).getTime();

    const { data: updated, error: updErr } = await client
      .from("special_predictions")
      .update({ candidate_id: second })
      .eq("id", inserted!.id)
      .select("predicted_at")
      .single();
    expect(updErr).toBeNull();
    const after = new Date(updated!.predicted_at).getTime();

    expect(after).toBeGreaterThan(before);
  });
});

describe("bloqueo de predicciones por fase de torneo (trigger)", () => {
  const dummyMatchId = "00000000-0000-0000-0000-000000000000";

  beforeAll(async () => {
    // Aseguramos estado inicial limpio: todas las fases desbloqueadas
    await admin
      .from("tournament_phases")
      .update({ edits_locked: false })
      .neq("phase_code", "");

    // Insertar un partido final dummy si no existe
    const { data: existing } = await admin
      .from("matches")
      .select("id")
      .eq("stage", "final");

    if (!existing || existing.length === 0) {
      await admin.from("matches").insert({
        id: dummyMatchId,
        home_team: "TBD",
        away_team: "TBD",
        stage: "final",
        status: "scheduled",
        match_time: new Date(Date.now() + 86400 * 1000).toISOString(),
      });
    }
  });

  afterAll(async () => {
    await admin.from("matches").delete().eq("id", dummyMatchId);
  });

  async function setFinalKickoff(inPast: boolean) {
    const matchTime = inPast
      ? new Date(Date.now() - 3600 * 1000).toISOString()
      : new Date(Date.now() + 86400 * 1000).toISOString();
    await admin
      .from("matches")
      .update({ match_time: matchTime })
      .eq("stage", "final");
  }

  it("bloquea inserciones y actualizaciones si la final ha comenzado", async () => {
    const user = await createAuthedUser();
    const leagueId = await createLeagueWithMembership(user);
    const candidateId = await createCandidate("champion", "Candidato de Bloqueo");
    const client = createAuthedClient(user.token);

    // 1. Bloqueamos poniendo la final en el pasado
    await setFinalKickoff(true);

    try {
      // 2. Intentamos insertar
      const { error: insertErr } = await client.from("special_predictions").insert({
        user_id: user.id,
        league_id: leagueId,
        category: "champion",
        candidate_id: candidateId,
      });

      // 3. Debe fallar por el trigger
      expect(insertErr).not.toBeNull();
      expect(insertErr?.code).toBe("P0001");
      expect(insertErr?.message).toContain("bloqueadas");
    } finally {
      // 4. Restauramos final al futuro
      await setFinalKickoff(false);
    }
  });

  it("permite eliminaciones (DELETE) incluso si la final ha comenzado", async () => {
    const user = await createAuthedUser();
    const leagueId = await createLeagueWithMembership(user);
    const candidateId = await createCandidate("champion", "Candidato a Borrar");
    const client = createAuthedClient(user.token);

    // 1. Insertamos primero en estado desbloqueado
    await setFinalKickoff(false);
    const { error: insErr } = await client.from("special_predictions").insert({
      user_id: user.id,
      league_id: leagueId,
      category: "champion",
      candidate_id: candidateId,
    });
    expect(insErr).toBeNull();

    // 2. Bloqueamos poniendo la final en el pasado
    await setFinalKickoff(true);

    try {
      // 3. Intentamos eliminar como admin (service role) para no fallar por RLS de delete
      const { error: delErr } = await admin
        .from("special_predictions")
        .delete()
        .eq("user_id", user.id)
        .eq("league_id", leagueId)
        .eq("category", "champion");

      expect(delErr).toBeNull();
    } finally {
      // 4. Restauramos final al futuro
      await setFinalKickoff(false);
    }
  });
});

// Seed determinista para los tests e2e de la página de predicciones.
// Crea: una liga, el usuario de prueba como miembro, varios partidos en
// distintos estados (scheduled/live/finished/suspended/canceled + un TBD),
// y predicciones del usuario para los partidos finalizados (con diferentes
// resultados: exacto, parcial, fallo) para ejercitar el modo resultado.
//
// Devuelve un objeto con cleanup() que borra TODO lo creado (orden inverso
// para respetar FKs).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SeededMatch {
  id: string;
  home: string;
  away: string;
  home_team_code: string | null;
  away_team_code: string | null;
  status: "scheduled" | "live" | "finished" | "suspended" | "canceled";
  home_score: number | null;
  away_score: number | null;
  matchday: number | null;
  stage: string | null;
  group_label: string | null;
  expectedPrediction?: { home: number; away: number; multiplier: number };
}

export interface SeedResult {
  leagueId: string;
  userId: string;
  matches: SeededMatch[];
  cleanup: () => Promise<void>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name}. Necesario para el seed e2e.`,
    );
  }
  return value;
}

function createAdminClient(): SupabaseClient {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function isoDaysFromNow(daysOffset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysOffset);
  d.setUTCHours(20, 0, 0, 0);
  return d.toISOString();
}

export async function seedPredictionsE2E(userId: string): Promise<SeedResult> {
  const admin = createAdminClient();
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdLeagueName = `E2E Test League ${runId}`;
  const createdInviteCode = `E2E${runId.toUpperCase()}`;
  // Limpieza previa: borra partidos de runs anteriores del seed. Se hace
  // por nombre (prefijo `test_`) en lugar de por FK para no necesitar las
  // ids de runs previos, y porque estos partidos no tienen predicciones de
  // otros usuarios (solo del propio test user que ya está siendo borrado).
  // Si la BD tiene datos reales de WC2026, no se ven afectados porque
  // esos no usan el prefijo `test_`.
  await admin.from("matches").delete().like("home_team", "test_%");

  // 1) Crear la liga
  const { data: league, error: leagueErr } = await admin
    .from("leagues")
    .insert({
      name: createdLeagueName,
      invite_code: createdInviteCode,
      created_by: userId,
    })
    .select("id")
    .single();
  if (leagueErr || !league) {
    throw new Error(`Error creando liga e2e: ${leagueErr?.message}`);
  }
  const leagueId = league.id;

  // 2) Crear el profile del usuario (lo crea el trigger de auth.users, pero
  //    forzamos su creación por si el trigger no se ha disparado aún). Si ya
  //    existe (caso típico), .upsert() no hace nada.
  await admin
    .from("profiles")
    .upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true });

  // 3) Crear el league_member (rol admin para no tener que aceptar invitaciones)
  await admin.from("league_members").insert({
    league_id: leagueId,
    user_id: userId,
    role: "admin",
    payment_status: "paid",
  });

  // 4) Setear como liga activa del usuario (la página lee active_league_id)
  //    NOTA: hay una RPC fn_set_active_league, pero un upsert directo funciona
  //    también con service role.
  await admin
    .from("profiles")
    .update({ active_league_id: leagueId })
    .eq("id", userId);

  // 5) Crear partidos: 3 finalizados (J1) + 1 scheduled (J1) + 1 scheduled (J2) + 1 TBD (semi) + 1 live + 1 suspended.
  //    Los nombres usan el prefijo `test_` + nombre del país en lowercase para
  //    que sean visualmente identificables como data de testing y para que
  //    el cleanup por `home_team LIKE 'test_%'` los identifique sin ambigüedad.
  //    `home_team_code` y `away_team_code` se mantienen con los códigos FIFA
  //    reales para que las banderas (`flagForTeamCode`) sigan funcionando.
  const matchRows: SeededMatch[] = [
    {
      id: "",
      home: "test_argentina",
      away: "test_bolivia",
      home_team_code: "ARG",
      away_team_code: "BOL",
      status: "finished",
      home_score: 3,
      away_score: 0,
      matchday: 1,
      stage: "group",
      group_label: "A",
      expectedPrediction: { home: 2, away: 0, multiplier: 1.25 }, // 2*1.25 = 2.50 pts (parcial con multiplicador)
    },
    {
      id: "",
      home: "test_brasil",
      away: "test_colombia",
      home_team_code: "BRA",
      away_team_code: "COL",
      status: "finished",
      home_score: 1,
      away_score: 1,
      matchday: 1,
      stage: "group",
      group_label: "B",
      expectedPrediction: { home: 1, away: 1, multiplier: 1.25 }, // 5*1.25 = 6.25 pts (exacto)
    },
    {
      id: "",
      home: "test_uruguay",
      away: "test_chile",
      home_team_code: "URU",
      away_team_code: "CHI",
      status: "finished",
      home_score: 0,
      away_score: 2,
      matchday: 1,
      stage: "group",
      group_label: "C",
      expectedPrediction: { home: 1, away: 0, multiplier: 1.0 }, // 0 pts (fallo)
    },
    {
      id: "",
      home: "test_ecuador",
      away: "test_peru",
      home_team_code: "ECU",
      away_team_code: "PER",
      status: "scheduled",
      home_score: null,
      away_score: null,
      matchday: 1,
      stage: "group",
      group_label: "A",
    },
    {
      id: "",
      home: "test_mexico",
      away: "test_canada",
      home_team_code: "MEX",
      away_team_code: "CAN",
      status: "scheduled",
      home_score: null,
      away_score: null,
      matchday: 2,
      stage: "group",
      group_label: "D",
    },
    {
      id: "",
      home: "Por definir",
      away: "Por definir",
      home_team_code: null,
      away_team_code: null,
      status: "scheduled",
      home_score: null,
      away_score: null,
      matchday: null,
      stage: "semi",
      group_label: null,
    },
    {
      id: "",
      home: "test_espana",
      away: "test_alemania",
      home_team_code: "ESP",
      away_team_code: "GER",
      status: "live",
      home_score: 1,
      away_score: 0,
      matchday: 1,
      stage: "group",
      group_label: "E",
    },
    {
      id: "",
      home: "test_francia",
      away: "test_italia",
      home_team_code: "FRA",
      away_team_code: "ITA",
      status: "suspended",
      home_score: null,
      away_score: null,
      matchday: 2,
      stage: "group",
      group_label: "F",
    },
  ];

  // match_time: scheduled/live con fechas relativas (ayer/mañana) para que
  // los multiplicadores/distancia de jornada sean razonables en el seed.
  const rowsForInsert = matchRows.map((m) => {
    let match_time: string;
    if (m.status === "finished") match_time = isoDaysFromNow(-2);
    else if (m.status === "live") match_time = isoDaysFromNow(0);
    else if (m.status === "suspended") match_time = isoDaysFromNow(-1);
    else {
      // scheduled: J1 mañana, J2 pasado mañana, TBD dentro de 5 días
      const days =
        m.matchday === 1 ? 1 : m.matchday === 2 ? 2 : m.matchday === null ? 5 : 3;
      match_time = isoDaysFromNow(days);
    }
    return {
      home_team: m.home,
      away_team: m.away,
      home_team_code: m.home_team_code,
      away_team_code: m.away_team_code,
      status: m.status,
      home_score: m.home_score,
      away_score: m.away_score,
      matchday: m.matchday,
      stage: m.stage,
      group_label: m.group_label,
      match_time,
    };
  });

  const { data: insertedMatches, error: matchesErr } = await admin
    .from("matches")
    .insert(rowsForInsert)
    .select("id, home_team, away_team, status, home_score, away_score");
  if (matchesErr || !insertedMatches) {
    throw new Error(`Error creando partidos e2e: ${matchesErr?.message}`);
  }

  const matchIdByName = new Map<string, string>();
  for (const m of insertedMatches) {
    matchIdByName.set(m.home_team, m.id);
  }

  // 6) Crear predicciones del usuario para los partidos finalizados
  //    (la página también las traerá con .select). Para los partidos scheduled
  //    dejamos que fn_ensure_default_predictions rellene 0-0 (la página lo
  //    llama), pero para no depender de eso, también insertamos 0-0 directo.
  const predictionsToInsert: Array<{
    league_id: string;
    match_id: string;
    user_id: string;
    home_score_pred: number;
    away_score_pred: number;
    multiplier: number;
  }> = [];
  for (const m of matchRows) {
    if (m.status === "finished" && m.expectedPrediction) {
      const id = matchIdByName.get(m.home);
      if (id) {
        predictionsToInsert.push({
          league_id: leagueId,
          match_id: id,
          user_id: userId,
          home_score_pred: m.expectedPrediction.home,
          away_score_pred: m.expectedPrediction.away,
          multiplier: m.expectedPrediction.multiplier,
        });
      }
    }
  }
  for (const m of matchRows) {
    if (m.status === "scheduled" || m.status === "live") {
      const id = matchIdByName.get(m.home);
      if (id) {
        predictionsToInsert.push({
          league_id: leagueId,
          match_id: id,
          user_id: userId,
          home_score_pred: 0,
          away_score_pred: 0,
          multiplier: 1.0,
        });
      }
    }
  }
  if (predictionsToInsert.length > 0) {
    const { error: predErr } = await admin
      .from("predictions")
      .insert(predictionsToInsert);
    if (predErr) {
      throw new Error(`Error creando predicciones e2e: ${predErr.message}`);
    }
  }

  // 7) Para los partidos finalizados, calcular points_earned y evaluated_at
  //    para que la UI los muestre con el valor del servidor. Esto espeja lo
  //    que hace el trigger fn_resolve_challenges_on_match_status_change
  //    (nos saltamos la transacción del trigger para evitar depender de él
  //    en e2e).
  for (const m of matchRows) {
    if (m.status !== "finished" || !m.expectedPrediction) continue;
    const id = matchIdByName.get(m.home);
    if (!id) continue;
    const pred = m.expectedPrediction;
    let base: number;
    if (pred.home === m.home_score && pred.away === m.away_score) base = 5;
    else if (
      Math.sign(pred.home - pred.away) === Math.sign(m.home_score! - m.away_score!)
    )
      base = 2;
    else base = 0;
    const points = Math.round(base * pred.multiplier * 100) / 100;
    await admin
      .from("predictions")
      .update({
        points_earned: points,
        evaluated_at: new Date().toISOString(),
      })
      .eq("match_id", id)
      .eq("user_id", userId);
  }

  // Cleanup en orden inverso (FKs). Borra por prefijo `test_` para limpiar
  // cualquier partido de tests que se haya colado (también lo hace el
  // pre-cleanup al inicio del seed, pero lo repetimos aquí para
  // idempotencia).
  const matchIds = insertedMatches.map((m) => m.id);
  const cleanup = async () => {
    await admin.from("predictions").delete().eq("league_id", leagueId);
    await admin.from("league_members").delete().eq("league_id", leagueId);
    await admin.from("leagues").delete().eq("id", leagueId);
    if (matchIds.length > 0) {
      await admin.from("matches").delete().in("id", matchIds);
    }
    // Safety net: borra cualquier otro match con prefijo test_ que se haya
    // colado de un run anterior sin cleanup exitoso.
    await admin.from("matches").delete().like("home_team", "test_%");
    await admin
      .from("profiles")
      .update({ active_league_id: null })
      .eq("id", userId);
  };

  const matches: SeededMatch[] = insertedMatches.map((m) => {
    const row = matchRows.find((r) => r.home === m.home_team)!;
    return {
      id: m.id,
      home: m.home_team,
      away: m.away_team,
      home_team_code: row.home_team_code,
      away_team_code: row.away_team_code,
      status: m.status as SeededMatch["status"],
      home_score: m.home_score,
      away_score: m.away_score,
      matchday: row.matchday,
      stage: row.stage,
      group_label: row.group_label,
      expectedPrediction: row.expectedPrediction,
    };
  });

  return { leagueId, userId, matches, cleanup };
}


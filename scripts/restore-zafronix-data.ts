/**
 * scripts/restore-zafronix-data.ts
 *
 * Story 8.3 — Script Administrativo de Sincronización y Restauración Completa.
 *
 * Script ejecutable de consola que carga TODOS los datos vigentes del Mundial 2026
 * desde la API de Zafronix y los resiembra / reconcilia contra la base local. A
 * diferencia del cron de respaldo (sync-matches.ts, Story 8.2), realiza una
 * solicitud GET DIRECTA (sin cabeceras condicionales If-None-Match) para forzar la
 * descarga del listado completo, e INSERTA los partidos ausentes además de
 * actualizar los existentes.
 *
 * Cuando un partido ya finalizado cambia de marcador, recalcula los puntos de las
 * predicciones YA evaluadas usando el motor de puntuación único
 * (src/utils/scoring.ts) y ajusta el ledger (predictions / league_members /
 * point_transactions) aplicando el DELTA exacto de forma atómica vía la RPC
 * fn_apply_accrual_correction. Las predicciones aún no evaluadas las puntúa el
 * trigger tr_resolve_challenges_on_match_status_change al actualizar el partido.
 *
 * Uso local:  npm run restore-zafronix-data   (requiere .env.local o variables de entorno)
 * Uso directo: npx tsx scripts/restore-zafronix-data.ts
 *
 * Variables de entorno requeridas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WC_API_KEY.
 */

import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  calculateBasePoints,
  calculatePredictionPoints,
  type MatchStatus,
} from "../src/utils/scoring";
import { normalizeTeamName, isPlaceholderTeam } from "./sync-matches";

// ── Cargar variables de entorno (solo relevante en ejecución local) ──
config({ path: ".env.local" });
config({ path: ".env" });

// ── Constantes ──────────────────────────────────────────────────────

const ZAFRONIX_API_URL =
  "https://api.zafronix.com/fifa/worldcup/v1/matches?year=2026";

// ── Zod Schemas ─────────────────────────────────────────────────────

/**
 * Schema de un partido de la respuesta de la API de Zafronix. Espeja
 * `zafronixMatchSchema` de sync-matches.ts y lo AMPLÍA con campos opcionales
 * (matchTime, matchday, group, sede, códigos ISO) necesarios para INSERTAR
 * partidos ausentes durante una restauración sobre base de datos vacía.
 */
const zafronixMatchSchema = z.object({
  id: z.string(),
  homeTeam: z.string(),
  awayTeam: z.string(),
  homeScore: z.number().int().nonnegative().nullable(),
  awayScore: z.number().int().nonnegative().nullable(),
  status: z.string(),
  stage: z.string().nullable().optional(),
  bracketSlot: z.number().int().nullable().optional(),
  // Campos opcionales para inserción de partidos nuevos:
  matchTime: z.string().nullable().optional(),
  matchday: z.number().int().nullable().optional(),
  groupLabel: z.string().nullable().optional(),
  homeTeamCode: z.string().nullable().optional(),
  awayTeamCode: z.string().nullable().optional(),
  homeSource: z.string().nullable().optional(),
  awaySource: z.string().nullable().optional(),
  venue: z.string().nullable().optional(),
});

type ZafronixMatch = z.infer<typeof zafronixMatchSchema>;

/**
 * La API retorna un objeto envoltorio con metadatos y la propiedad "data".
 */
const zafronixResponseSchema = z.object({
  year: z.number().int().optional(),
  count: z.number().int().optional(),
  data: z.array(zafronixMatchSchema),
});

// ── Tipos auxiliares ────────────────────────────────────────────────

/** Resumen del proceso de restauración (AC #6). */
export interface RestoreSummary {
  /** Partidos insertados que no existían localmente. */
  created: number;
  /** Partidos existentes actualizados por cambio de marcador/estado/equipos. */
  updated: number;
  /** Predicciones ya evaluadas recalculadas con corrección de ledger (delta != 0). */
  corrections: number;
  /** Operaciones fallidas (inserciones/actualizaciones/correcciones con error). */
  errors: number;
}

/** Forma mínima de un partido local consultado para el mapeo. */
interface LocalMatch {
  id: string;
  external_ref: string | null;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  status: string;
  bracket_slot: number | null;
  match_time: string | null;
  stage: string | null;
}

// ── Helpers de Normalización y Mapeo ─────────────────────────────────

/**
 * Mapea el status de la API de Zafronix a los status válidos de nuestra DB.
 * La DB acepta: 'scheduled' | 'live' | 'finished' | 'suspended' | 'canceled'.
 */
export function mapApiStatus(apiStatus: string): MatchStatus {
  switch (apiStatus.toLowerCase()) {
    case "finished":
    case "completed":
      return "finished";
    case "live":
    case "in_progress":
    case "in-progress":
      return "live";
    case "suspended":
    case "postponed":
      return "suspended";
    case "canceled":
    case "cancelled":
    case "abandoned":
      return "canceled";
    case "scheduled":
      return "scheduled";
    default:
      console.warn(
        `⚠️ Estado desconocido de la API: "${apiStatus}". Mapeando por defecto a "scheduled".`,
      );
      return "scheduled";
  }
}

/**
 * Normaliza los nombres de las fases (stage) al vocabulario interno de la base de datos:
 * 'group', 'round-32', 'round-16', 'quarter', 'semi', 'third-place', 'final'.
 */
export function normalizeStage(stage: string | null | undefined): string | null {
  if (!stage) return null;
  const s = stage.trim().toLowerCase();
  switch (s) {
    case "group":
    case "group_stage":
    case "group-stage":
    case "groups":
      return "group";
    case "round-32":
    case "round_of_32":
    case "round-of-32":
    case "last-32":
      return "round-32";
    case "round-16":
    case "round_of_16":
    case "round-of-16":
    case "last-16":
      return "round-16";
    case "quarter-finals":
    case "quarter-final":
    case "quarterfinals":
    case "quarterfinal":
    case "quarter":
    case "quarters":
      return "quarter";
    case "semi-finals":
    case "semi-final":
    case "semifinals":
    case "semifinal":
    case "semi":
    case "semis":
      return "semi";
    case "third-place":
    case "third_place":
    case "thirdplace":
    case "playoff-for-third-place":
    case "3rd-place":
      return "third-place";
    case "final":
    case "finals":
      return "final";
    default:
      return stage;
  }
}

/**
 * Realiza una petición externa con reintentos y tiempo límite de respuesta (timeout).
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
  retries = 3,
  delayMs = 1000,
): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 segundos timeout

    try {
      const response = await fetchFn(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const message = err instanceof Error ? err.message : String(err);
      if (attempt === retries) {
        throw new Error(`Fallo tras ${retries} intentos de red. Último error: ${message}`);
      }
      console.warn(`Intento de red ${attempt} fallido: ${message}. Reintentando en ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("Petición de red no alcanzada");
}

/**
 * Ejecuta una tarea asíncrona sobre una lista de elementos agrupados en lotes (concurrencia controlada).
 */
async function runInBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const chunkResults = await Promise.all(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}

/**
 * Resuelve el partido local correspondiente a un partido de la API usando los
 * mapas en memoria: external_ref → bracket_slot (eliminatorias) → nombres
 * normalizados (fase de grupos). Espeja la lógica de sync-matches.ts.
 */
function resolveLocalMatch(
  apiMatch: ZafronixMatch,
  localByRef: Map<string, LocalMatch>,
  localKnockoutBySlot: Map<number, LocalMatch>,
  localGroupByTeams: Map<string, LocalMatch>,
): LocalMatch | undefined {
  let local = localByRef.get(apiMatch.id);
  if (local) return local;

  const parts = apiMatch.id.split("-");
  const matchNum = parts.length > 1 && parts[1] ? parseInt(parts[1], 10) : NaN;
  if (isNaN(matchNum)) return undefined;

  if (matchNum >= 73) {
    local = localKnockoutBySlot.get(matchNum);
  } else if (apiMatch.homeTeam && apiMatch.awayTeam) {
    const key = `${normalizeTeamName(apiMatch.homeTeam)}|${normalizeTeamName(apiMatch.awayTeam)}`;
    local = localGroupByTeams.get(key);
  }
  return local;
}

/**
 * Construye la fila de inserción de un partido nuevo. Devuelve null si no se
 * puede determinar `match_time` (columna NOT NULL): preferimos OMITIR e informar
 * antes que insertar un kickoff inválido que corrompa el time-gating.
 */
function buildInsertRow(apiMatch: ZafronixMatch): Record<string, unknown> | null {
  if (!apiMatch.matchTime) {
    return null;
  }
  const mappedStatus = mapApiStatus(apiMatch.status);
  const isKnockout =
    apiMatch.bracketSlot !== null && apiMatch.bracketSlot !== undefined;

  // En eliminatorias evitamos persistir placeholders (TBD, 1A, W73...) como nombres reales.
  const homeIsReal = !isPlaceholderTeam(apiMatch.homeTeam);
  const awayIsReal = !isPlaceholderTeam(apiMatch.awayTeam);

  return {
    external_ref: apiMatch.id,
    home_team: isKnockout && !homeIsReal ? "Por definir" : apiMatch.homeTeam,
    away_team: isKnockout && !awayIsReal ? "Por definir" : apiMatch.awayTeam,
    home_team_code: apiMatch.homeTeamCode ?? null,
    away_team_code: apiMatch.awayTeamCode ?? null,
    home_score: apiMatch.homeScore,
    away_score: apiMatch.awayScore,
    match_time: apiMatch.matchTime,
    status: mappedStatus,
    matchday: apiMatch.matchday ?? null,
    stage: normalizeStage(apiMatch.stage),
    group_label: apiMatch.groupLabel ?? null,
    bracket_slot: apiMatch.bracketSlot ?? null,
    home_source: apiMatch.homeSource ?? null,
    away_source: apiMatch.awaySource ?? null,
    venue: apiMatch.venue ?? null,
  };
}

/**
 * Recalcula las predicciones YA evaluadas de un partido cuyo marcador/estado
 * cambió, aplicando el delta de puntos vía la RPC atómica
 * fn_apply_accrual_correction. Retorna el número de correcciones efectivas
 * (delta != 0) y si hubo errores. Las predicciones NO evaluadas las puntúa el
 * trigger al actualizar el partido, por lo que NO se tocan aquí.
 */
async function correctEvaluatedPredictions(
  supabase: SupabaseClient,
  local: LocalMatch,
  apiMatch: ZafronixMatch,
  mappedStatus: MatchStatus,
): Promise<{ corrections: number; errors: number }> {
  const { data: preds, error } = await supabase
    .from("predictions")
    .select("id, home_score_pred, away_score_pred, multiplier, points_earned")
    .eq("match_id", local.id)
    .not("evaluated_at", "is", null);

  if (error) {
    console.error(
      `Error al consultar predicciones del partido ${local.id}: ${error.message}`,
    );
    return { corrections: 0, errors: 1 };
  }

  if (!preds || preds.length === 0) {
    return { corrections: 0, errors: 0 };
  }

  const actual = {
    home: apiMatch.homeScore ?? NaN,
    away: apiMatch.awayScore ?? NaN,
  };

  const results = await Promise.all(
    preds.map(async (p) => {
      try {
        // Motor de puntuación ÚNICO (src/utils/scoring.ts): puntos base * multiplicador.
        const base = calculateBasePoints(
          { home: p.home_score_pred, away: p.away_score_pred },
          actual,
          mappedStatus,
        );
        const newPoints = calculatePredictionPoints(base, Number(p.multiplier));

        const { data: delta, error: rpcError } = await supabase.rpc(
          "fn_apply_accrual_correction",
          {
            p_prediction_id: p.id,
            p_new_points: newPoints,
            p_match_id: local.id,
            p_match_status: mappedStatus,
          },
        );

        if (rpcError) {
          console.error(
            `Error al corregir predicción ${p.id}: ${rpcError.message}`,
          );
          return { corrected: false, errored: true };
        }
        return { corrected: Number(delta) !== 0, errored: false };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Excepción al corregir predicción ${p.id}: ${msg}`);
        return { corrected: false, errored: true };
      }
    }),
  );

  return {
    corrections: results.filter((r) => r.corrected).length,
    errors: results.filter((r) => r.errored).length,
  };
}

// ── Función principal exportada para testing ────────────────────────

/**
 * Ejecuta la restauración completa: descarga el listado de partidos de Zafronix
 * (GET directo sin If-None-Match), inserta los ausentes, actualiza los que
 * cambiaron y corrige el ledger de las predicciones ya evaluadas.
 */
export async function restoreZafronixData(
  supabase: SupabaseClient,
  apiKey: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<RestoreSummary> {
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("El X-API-Key de Zafronix no puede estar vacío.");
  }

  // 1. GET DIRECTO sin cabeceras condicionales (descarga completa, AC #3).
  const response = await fetchWithRetry(
    ZAFRONIX_API_URL,
    { headers: { "X-API-Key": apiKey } },
    fetchFn,
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `Error de la API de Zafronix: HTTP ${response.status} ${response.statusText}. Body: ${errorBody}`,
    );
  }

  // 2. Parsear y validar el body con Zod.
  let rawBody: unknown;
  try {
    rawBody = await response.json();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Error al parsear el JSON de la respuesta de la API: ${message}`);
  }

  const parseResult = zafronixResponseSchema.safeParse(rawBody);
  if (!parseResult.success) {
    throw new Error(
      `Error de validación del body de la API: ${JSON.stringify(parseResult.error.issues)}`,
    );
  }
  // Deduplicar partidos de la API por ID para evitar conflictos/inserciones duplicadas concurrentes
  const seenIds = new Set<string>();
  const apiMatches = parseResult.data.data.filter((match) => {
    if (seenIds.has(match.id)) {
      console.warn(`⚠️ Registro de partido duplicado en la respuesta de la API de Zafronix: ${match.id}. Se omitirá el duplicado.`);
      return false;
    }
    seenIds.add(match.id);
    return true;
  });

  // 3. Consultar todos los partidos locales actuales (AC #4).
  const { data: localMatches, error: fetchError } = await supabase
    .from("matches")
    .select(
      "id, external_ref, home_team, away_team, home_score, away_score, status, bracket_slot, match_time, stage",
    );

  if (fetchError) {
    throw new Error(`Error al consultar partidos locales: ${fetchError.message}`);
  }

  // 4. Mapas en memoria para resolución eficiente (external_ref / slot / nombres).
  const all = (localMatches ?? []) as LocalMatch[];
  const localByRef = new Map<string, LocalMatch>(
    all.filter((m) => m.external_ref).map((m) => [m.external_ref as string, m]),
  );
  const localKnockoutBySlot = new Map<number, LocalMatch>(
    all
      .filter((m) => m.bracket_slot !== null && m.bracket_slot !== undefined)
      .map((m) => [m.bracket_slot as number, m]),
  );
  const localGroupByTeams = new Map<string, LocalMatch>(
    all
      .filter((m) => m.bracket_slot === null || m.bracket_slot === undefined)
      .map((m) => [
        `${normalizeTeamName(m.home_team)}|${normalizeTeamName(m.away_team)}`,
        m,
      ]),
  );

  // 5. Clasificar cada partido de la API: insertar, actualizar o ignorar.
  const insertRows: Record<string, unknown>[] = [];
  const updateTasks: Array<{ local: LocalMatch; apiMatch: ZafronixMatch }> = [];
  let skippedInserts = 0;

  for (const apiMatch of apiMatches) {
    const local = resolveLocalMatch(
      apiMatch,
      localByRef,
      localKnockoutBySlot,
      localGroupByTeams,
    );

    if (!local) {
      const row = buildInsertRow(apiMatch);
      if (row) {
        insertRows.push(row);
      } else {
        skippedInserts++;
        console.warn(
          `⚠️ Partido ${apiMatch.id} ausente localmente y sin match_time en la API: omitido.`,
        );
      }
      continue;
    }

    const mappedStatus = mapApiStatus(apiMatch.status);
    const scoreChanged =
      local.home_score !== apiMatch.homeScore ||
      local.away_score !== apiMatch.awayScore;
    const statusChanged = local.status !== mappedStatus;
    const timeChanged = apiMatch.matchTime ? (local.match_time !== apiMatch.matchTime) : false;
    const normalizedApiStage = normalizeStage(apiMatch.stage);
    const stageChanged = apiMatch.stage ? (local.stage !== normalizedApiStage) : false;

    const canUpdateTeams =
      local.bracket_slot !== null &&
      !isPlaceholderTeam(apiMatch.homeTeam) &&
      !isPlaceholderTeam(apiMatch.awayTeam);
    const teamsChanged =
      canUpdateTeams &&
      (local.home_team !== apiMatch.homeTeam ||
        local.away_team !== apiMatch.awayTeam);

    if (scoreChanged || statusChanged || teamsChanged || timeChanged || stageChanged) {
      updateTasks.push({ local, apiMatch });
    }
  }

  const summary: RestoreSummary = {
    created: 0,
    updated: 0,
    corrections: 0,
    errors: skippedInserts,
  };

  // 6. Insertar partidos ausentes en lotes (concurrencia controlada para evitar saturación de la DB).
  if (insertRows.length > 0) {
    const insertResults = await runInBatches(insertRows, 5, async (row) =>
      await supabase.from("matches").insert(row),
    );
    for (const r of insertResults) {
      if (r.error) {
        console.error("Error al insertar partido:", r.error.message);
        summary.errors++;
      } else {
        summary.created++;
      }
    }
  }

  // 7. Procesar actualizaciones en lotes (concurrencia controlada). Por cada partido cambiado:
  //    (a) corregir predicciones ya evaluadas (RPC atómica), luego
  //    (b) actualizar el partido (dispara el trigger para las NO evaluadas y desafíos completados).
  const updateResults = await runInBatches(updateTasks, 5, async ({ local, apiMatch }) => {
    const mappedStatus = mapApiStatus(apiMatch.status);
    const scoreChanged =
      local.home_score !== apiMatch.homeScore ||
      local.away_score !== apiMatch.awayScore;
    const statusChanged = local.status !== mappedStatus;

    let corrections = 0;
    let errors = 0;

    // (a) Solo recalculamos cuando el cambio afecta a la puntuación.
    if (scoreChanged || statusChanged) {
      const res = await correctEvaluatedPredictions(
        supabase,
        local,
        apiMatch,
        mappedStatus,
      );
      corrections += res.corrections;
      errors += res.errors;

      // Si hubo errores al corregir las predicciones, NO actualizamos el partido
      // para mantener consistencia y evitar un estado de datos parcial.
      if (errors > 0) {
        console.error(
          `Se cancela actualización del partido ${local.id} debido a errores en la corrección de predicciones.`,
        );
        return { updated: false, corrections, errors };
      }
    }

    // (b) Actualizar el partido con los nuevos datos.
    const canUpdateTeams =
      local.bracket_slot !== null &&
      !isPlaceholderTeam(apiMatch.homeTeam) &&
      !isPlaceholderTeam(apiMatch.awayTeam);

    const updateData: Record<string, unknown> = {
      external_ref: apiMatch.id, // Sostener / rellenar la referencia externa
      home_score: apiMatch.homeScore,
      away_score: apiMatch.awayScore,
      status: mappedStatus,
      updated_at: new Date().toISOString(),
    };
    if (apiMatch.matchTime) {
      updateData.match_time = apiMatch.matchTime;
    }
    if (apiMatch.stage) {
      updateData.stage = normalizeStage(apiMatch.stage);
    }
    if (canUpdateTeams) {
      updateData.home_team = apiMatch.homeTeam;
      updateData.away_team = apiMatch.awayTeam;
    }

    const { error: updateError } = await supabase
      .from("matches")
      .update(updateData)
      .eq("id", local.id);

    if (updateError) {
      console.error(
        `Error al actualizar partido ${local.id}: ${updateError.message}`,
      );
      errors++;
      return { updated: false, corrections, errors };
    }
    return { updated: true, corrections, errors };
  });

  for (const r of updateResults) {
    if (r.updated) summary.updated++;
    summary.corrections += r.corrections;
    summary.errors += r.errors;
  }

  // 8. Resumen informativo (AC #6).
  console.log(
    `✅ Restauración completada. Partidos creados: ${summary.created}, ` +
      `actualizados: ${summary.updated}, correcciones de predicciones: ${summary.corrections}, ` +
      `errores: ${summary.errors}.`,
  );

  return summary;
}

// ── Entry Point (ejecución directa) ─────────────────────────────────

async function main(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const wcApiKey = process.env.WC_API_KEY;

  const missing: string[] = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!wcApiKey) missing.push("WC_API_KEY");

  if (missing.length > 0) {
    console.error(`❌ Faltan variables de entorno requeridas: ${missing.join(", ")}`);
    process.exit(1);
  }

  // Cliente con service_role: bypassa RLS para escribir en matches / predictions /
  // league_members / point_transactions.
  const supabase = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { persistSession: false },
  });

  try {
    await restoreZafronixData(supabase, wcApiKey!);
  } catch (error) {
    console.error("❌ Error fatal durante la restauración:", error);
    process.exit(1);
  }
}

// Solo ejecutar main() si se invoca directamente (no importado como módulo).
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  /restore-zafronix-data(?:\.[tj]s)?$/.test(process.argv[1]);

if (isDirectRun) {
  main();
}

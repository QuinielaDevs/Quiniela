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
import { TOURNAMENT_PHASES_2026 } from "../src/config/tournamentPhases";
import { normalizeTeamName, isPlaceholderTeam } from "./sync-matches";

// ── Cargar variables de entorno (solo relevante en ejecución local) ──
config({ path: ".env.local" });
config({ path: ".env" });

// ── Constantes ──────────────────────────────────────────────────────

const ZAFRONIX_MATCHES_URL =
  "https://api.zafronix.com/fifa/worldcup/v1/matches?year=2026";
const ZAFRONIX_TOURNAMENT_URL =
  "https://api.zafronix.com/fifa/worldcup/v1/tournaments/2026";

// ── Zod Schemas ─────────────────────────────────────────────────────

/**
 * Schema de un partido de la respuesta de la API de Zafronix, ajustado al
 * formato real de la API (junio 2026). Los campos opcionales capturan todos
 * los datos disponibles para inserción de partidos nuevos en restauración
 * completa sobre base de datos vacía.
 *
 * Campos anulables (null): homeTeam/awayTeam son null en eliminatorias cuando
 * los equipos aún no están definidos. homeScore/awayScore/result son null en
 * partidos no jugados. La API NO tiene campo "status": se deriva de result y
 * scores más abajo.
 */
const zafronixMatchSchema = z.object({
  id: z.string(),
  matchNo: z.number().int().positive(),
  date: z.string().nullable().optional(),
  kickoff: z.string().nullable().optional(),
  kickoffUtc: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  stage: z.string().nullable().optional(),
  stageNormalized: z.string().nullable().optional(),
  homeTeam: z.string().nullable(),
  awayTeam: z.string().nullable(),
  homeRef: z.string().nullable().optional(),
  awayRef: z.string().nullable().optional(),
  homeScore: z.number().int().nonnegative().nullable(),
  awayScore: z.number().int().nonnegative().nullable(),
  result: z.string().nullable().optional(),
  extraTime: z.boolean().nullable().optional(),
  penalties: z.string().nullable().optional(),
  stadium: z.string().nullable().optional(),
  stadiumId: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  attendance: z.number().int().nullable().optional(),
  referee: z.string().nullable().optional(),
  weather: z.string().nullable().optional(),
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

/** Datos de un equipo extraídos de GET /tournaments/2026. */
interface ZafronixTeam {
  name: string;
  iso: string | null;
  code: string;
}

/** Resumen del sembrado de premios. */
export interface AwardSeedSummary {
  champion: number;
  top_scorer: number;
  mvp: number;
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
 * Deriva el status del partido a partir de los campos disponibles en la API.
 * La API de Zafronix (junio 2026) NO incluye campo "status" explícito, pero
 * provee "result" y scores para inferirlo.
 *
 * DB acepta: 'scheduled' | 'live' | 'finished' | 'suspended' | 'canceled'.
 */
export function deriveMatchStatus(apiMatch: ZafronixMatch): MatchStatus {
  const result = apiMatch.result?.toLowerCase();

  if (result === "home" || result === "away" || result === "draw") {
    return "finished";
  }

  if (
    result === "cancelled" ||
    result === "canceled" ||
    result === "abandoned"
  ) {
    return "canceled";
  }

  if (result === "postponed" || result === "suspended") {
    return "suspended";
  }

  // Si hay scores pero no result, podría ser live o un estado raro.
  // La API free-tier actual no parece reportar partidos en vivo;
  // tratamos como scheduled para que el trigger de la DB actúe si cambia.
  if (
    (apiMatch.homeScore !== null && apiMatch.homeScore !== undefined) ||
    (apiMatch.awayScore !== null && apiMatch.awayScore !== undefined)
  ) {
    return "live";
  }

  return "scheduled";
}

/**
 * Mapea el status de la API de Zafronix a los status válidos de nuestra DB.
 * La DB acepta: 'scheduled' | 'live' | 'finished' | 'suspended' | 'canceled'.
 *
 * Función conservada para compatibilidad con sync-matches.ts anterior y tests;
 * para el nuevo formato de API sin campo "status", usar deriveMatchStatus().
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
 *
 * La API de Zafronix (junio 2026) usa valores como: group_a, group_b, ..., r32, r16, qf, sf, f, 3p.
 */
export function normalizeStage(
  stage: string | null | undefined,
): string | null {
  if (!stage) return null;
  const s = stage.trim().toLowerCase();

  // Fase de grupos: "group_a", "group_b", etc. → "group"
  if (s.startsWith("group")) return "group";

  switch (s) {
    case "round-32":
    case "round_of_32":
    case "round-of-32":
    case "r32":
    case "last-32":
      return "round-32";
    case "round-16":
    case "round_of_16":
    case "round-of-16":
    case "r16":
    case "last-16":
      return "round-16";
    case "quarter-finals":
    case "quarter-final":
    case "quarterfinals":
    case "quarterfinal":
    case "quarter":
    case "quarters":
    case "qf":
      return "quarter";
    case "semi-finals":
    case "semi-final":
    case "semifinals":
    case "semifinal":
    case "semi":
    case "semis":
    case "sf":
      return "semi";
    case "third-place":
    case "third_place":
    case "thirdplace":
    case "playoff-for-third-place":
    case "3rd-place":
    case "3p":
      return "third-place";
    case "final":
    case "finals":
    case "f":
      return "final";
    default:
      return stage;
  }
}

/**
 * Extrae el label del grupo a partir del campo stage de la API.
 * Ej: "group_a" → "A", "group_b" → "B". Retorna null si no es fase de grupos.
 */
export function extractGroupLabel(
  stage: string | null | undefined,
): string | null {
  if (!stage) return null;
  const s = stage.trim().toLowerCase();
  if (!s.startsWith("group")) return null;
  const parts = s.split("_");
  if (parts.length > 1 && parts[1]) return parts[1].toUpperCase();
  // "groupa", "groupb"
  const match = s.match(/group\s*([a-l])/i);
  return match?.[1]?.toUpperCase() ?? null;
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
      const response = await fetchFn(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const message = err instanceof Error ? err.message : String(err);
      if (attempt === retries) {
        throw new Error(
          `Fallo tras ${retries} intentos de red. Último error: ${message}`,
        );
      }
      console.warn(
        `Intento de red ${attempt} fallido: ${message}. Reintentando en ${delayMs}ms...`,
      );
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
 * mapas en memoria: external_ref → bracket_slot (eliminatorias, via matchNo)
 * → nombres normalizados (fase de grupos).
 */
function resolveLocalMatch(
  apiMatch: ZafronixMatch,
  localByRef: Map<string, LocalMatch>,
  localKnockoutBySlot: Map<number, LocalMatch>,
  localGroupByTeams: Map<string, LocalMatch>,
): LocalMatch | undefined {
  let local = localByRef.get(apiMatch.id);
  if (local) return local;

  const matchNum = apiMatch.matchNo;
  if (!Number.isFinite(matchNum)) return undefined;

  if (matchNum >= 73) {
    local = localKnockoutBySlot.get(matchNum);
  } else if (apiMatch.homeTeam && apiMatch.awayTeam) {
    const key = `${normalizeTeamName(apiMatch.homeTeam)}|${normalizeTeamName(apiMatch.awayTeam)}`;
    local = localGroupByTeams.get(key);
  }
  return local;
}

/**
 * Construye la fila de inserción de un partido nuevo mapeando los campos de la
 * API de Zafronix (junio 2026) a las columnas de la tabla local `matches`.
 * Devuelve null si no se puede determinar `match_time` (columna NOT NULL):
 * preferimos OMITIR e informar antes que insertar un kickoff inválido.
 */
function buildInsertRow(
  apiMatch: ZafronixMatch,
  matchday: number | null,
  teamCodeMap: Map<string, string>,
): Record<string, unknown> | null {
  if (!apiMatch.kickoffUtc) {
    return null;
  }
  const mappedStatus = deriveMatchStatus(apiMatch);
  const isKnockout = apiMatch.matchNo >= 73;

  // En eliminatorias evitamos persistir placeholders como nombres reales.
  const homeTeam = apiMatch.homeTeam ?? "";
  const awayTeam = apiMatch.awayTeam ?? "";
  const homeIsReal = !isPlaceholderTeam(homeTeam);
  const awayIsReal = !isPlaceholderTeam(awayTeam);

  return {
    external_ref: apiMatch.id,
    home_team:
      isKnockout && !homeIsReal ? "Por definir" : homeTeam || "Por definir",
    away_team:
      isKnockout && !awayIsReal ? "Por definir" : awayTeam || "Por definir",
    home_team_code: homeTeam
      ? (teamCodeMap.get(normalizeTeamName(homeTeam)) ?? null)
      : null,
    away_team_code: awayTeam
      ? (teamCodeMap.get(normalizeTeamName(awayTeam)) ?? null)
      : null,
    home_source: isKnockout ? (apiMatch.homeRef ?? null) : null,
    away_source: isKnockout ? (apiMatch.awayRef ?? null) : null,
    home_score: apiMatch.homeScore,
    away_score: apiMatch.awayScore,
    match_time: apiMatch.kickoffUtc,
    status: mappedStatus,
    matchday,
    stage: normalizeStage(apiMatch.stage),
    group_label: isKnockout ? null : extractGroupLabel(apiMatch.stage),
    bracket_slot: isKnockout ? apiMatch.matchNo : null,
    venue: apiMatch.stadium ?? null,
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
 * Deriva `matchday` (jornada 1-3) para partidos de fase de grupos a partir
 * del orden cronológico dentro de cada grupo. Cada grupo tiene 6 partidos:
 * los primeros 2 (por kickoffUtc) → jornada 1, siguientes 2 → jornada 2,
 * últimos 2 → jornada 3. Partidos sin group_label o sin kickoffUtc quedan
 * con matchday null.
 */
function computeMatchdays(
  matches: ZafronixMatch[],
): Map<string, number | null> {
  const map = new Map<string, number | null>();

  const groupMatches = new Map<string, ZafronixMatch[]>();
  for (const m of matches) {
    if (m.matchNo >= 73) continue; // eliminatorias sin matchday
    const group = extractGroupLabel(m.stage);
    if (!group) {
      map.set(m.id, null);
      continue;
    }
    if (!groupMatches.has(group)) groupMatches.set(group, []);
    groupMatches.get(group)!.push(m);
  }

  for (const [, groupList] of groupMatches) {
    groupList.sort((a, b) =>
      (a.kickoffUtc ?? "").localeCompare(b.kickoffUtc ?? ""),
    );
    let idx = 0;
    for (const m of groupList) {
      const md = idx < 2 ? 1 : idx < 4 ? 2 : 3;
      map.set(m.id, md);
      idx++;
    }
  }

  return map;
}

/**
 * Obtiene los 48 equipos desde GET /tournaments/2026 con name, iso (alpha-2) y
 * code (FIFA 3-letras). El caller deriva de aquí tanto el teamCodeMap para
 * matches como los datos para award_candidates.
 */
async function fetchTournamentTeams(
  apiKey: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<ZafronixTeam[]> {
  const response = await fetchWithRetry(
    ZAFRONIX_TOURNAMENT_URL,
    { headers: { "X-API-Key": apiKey } },
    fetchFn,
  );

  if (!response.ok) {
    console.warn(
      `⚠️ No se pudo obtener /tournaments/2026 (HTTP ${response.status}).`,
    );
    return [];
  }

  let rawBody: unknown;
  try {
    rawBody = await response.json();
  } catch {
    console.warn("⚠️ Error al parsear JSON de /tournaments/2026.");
    return [];
  }

  const parsed = z
    .object({
      teams: z.array(
        z.object({
          name: z.string(),
          iso: z.string().nullable().optional(),
          code: z.string(),
        }),
      ),
    })
    .safeParse(rawBody);

  if (!parsed.success) {
    console.warn("⚠️ Formato inesperado en /tournaments/2026.");
    return [];
  }

  return parsed.data.teams.map((t) => ({
    name: t.name,
    iso: t.iso ?? null,
    code: t.code,
  }));
}

/** Schema mínimo de un jugador del roster para awards. */
const rosterPlayerSchema = z.object({
  name: z.string(),
  position: z.string().nullable().optional(),
  jersey: z.number().int().positive().nullable().optional(),
});

type RosterPlayer = z.infer<typeof rosterPlayerSchema>;

/**
 * Obtiene el plantel completo de un equipo desde
 * GET /teams/{name}/roster?year=2026.
 */
async function fetchTeamRoster(
  teamName: string,
  apiKey: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<RosterPlayer[]> {
  const encoded = encodeURIComponent(teamName);
  const url = `https://api.zafronix.com/fifa/worldcup/v1/teams/${encoded}/roster?year=2026`;

  const response = await fetchWithRetry(
    url,
    { headers: { "X-API-Key": apiKey } },
    fetchFn,
    2, // menos reintentos para no gastar cuota en fallos
  );

  if (!response.ok) {
    console.warn(
      `⚠️ Roster de ${teamName} no disponible (HTTP ${response.status}).`,
    );
    return [];
  }

  let rawBody: unknown;
  try {
    rawBody = await response.json();
  } catch {
    console.warn(`⚠️ Error al parsear JSON del roster de ${teamName}.`);
    return [];
  }

  const parsed = z.array(rosterPlayerSchema).safeParse(rawBody);
  if (!parsed.success) {
    console.warn(`⚠️ Formato inesperado en roster de ${teamName}.`);
    return [];
  }

  return parsed.data;
}

/**
 * Siembra la tabla award_candidates con todos los equipos (champion) y todos
 * los jugadores de todos los planteles (top_scorer + mvp) desde la API de
 * Zafronix. Idempotente: consulta los existentes antes de insertar para no
 * duplicar en ejecuciones repetidas.
 */
async function seedAwardCandidates(
  supabase: SupabaseClient,
  teams: ZafronixTeam[],
  apiKey: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<AwardSeedSummary> {
  // 1. Claves ya existentes para idempotencia.
  const { data: existing } = await supabase
    .from("award_candidates")
    .select("category, name, team_name");

  const existingKeys = new Set(
    (existing ?? []).map((r) => `${r.category}|${r.name}|${r.team_name ?? ""}`),
  );

  const summary: AwardSeedSummary = {
    champion: 0,
    top_scorer: 0,
    mvp: 0,
    errors: 0,
  };

  // 2. Champion: una fila por cada selección nacional.
  const sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name));
  let champOrder = 0;
  for (const t of sorted) {
    champOrder++;
    const key = `champion|${t.name}|`;
    if (existingKeys.has(key)) continue;

    const { error } = await supabase.from("award_candidates").insert({
      category: "champion",
      name: t.name,
      team_name: null,
      flag_code: t.iso,
      display_order: champOrder,
    });
    if (error) {
      console.error(`Error al insertar champion ${t.name}: ${error.message}`);
      summary.errors++;
    } else {
      summary.champion++;
    }
  }

  // 3. top_scorer + mvp: un par por cada jugador de cada plantel.
  let globalOrder = 0;
  for (const team of teams) {
    const players = await fetchTeamRoster(team.name, apiKey, fetchFn);
    const teamName = team.name;
    const iso = team.iso;

    for (const player of players) {
      globalOrder++;

      const tKey = `top_scorer|${player.name}|${teamName}`;
      if (!existingKeys.has(tKey)) {
        const { error: errT } = await supabase
          .from("award_candidates")
          .insert({
            category: "top_scorer",
            name: player.name,
            team_name: teamName,
            flag_code: iso,
            display_order: globalOrder,
          });
        if (errT) {
          console.error(
            `Error al insertar top_scorer ${player.name}: ${errT.message}`,
          );
          summary.errors++;
        } else {
          summary.top_scorer++;
        }
      }

      const mKey = `mvp|${player.name}|${teamName}`;
      if (!existingKeys.has(mKey)) {
        const { error: errM } = await supabase
          .from("award_candidates")
          .insert({
            category: "mvp",
            name: player.name,
            team_name: teamName,
            flag_code: iso,
            display_order: globalOrder,
          });
        if (errM) {
          console.error(
            `Error al insertar mvp ${player.name}: ${errM.message}`,
          );
          summary.errors++;
        } else {
          summary.mvp++;
        }
      }
    }
  }

  return summary;
}

/**
 * Siembra la tabla tournament_phases con las 4 fases del torneo (A-D) desde
 * la fuente canónica src/config/tournamentPhases.ts. Luego sincroniza los
 * boundaries (starts_at/ends_at) desde los partidos reales vía la RPC
 * fn_sync_tournament_phases_from_matches. Idempotente: consulta phase_code
 * existentes antes de insertar.
 */
async function seedTournamentPhases(
  supabase: SupabaseClient,
): Promise<number> {
  const { data: existing } = await supabase
    .from("tournament_phases")
    .select("phase_code");

  const existingCodes = new Set(
    (existing ?? []).map((r) => r.phase_code),
  );

  let inserted = 0;
  let sort = 0;
  for (const p of TOURNAMENT_PHASES_2026) {
    if (existingCodes.has(p.code)) { sort++; continue; }

    const { error } = await supabase.from("tournament_phases").insert({
      phase_code: p.code,
      reward_points: p.rewardPoints,
      starts_at: p.startsAt,
      ends_at: p.endsAt,
      edits_locked: p.editsLocked,
      label: p.label,
      sort_order: sort,
    });

    if (error) {
      console.error(
        `Error al insertar fase ${p.code}: ${error.message}`,
      );
    } else {
      inserted++;
    }
    sort++;
  }

  if (inserted > 0) {
    const { error: rpcErr } = await supabase.rpc(
      "fn_sync_tournament_phases_from_matches",
    );
    if (rpcErr) {
      console.error(
        `Error al sincronizar fases desde matches: ${rpcErr.message}`,
      );
    }
  }

  return inserted;
}

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

  // 0. Obtener equipos desde /tournaments/2026: provee FIFA codes para matches
  //    y datos (name/iso) para award_candidates.
  const teams = await fetchTournamentTeams(apiKey, fetchFn);
  const teamCodeMap = new Map(
    teams.map((t) => [normalizeTeamName(t.name), t.code]),
  );

  // 1. GET DIRECTO sin cabeceras condicionales (descarga completa, AC #3).
  const response = await fetchWithRetry(
    ZAFRONIX_MATCHES_URL,
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
    throw new Error(
      `Error al parsear el JSON de la respuesta de la API: ${message}`,
    );
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
      console.warn(
        `⚠️ Registro de partido duplicado en la respuesta de la API de Zafronix: ${match.id}. Se omitirá el duplicado.`,
      );
      return false;
    }
    seenIds.add(match.id);
    return true;
  });

  // Derivar matchday por grupo (jornada 1-3 vía orden cronológico).
  const matchdayMap = computeMatchdays(apiMatches);

  // 3. Consultar todos los partidos locales actuales (AC #4).
  const { data: localMatches, error: fetchError } = await supabase
    .from("matches")
    .select(
      "id, external_ref, home_team, away_team, home_score, away_score, status, bracket_slot, match_time, stage",
    );

  if (fetchError) {
    throw new Error(
      `Error al consultar partidos locales: ${fetchError.message}`,
    );
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
      const row = buildInsertRow(
        apiMatch,
        matchdayMap.get(apiMatch.id) ?? null,
        teamCodeMap,
      );
      if (row) {
        insertRows.push(row);
      } else {
        skippedInserts++;
        console.warn(
          `⚠️ Partido ${apiMatch.id} ausente localmente y sin kickoffUtc en la API: omitido.`,
        );
      }
      continue;
    }

    const mappedStatus = deriveMatchStatus(apiMatch);
    const scoreChanged =
      local.home_score !== apiMatch.homeScore ||
      local.away_score !== apiMatch.awayScore;
    const statusChanged = local.status !== mappedStatus;
    const timeChanged = apiMatch.kickoffUtc
      ? local.match_time !== apiMatch.kickoffUtc
      : false;
    const normalizedApiStage = normalizeStage(apiMatch.stage);
    const stageChanged = apiMatch.stage
      ? local.stage !== normalizedApiStage
      : false;

    const isLocalKnockout =
      local.bracket_slot !== null && local.bracket_slot !== undefined;
    const canUpdateTeams =
      isLocalKnockout &&
      apiMatch.homeTeam !== null &&
      apiMatch.awayTeam !== null &&
      !isPlaceholderTeam(apiMatch.homeTeam) &&
      !isPlaceholderTeam(apiMatch.awayTeam);
    const teamsChanged =
      canUpdateTeams &&
      (local.home_team !== apiMatch.homeTeam ||
        local.away_team !== apiMatch.awayTeam);

    if (
      scoreChanged ||
      statusChanged ||
      teamsChanged ||
      timeChanged ||
      stageChanged
    ) {
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
    const insertResults = await runInBatches(
      insertRows,
      5,
      async (row) => await supabase.from("matches").insert(row),
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
  const updateResults = await runInBatches(
    updateTasks,
    5,
    async ({ local, apiMatch }) => {
      const mappedStatus = deriveMatchStatus(apiMatch);
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
      const isLocalKnockout =
        local.bracket_slot !== null && local.bracket_slot !== undefined;
      const homeTeamNonNull = apiMatch.homeTeam !== null;
      const awayTeamNonNull = apiMatch.awayTeam !== null;
      const canUpdateTeams =
        isLocalKnockout &&
        homeTeamNonNull &&
        awayTeamNonNull &&
        !isPlaceholderTeam(apiMatch.homeTeam!) &&
        !isPlaceholderTeam(apiMatch.awayTeam!);

      const updateData: Record<string, unknown> = {
        external_ref: apiMatch.id,
        home_score: apiMatch.homeScore,
        away_score: apiMatch.awayScore,
        status: mappedStatus,
        updated_at: new Date().toISOString(),
      };
      if (apiMatch.kickoffUtc) {
        updateData.match_time = apiMatch.kickoffUtc;
      }
      if (apiMatch.stage) {
        updateData.stage = normalizeStage(apiMatch.stage);
      }
      if (canUpdateTeams) {
        updateData.home_team = apiMatch.homeTeam;
        updateData.away_team = apiMatch.awayTeam;
        // FIFA codes desde /tournaments/2026 (mapeo por nombre normalizado).
        if (apiMatch.homeTeam) {
          const homeCode = teamCodeMap.get(
            normalizeTeamName(apiMatch.homeTeam),
          );
          if (homeCode) updateData.home_team_code = homeCode;
        }
        if (apiMatch.awayTeam) {
          const awayCode = teamCodeMap.get(
            normalizeTeamName(apiMatch.awayTeam),
          );
          if (awayCode) updateData.away_team_code = awayCode;
        }
      }
      // matchday: derivado del orden cronológico por grupo (solo fase de grupos).
      const md = matchdayMap.get(apiMatch.id);
      if (md !== undefined) {
        updateData.matchday = md;
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
    },
  );

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

  // 8.5 Seed de tournament_phases desde config canónico + sync con matches.
  const phasesInserted = await seedTournamentPhases(supabase);
  if (phasesInserted > 0) {
    console.log(`📅 Fases del torneo sembradas: ${phasesInserted}.`);
  }

  // 9. Seed de award_candidates (campeón / goleador / MVP) desde la API.
  const awardSummary = await seedAwardCandidates(
    supabase,
    teams,
    apiKey,
    fetchFn,
  );
  console.log(
    `🏆 Premios: campeones = ${awardSummary.champion}, ` +
      `goleadores = ${awardSummary.top_scorer}, ` +
      `mvp = ${awardSummary.mvp}, ` +
      `errores = ${awardSummary.errors}.`,
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
    console.error(
      `❌ Faltan variables de entorno requeridas: ${missing.join(", ")}`,
    );
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

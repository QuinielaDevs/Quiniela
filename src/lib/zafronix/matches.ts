/**
 * src/lib/zafronix/matches.ts
 *
 * Schema canónico + helpers compartidos para todas las interacciones con
 * la API REST de Zafronix (GET /matches, GET /tournaments, GET /teams/* /roster).
 *
 * Verificado contra la API real (junio 2026) con scripts/verify-zafronix-schema.ts.
 *
 * Fuente única de verdad para:
 *   - scripts/sync-matches.ts       (sincronización periódica ETag)
 *   - scripts/restore-zafronix-data.ts  (restauración completa)
 *   - src/app/api/webhooks/zafronix/route.ts  (webhook handler)
 */

import { z } from "zod";
import type { MatchStatus } from "../../utils/scoring";

// ── Zod Schemas ─────────────────────────────────────────────────────

/**
 * Schema canónico de un partido de GET /matches?year=YYYY.
 *
 * Formato verificado contra la API real (junio 2026):
 *   - result: score string ("3-2", "0-2", "3-3") para partidos finalizados
 *   - referee: objeto { name, country } (no string)
 *   - matchNo: presente para 2026, ausente en años históricos → opcional
 *   - kickoffUtc: presente para 2026, ausente en años históricos
 *   - homeTeam/awayTeam: null en eliminatorias TBD
 */
export const zafronixMatchSchema = z.object({
  id: z.string(),
  matchNo: z.number().int().positive().optional(),
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
  referee: z
    .union([
      z.string(),
      z.object({ name: z.string(), country: z.string().nullable().optional() }),
    ])
    .nullable()
    .optional(),
  weather: z
    .union([
      z.string(),
      z.object({
        tempC: z.number().nullable().optional(),
        humidityPct: z.number().nullable().optional(),
        precipitationMm: z.number().nullable().optional(),
        windKmh: z.number().nullable().optional(),
        code: z.number().nullable().optional(),
      }).passthrough(),
    ])
    .nullable()
    .optional(),
});

export type ZafronixMatch = z.infer<typeof zafronixMatchSchema>;

/** Envoltorio de la respuesta de GET /matches. */
export const zafronixResponseSchema = z.object({
  year: z.number().int().optional(),
  count: z.number().int().optional(),
  data: z.array(zafronixMatchSchema),
});

/** Schema de GET /tournaments/{year}.teams. */
export const tournamentTeamsSchema = z.object({
  teams: z.array(
    z.object({
      name: z.string(),
      iso: z.string().nullable().optional(),
      code: z.string(),
    }),
  ),
});

/** Tipo de equipo extraído del tournament endpoint. */
export interface ZafronixTeam {
  name: string;
  iso: string | null;
  code: string;
}

/** Schema mínimo de un jugador de GET /teams/{name}/roster?year=YYYY. */
export const rosterPlayerSchema = z.object({
  name: z.string(),
  position: z.string().nullable().optional(),
  jersey: z.number().int().positive().nullable().optional(),
});

export type RosterPlayer = z.infer<typeof rosterPlayerSchema>;

// ── Helpers de status ───────────────────────────────────────────────

/**
 * Deriva el status del partido a partir de los campos disponibles en la API.
 * La API de Zafronix NO incluye campo "status" explícito.
 *
 * Verificación real (junio 2026):
 *   - result es un score string "3-2", "0-2", "3-3" para finished
 *   - result puede ser "home"/"away"/"draw" en formatos legacy (backward compat)
 *   - result es null para partidos no finalizados
 *
 * DB acepta: 'scheduled' | 'live' | 'finished' | 'suspended' | 'canceled'.
 */
export function deriveMatchStatus(apiMatch: ZafronixMatch): MatchStatus {
  const result = (apiMatch.result ?? "").toLowerCase();

  // Score string format: "3-2", "0-2", "3-3" → finished
  if (/^\d+-\d+$/.test(result)) {
    return "finished";
  }

  // Legacy outcome format (backward compat): "home", "away", "draw"
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

  // Scores presentes sin result → posiblemente live
  if (
    (apiMatch.homeScore !== null && apiMatch.homeScore !== undefined) ||
    (apiMatch.awayScore !== null && apiMatch.awayScore !== undefined)
  ) {
    return "live";
  }

  return "scheduled";
}

/**
 * Mapea un string de status de la API a los status válidos de la DB.
 * Función de compatibilidad para código que reciba un status string directo
 * (webhooks, sync-matches legacy, etc.).
 *
 * DB acepta: 'scheduled' | 'live' | 'finished' | 'suspended' | 'canceled'.
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
        `Estado desconocido de la API: "${apiStatus}". Mapeando por defecto a "scheduled".`,
      );
      return "scheduled";
  }
}

// ── Helpers de stage / grupo ────────────────────────────────────────

/**
 * Normaliza los nombres de las fases (stage) al vocabulario interno de la DB:
 * 'group', 'round-32', 'round-16', 'quarter', 'semi', 'third-place', 'final'.
 *
 * La API de Zafronix puede usar: group_a, r32, r16, qf, sf, f, 3p,
 * round_of_32, quarter_final, etc.
 */
export function normalizeStage(
  stage: string | null | undefined,
): string | null {
  if (!stage) return null;
  const s = stage.trim().toLowerCase();

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
    case "quarter_final":
      return "quarter";
    case "semi-finals":
    case "semi-final":
    case "semifinals":
    case "semifinal":
    case "semi":
    case "semis":
    case "sf":
    case "semi_final":
      return "semi";
    case "third-place":
    case "third_place":
    case "thirdplace":
    case "playoff-for-third-place":
    case "3rd-place":
    case "3p":
    case "thirdPlace":
    case "third_place":
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
  const match = s.match(/group\s*([a-l])/i);
  return match?.[1]?.toUpperCase() ?? null;
}

// ── Helpers de matchNo ──────────────────────────────────────────────

/**
 * Extrae el número de partido del id de Zafronix ("2026-073" → 73).
 * Fallback cuando matchNo no está presente en la respuesta de la API.
 */
export function extractMatchNo(matchId: string): number | null {
  const parts = matchId.split("-");
  if (parts.length > 1 && parts[1]) {
    const n = parseInt(parts[1], 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Resuelve el matchNo: del campo directo de la API, o extraído del id
 * como fallback. Útil para años históricos donde matchNo puede no venir.
 */
export function resolveMatchNo(apiMatch: ZafronixMatch): number | null {
  return apiMatch.matchNo ?? extractMatchNo(apiMatch.id);
}

// ── Helpers de equipos ──────────────────────────────────────────────

/**
 * Normaliza nombres de equipos para solucionar discrepancias entre la API
 * y el seed local.
 */
export function normalizeTeamName(name: string): string {
  const norm = name.trim().toLowerCase();
  switch (norm) {
    case "usa":
    case "united states":
      return "United States";
    case "south korea":
    case "korea republic":
      return "Korea Republic";
    case "czech republic":
    case "czechia":
      return "Czechia";
    case "turkey":
    case "türkiye":
      return "Türkiye";
    case "ivory coast":
    case "côte d'ivoire":
    case "cote d'ivoire":
    case "cote d''ivoire":
      return "Cote d'Ivoire";
    case "iran":
    case "ir iran":
      return "IR Iran";
    case "cape verde":
    case "cabo verde":
      return "Cabo Verde";
    case "dr congo":
    case "congo dr":
      return "Congo DR";
    case "bosnia and herzegovina":
    case "bosnia & herzegovina":
      return "Bosnia & Herzegovina";
    default:
      return name;
  }
}

/**
 * Determina si el nombre de equipo provisto es un marcador de posición
 * (placeholder) del bracket de FIFA.
 */
export function isPlaceholderTeam(name: string): boolean {
  const norm = name.trim().toUpperCase();
  if (
    norm === "TBD" ||
    norm === "POR DEFINIR" ||
    norm === "" ||
    norm === "POR DEFINIR EQUIPO"
  ) {
    return true;
  }
  if (/^[123][A-L]$/.test(norm)) return true;
  if (/^[WL]\d{2,3}$/.test(norm)) return true;
  if (/^3[A-L]{3,6}$/.test(norm)) return true;
  return false;
}

/**
 * Extrae el nombre del referee, manejando tanto el formato string como
 * el formato objeto { name, country } de la API.
 */
export function extractRefereeName(
  referee: ZafronixMatch["referee"],
): string | null {
  if (!referee) return null;
  if (typeof referee === "string") return referee;
  return referee.name ?? null;
}

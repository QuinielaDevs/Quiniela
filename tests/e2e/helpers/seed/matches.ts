// Seed declarativo de partidos (Fase 1 del plan E2E).
//
// Reglas:
//  - Los equipos SIEMPRE llevan prefijo `test_` (identificación + cleanup por
//    prefijo; trampa §7.1: `matches` es un catálogo GLOBAL sin league_id).
//  - `bracket_slot` de slots TBD de test usa valores >= 9000: la columna solo
//    tiene un UNIQUE parcial (sin CHECK de rango), así no colisiona con los
//    73-104 reales del calendario WC2026 sembrado.

import { createAdminClient } from "../admin";

export type MatchStatus = "scheduled" | "live" | "finished" | "suspended" | "canceled";

export interface MatchSpec {
  home: string;
  away: string;
  homeTeamCode?: string | null;
  awayTeamCode?: string | null;
  /** Kickoff relativo a ahora (ms). Alternativa: matchTime absoluto. */
  kickoffOffsetMs?: number;
  matchTime?: string;
  status?: MatchStatus;
  matchday?: number | null;
  stage?: string | null;
  groupLabel?: string | null;
  bracketSlot?: number | null;
  homeSource?: string | null;
  awaySource?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  externalRef?: string | null;
  venue?: string | null;
  extraTimeHomeScore?: number | null;
  extraTimeAwayScore?: number | null;
  penaltiesHomeScore?: number | null;
  penaltiesAwayScore?: number | null;
  /** Escape hatch: NO forzar el prefijo test_ (p. ej. placeholders "Por
   *  definir" del dataset histórico). El cleanup por prefijo no los ve:
   *  bórralos por id. */
  rawTeamNames?: boolean;
}

export interface SeededMatchRow {
  id: string;
  home_team: string;
  away_team: string;
  home_team_code: string | null;
  away_team_code: string | null;
  match_time: string;
  status: MatchStatus;
  matchday: number | null;
  stage: string | null;
  group_label: string | null;
  bracket_slot: number | null;
  home_score: number | null;
  away_score: number | null;
  external_ref: string | null;
}

const MATCH_SELECT =
  "id, home_team, away_team, home_team_code, away_team_code, match_time, status, matchday, stage, group_label, bracket_slot, home_score, away_score, external_ref";

export function ensureTestPrefix(team: string): string {
  return team.startsWith("test_") ? team : `test_${team}`;
}

function resolveMatchTime(spec: MatchSpec): string {
  if (spec.matchTime) return spec.matchTime;
  const offset = spec.kickoffOffsetMs ?? 2 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + offset).toISOString();
}

function toRow(spec: MatchSpec) {
  return {
    home_team: spec.rawTeamNames ? spec.home : ensureTestPrefix(spec.home),
    away_team: spec.rawTeamNames ? spec.away : ensureTestPrefix(spec.away),
    home_team_code: spec.homeTeamCode ?? null,
    away_team_code: spec.awayTeamCode ?? null,
    match_time: resolveMatchTime(spec),
    status: spec.status ?? "scheduled",
    matchday: spec.matchday ?? null,
    stage: spec.stage ?? null,
    group_label: spec.groupLabel ?? null,
    bracket_slot: spec.bracketSlot ?? null,
    home_source: spec.homeSource ?? null,
    away_source: spec.awaySource ?? null,
    home_score: spec.homeScore ?? null,
    away_score: spec.awayScore ?? null,
    external_ref: spec.externalRef ?? null,
    venue: spec.venue ?? null,
    extra_time_home_score: spec.extraTimeHomeScore ?? null,
    extra_time_away_score: spec.extraTimeAwayScore ?? null,
    penalties_home_score: spec.penaltiesHomeScore ?? null,
    penalties_away_score: spec.penaltiesAwayScore ?? null,
  };
}

export async function seedMatches(specs: MatchSpec[]): Promise<SeededMatchRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("matches")
    .insert(specs.map(toRow))
    .select(MATCH_SELECT);
  if (error || !data) {
    throw new Error(`Error creando partidos e2e: ${error?.message}`);
  }
  return data as SeededMatchRow[];
}

export async function seedMatch(spec: MatchSpec): Promise<SeededMatchRow> {
  const [row] = await seedMatches([spec]);
  if (!row) throw new Error("seedMatch: el insert no devolvió la fila creada");
  return row;
}

export async function deleteMatches(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const admin = createAdminClient();
  await admin.from("matches").delete().in("id", ids);
}

// Red de seguridad: borra TODO partido de test que haya quedado de runs
// anteriores sin cleanup. No toca el calendario WC2026 (sin prefijo test_).
export async function deleteAllTestMatches(): Promise<void> {
  const admin = createAdminClient();
  await admin.from("matches").delete().like("home_team", "test_%");
}

// ──────────────────────────────────────────────────────────────────────
// Presets declarativos (overrides al gusto del spec que los usa).
// ──────────────────────────────────────────────────────────────────────

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

let presetCounter = 0;
function nextTag(): number {
  presetCounter += 1;
  return presetCounter;
}

/** Partido editable: kickoff dentro de 2 días (fuera de la ventana de 1 min). */
export function editableMatch(overrides: Partial<MatchSpec> = {}): MatchSpec {
  const tag = nextTag();
  return {
    home: `test_editable_h${tag}`,
    away: `test_editable_a${tag}`,
    kickoffOffsetMs: 2 * DAY,
    status: "scheduled",
    matchday: 1,
    stage: "group",
    groupLabel: "A",
    ...overrides,
  };
}

/** Partido bloqueado para ESCRITURA: kickoff hace 30 s, sigue `scheduled`.
 *  El candado vigente es el kickoff EXACTO (fn_match_editable:
 *  `now() < match_time`, migración 20260605150000): un kickoff futuro, aunque
 *  sea +30 s, sigue siendo editable (Fase 4, SEGUIMIENTO.md). */
export function lockedMatch(overrides: Partial<MatchSpec> = {}): MatchSpec {
  const tag = nextTag();
  return {
    home: `test_locked_h${tag}`,
    away: `test_locked_a${tag}`,
    kickoffOffsetMs: -30 * 1000,
    status: "scheduled",
    matchday: 1,
    stage: "group",
    groupLabel: "B",
    ...overrides,
  };
}

export function liveMatch(
  score: { home: number; away: number } = { home: 0, away: 0 },
  overrides: Partial<MatchSpec> = {},
): MatchSpec {
  const tag = nextTag();
  return {
    home: `test_live_h${tag}`,
    away: `test_live_a${tag}`,
    kickoffOffsetMs: -30 * MINUTE,
    status: "live",
    matchday: 1,
    stage: "group",
    groupLabel: "C",
    homeScore: score.home,
    awayScore: score.away,
    ...overrides,
  };
}

export function finishedMatch(
  score: { home: number; away: number },
  overrides: Partial<MatchSpec> = {},
): MatchSpec {
  const tag = nextTag();
  return {
    home: `test_finished_h${tag}`,
    away: `test_finished_a${tag}`,
    kickoffOffsetMs: -2 * DAY,
    status: "finished",
    matchday: 1,
    stage: "group",
    groupLabel: "D",
    homeScore: score.home,
    awayScore: score.away,
    ...overrides,
  };
}

export function suspendedMatch(overrides: Partial<MatchSpec> = {}): MatchSpec {
  const tag = nextTag();
  return {
    home: `test_suspended_h${tag}`,
    away: `test_suspended_a${tag}`,
    kickoffOffsetMs: -1 * DAY,
    status: "suspended",
    matchday: 1,
    stage: "group",
    groupLabel: "E",
    ...overrides,
  };
}

/** Slot de eliminatoria sin equipos resueltos: la UI muestra los orígenes
 *  ("Ganador 97") y la BD bloquea predicciones (fn_match_editable). El
 *  bracket_slot >= 9000 evita el UNIQUE de los slots reales 73-104. */
export function tbdKnockoutMatch(overrides: Partial<MatchSpec> = {}): MatchSpec {
  const tag = nextTag();
  return {
    home: `test_tbd_h${tag}`,
    away: `test_tbd_a${tag}`,
    homeTeamCode: null,
    awayTeamCode: null,
    kickoffOffsetMs: 5 * DAY,
    status: "scheduled",
    matchday: null,
    stage: "semi",
    bracketSlot: 9000 + (Date.now() % 10_000) + tag,
    homeSource: "W97",
    awaySource: "W98",
    ...overrides,
  };
}

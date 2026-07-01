// src/config/tournamentPhases.ts
//
// CANONICAL SOURCE OF TRUTH for FIFA World Cup 2026 phase boundaries.
// Both `tournament_phases` (Epic 6) and Epic 2's `matches` loader (Story 2.1)
// MUST derive their dates from THIS file. Divergence is caught by the contract
// test in tests/integration/tournament-phases-contract.test.ts.
//
// Las fechas de frontera DERIVAN del calendario sembrado por Epic-7
// (supabase/migrations/20260604131000_seed_worldcup_2026.sql) y se mantienen en
// sincronía con la BD vía `fn_sync_tournament_phases_from_matches`
// (20260605140000_sync_tournament_phases.sql). El contract test
// tests/integration/tournament-phases-contract.test.ts valida config ↔ BD ↔ calendario.
// All values are ISO-8601 UTC (timestamptz). WC2026 host venues span UTC-7..UTC-4;
// store UTC, convert at the edge.

export type AwardPhase = 'A' | 'B' | 'C' | 'D';

export interface TournamentPhaseConfig {
  /** Stable key. Matches tournament_phases.phase_code. */
  readonly code: AwardPhase;
  /** Points for a correct special prediction made during this phase (FR-16). */
  readonly rewardPoints: 50 | 25 | 10 | 2;
  /** Inclusive lower bound (UTC). `null` = open-ended start (before tournament). */
  readonly startsAt: string | null;
  /** Exclusive upper bound (UTC). `null` = open-ended end (tournament over). */
  readonly endsAt: string | null;
  /** Whether edits to predictions are locked during this phase (FR-16, Fase D). */
  readonly editsLocked: boolean;
  readonly label: string;
  readonly startsAtTime: number;
  readonly endsAtTime: number;
}

// Derivadas del calendario WC2026 sembrado por Epic-7 (MIN match_time por hito).
const INAUGURAL_KICKOFF = '2026-06-11T19:00:00Z';   // Fase A → B boundary (MIN match_time de todos)
const KNOCKOUT_START    = '2026-06-28T19:00:00Z';   // Fase B → C boundary (MIN match_time stage<>'group')
const SEMIFINAL_START   = '2026-07-14T19:00:00Z';   // Fase C → D boundary (MIN match_time stage='semi')

const parseTime = (s: string | null, def: number): number => {
  if (s === null) return def;
  const t = Date.parse(s);
  if (isNaN(t)) {
    throw new Error(`Invalid date string in configuration: "${s}"`);
  }
  return t;
};

const rawPhases = [
  { code: 'A' as const, rewardPoints: 50 as const, startsAt: null,              endsAt: INAUGURAL_KICKOFF, editsLocked: false, label: 'Before inaugural match' },
  { code: 'B' as const, rewardPoints: 25 as const, startsAt: INAUGURAL_KICKOFF, endsAt: KNOCKOUT_START,    editsLocked: false, label: 'Group stage' },
  { code: 'C' as const, rewardPoints: 10 as const, startsAt: KNOCKOUT_START,    endsAt: SEMIFINAL_START,   editsLocked: false, label: 'Round of 32 + Round of 16 + Quarterfinals' },
  { code: 'D' as const, rewardPoints: 2 as const,  startsAt: SEMIFINAL_START,   endsAt: null,              editsLocked: false, label: 'Semifinals onward' },
] as const;

/**
 * Ordered, non-overlapping, gapless. resolvePhase relies on this order.
 * Boundary convention: [startsAt, endsAt) — start inclusive, end exclusive.
 */
export const TOURNAMENT_PHASES_2026: readonly TournamentPhaseConfig[] = rawPhases.map((p) => ({
  ...p,
  startsAtTime: parseTime(p.startsAt, -Infinity),
  endsAtTime: parseTime(p.endsAt, Infinity),
}));

// src/config/tournamentPhases.ts
//
// CANONICAL SOURCE OF TRUTH for FIFA World Cup 2026 phase boundaries.
// Both `tournament_phases` (Epic 6) and Epic 2's `matches` loader (Story 2.1)
// MUST derive their dates from THIS file. Divergence is caught by the contract
// test in tests/integration/tournament-phases-contract.test.ts.
//
// ⚠️ ALL DATES BELOW ARE TBD-CONFIRM PLACEHOLDERS.
// Final FIFA fixture release pending. Replace with official kickoffs before prod.
// All values are ISO-8601 UTC (timestamptz). WC2026 host venues span UTC-7..UTC-4;
// store UTC, convert at the edge.

export type AwardPhase = 'A' | 'B' | 'C' | 'D';

export interface TournamentPhaseConfig {
  /** Stable key. Matches tournament_phases.phase_code. */
  readonly code: AwardPhase;
  /** Points for a correct special prediction made during this phase (FR-16). */
  readonly rewardPoints: 50 | 25 | 10 | 0;
  /** Inclusive lower bound (UTC). `null` = open-ended start (before tournament). */
  readonly startsAt: string | null;
  /** Exclusive upper bound (UTC). `null` = open-ended end (tournament over). */
  readonly endsAt: string | null;
  /** Whether edits to predictions are locked during this phase (FR-16, Fase D). */
  readonly editsLocked: boolean;
  readonly label: string;
}

// TBD-CONFIRM placeholders — see header.
const INAUGURAL_KICKOFF = '2026-06-11T18:00:00Z';   // Fase A → B boundary
const KNOCKOUT_START    = '2026-06-28T16:00:00Z';   // Fase B → C boundary (= first Round-of-32 kickoff)
const SEMIFINAL_START   = '2026-07-14T18:00:00Z';   // Fase C → D boundary

/**
 * Ordered, non-overlapping, gapless. resolvePhase relies on this order.
 * Boundary convention: [startsAt, endsAt) — start inclusive, end exclusive.
 */
export const TOURNAMENT_PHASES_2026: readonly TournamentPhaseConfig[] = [
  { code: 'A', rewardPoints: 50, startsAt: null,              endsAt: INAUGURAL_KICKOFF, editsLocked: false, label: 'Before inaugural match' },
  { code: 'B', rewardPoints: 25, startsAt: INAUGURAL_KICKOFF, endsAt: KNOCKOUT_START,    editsLocked: false, label: 'Group stage' },
  { code: 'C', rewardPoints: 10, startsAt: KNOCKOUT_START,    endsAt: SEMIFINAL_START,   editsLocked: false, label: 'Round of 32 + Round of 16 + Quarterfinals' },
  { code: 'D', rewardPoints: 0,  startsAt: SEMIFINAL_START,   endsAt: null,              editsLocked: true,  label: 'Semifinals onward' },
] as const;

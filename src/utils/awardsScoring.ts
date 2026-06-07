// src/utils/awardsScoring.ts
import {
  type AwardPhase,
  type TournamentPhaseConfig,
  TOURNAMENT_PHASES_2026,
} from '@/config/tournamentPhases';

export interface ResolvedPhase {
  readonly code: AwardPhase;
  readonly rewardPoints: TournamentPhaseConfig['rewardPoints'];
  readonly editsLocked: boolean;
}

/**
 * Resolve which tournament phase a timestamp falls in.
 * Boundary convention: [startsAt, endsAt) — start inclusive, end exclusive.
 * @param at     Moment to classify (caller injects; e.g. special_predictions.predicted_at).
 * @param phases Ordered, gapless, non-overlapping. Defaults to WC2026 config.
 * @throws if `at` matches no phase (a gap/parse bug — fail loud, never silent).
 */
export function resolvePhase(
  at: Date,
  phases: readonly TournamentPhaseConfig[] = TOURNAMENT_PHASES_2026,
): ResolvedPhase {
  const t = at.getTime();
  if (isNaN(t)) {
    throw new Error("resolvePhase: invalid date passed");
  }
  for (const p of phases) {
    if (t >= p.startsAtTime && t < p.endsAtTime) {
      return { code: p.code, rewardPoints: p.rewardPoints, editsLocked: p.editsLocked };
    }
  }
  throw new Error(`resolvePhase: no phase covers ${at.toISOString()} — phase config has a gap`);
}

/**
 * Score a correct special prediction made at `predictedAt` (FR-16).
 * Returns the phase reward. `editsLocked` prevents new edits, but does not zero
 * out a correct prediction's reward.
 */
export function scoreAward(
  predictedAt: Date,
  isCorrect: boolean,
  phases: readonly TournamentPhaseConfig[] = TOURNAMENT_PHASES_2026,
): number {
  if (!isCorrect) return 0;
  const { rewardPoints } = resolvePhase(predictedAt, phases);
  return rewardPoints;
}

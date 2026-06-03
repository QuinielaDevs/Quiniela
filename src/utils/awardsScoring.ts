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
    let lo = -Infinity;
    if (p.startsAt !== null) {
      const parsedLo = Date.parse(p.startsAt);
      if (isNaN(parsedLo)) {
        throw new Error(`resolvePhase: invalid startsAt date string "${p.startsAt}" in phase ${p.code}`);
      }
      lo = parsedLo;
    }

    let hi = Infinity;
    if (p.endsAt !== null) {
      const parsedHi = Date.parse(p.endsAt);
      if (isNaN(parsedHi)) {
        throw new Error(`resolvePhase: invalid endsAt date string "${p.endsAt}" in phase ${p.code}`);
      }
      hi = parsedHi;
    }

    if (t >= lo && t < hi) {
      return { code: p.code, rewardPoints: p.rewardPoints, editsLocked: p.editsLocked };
    }
  }
  throw new Error(`resolvePhase: no phase covers ${at.toISOString()} — phase config has a gap`);
}

/**
 * Score a correct special prediction made at `predictedAt` (FR-16).
 * Returns the phase reward, or 0 when edits were locked (Fase D).
 */
export function scoreAward(
  predictedAt: Date,
  isCorrect: boolean,
  phases: readonly TournamentPhaseConfig[] = TOURNAMENT_PHASES_2026,
): number {
  if (!isCorrect) return 0;
  const { rewardPoints, editsLocked } = resolvePhase(predictedAt, phases);
  return editsLocked ? 0 : rewardPoints;
}

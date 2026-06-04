import {
  POINTS_EXACT,
  calculateBasePoints,
  calculatePredictionPoints,
} from "@/utils/scoring";
import type { BadgeType, GameProfileType } from "@/types";

type TerminalStatus = "finished" | "suspended" | "canceled";

export type AwardMatch = {
  id: string;
  matchday: number | null;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
};

export type AwardPrediction = {
  matchId: string;
  homeScorePred: number;
  awayScorePred: number;
  multiplier: number;
};

export type DerivedBadge = {
  badgeType: BadgeType;
  badgeLabel: string;
  reason: string;
  points: number;
};

export type DerivedGameProfile = {
  profileType: GameProfileType;
  profileLabel: string;
  summary: string;
};

export type DerivedAwardsResult = {
  badges: DerivedBadge[];
  profile: DerivedGameProfile | null;
  predictedCount: number;
  totalPoints: number;
  exactDifficultCount: number;
  drawPredictedCount: number;
  tightPredictionCount: number;
  awayWinPredictedCount: number;
  averagePredictedGoals: number;
};

const TERMINAL_STATUSES = new Set<TerminalStatus>([
  "finished",
  "suspended",
  "canceled",
]);

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status as TerminalStatus);
}

function hasFinalScore(match: AwardMatch): boolean {
  return Number.isInteger(match.homeScore) && Number.isInteger(match.awayScore);
}

function isEvaluableFinished(
  match: AwardMatch,
): match is AwardMatch & { homeScore: number; awayScore: number } {
  return match.status === "finished" && hasFinalScore(match);
}

function isDifficultExact(match: AwardMatch): boolean {
  if (match.homeScore == null || match.awayScore == null) return false;
  const totalGoals = match.homeScore + match.awayScore;
  const margin = Math.abs(match.homeScore - match.awayScore);
  return totalGoals >= 4 || margin >= 3 || Math.max(match.homeScore, match.awayScore) >= 3;
}

function isTightPrediction(prediction: AwardPrediction): boolean {
  const totalPredictedGoals =
    prediction.homeScorePred + prediction.awayScorePred;
  const predictedMargin = Math.abs(
    prediction.homeScorePred - prediction.awayScorePred,
  );

  return (
    (prediction.homeScorePred === 0 && prediction.awayScorePred === 0) ||
    (prediction.homeScorePred === 1 && prediction.awayScorePred === 0) ||
    (prediction.homeScorePred === 0 && prediction.awayScorePred === 1) ||
    (prediction.homeScorePred === 1 && prediction.awayScorePred === 1) ||
    (totalPredictedGoals <= 2 && predictedMargin <= 1)
  );
}

function predictionByMatchId(predictions: AwardPrediction[]) {
  return new Map(predictions.map((prediction) => [prediction.matchId, prediction]));
}

export function closedMatchdays(matches: AwardMatch[]): number[] {
  const byMatchday = new Map<number, AwardMatch[]>();

  for (const match of matches) {
    if (match.matchday == null) continue;
    const current = byMatchday.get(match.matchday) ?? [];
    current.push(match);
    byMatchday.set(match.matchday, current);
  }

  return [...byMatchday.entries()]
    .filter(([, matchdayMatches]) => {
      const hasFinished = matchdayMatches.some(isEvaluableFinished);
      const allTerminal = matchdayMatches.every((m) => isTerminal(m.status));
      return hasFinished && allTerminal;
    })
    .map(([matchday]) => matchday)
    .sort((a, b) => a - b);
}

export function deriveAwardsForMatchday(
  matches: AwardMatch[],
  predictions: AwardPrediction[],
  matchday: number,
): DerivedAwardsResult {
  const predictionMap = predictionByMatchId(predictions);
  const finishedMatches = matches.filter(
    (
      match,
    ): match is AwardMatch & { homeScore: number; awayScore: number } =>
      match.matchday === matchday && isEvaluableFinished(match),
  );

  let totalPoints = 0;
  let exactDifficultCount = 0;
  let drawPredictedCount = 0;
  let tightPredictionCount = 0;
  let awayWinPredictedCount = 0;
  let predictedGoals = 0;
  let predictedCount = 0;

  for (const match of finishedMatches) {
    const prediction = predictionMap.get(match.id);
    if (!prediction) continue;

    predictedCount += 1;
    predictedGoals += prediction.homeScorePred + prediction.awayScorePred;
    if (prediction.homeScorePred === prediction.awayScorePred) {
      drawPredictedCount += 1;
    }
    if (prediction.awayScorePred > prediction.homeScorePred) {
      awayWinPredictedCount += 1;
    }
    if (isTightPrediction(prediction)) {
      tightPredictionCount += 1;
    }

    const base = calculateBasePoints(
      { home: prediction.homeScorePred, away: prediction.awayScorePred },
      { home: match.homeScore, away: match.awayScore },
      "finished",
    );
    totalPoints += calculatePredictionPoints(base, prediction.multiplier);

    if (base === POINTS_EXACT && isDifficultExact(match)) {
      exactDifficultCount += 1;
    }
  }

  totalPoints = round2(totalPoints);
  const averagePredictedGoals =
    predictedCount === 0 ? 0 : round2(predictedGoals / predictedCount);
  const badges: DerivedBadge[] = [];

  if (predictedCount > 0 && exactDifficultCount > 0) {
    badges.push({
      badgeType: "nostradamus",
      badgeLabel: "Nostradamus",
      reason: "Acertó un marcador exacto de alta dificultad en la jornada.",
      points: totalPoints,
    });
  }

  if (predictedCount > 0 && totalPoints === 0) {
    badges.push({
      badgeType: "el_salado",
      badgeLabel: "El Salado",
      reason: "Terminó la jornada sin sumar puntos pese a tener predicciones.",
      points: 0,
    });
  }

  if (predictedCount > 0 && drawPredictedCount > predictedCount / 2) {
    badges.push({
      badgeType: "el_tibio",
      badgeLabel: "El Tibio",
      reason: "Pronosticó empates en la mayoría de sus partidos de la jornada.",
      points: totalPoints,
    });
  }

  return {
    badges,
    profile: deriveGameProfile({
      predictedCount,
      tightPredictionCount,
      averagePredictedGoals,
      awayWinPredictedCount,
    }),
    predictedCount,
    totalPoints,
    exactDifficultCount,
    drawPredictedCount,
    tightPredictionCount,
    awayWinPredictedCount,
    averagePredictedGoals,
  };
}

function deriveGameProfile({
  predictedCount,
  tightPredictionCount,
  averagePredictedGoals,
  awayWinPredictedCount,
}: {
  predictedCount: number;
  tightPredictionCount: number;
  averagePredictedGoals: number;
  awayWinPredictedCount: number;
}): DerivedGameProfile | null {
  if (predictedCount === 0) return null;

  if (tightPredictionCount > predictedCount / 2) {
    return {
      profileType: "conservador",
      profileLabel: "Conservador",
      summary: "Prefiere marcadores cortos y partidos cerrados.",
    };
  }

  if (averagePredictedGoals >= 3.5) {
    return {
      profileType: "optimista",
      profileLabel: "Optimista",
      summary: "Juega esperando marcadores amplios y partidos con goles.",
    };
  }

  if (awayWinPredictedCount / predictedCount >= 0.4) {
    return {
      profileType: "cazador_sorpresas",
      profileLabel: "Cazador de Sorpresas",
      summary:
        "Se anima a pronosticar golpes visitantes aunque no haya cuotas cargadas todavía.",
    };
  }

  return {
    profileType: "conservador",
    profileLabel: "Conservador",
    summary: "No mostró una tendencia fuerte, así que queda como perfil base.",
  };
}

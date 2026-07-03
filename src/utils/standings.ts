// ============================================================
// Motor PURO de la tabla de posiciones (Story 3.1).
// Sin dependencias de DB ni DOM: recibe datos ya cargados y devuelve filas
// ordenadas con su rank. La fórmula de puntos vive SOLO en `scoring.ts`
// (fuente única de verdad de 2.1); aquí solo se agrega y ordena.
//
// IMPORTANTE: la clasificación se calcula on-the-fly desde los partidos
// `finished` + predicciones. NO se lee `predictions.points_earned` (esa
// persistencia oficial es trabajo de Epic 5.3, aún no implementado).
// ============================================================
import {
  POINTS_EXACT,
  POINTS_RESULT,
  calculateBasePoints,
  calculatePredictionPoints,
} from "@/utils/scoring";
import type { PaymentStatus } from "@/types";
import { phaseKeyForMatch } from "@/utils/tournament";

export type StandingMember = {
  userId: string;
  displayName: string;
  avatarUrl: string;
  paymentStatus: PaymentStatus;
  joinedAt: string; // ISO 8601 UTC (league_members.joined_at)
  /** Puntos ganados en duelos de la liga (calculados vía RPC fn_get_league_duel_points).
   *  Toda la liga, no por jornada. 4º criterio de desempate. Opcional → 0 si no se provee. */
  duelPoints?: number;
  /** Puntos de premios especiales (RPC fn_get_league_award_points, BUG-004).
   *  Solo suman al total en el acumulado General: un premio no pertenece a
   *  ninguna jornada/fase. Opcional → 0 si no se provee. */
  awardPoints?: number;
};

export type StandingMatch = {
  id: string;
  status: string; // MatchStatus; solo cuentan los 'finished'
  matchday: number | null;
  stage?: string | null;
  homeScore: number | null;
  awayScore: number | null;
  updatedAt?: string; // timestamp ISO de actualización
  matchTime?: string; // timestamp ISO de kick-off (para ordenar dentro de la fase)
  homeTeam?: string | null;
  awayTeam?: string | null;
  penaltiesHomeScore?: number | null;
  penaltiesAwayScore?: number | null;
  extraTimeHomeScore?: number | null;
  extraTimeAwayScore?: number | null;
};

export type StandingPrediction = {
  userId: string;
  matchId: string;
  homeScorePred: number;
  awayScorePred: number;
  multiplier: number;
};

export type StandingRow = {
  rank: number;
  userId: string;
  displayName: string;
  avatarUrl: string;
  paymentStatus: PaymentStatus;
  totalPoints: number;
  /** Aciertos de marcador EXACTO (5 pts): equipo y score, incluye empates exactos. */
  exactCount: number;
  /** Aciertos solo de resultado/ganador o empate (2 pts), sin el marcador exacto. */
  resultCount: number;
  /** Puntos ganados en duelos usados en el desempate y mostrados en General. */
  duelPoints: number;
  /** Puntos de premios especiales incluidos en totalPoints (solo General). */
  awardPoints: number;
  /** Cambio de rango/posición respecto al partido/estado anterior. Positivo = subió, Negativo = bajó, 0 = igual. */
  rankChange?: number;
  /** Indica si comparte el rank con otro miembro debido a un empate absoluto en los 5 criterios principales. */
  isTie: boolean;
};

export type ProjectedStandingRow = StandingRow & {
  /** Puntos virtuales aportados por partidos live; no son clasificacion oficial. */
  livePoints: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

type BaseStandingCalculation = {
  member: StandingMember;
  totalPoints: number;
  exactCount: number;
  resultCount: number;
  duelPoints: number;
  awardPoints: number;
};

function computeBaseStandings(
  members: StandingMember[],
  matchesInScope: StandingMatch[],
  predictions: StandingPrediction[],
  includeAwards: boolean,
): BaseStandingCalculation[] {
  const predictionByKey = new Map(
    predictions.map((p) => [`${p.userId}:${p.matchId}`, p]),
  );

  const rows = members.map((member) => {
    let totalPoints = 0;
    let exactCount = 0;
    let resultCount = 0;

    for (const match of matchesInScope) {
      const pred = predictionByKey.get(`${member.userId}:${match.id}`);
      if (!pred) continue;

      const base = calculateBasePoints(
        { home: pred.homeScorePred, away: pred.awayScorePred },
        { home: match.homeScore as number, away: match.awayScore as number },
        "finished",
      );
      totalPoints += calculatePredictionPoints(base, pred.multiplier);
      if (base === POINTS_EXACT) exactCount += 1;
      else if (base === POINTS_RESULT) resultCount += 1;
    }

    const awardPoints = includeAwards ? round2(member.awardPoints ?? 0) : 0;

    return {
      member,
      totalPoints: round2(totalPoints + awardPoints),
      exactCount,
      resultCount,
      duelPoints: member.duelPoints ?? 0,
      awardPoints,
    };
  });

  rows.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.exactCount !== a.exactCount) return b.exactCount - a.exactCount;
    if (b.resultCount !== a.resultCount) return b.resultCount - a.resultCount;
    if (b.awardPoints !== a.awardPoints) return b.awardPoints - a.awardPoints;
    if (b.duelPoints !== a.duelPoints) return b.duelPoints - a.duelPoints;
    return a.member.userId.localeCompare(b.member.userId);
  });

  return rows;
}

export function buildStandings(
  members: StandingMember[],
  matches: StandingMatch[],
  predictions: StandingPrediction[],
  phaseKeyOrMatchday?: string | number,
): StandingRow[] {
  const targetPhaseKey =
    typeof phaseKeyOrMatchday === "number"
      ? `jornada-${phaseKeyOrMatchday}`
      : phaseKeyOrMatchday;

  // Partidos en alcance: solo 'finished' y, si se filtra, de esa fase.
  const matchesInScope = matches.filter((m) => {
    if (m.status !== "finished") return false;
    if (targetPhaseKey === undefined || targetPhaseKey === "general")
      return true;

    const mStage = m.stage ?? null;
    return (
      phaseKeyForMatch({ stage: mStage, matchday: m.matchday }) ===
      targetPhaseKey
    );
  });

  const includeAwards =
    targetPhaseKey === undefined || targetPhaseKey === "general";

  // 1. Calcular clasificación actual
  const currentRows = computeBaseStandings(
    members,
    matchesInScope,
    predictions,
    includeAwards,
  );

  const areRowsEqual = (
    r1: BaseStandingCalculation | undefined,
    r2: BaseStandingCalculation | undefined,
  ) => {
    if (!r1 || !r2) return false;
    return (
      r1.totalPoints === r2.totalPoints &&
      r1.exactCount === r2.exactCount &&
      r1.resultCount === r2.resultCount &&
      r1.awardPoints === r2.awardPoints &&
      r1.duelPoints === r2.duelPoints
    );
  };

  // 2. Calcular clasificación anterior (excluyendo el partido finalizado más reciente)
  const previousRanks = new Map<string, number>();
  if (matchesInScope.length > 0) {
    const sortedScope = [...matchesInScope].sort((a, b) => {
      const timeA = a.matchTime ? new Date(a.matchTime).getTime() : 0;
      const timeB = b.matchTime ? new Date(b.matchTime).getTime() : 0;
      if (timeB !== timeA) return timeB - timeA;
      return b.id.localeCompare(a.id);
    });
    const lastMatch = sortedScope[0]!;
    const previousMatches = matchesInScope.filter((m) => m.id !== lastMatch.id);
    const previousRows = computeBaseStandings(
      members,
      previousMatches,
      predictions,
      includeAwards,
    );
    let prevRank = 1;
    previousRows.forEach((row, index) => {
      if (index > 0 && !areRowsEqual(row, previousRows[index - 1])) {
        prevRank = index + 1;
      }
      previousRanks.set(row.member.userId, prevRank);
    });
  } else {
    let prevRank = 1;
    currentRows.forEach((row, index) => {
      if (index > 0 && !areRowsEqual(row, currentRows[index - 1])) {
        prevRank = index + 1;
      }
      previousRanks.set(row.member.userId, prevRank);
    });
  }

  let currentRank = 1;
  return currentRows.map((row, index) => {
    if (index > 0) {
      if (!areRowsEqual(row, currentRows[index - 1])) {
        currentRank = index + 1;
      }
    }

    const previousRank = previousRanks.get(row.member.userId) ?? currentRank;
    const isTieWithPrev =
      index > 0 && areRowsEqual(row, currentRows[index - 1]);
    const isTieWithNext =
      index < currentRows.length - 1 &&
      areRowsEqual(row, currentRows[index + 1]);
    const isTie = isTieWithPrev || isTieWithNext;

    return {
      rank: currentRank,
      userId: row.member.userId,
      displayName: row.member.displayName,
      avatarUrl: row.member.avatarUrl,
      paymentStatus: row.member.paymentStatus,
      totalPoints: row.totalPoints,
      exactCount: row.exactCount,
      resultCount: row.resultCount,
      duelPoints: row.duelPoints,
      awardPoints: row.awardPoints,
      rankChange: previousRank - currentRank,
      isTie,
    };
  });
}

type BaseProjectedCalculation = BaseStandingCalculation & {
  livePoints: number;
};

function computeBaseProjectedStandings(
  members: StandingMember[],
  matchesInScope: StandingMatch[],
  predictions: StandingPrediction[],
): BaseProjectedCalculation[] {
  const predictionByKey = new Map(
    predictions.map((p) => [`${p.userId}:${p.matchId}`, p]),
  );

  const rows = members.map((member) => {
    let totalPoints = 0;
    let livePoints = 0;
    let exactCount = 0;
    let resultCount = 0;

    for (const match of matchesInScope) {
      const pred = predictionByKey.get(`${member.userId}:${match.id}`);
      if (!pred) continue;

      const base = calculateBasePoints(
        { home: pred.homeScorePred, away: pred.awayScorePred },
        { home: match.homeScore as number, away: match.awayScore as number },
        "finished",
      );
      const points = calculatePredictionPoints(base, pred.multiplier);
      totalPoints += points;
      if (match.status === "live") livePoints += points;
      if (base === POINTS_EXACT) exactCount += 1;
      else if (base === POINTS_RESULT) resultCount += 1;
    }

    const awardPoints = round2(member.awardPoints ?? 0);

    return {
      member,
      totalPoints: round2(totalPoints + awardPoints),
      livePoints: round2(livePoints),
      exactCount,
      resultCount,
      duelPoints: member.duelPoints ?? 0,
      awardPoints,
    };
  });

  rows.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.exactCount !== a.exactCount) return b.exactCount - a.exactCount;
    if (b.resultCount !== a.resultCount) return b.resultCount - a.resultCount;
    if (b.awardPoints !== a.awardPoints) return b.awardPoints - a.awardPoints;
    if (b.duelPoints !== a.duelPoints) return b.duelPoints - a.duelPoints;
    return a.member.userId.localeCompare(b.member.userId);
  });

  return rows;
}

/**
 * Construye la tabla proyectada: finished + live. Los partidos live se calculan
 * como si su marcador momentaneo fuera el resultado final, pero solo para esta
 * vista. `buildStandings` sigue siendo la fuente de la clasificacion oficial y
 * solo cuenta partidos finished.
 */
export function buildProjectedStandings(
  members: StandingMember[],
  matches: StandingMatch[],
  predictions: StandingPrediction[],
): ProjectedStandingRow[] {
  const matchesInScope = matches.filter(
    (m) =>
      m.status === "finished" ||
      (m.status === "live" &&
        Number.isInteger(m.homeScore) &&
        Number.isInteger(m.awayScore)),
  );

  // 1. Calcular posiciones proyectadas actuales (incluyendo live)
  const projectedRows = computeBaseProjectedStandings(
    members,
    matchesInScope,
    predictions,
  );

  // 2. Calcular posiciones oficiales base (sólo finished)
  const finishedMatches = matchesInScope.filter((m) => m.status === "finished");
  const officialRows = computeBaseStandings(
    members,
    finishedMatches,
    predictions,
    true,
  );
  const officialRanks = new Map<string, number>();

  const areBaseRowsEqual = (
    r1: BaseStandingCalculation | undefined,
    r2: BaseStandingCalculation | undefined,
  ) => {
    if (!r1 || !r2) return false;
    return (
      r1.totalPoints === r2.totalPoints &&
      r1.exactCount === r2.exactCount &&
      r1.resultCount === r2.resultCount &&
      r1.awardPoints === r2.awardPoints &&
      r1.duelPoints === r2.duelPoints
    );
  };

  let officialRank = 1;
  officialRows.forEach((row, index) => {
    if (index > 0) {
      if (!areBaseRowsEqual(row, officialRows[index - 1])) {
        officialRank = index + 1;
      }
    }
    officialRanks.set(row.member.userId, officialRank);
  });

  const areProjectedRowsEqual = (
    r1: BaseProjectedCalculation | undefined,
    r2: BaseProjectedCalculation | undefined,
  ) => {
    if (!r1 || !r2) return false;
    return (
      r1.totalPoints === r2.totalPoints &&
      r1.exactCount === r2.exactCount &&
      r1.resultCount === r2.resultCount &&
      r1.awardPoints === r2.awardPoints &&
      r1.duelPoints === r2.duelPoints
    );
  };

  let currentRank = 1;
  return projectedRows.map((row, index) => {
    if (index > 0) {
      if (!areProjectedRowsEqual(row, projectedRows[index - 1])) {
        currentRank = index + 1;
      }
    }

    const oRank = officialRanks.get(row.member.userId) ?? currentRank;
    const isTieWithPrev =
      index > 0 && areProjectedRowsEqual(row, projectedRows[index - 1]);
    const isTieWithNext =
      index < projectedRows.length - 1 &&
      areProjectedRowsEqual(row, projectedRows[index + 1]);
    const isTie = isTieWithPrev || isTieWithNext;

    return {
      rank: currentRank,
      userId: row.member.userId,
      displayName: row.member.displayName,
      avatarUrl: row.member.avatarUrl,
      paymentStatus: row.member.paymentStatus,
      totalPoints: row.totalPoints,
      exactCount: row.exactCount,
      resultCount: row.resultCount,
      duelPoints: row.duelPoints,
      awardPoints: row.awardPoints,
      livePoints: row.livePoints,
      rankChange: oRank - currentRank,
      isTie,
    };
  });
}

/** Jornadas distintas (asc) presentes en partidos finished. Para las pestañas. */
export function finishedMatchdays(matches: StandingMatch[]): number[] {
  const set = new Set<number>();
  for (const m of matches) {
    if (m.status === "finished" && m.matchday != null) set.add(m.matchday);
  }
  return [...set].sort((a, b) => a - b);
}

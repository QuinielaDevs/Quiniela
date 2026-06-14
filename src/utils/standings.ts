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
  /** Saldo de puntos de duelos usado en el desempate y mostrado en General. */
  duelPoints: number;
  /** Puntos de premios especiales incluidos en totalPoints (solo General). */
  awardPoints: number;
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

/**
 * Construye la tabla de posiciones para el alcance pedido.
 *
 * @param phaseKeyOrMatchday  undefined = acumulado (General); string/número = fase/jornada específica.
 *
 * Desempate: puntos desc → marcadores exactos desc → resultados desc → premios desc → puntos de duelos desc.
 * Si persiste el empate absoluto (mismos valores en todos los 5 criterios principales),
 * comparten la posición (rank) y se usa userId como orden determinista estable.
 */
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
    if (targetPhaseKey === undefined || targetPhaseKey === "general") return true;
    
    const mStage = m.stage ?? null;
    return phaseKeyForMatch({ stage: mStage, matchday: m.matchday }) === targetPhaseKey;
  });

  const predictionByKey = new Map(
    predictions.map((p) => [`${p.userId}:${p.matchId}`, p]),
  );

  // Los premios especiales no pertenecen a ninguna jornada/fase: solo entran
  // en el acumulado General (BUG-004).
  const includeAwards =
    targetPhaseKey === undefined || targetPhaseKey === "general";

  const rows = members.map((member) => {
    let totalPoints = 0;
    let exactCount = 0;
    let resultCount = 0;

    for (const match of matchesInScope) {
      const pred = predictionByKey.get(`${member.userId}:${match.id}`);
      if (!pred) continue;

      const base = calculateBasePoints(
        { home: pred.homeScorePred, away: pred.awayScorePred },
        // homeScore/awayScore pueden ser null en un 'finished' corrupto;
        // calculateBasePoints blinda no-finitos → 0.
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
      // Puntos ganados en duelos de toda la liga. 4º criterio de desempate.
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
    // Clave final estable: ante empate TOTAL (puntos+exactos+resultados+awards+duelos),
    // ordenar por userId garantiza un orden determinista en la lista interna.
    return a.member.userId.localeCompare(b.member.userId);
  });

  const areRowsEqual = (r1: typeof rows[0] | undefined, r2: typeof rows[0] | undefined) => {
    if (!r1 || !r2) return false;
    return r1.totalPoints === r2.totalPoints &&
           r1.exactCount === r2.exactCount &&
           r1.resultCount === r2.resultCount &&
           r1.awardPoints === r2.awardPoints &&
           r1.duelPoints === r2.duelPoints;
  };

  let currentRank = 1;
  return rows.map((row, index) => {
    if (index > 0) {
      const prev = rows[index - 1];
      if (!areRowsEqual(row, prev)) {
        currentRank = index + 1;
      }
    }

    const isTieWithPrev = index > 0 && areRowsEqual(row, rows[index - 1]);
    const isTieWithNext = index < rows.length - 1 && areRowsEqual(row, rows[index + 1]);
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
      isTie,
    };
  });
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

      // Para proyeccion, un live con marcador valido se evalua como snapshot
      // virtual. La semantica oficial de scoring.ts para status live no cambia.
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

    // La proyectada es una vista del acumulado General: los premios siempre
    // entran (BUG-004), igual que en buildStandings sin filtro de fase.
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

  const areRowsEqual = (r1: typeof rows[0] | undefined, r2: typeof rows[0] | undefined) => {
    if (!r1 || !r2) return false;
    return r1.totalPoints === r2.totalPoints &&
           r1.exactCount === r2.exactCount &&
           r1.resultCount === r2.resultCount &&
           r1.awardPoints === r2.awardPoints &&
           r1.duelPoints === r2.duelPoints;
  };

  let currentRank = 1;
  return rows.map((row, index) => {
    if (index > 0) {
      const prev = rows[index - 1];
      if (!areRowsEqual(row, prev)) {
        currentRank = index + 1;
      }
    }

    const isTieWithPrev = index > 0 && areRowsEqual(row, rows[index - 1]);
    const isTieWithNext = index < rows.length - 1 && areRowsEqual(row, rows[index + 1]);
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

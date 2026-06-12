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
  /** Neto de puntos ganados/perdidos en duelos (RPC league_duel_points; excluye
   *  acreditaciones de jornada). Toda la liga, no por jornada. Puede ser
   *  negativo. 2º criterio de desempate. Opcional → 0 si no se provee. */
  duelPoints?: number;
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
  /** Neto de duelos (ganado − perdido) usado en el desempate y mostrado en
   *  General. Puede ser negativo. */
  duelPoints: number;
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
 * Desempate (Story 3.1 AC #5): puntos desc → marcadores exactos desc →
 * neto de duelos desc → joined_at asc. El neto de duelos llega vía
 * `member.duelPoints` (0 si no se provee).
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

    return {
      member,
      totalPoints: round2(totalPoints),
      exactCount,
      resultCount,
      // Neto de duelos de toda la liga. 2º criterio de desempate.
      duelPoints: member.duelPoints ?? 0,
    };
  });

  rows.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.exactCount !== a.exactCount) return b.exactCount - a.exactCount;
    if (b.duelPoints !== a.duelPoints) return b.duelPoints - a.duelPoints;
    // joined_at ascendente: ISO 8601 UTC ordena lexicográficamente.
    const byJoined = a.member.joinedAt.localeCompare(b.member.joinedAt);
    if (byJoined !== 0) return byJoined;
    // Clave final estable: ante empate TOTAL (puntos+exactos+duelos+joined_at),
    // ordenar por userId garantiza un orden determinista (no depende del orden
    // de inserción ni de la implementación de sort).
    return a.member.userId.localeCompare(b.member.userId);
  });

  return rows.map((row, index) => ({
    rank: index + 1,
    userId: row.member.userId,
    displayName: row.member.displayName,
    avatarUrl: row.member.avatarUrl,
    paymentStatus: row.member.paymentStatus,
    totalPoints: row.totalPoints,
    exactCount: row.exactCount,
    resultCount: row.resultCount,
    duelPoints: row.duelPoints,
  }));
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

    return {
      member,
      totalPoints: round2(totalPoints),
      livePoints: round2(livePoints),
      exactCount,
      resultCount,
      duelPoints: member.duelPoints ?? 0,
    };
  });

  rows.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.exactCount !== a.exactCount) return b.exactCount - a.exactCount;
    if (b.duelPoints !== a.duelPoints) return b.duelPoints - a.duelPoints;
    const byJoined = a.member.joinedAt.localeCompare(b.member.joinedAt);
    if (byJoined !== 0) return byJoined;
    return a.member.userId.localeCompare(b.member.userId);
  });

  return rows.map((row, index) => ({
    rank: index + 1,
    userId: row.member.userId,
    displayName: row.member.displayName,
    avatarUrl: row.member.avatarUrl,
    paymentStatus: row.member.paymentStatus,
    totalPoints: row.totalPoints,
    exactCount: row.exactCount,
    resultCount: row.resultCount,
    duelPoints: row.duelPoints,
    livePoints: row.livePoints,
  }));
}

/** Jornadas distintas (asc) presentes en partidos finished. Para las pestañas. */
export function finishedMatchdays(matches: StandingMatch[]): number[] {
  const set = new Set<number>();
  for (const m of matches) {
    if (m.status === "finished" && m.matchday != null) set.add(m.matchday);
  }
  return [...set].sort((a, b) => a - b);
}

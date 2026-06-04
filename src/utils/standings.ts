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
  calculateBasePoints,
  calculatePredictionPoints,
} from "@/utils/scoring";
import type { PaymentStatus } from "@/types";

export type StandingMember = {
  userId: string;
  displayName: string;
  avatarUrl: string;
  paymentStatus: PaymentStatus;
  joinedAt: string; // ISO 8601 UTC (league_members.joined_at)
};

export type StandingMatch = {
  id: string;
  status: string; // MatchStatus; solo cuentan los 'finished'
  matchday: number | null;
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
  exactCount: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Construye la tabla de posiciones para el alcance pedido.
 *
 * @param matchday  undefined = acumulado (General); número = solo esa jornada.
 *
 * Desempate (Story 3.1 AC #5): puntos desc → marcadores exactos desc →
 * puntos de duelos 1v1 desc (Epic 5, hoy constante 0) → joined_at asc.
 */
export function buildStandings(
  members: StandingMember[],
  matches: StandingMatch[],
  predictions: StandingPrediction[],
  matchday?: number,
): StandingRow[] {
  // Partidos en alcance: solo 'finished' y, si se filtra, de esa jornada.
  const matchesInScope = matches.filter(
    (m) =>
      m.status === "finished" &&
      (matchday === undefined || m.matchday === matchday),
  );

  const predictionByKey = new Map(
    predictions.map((p) => [`${p.userId}:${p.matchId}`, p]),
  );

  const rows = members.map((member) => {
    let totalPoints = 0;
    let exactCount = 0;

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
    }

    return {
      member,
      totalPoints: round2(totalPoints),
      exactCount,
      // Duelos 1v1 (Epic 5) aún no existen → inerte. Seam explícito para que
      // Epic 5 lo conecte sin reescribir el orden.
      duelPoints: 0,
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

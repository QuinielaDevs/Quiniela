// Motor de puntuación de la quiniela (Story 2.1 — AC #4, #5).
// Lógica de negocio PURA: sin dependencias de base de datos ni DOM, por lo que
// es la fuente ÚNICA de verdad de la fórmula de puntos base. La consume tanto la
// tabla proyectada en vivo del cliente (Epic 4) como —si más adelante se añade
// una versión SQL para la clasificación oficial— debe espejarse exactamente con
// el mismo vector de pruebas para evitar drift. [Source: architecture.md#Separación de Standings]

/**
 * Estados posibles de un partido. Espeja el CHECK de `matches.status`; mantener
 * sincronizado con la migración matches_and_predictions.sql y con `MatchStatus`
 * en src/types/index.ts (los tipos generados lo tipan como `string`).
 */
export type MatchStatus =
  | "scheduled"
  | "live"
  | "finished"
  | "suspended"
  | "canceled";

/** Marcador (goles local/visitante). Reutilizable para predicción y resultado real. */
export type Scoreline = { home: number; away: number };

/** Puntos base por marcador exacto. */
export const POINTS_EXACT = 5;
/** Puntos base por acertar solo el resultado (mismo ganador o empate). */
export const POINTS_RESULT = 2;
/** Puntos base por no acertar (o partido no finalizado/anulado). */
export const POINTS_NONE = 0;

/**
 * Calcula la puntuación BASE de una predicción frente al resultado real.
 *
 * Reglas:
 *  - Si el partido NO está 'finished' (incluye 'canceled'/'suspended', que
 *    explícitamente anulan la predicción a 0.00, y 'scheduled'/'live', que aún
 *    no puntúan) → 0. Estos partidos quedan EXCLUIDOS de las sumatorias de
 *    clasificación oficial y proyectada (AC #5).
 *  - Marcador exacto → 5.
 *  - Resultado acertado (mismo ganador local/visitante, o mismo empate),
 *    marcador distinto → 2.
 *  - En otro caso → 0.
 *
 * El multiplicador por antelación (PuntosObtenidos = base * multiplier) NO se
 * aplica aquí: pertenece a Story 2.4.
 */
export function calculateBasePoints(
  prediction: Scoreline,
  actual: Scoreline,
  status: MatchStatus,
): number {
  if (status !== "finished") {
    return POINTS_NONE;
  }

  // Guarda defensiva: un partido 'finished' con marcador real null (estado posible
  // en BD: no hay CHECK que lo impida) llegaría aquí como null/NaN. Sin esta guarda,
  // null === null daría "marcador exacto = 5" erróneo. Los goles son enteros >= 0.
  if (
    !Number.isInteger(prediction.home) ||
    !Number.isInteger(prediction.away) ||
    !Number.isInteger(actual.home) ||
    !Number.isInteger(actual.away)
  ) {
    return POINTS_NONE;
  }

  if (prediction.home === actual.home && prediction.away === actual.away) {
    return POINTS_EXACT;
  }

  const predictedOutcome = Math.sign(prediction.home - prediction.away);
  const actualOutcome = Math.sign(actual.home - actual.away);
  if (predictedOutcome === actualOutcome) {
    return POINTS_RESULT;
  }

  return POINTS_NONE;
}

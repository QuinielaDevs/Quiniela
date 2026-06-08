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

// ============================================================
// Multiplicador por antelación — por DISTANCIA EN JORNADAS.
// Premia pronosticar con jornadas de antelación: el multiplicador depende de
// cuántas jornadas por delante está la ronda del partido respecto a la jornada
// EN CURSO (la última cuyo primer partido ya empezó). Lineal +0.25 por jornada
// de distancia, tope 2.50x. Conforme avanza el torneo la distancia se acorta y
// el multiplicador baja (penalización por editar tarde).
//
// Rondas como jornadas consecutivas: J1=1, J2=2, J3=3, 32avos=4, Octavos=5,
// Cuartos=6, Semis=7, 3er puesto=8, Final=8.
//
// Regla de Jornada 1: la primera jornada es la línea base y SIEMPRE vale 1.0x.
//
// Esta misma regla se espeja en SQL (fn_match_round_ordinal +
// fn_current_round_ordinal + fn_prediction_multiplier + fn_save_prediction); si
// cambia una, cambiar la otra y su vector de pruebas para evitar drift.
// ============================================================

/** Jornada base del torneo: siempre 1.0x (no acumula antelación). */
export const BASELINE_MATCHDAY = 1;

export const MIN_MULTIPLIER = 1.0;
export const MAX_MULTIPLIER = 2.5;

/** Incremento del multiplicador por cada jornada de distancia. */
export const MULTIPLIER_STEP = 0.25;

/**
 * Tabla distancia-en-jornadas → multiplicador (para mostrar en Reglas). Lineal
 * +0.25 por jornada hasta el tope 2.5x (distancia 6+). Distancia 0 = 1.0x.
 */
export const MULTIPLIER_TIERS: ReadonlyArray<{
  distance: number;
  value: number;
}> = [
  { distance: 1, value: 1.25 },
  { distance: 2, value: 1.5 },
  { distance: 3, value: 1.75 },
  { distance: 4, value: 2.0 },
  { distance: 5, value: 2.25 },
  { distance: 6, value: 2.5 },
];

/**
 * Ordinales secuenciales de las rondas de eliminatoria (los grupos usan su
 * `matchday` 1/2/3). Espeja public.fn_match_round_ordinal en SQL.
 */
const KNOCKOUT_ORDINALS: Readonly<Record<string, number>> = {
  "round-32": 4,
  "round-16": 5,
  quarter: 6,
  semi: 7,
  "third-place": 8,
  final: 8,
};

function toMs(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return new Date(value).getTime();
}

/**
 * Ordinal secuencial de la ronda de un partido (J1=1, J2=2, J3=3, 32avos=4 …
 * Final=8). Grupos → su `matchday`; eliminatorias → por `stage`. null si no se
 * puede determinar. Espeja public.fn_match_round_ordinal.
 */
export function roundOrdinal(
  matchday: number | null | undefined,
  stage: string | null | undefined,
): number | null {
  if (stage && KNOCKOUT_ORDINALS[stage] != null) return KNOCKOUT_ORDINALS[stage];
  if (matchday != null) return matchday;
  return null;
}

/**
 * Ordinal de la "jornada en curso": la mayor ronda cuyo primer partido ya
 * empezó (match_time <= now). 0 si el torneo aún no inicia. Espeja
 * public.fn_current_round_ordinal (calculado en cliente sobre la lista cargada).
 */
export function currentRoundOrdinal(
  matches: ReadonlyArray<{
    matchday: number | null;
    stage: string | null;
    match_time: Date | string | number;
    status?: string | null;
  }>,
  now: Date | string | number = Date.now(),
): number {
  const nowMs = toMs(now);
  let current = 0;
  for (const match of matches) {
    if (match.status === "canceled") continue;
    if (toMs(match.match_time) > nowMs) continue;
    const ordinal = roundOrdinal(match.matchday, match.stage);
    if (ordinal != null && ordinal > current) current = ordinal;
  }
  return current;
}

/** Multiplicador para una distancia (en jornadas). Distancia <= 0 → 1.0x. */
export function multiplierForDistance(distance: number): number {
  if (!Number.isFinite(distance) || distance <= 0) return MIN_MULTIPLIER;
  return Math.min(MAX_MULTIPLIER, MIN_MULTIPLIER + MULTIPLIER_STEP * distance);
}

/**
 * Multiplicador por antelación basado en la DISTANCIA EN JORNADAS entre la ronda
 * del partido y la jornada en curso (`currentOrdinal`). Jornada 1 (línea base) o
 * ronda desconocida → 1.0x. El valor AUTORITATIVO lo calcula el backend
 * (fn_prediction_multiplier con la jornada en curso del servidor); esta versión
 * TS sirve para la UI predictiva.
 */
export function calculatePredictionMultiplier(
  matchday: number | null | undefined,
  stage: string | null | undefined,
  currentOrdinal: number,
): number {
  const target = roundOrdinal(matchday, stage);
  if (target == null || target <= BASELINE_MATCHDAY) {
    return MIN_MULTIPLIER;
  }
  // Referencia con piso en la jornada 1: pre-torneo (current 0) la J2 queda a
  // distancia 1 (1.25x), no 2. Espeja greatest(fn_current_round_ordinal(), 1).
  const reference = Math.max(currentOrdinal, BASELINE_MATCHDAY);
  const distance = Math.max(0, target - reference);
  return multiplierForDistance(distance);
}

/**
 * Aplicación final: PuntosObtenidos = PuntosBase * Multiplicador. No duplica la
 * regla de puntos base (`calculateBasePoints`). Redondea a 2 decimales para
 * `predictions.points_earned numeric(6,2)`.
 */
export function calculatePredictionPoints(
  basePoints: number,
  multiplier: number,
): number {
  if (!Number.isFinite(basePoints) || !Number.isFinite(multiplier)) {
    return 0;
  }
  return Math.round(basePoints * multiplier * 100) / 100;
}

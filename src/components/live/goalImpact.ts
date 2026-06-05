// ============================================================
// Lógica PURA del "Impacto de Gol" (Story 4.2).
// Sin React ni DOM: deriva, a partir de los datos de la tabla proyectada,
// (a) qué equipo anotó, (b) qué jugadores subieron de puesto y (c) a quién
// anuncia el toast. La fórmula de puntos vive SOLO en `scoring.ts` y el orden
// en `standings.ts` (buildProjectedStandings); aquí solo se comparan ranks.
// ============================================================
import type { StandingMatch } from "@/utils/standings";

/**
 * Partido enriquecido para la vista en vivo: el contrato puro de scoring
 * (`StandingMatch`) más los nombres de equipo, necesarios solo para el copy
 * del toast. NO se agregan estos campos a `standings.ts` para no contaminar el
 * motor de clasificación.
 */
export type LiveMatch = StandingMatch & {
  homeTeam: string | null;
  awayTeam: string | null;
};

/** Fila mínima necesaria para detectar movimientos (subconjunto de ProjectedStandingRow). */
export type RankRow = {
  userId: string;
  displayName: string;
  rank: number;
};

export type Mover = {
  userId: string;
  displayName: string;
  rank: number;
  prevRank: number;
};

function toScore(value: number | null): number {
  return Number.isInteger(value) ? (value as number) : 0;
}

/**
 * `true` solo si algún lado **incrementó** su marcador respecto al anterior, es
 * decir, hubo un gol. Una corrección a la baja (o sin marcador previo) devuelve
 * `false`: el "Impacto de Gol" no debe celebrarse sin un gol real, aunque el
 * recálculo reordene puestos. Cubre el caso de ambos lados subiendo (doble gol).
 */
export function hasScoreIncrease(
  prev: LiveMatch | undefined,
  next: LiveMatch,
): boolean {
  if (!prev || prev.homeScore === null || prev.awayScore === null) return false;
  return (
    toScore(next.homeScore) > toScore(prev.homeScore) ||
    toScore(next.awayScore) > toScore(prev.awayScore)
  );
}

/**
 * Infiere el equipo que anotó comparando el marcador nuevo contra el anterior.
 * Devuelve el nombre del equipo cuyo lado incrementó, o `null` si no se puede
 * determinar (sin marcador previo, ambos lados cambian, o falta el nombre).
 */
export function resolveScoringTeam(
  prev: LiveMatch | undefined,
  next: LiveMatch,
): string | null {
  if (!prev) return null;

  const homeUp = toScore(next.homeScore) > toScore(prev.homeScore);
  const awayUp = toScore(next.awayScore) > toScore(prev.awayScore);

  if (homeUp && !awayUp) return next.homeTeam ?? null;
  if (awayUp && !homeUp) return next.awayTeam ?? null;
  return null;
}

/**
 * Jugadores cuyo `rank` mejoró (disminuyó numéricamente) entre la tabla previa
 * y la recalculada. Ignora a quienes no estaban en la tabla previa.
 */
export function findMovers(prevRows: RankRow[], nextRows: RankRow[]): Mover[] {
  const prevRankByUser = new Map(prevRows.map((row) => [row.userId, row.rank]));
  const movers: Mover[] = [];

  for (const row of nextRows) {
    const prevRank = prevRankByUser.get(row.userId);
    if (prevRank != null && row.rank < prevRank) {
      movers.push({
        userId: row.userId,
        displayName: row.displayName,
        rank: row.rank,
        prevRank,
      });
    }
  }

  return movers;
}

/**
 * Selección determinista del jugador a anunciar (AC #2):
 * 1. el usuario actual (viewer) si subió;
 * 2. si no, el nuevo líder (quien subió al puesto 1);
 * 3. si no, el de mayor salto de puestos (desempate: rank menor, luego userId).
 */
export function selectAnnouncedMover(
  movers: Mover[],
  currentUserId: string,
): Mover | null {
  if (movers.length === 0) return null;

  const viewer = movers.find((mover) => mover.userId === currentUserId);
  if (viewer) return viewer;

  const newLeader = movers.find((mover) => mover.rank === 1);
  if (newLeader) return newLeader;

  const [topJump] = [...movers].sort((a, b) => {
    const jumpDiff = b.prevRank - b.rank - (a.prevRank - a.rank);
    if (jumpDiff !== 0) return jumpDiff;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.userId.localeCompare(b.userId);
  });
  return topJump ?? null;
}

/** Ordinal en español para el copy: 1er, 2º, 3º... */
export function formatRank(rank: number): string {
  return rank === 1 ? "1er" : `${rank}º`;
}

/**
 * Copy del toast "Impacto de Gol". Con equipo conocido nombra el gol; sin
 * equipo usa el fallback neutro. Tercera persona con `displayName` para todos
 * (incluido el viewer), por consistencia.
 */
export function buildGoalToastMessage(
  mover: Mover,
  scoringTeam: string | null,
): string {
  const rankLabel = formatRank(mover.rank);
  const tail = `${mover.displayName} sube al ${rankLabel} puesto proyectado 🎉`;
  return scoringTeam
    ? `¡Gol de ${scoringTeam}! ${tail}`
    : `¡Cambio en los marcadores! ${tail}`;
}

// Presentación de fases del torneo (Mundial 2026) y descripción de los
// "orígenes" TBD de eliminatoria. La tabla public.matches guarda `stage`
// (group/round-32/round-16/quarter/semi/third-place/final), `matchday` (1/2/3
// en grupos) y `home_source`/`away_source` (códigos como 1A, 3A/B/C/D/F, W97,
// L101) para los slots de bracket aún no resueltos. Capa pura de presentación.

export type MatchPhase = {
  // Clave estable usada por el tab bar (jornada-1, round-32, …).
  key: string;
  // Etiqueta corta para el tab (Jornada 1, 16avos, Octavos, …).
  label: string;
};

// Etiqueta legible de una fase de eliminatoria.
const STAGE_LABELS: Record<string, string> = {
  "round-32": "16avos",
  "round-16": "Octavos",
  quarter: "Cuartos",
  semi: "Semis",
  "third-place": "3.º Puesto",
  final: "Final",
};

// Orden canónico de las fases knockout para ordenar los tabs.
const KNOCKOUT_ORDER = [
  "round-32",
  "round-16",
  "quarter",
  "semi",
  "third-place",
  "final",
];

export function stageLabel(stage: string | null): string {
  if (!stage) return "Por definir";
  return STAGE_LABELS[stage] ?? stage;
}

// Deriva la clave de fase de un partido: jornada-N en grupos, el `stage` en
// eliminatorias.
export function phaseKeyForMatch(match: {
  stage: string | null;
  matchday: number | null;
}): string {
  if (match.stage === "group" || (match.matchday != null && !match.stage)) {
    return `jornada-${match.matchday ?? 0}`;
  }
  return match.stage ?? "otros";
}

// Construye la lista ordenada de fases presentes en un conjunto de partidos.
// Grupos primero (Jornada 1→3 por número), luego eliminatorias en orden FIFA.
export function buildPhases(
  matches: { stage: string | null; matchday: number | null }[],
): MatchPhase[] {
  const groupDays = new Set<number>();
  const knockout = new Set<string>();

  for (const match of matches) {
    if (match.stage === "group" || (match.matchday != null && !match.stage)) {
      if (match.matchday != null) groupDays.add(match.matchday);
    } else if (match.stage) {
      knockout.add(match.stage);
    }
  }

  const phases: MatchPhase[] = [];

  for (const day of [...groupDays].sort((a, b) => a - b)) {
    phases.push({ key: `jornada-${day}`, label: `Jornada ${day}` });
  }

  for (const stage of KNOCKOUT_ORDER) {
    if (knockout.has(stage)) {
      phases.push({ key: stage, label: stageLabel(stage) });
    }
  }

  return phases;
}

// Agrupa partidos de fase de grupos por su `group_label` (A–L), ordenado
// alfabéticamente. Los partidos sin group_label caen en una sección final "—"
// (no debería ocurrir en grupos, es defensivo). Dentro de cada grupo respeta el
// orden de entrada (la consulta ya los trae por match_time).
export function groupByGroupLabel<T extends { group_label: string | null }>(
  matches: T[],
): { group: string; matches: T[] }[] {
  const byGroup = new Map<string, T[]>();

  for (const match of matches) {
    const key = match.group_label ?? "—";
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(match);
    else byGroup.set(key, [match]);
  }

  return [...byGroup.entries()]
    .sort(([a], [b]) => {
      // La sección sin grupo ("—") siempre va al final.
      if (a === "—") return 1;
      if (b === "—") return -1;
      return a.localeCompare(b);
    })
    .map(([group, groupMatches]) => ({ group, matches: groupMatches }));
}

// Ordena partidos de eliminatoria por `bracket_slot` ascendente (orden del
// cuadro). Fallback a `match_time` cuando falta el slot. No muta la entrada.
export function sortKnockoutBySlot<
  T extends { bracket_slot: number | null; match_time: string },
>(matches: T[]): T[] {
  return [...matches].sort((a, b) => {
    const slotA = a.bracket_slot;
    const slotB = b.bracket_slot;
    if (slotA != null && slotB != null) return slotA - slotB;
    if (slotA != null) return -1;
    if (slotB != null) return 1;
    return a.match_time.localeCompare(b.match_time);
  });
}

// Etiqueta de un cruce de eliminatoria a partir de sus orígenes TBD
//   (W73, W74) → "Ganador 73 vs Ganador 74"; null si no hay orígenes.
export function knockoutMatchupLabel(match: {
  home_source: string | null;
  away_source: string | null;
}): string | null {
  const home = describeMatchSource(match.home_source);
  const away = describeMatchSource(match.away_source);
  if (!home && !away) return null;
  return `${home ?? "Por definir"} vs ${away ?? "Por definir"}`;
}

// Traduce un código de origen de bracket TBD a texto legible.
//   1A        → 1.º Grupo A
//   2B        → 2.º Grupo B
//   3A/B/C/D/F → 3.º (A/B/C/D/F)
//   W97       → Ganador 97
//   L101      → Perdedor 101
export function describeMatchSource(source: string | null): string | null {
  if (!source) return null;

  const winner = /^W(\d+)$/.exec(source);
  if (winner) return `Ganador ${winner[1]}`;

  const loser = /^L(\d+)$/.exec(source);
  if (loser) return `Perdedor ${loser[1]}`;

  const single = /^([123])([A-L])$/.exec(source);
  if (single) {
    const ordinal =
      single[1] === "1" ? "1.º" : single[1] === "2" ? "2.º" : "3.º";
    return `${ordinal} Grupo ${single[2]}`;
  }

  const thirds = /^3(.+)$/.exec(source);
  if (thirds) return `3.º (${thirds[1]})`;

  return source;
}

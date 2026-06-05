// Presentación de fases del torneo (Mundial 2026) y descripción de los
// "orígenes" TBD de eliminatoria. La tabla public.matches guarda `stage`
// (group/round-32/round-16/quarter/semi/third-place/final), `matchday` (1/2/3
// en grupos) y `home_source`/`away_source` (códigos como 1A, 3A/B/C/D/F, W97,
// L101) para los slots de bracket aún no resueltos. Capa pura de presentación.

export type MatchPhase = {
  // Clave estable usada por el tab bar (jornada-1, round-32, …).
  key: string;
  // Etiqueta corta para el tab (Jornada 1, 32avos, Octavos, …).
  label: string;
};

// Etiqueta legible de una fase de eliminatoria.
const STAGE_LABELS: Record<string, string> = {
  "round-32": "32avos",
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

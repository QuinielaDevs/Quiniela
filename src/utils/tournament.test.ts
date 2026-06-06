import { describe, expect, it } from "vitest";

import {
  buildPhases,
  describeMatchSource,
  groupByGroupLabel,
  knockoutMatchupLabel,
  phaseKeyForMatch,
  sortKnockoutBySlot,
  stageLabel,
} from "@/utils/tournament";

describe("stageLabel", () => {
  it("traduce las fases de eliminatoria", () => {
    expect(stageLabel("round-32")).toBe("32avos");
    expect(stageLabel("round-16")).toBe("Octavos");
    expect(stageLabel("quarter")).toBe("Cuartos");
    expect(stageLabel("semi")).toBe("Semis");
    expect(stageLabel("third-place")).toBe("3.º Puesto");
    expect(stageLabel("final")).toBe("Final");
  });

  it("usa fallback para fases desconocidas o nulas", () => {
    expect(stageLabel(null)).toBe("Por definir");
    expect(stageLabel("otra")).toBe("otra");
  });
});

describe("phaseKeyForMatch", () => {
  it("usa jornada-N para grupos", () => {
    expect(phaseKeyForMatch({ stage: "group", matchday: 2 })).toBe("jornada-2");
  });

  it("usa el stage para eliminatorias", () => {
    expect(phaseKeyForMatch({ stage: "round-16", matchday: null })).toBe(
      "round-16",
    );
  });
});

describe("buildPhases", () => {
  it("ordena jornadas de grupo y luego eliminatorias en orden FIFA", () => {
    const phases = buildPhases([
      { stage: "final", matchday: null },
      { stage: "group", matchday: 3 },
      { stage: "round-32", matchday: null },
      { stage: "group", matchday: 1 },
      { stage: "quarter", matchday: null },
      { stage: "group", matchday: 1 },
    ]);

    expect(phases.map((p) => p.key)).toEqual([
      "jornada-1",
      "jornada-3",
      "round-32",
      "quarter",
      "final",
    ]);
    expect(phases[0]?.label).toBe("Jornada 1");
    expect(phases[2]?.label).toBe("32avos");
  });

  it("devuelve lista vacía sin partidos", () => {
    expect(buildPhases([])).toEqual([]);
  });
});

describe("describeMatchSource", () => {
  it("describe posiciones de grupo", () => {
    expect(describeMatchSource("1A")).toBe("1.º Grupo A");
    expect(describeMatchSource("2B")).toBe("2.º Grupo B");
  });

  it("describe terceros con conjunto de grupos", () => {
    expect(describeMatchSource("3A/B/C/D/F")).toBe("3.º (A/B/C/D/F)");
  });

  it("describe ganadores y perdedores de partidos previos", () => {
    expect(describeMatchSource("W97")).toBe("Ganador 97");
    expect(describeMatchSource("L101")).toBe("Perdedor 101");
  });

  it("devuelve null sin origen", () => {
    expect(describeMatchSource(null)).toBeNull();
  });
});

describe("groupByGroupLabel", () => {
  it("agrupa por grupo y ordena A→L conservando el orden interno", () => {
    const sections = groupByGroupLabel([
      { id: 1, group_label: "B" },
      { id: 2, group_label: "A" },
      { id: 3, group_label: "B" },
      { id: 4, group_label: "A" },
    ]);

    expect(sections.map((s) => s.group)).toEqual(["A", "B"]);
    expect(sections[0]?.matches.map((m) => m.id)).toEqual([2, 4]);
    expect(sections[1]?.matches.map((m) => m.id)).toEqual([1, 3]);
  });

  it("agrupa los partidos sin group_label en una sección final '—'", () => {
    const sections = groupByGroupLabel([
      { id: 1, group_label: "A" },
      { id: 2, group_label: null },
    ]);

    expect(sections.map((s) => s.group)).toEqual(["A", "—"]);
  });

  it("devuelve lista vacía sin partidos", () => {
    expect(groupByGroupLabel([])).toEqual([]);
  });
});

describe("sortKnockoutBySlot", () => {
  it("ordena por bracket_slot ascendente sin mutar la entrada", () => {
    const input = [
      { bracket_slot: 75, match_time: "2026-07-01T00:00:00Z" },
      { bracket_slot: 73, match_time: "2026-07-02T00:00:00Z" },
      { bracket_slot: 74, match_time: "2026-07-03T00:00:00Z" },
    ];
    const sorted = sortKnockoutBySlot(input);

    expect(sorted.map((m) => m.bracket_slot)).toEqual([73, 74, 75]);
    expect(input.map((m) => m.bracket_slot)).toEqual([75, 73, 74]); // no muta
  });

  it("usa match_time como fallback cuando falta el slot", () => {
    const sorted = sortKnockoutBySlot([
      { bracket_slot: null, match_time: "2026-07-03T00:00:00Z" },
      { bracket_slot: null, match_time: "2026-07-01T00:00:00Z" },
    ]);
    expect(sorted.map((m) => m.match_time)).toEqual([
      "2026-07-01T00:00:00Z",
      "2026-07-03T00:00:00Z",
    ]);
  });
});

describe("knockoutMatchupLabel", () => {
  it("compone el cruce a partir de los orígenes", () => {
    expect(
      knockoutMatchupLabel({ home_source: "W73", away_source: "W74" }),
    ).toBe("Ganador 73 vs Ganador 74");
  });

  it("devuelve null si no hay orígenes", () => {
    expect(
      knockoutMatchupLabel({ home_source: null, away_source: null }),
    ).toBeNull();
  });
});

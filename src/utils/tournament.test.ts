import { describe, expect, it } from "vitest";

import {
  buildPhases,
  describeMatchSource,
  phaseKeyForMatch,
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

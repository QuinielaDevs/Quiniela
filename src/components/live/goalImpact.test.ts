import { describe, expect, it } from "vitest";

import {
  buildGoalToastMessage,
  findMovers,
  formatRank,
  hasScoreIncrease,
  resolveScoringTeam,
  selectAnnouncedMover,
  type LiveMatch,
  type Mover,
  type RankRow,
} from "@/components/live/goalImpact";

function liveMatch(overrides: Partial<LiveMatch> = {}): LiveMatch {
  return {
    id: "m1",
    status: "live",
    matchday: 1,
    homeScore: 0,
    awayScore: 0,
    homeTeam: "Argentina",
    awayTeam: "Francia",
    ...overrides,
  };
}

describe("resolveScoringTeam", () => {
  it("devuelve el equipo local cuando sube el marcador local", () => {
    const prev = liveMatch({ homeScore: 0, awayScore: 0 });
    const next = liveMatch({ homeScore: 1, awayScore: 0 });
    expect(resolveScoringTeam(prev, next)).toBe("Argentina");
  });

  it("devuelve el equipo visitante cuando sube el marcador visitante", () => {
    const prev = liveMatch({ homeScore: 1, awayScore: 0 });
    const next = liveMatch({ homeScore: 1, awayScore: 1 });
    expect(resolveScoringTeam(prev, next)).toBe("Francia");
  });

  it("devuelve null sin marcador previo conocido", () => {
    expect(resolveScoringTeam(undefined, liveMatch({ homeScore: 1 }))).toBeNull();
  });

  it("devuelve null si ambos lados cambian o no se puede determinar", () => {
    const prev = liveMatch({ homeScore: 0, awayScore: 0 });
    const next = liveMatch({ homeScore: 1, awayScore: 1 });
    expect(resolveScoringTeam(prev, next)).toBeNull();
  });

  it("devuelve null si falta el nombre del equipo que anotó", () => {
    const prev = liveMatch({ homeScore: 0, awayScore: 0 });
    const next = liveMatch({ homeScore: 1, awayScore: 0, homeTeam: null });
    expect(resolveScoringTeam(prev, next)).toBeNull();
  });

  it("trata marcadores null como 0 al comparar", () => {
    const prev = liveMatch({ homeScore: null, awayScore: null });
    const next = liveMatch({ homeScore: 1, awayScore: null });
    expect(resolveScoringTeam(prev, next)).toBe("Argentina");
  });
});

describe("hasScoreIncrease", () => {
  it("true cuando sube el marcador local", () => {
    expect(
      hasScoreIncrease(liveMatch({ homeScore: 0 }), liveMatch({ homeScore: 1 })),
    ).toBe(true);
  });

  it("true cuando sube el visitante", () => {
    expect(
      hasScoreIncrease(
        liveMatch({ homeScore: 1, awayScore: 0 }),
        liveMatch({ homeScore: 1, awayScore: 1 }),
      ),
    ).toBe(true);
  });

  it("true cuando ambos suben (doble gol)", () => {
    expect(
      hasScoreIncrease(
        liveMatch({ homeScore: 0, awayScore: 0 }),
        liveMatch({ homeScore: 1, awayScore: 1 }),
      ),
    ).toBe(true);
  });

  it("false ante una corrección a la baja", () => {
    expect(
      hasScoreIncrease(
        liveMatch({ homeScore: 1, awayScore: 0 }),
        liveMatch({ homeScore: 0, awayScore: 0 }),
      ),
    ).toBe(false);
  });

  it("false sin marcador previo y sin cambios", () => {
    expect(hasScoreIncrease(undefined, liveMatch({ homeScore: 1 }))).toBe(false);
    expect(
      hasScoreIncrease(liveMatch({ homeScore: 1 }), liveMatch({ homeScore: 1 })),
    ).toBe(false);
  });

  it("false si el marcador previo contiene null", () => {
    expect(
      hasScoreIncrease(
        liveMatch({ homeScore: null, awayScore: 0 }),
        liveMatch({ homeScore: 1, awayScore: 0 }),
      ),
    ).toBe(false);
    expect(
      hasScoreIncrease(
        liveMatch({ homeScore: 0, awayScore: null }),
        liveMatch({ homeScore: 0, awayScore: 1 }),
      ),
    ).toBe(false);
  });
});

describe("findMovers", () => {
  const prev: RankRow[] = [
    { userId: "ana", displayName: "Ana", rank: 1 },
    { userId: "beto", displayName: "Beto", rank: 2 },
    { userId: "cris", displayName: "Cris", rank: 3 },
  ];

  it("detecta a quienes mejoran su puesto", () => {
    const next: RankRow[] = [
      { userId: "cris", displayName: "Cris", rank: 1 },
      { userId: "ana", displayName: "Ana", rank: 2 },
      { userId: "beto", displayName: "Beto", rank: 3 },
    ];
    const movers = findMovers(prev, next);
    expect(movers.map((m) => m.userId)).toEqual(["cris"]);
    expect(movers[0]).toMatchObject({ rank: 1, prevRank: 3 });
  });

  it("no reporta a quien baja ni a quien se mantiene", () => {
    const next: RankRow[] = [
      { userId: "ana", displayName: "Ana", rank: 1 },
      { userId: "cris", displayName: "Cris", rank: 2 },
      { userId: "beto", displayName: "Beto", rank: 3 },
    ];
    expect(findMovers(prev, next).map((m) => m.userId)).toEqual(["cris"]);
  });

  it("ignora jugadores ausentes en la tabla previa", () => {
    const next: RankRow[] = [
      { userId: "nuevo", displayName: "Nuevo", rank: 1 },
      ...prev,
    ];
    expect(findMovers(prev, next).map((m) => m.userId)).not.toContain("nuevo");
  });
});

describe("selectAnnouncedMover", () => {
  const movers: Mover[] = [
    { userId: "ana", displayName: "Ana", rank: 2, prevRank: 4 },
    { userId: "cris", displayName: "Cris", rank: 3, prevRank: 5 },
  ];

  it("prioriza al usuario actual si subió", () => {
    expect(selectAnnouncedMover(movers, "cris")?.userId).toBe("cris");
  });

  it("si el viewer no subió, anuncia al nuevo líder (rank 1)", () => {
    const withLeader: Mover[] = [
      ...movers,
      { userId: "beto", displayName: "Beto", rank: 1, prevRank: 2 },
    ];
    expect(selectAnnouncedMover(withLeader, "nadie")?.userId).toBe("beto");
  });

  it("sin viewer ni líder, anuncia el mayor salto de puestos", () => {
    // Ana sube 2 (4→2), Cris sube 2 (5→3); empate de salto → rank menor (Ana=2).
    expect(selectAnnouncedMover(movers, "nadie")?.userId).toBe("ana");
    const biggerJump: Mover[] = [
      { userId: "ana", displayName: "Ana", rank: 2, prevRank: 3 },
      { userId: "cris", displayName: "Cris", rank: 3, prevRank: 8 },
    ];
    expect(selectAnnouncedMover(biggerJump, "nadie")?.userId).toBe("cris");
  });

  it("devuelve null sin movimientos", () => {
    expect(selectAnnouncedMover([], "ana")).toBeNull();
  });
});

describe("buildGoalToastMessage / formatRank", () => {
  it("formatea el ordinal en español", () => {
    expect(formatRank(1)).toBe("1er");
    expect(formatRank(2)).toBe("2º");
    expect(formatRank(3)).toBe("3º");
  });

  it("incluye equipo, jugador y puesto cuando se conoce el equipo", () => {
    const mover: Mover = { userId: "ana", displayName: "Ana", rank: 1, prevRank: 3 };
    expect(buildGoalToastMessage(mover, "Argentina")).toBe(
      "¡Gol de Argentina! Ana sube al 1er puesto proyectado 🎉",
    );
  });

  it("usa el fallback neutro cuando no hay equipo", () => {
    const mover: Mover = { userId: "ana", displayName: "Ana", rank: 3, prevRank: 5 };
    expect(buildGoalToastMessage(mover, null)).toBe(
      "¡Cambio en los marcadores! Ana sube al 3º puesto proyectado 🎉",
    );
  });
});

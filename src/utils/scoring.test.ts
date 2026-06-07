import { describe, expect, it } from "vitest";
import {
  calculateBasePoints,
  calculatePredictionMultiplier,
  calculatePredictionPoints,
  currentRoundOrdinal,
  roundOrdinal,
} from "./scoring";

// Motor de puntuación base (Story 2.1 — AC #4, #5). Lógica pura, sin DB ni DOM.
// Reglas: marcador exacto = 5; resultado acertado (mismo ganador/empate) = 2;
// sin acierto = 0. Partidos no 'finished' (incluye canceled/suspended) = 0.

describe("calculateBasePoints — partido finished", () => {
  it("marcador exacto = 5 pts", () => {
    expect(
      calculateBasePoints({ home: 2, away: 1 }, { home: 2, away: 1 }, "finished"),
    ).toBe(5);
  });

  it("empate exacto = 5 pts", () => {
    expect(
      calculateBasePoints({ home: 1, away: 1 }, { home: 1, away: 1 }, "finished"),
    ).toBe(5);
  });

  it("resultado acertado (victoria local), marcador distinto = 2 pts", () => {
    expect(
      calculateBasePoints({ home: 2, away: 1 }, { home: 3, away: 0 }, "finished"),
    ).toBe(2);
  });

  it("resultado acertado (victoria visitante), marcador distinto = 2 pts", () => {
    expect(
      calculateBasePoints({ home: 0, away: 1 }, { home: 1, away: 3 }, "finished"),
    ).toBe(2);
  });

  it("empate acertado, marcador distinto = 2 pts", () => {
    expect(
      calculateBasePoints({ home: 1, away: 1 }, { home: 2, away: 2 }, "finished"),
    ).toBe(2);
  });

  it("resultado equivocado (predijo empate, ganó local) = 0 pts", () => {
    expect(
      calculateBasePoints({ home: 1, away: 1 }, { home: 2, away: 0 }, "finished"),
    ).toBe(0);
  });

  it("resultado equivocado (predijo local, ganó visitante) = 0 pts", () => {
    expect(
      calculateBasePoints({ home: 2, away: 1 }, { home: 0, away: 1 }, "finished"),
    ).toBe(0);
  });
});

describe("calculateBasePoints — partidos anulados o sin finalizar (AC #5)", () => {
  it("canceled → 0 pts aunque el marcador sea exacto", () => {
    expect(
      calculateBasePoints({ home: 2, away: 1 }, { home: 2, away: 1 }, "canceled"),
    ).toBe(0);
  });

  it("suspended → 0 pts aunque el marcador sea exacto", () => {
    expect(
      calculateBasePoints({ home: 2, away: 1 }, { home: 2, away: 1 }, "suspended"),
    ).toBe(0);
  });

  it("scheduled → 0 pts (todavía no puntúa)", () => {
    expect(
      calculateBasePoints({ home: 2, away: 1 }, { home: 2, away: 1 }, "scheduled"),
    ).toBe(0);
  });

  it("live → 0 pts (todavía no puntúa)", () => {
    expect(
      calculateBasePoints({ home: 2, away: 1 }, { home: 2, away: 1 }, "live"),
    ).toBe(0);
  });
});

describe("calculateBasePoints — guarda defensiva de marcadores inválidos", () => {
  it("finished con marcador real null → 0 pts (no se confunde con exacto)", () => {
    // Simula un partido 'finished' con home_score/away_score null en BD.
    const nullScore = { home: null as unknown as number, away: null as unknown as number };
    expect(
      calculateBasePoints({ home: 0, away: 0 }, nullScore, "finished"),
    ).toBe(0);
  });

  it("finished con NaN en el marcador → 0 pts", () => {
    expect(
      calculateBasePoints({ home: 2, away: 1 }, { home: NaN, away: 1 }, "finished"),
    ).toBe(0);
  });

  it("finished con goles no enteros → 0 pts", () => {
    expect(
      calculateBasePoints({ home: 2.5, away: 1 }, { home: 2, away: 1 }, "finished"),
    ).toBe(0);
  });
});

describe("roundOrdinal — ordinal de ronda", () => {
  it("grupos usan su matchday (1/2/3)", () => {
    expect(roundOrdinal(1, "group")).toBe(1);
    expect(roundOrdinal(2, "group")).toBe(2);
    expect(roundOrdinal(3, "group")).toBe(3);
  });

  it("eliminatorias por stage: 32avos=4 … Final=8", () => {
    expect(roundOrdinal(null, "round-32")).toBe(4);
    expect(roundOrdinal(null, "round-16")).toBe(5);
    expect(roundOrdinal(null, "quarter")).toBe(6);
    expect(roundOrdinal(null, "semi")).toBe(7);
    expect(roundOrdinal(null, "third-place")).toBe(8);
    expect(roundOrdinal(null, "final")).toBe(8);
  });

  it("ronda desconocida (sin matchday ni stage mapeable) → null", () => {
    expect(roundOrdinal(null, null)).toBeNull();
    expect(roundOrdinal(null, "otros")).toBeNull();
  });
});

describe("currentRoundOrdinal — jornada en curso", () => {
  const J1 = "2026-06-11T00:00:00.000Z";
  const J2 = "2026-06-18T00:00:00.000Z";
  const matches = [
    { matchday: 1, stage: "group", match_time: J1, status: "finished" },
    { matchday: 2, stage: "group", match_time: J2, status: "scheduled" },
    { matchday: null, stage: "final", match_time: "2026-07-19T00:00:00.000Z", status: "scheduled" },
  ];

  it("0 antes de que empiece cualquier partido", () => {
    expect(currentRoundOrdinal(matches, "2026-06-01T00:00:00.000Z")).toBe(0);
  });

  it("=1 cuando ya empezó la J1 pero no la J2", () => {
    expect(currentRoundOrdinal(matches, "2026-06-12T00:00:00.000Z")).toBe(1);
  });

  it("=2 cuando ya empezó la J2", () => {
    expect(currentRoundOrdinal(matches, "2026-06-19T00:00:00.000Z")).toBe(2);
  });

  it("ignora partidos cancelados", () => {
    const withCanceled = [
      { matchday: 3, stage: "group", match_time: J1, status: "canceled" },
    ];
    expect(currentRoundOrdinal(withCanceled, "2026-06-12T00:00:00.000Z")).toBe(0);
  });
});

describe("calculatePredictionMultiplier — distancia en jornadas", () => {
  it("Jornada 1 (línea base) → 1.00 sin importar la distancia", () => {
    expect(calculatePredictionMultiplier(1, "group", 0)).toBe(1.0);
  });

  it("ronda desconocida → 1.00 (defensivo)", () => {
    expect(calculatePredictionMultiplier(null, null, 0)).toBe(1.0);
  });

  it("la referencia tiene piso en la jornada 1 (pre-torneo, current 0)", () => {
    // Pre-torneo (current 0) la J1 es la referencia → J2 está a 1 de distancia.
    expect(calculatePredictionMultiplier(2, "group", 0)).toBe(1.25); // J2
    expect(calculatePredictionMultiplier(3, "group", 0)).toBe(1.5); // J3
    expect(calculatePredictionMultiplier(null, "round-32", 0)).toBe(1.75);
  });

  it("escala lineal +0.25 por jornada de distancia, tope 2.5x", () => {
    // J2 (ordinal 2) con la jornada en curso variando la distancia.
    expect(calculatePredictionMultiplier(2, "group", 2)).toBe(1.0); // dist 0
    expect(calculatePredictionMultiplier(2, "group", 1)).toBe(1.25); // dist 1
    expect(calculatePredictionMultiplier(3, "group", 1)).toBe(1.5); // dist 2
    expect(calculatePredictionMultiplier(3, "group", 2)).toBe(1.25); // J2 en curso
  });

  it("eliminatorias escalan por su ordinal de ronda", () => {
    // Final (ordinal 8) con jornada en curso 0 → distancia 7 (piso 1) → tope 2.5x.
    expect(calculatePredictionMultiplier(null, "final", 0)).toBe(2.5);
    // Cuartos (ordinal 6) con J3 en curso (3) → distancia 3 → 1.75x.
    expect(calculatePredictionMultiplier(null, "quarter", 3)).toBe(1.75);
  });

  it("distancia negativa (ronda ya en curso o pasada) → 1.00", () => {
    expect(calculatePredictionMultiplier(2, "group", 5)).toBe(1.0);
  });
});

describe("calculatePredictionPoints — base * multiplicador (Story 2.4)", () => {
  it("marcador exacto con 2.5x → 12.5", () => {
    expect(calculatePredictionPoints(5, 2.5)).toBe(12.5);
  });

  it("resultado acertado con 1.6x → 3.2", () => {
    expect(calculatePredictionPoints(2, 1.6)).toBe(3.2);
  });

  it("base 0 → 0 con cualquier multiplicador", () => {
    expect(calculatePredictionPoints(0, 2.5)).toBe(0);
  });

  it("valores no finitos → 0", () => {
    expect(calculatePredictionPoints(NaN, 1.3)).toBe(0);
    expect(calculatePredictionPoints(5, Infinity)).toBe(0);
  });
});

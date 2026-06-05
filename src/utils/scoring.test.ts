import { describe, expect, it } from "vitest";
import {
  calculateBasePoints,
  calculatePredictionMultiplier,
  calculatePredictionPoints,
} from "./scoring";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Helper: arma un par (savedAt, matchTime) con `days` de antelación exacta.
function multiplierForDays(days: number): number {
  const savedAt = 0;
  const matchTime = days * MS_PER_DAY;
  return calculatePredictionMultiplier(savedAt, matchTime);
}

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

describe("calculatePredictionMultiplier — lotes por antelación (Story 2.4)", () => {
  it("< 7 días → 1.00 (borde 6.99d)", () => {
    expect(multiplierForDays(6.99)).toBe(1.0);
  });

  it(">= 7 días → 1.30 (borde exacto 7d)", () => {
    expect(multiplierForDays(7)).toBe(1.3);
  });

  it(">= 14 días → 1.60 (borde exacto 14d)", () => {
    expect(multiplierForDays(14)).toBe(1.6);
  });

  it(">= 21 días → 1.90 (borde exacto 21d)", () => {
    expect(multiplierForDays(21)).toBe(1.9);
  });

  it(">= 28 días → 2.20 (borde exacto 28d)", () => {
    expect(multiplierForDays(28)).toBe(2.2);
  });

  it(">= 35 días → 2.50 (borde exacto 35d y 38d)", () => {
    expect(multiplierForDays(35)).toBe(2.5);
    expect(multiplierForDays(38)).toBe(2.5);
  });

  it("0 días o antelación negativa (después del kickoff) → 1.00", () => {
    expect(multiplierForDays(0)).toBe(1.0);
    expect(multiplierForDays(-3)).toBe(1.0);
  });

  it("acepta Date y string ISO además de números", () => {
    const saved = new Date("2026-05-01T00:00:00.000Z");
    const kickoff = new Date("2026-06-11T00:00:00.000Z"); // 41 días
    expect(calculatePredictionMultiplier(saved, kickoff)).toBe(2.5);
    expect(
      calculatePredictionMultiplier(
        "2026-06-10T00:00:00.000Z",
        "2026-06-11T00:00:00.000Z",
      ),
    ).toBe(1.0); // 1 día
  });

  it("tiempos inválidos → 1.00 (defensivo)", () => {
    expect(calculatePredictionMultiplier("no-date", 0)).toBe(1.0);
  });

  it("calcula en base a firstMatchTime si se especifica", () => {
    const saved = new Date("2026-05-01T00:00:00.000Z");
    const firstMatchTime = new Date("2026-06-11T00:00:00.000Z"); // 41 días
    const kickoff = new Date("2026-06-15T00:00:00.000Z"); // kickoff posterior
    expect(calculatePredictionMultiplier(saved, kickoff, firstMatchTime)).toBe(2.5);

    // Si el primer partido ya empezó, la antelación es <= 0, dando 1.00
    const savedAfterStart = new Date("2026-06-12T00:00:00.000Z");
    expect(calculatePredictionMultiplier(savedAfterStart, kickoff, firstMatchTime)).toBe(1.0);
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

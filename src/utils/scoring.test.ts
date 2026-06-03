import { describe, expect, it } from "vitest";
import { calculateBasePoints } from "./scoring";

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

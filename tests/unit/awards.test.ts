import { describe, expect, it } from "vitest";

import { groupCandidatesByCategory } from "@/utils/awards";
import { resolvePhase, scoreAward } from "@/utils/awardsScoring";
import type { AwardCandidate } from "@/types";

// Fábrica mínima de candidatos para los tests (solo los campos que usa el util).
function candidate(
  over: Partial<AwardCandidate> & Pick<AwardCandidate, "id" | "category">,
): AwardCandidate {
  return {
    id: over.id,
    category: over.category,
    name: over.name ?? "Sin nombre",
    team_name: over.team_name ?? null,
    flag_code: over.flag_code ?? null,
    image_url: over.image_url ?? null,
    display_order: over.display_order ?? 0,
    is_active: over.is_active ?? true,
    is_winner: over.is_winner ?? false,
    created_at: over.created_at ?? "2026-06-01T00:00:00Z",
  };
}

describe("groupCandidatesByCategory", () => {
  it("devuelve siempre las tres categorías, aunque estén vacías", () => {
    const grouped = groupCandidatesByCategory([]);
    expect(Object.keys(grouped).sort()).toEqual([
      "champion",
      "mvp",
      "top_scorer",
    ]);
    expect(grouped.champion).toEqual([]);
    expect(grouped.top_scorer).toEqual([]);
    expect(grouped.mvp).toEqual([]);
  });

  it("agrupa por categoría y ordena por display_order", () => {
    const grouped = groupCandidatesByCategory([
      candidate({ id: "b", category: "champion", name: "B", display_order: 2 }),
      candidate({ id: "a", category: "champion", name: "A", display_order: 1 }),
      candidate({ id: "s", category: "top_scorer", name: "S", display_order: 1 }),
    ]);

    expect(grouped.champion.map((c) => c.id)).toEqual(["a", "b"]);
    expect(grouped.top_scorer.map((c) => c.id)).toEqual(["s"]);
    expect(grouped.mvp).toEqual([]);
  });

  it("desempata por nombre cuando display_order coincide", () => {
    const grouped = groupCandidatesByCategory([
      candidate({ id: "z", category: "mvp", name: "Zlatan", display_order: 0 }),
      candidate({ id: "a", category: "mvp", name: "Ander", display_order: 0 }),
    ]);
    expect(grouped.mvp.map((c) => c.name)).toEqual(["Ander", "Zlatan"]);
  });

  it("ignora categorías desconocidas (defensivo ante drift del CHECK)", () => {
    const grouped = groupCandidatesByCategory([
      candidate({ id: "x", category: "unknown_award" as AwardCandidate["category"], name: "X" }),
      candidate({ id: "c", category: "champion", name: "C" }),
    ]);
    expect(grouped.champion.map((c) => c.id)).toEqual(["c"]);
    expect(grouped.top_scorer).toEqual([]);
    expect(grouped.mvp).toEqual([]);
  });
});

describe("resolvePhase & scoreAward", () => {
  const INAUGURAL = new Date("2026-06-11T18:00:00Z");
  const KNOCKOUT = new Date("2026-06-28T16:00:00Z");
  const SEMIFINAL = new Date("2026-07-14T18:00:00Z");

  it("resuelve correctamente la Fase A antes del partido inaugural", () => {
    const t = new Date(INAUGURAL.getTime() - 1);
    const phase = resolvePhase(t);
    expect(phase.code).toBe("A");
    expect(phase.rewardPoints).toBe(50);
    expect(phase.editsLocked).toBe(false);

    expect(scoreAward(t, true)).toBe(50);
    expect(scoreAward(t, false)).toBe(0);
  });

  it("resuelve la frontera exacta del kickoff inaugural como Fase B (inicio inclusivo)", () => {
    const phase = resolvePhase(INAUGURAL);
    expect(phase.code).toBe("B");
    expect(phase.rewardPoints).toBe(25);
    expect(phase.editsLocked).toBe(false);

    expect(scoreAward(INAUGURAL, true)).toBe(25);
  });

  it("resuelve correctamente la Fase B durante la fase de grupos", () => {
    const t = new Date(INAUGURAL.getTime() + 1000 * 60 * 60 * 24);
    const phase = resolvePhase(t);
    expect(phase.code).toBe("B");
    expect(phase.rewardPoints).toBe(25);

    expect(scoreAward(t, true)).toBe(25);
  });

  it("resuelve la frontera exacta del inicio de eliminatorias como Fase C (inicio inclusivo)", () => {
    const phase = resolvePhase(KNOCKOUT);
    expect(phase.code).toBe("C");
    expect(phase.rewardPoints).toBe(10);
    expect(phase.editsLocked).toBe(false);

    expect(scoreAward(KNOCKOUT, true)).toBe(10);
  });

  it("resuelve la Fase C durante octavos/cuartos", () => {
    const t = new Date(KNOCKOUT.getTime() + 1000 * 60 * 60 * 24);
    const phase = resolvePhase(t);
    expect(phase.code).toBe("C");
    expect(phase.rewardPoints).toBe(10);

    expect(scoreAward(t, true)).toBe(10);
  });

  it("resuelve la frontera exacta de semifinales como Fase D (edits locked)", () => {
    const phase = resolvePhase(SEMIFINAL);
    expect(phase.code).toBe("D");
    expect(phase.rewardPoints).toBe(0);
    expect(phase.editsLocked).toBe(true);

    expect(scoreAward(SEMIFINAL, true)).toBe(0);
  });

  it("resuelve la Fase D para fechas muy posteriores", () => {
    const t = new Date(SEMIFINAL.getTime() + 1000 * 60 * 60 * 24 * 30);
    const phase = resolvePhase(t);
    expect(phase.code).toBe("D");
    expect(phase.rewardPoints).toBe(0);
    expect(phase.editsLocked).toBe(true);

    expect(scoreAward(t, true)).toBe(0);
  });

  it("lanza un error ruidoso para fechas inválidas", () => {
    expect(() => resolvePhase(new Date("fecha-invalida"))).toThrow();
  });

  it("lanza un error ruidoso si hay un hueco en la configuración", () => {
    const gapPhases = [
      {
        code: "A" as const,
        rewardPoints: 50 as const,
        startsAt: null,
        endsAt: "2026-06-10T18:00:00Z",
        editsLocked: false,
        label: "A",
        startsAtTime: -Infinity,
        endsAtTime: Date.parse("2026-06-10T18:00:00Z"),
      },
      {
        code: "B" as const,
        rewardPoints: 25 as const,
        startsAt: "2026-06-12T18:00:00Z",
        endsAt: null,
        editsLocked: false,
        label: "B",
        startsAtTime: Date.parse("2026-06-12T18:00:00Z"),
        endsAtTime: Infinity,
      },
    ];
    const insideGap = new Date("2026-06-11T12:00:00Z");
    expect(() => resolvePhase(insideGap, gapPhases)).toThrow("resolvePhase: no phase covers");
  });
});


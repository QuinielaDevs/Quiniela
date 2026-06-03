import { describe, expect, it } from "vitest";

import { groupCandidatesByCategory } from "@/utils/awards";
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

import { describe, expect, it } from "vitest";

import { setMatchResultSchema } from "@/app/actions/matches.schema";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("setMatchResultSchema (Story 7.2)", () => {
  it("acepta un resultado finished con marcador válido", () => {
    const result = setMatchResultSchema.safeParse({
      matchId: UUID,
      homeScore: 2,
      awayScore: 1,
      status: "finished",
    });
    expect(result.success).toBe(true);
  });

  it("acepta scheduled con marcador nulo", () => {
    const result = setMatchResultSchema.safeParse({
      matchId: UUID,
      homeScore: null,
      awayScore: null,
      status: "scheduled",
    });
    expect(result.success).toBe(true);
  });

  it("exige marcador cuando el estado es live", () => {
    const result = setMatchResultSchema.safeParse({
      matchId: UUID,
      homeScore: null,
      awayScore: null,
      status: "live",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza marcador negativo", () => {
    const result = setMatchResultSchema.safeParse({
      matchId: UUID,
      homeScore: -1,
      awayScore: 0,
      status: "finished",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza un UUID inválido", () => {
    const result = setMatchResultSchema.safeParse({
      matchId: "no-es-uuid",
      homeScore: 0,
      awayScore: 0,
      status: "scheduled",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza un estado fuera del enum", () => {
    const result = setMatchResultSchema.safeParse({
      matchId: UUID,
      homeScore: 1,
      awayScore: 1,
      status: "postponed",
    });
    expect(result.success).toBe(false);
  });
});

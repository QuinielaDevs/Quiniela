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

  it("rechaza si se especifica solo una puntuación de prórroga", () => {
    const result = setMatchResultSchema.safeParse({
      matchId: UUID,
      homeScore: 1,
      awayScore: 1,
      status: "finished",
      extraTimeHomeScore: 2,
      extraTimeAwayScore: null,
    });
    expect(result.success).toBe(false);
  });

  it("acepta si se especifican ambas puntuaciones de prórroga con desempate", () => {
    const result = setMatchResultSchema.safeParse({
      matchId: UUID,
      homeScore: 1,
      awayScore: 1,
      status: "finished",
      extraTimeHomeScore: 2,
      extraTimeAwayScore: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza penales si la prórroga tiene un ganador claro", () => {
    const result = setMatchResultSchema.safeParse({
      matchId: UUID,
      homeScore: 1,
      awayScore: 1,
      status: "finished",
      extraTimeHomeScore: 2,
      extraTimeAwayScore: 1,
      penaltiesHomeScore: 4,
      penaltiesAwayScore: 2,
    });
    expect(result.success).toBe(false);
  });

  it("acepta penales si la prórroga termina en empate", () => {
    const result = setMatchResultSchema.safeParse({
      matchId: UUID,
      homeScore: 1,
      awayScore: 1,
      status: "finished",
      extraTimeHomeScore: 2,
      extraTimeAwayScore: 2,
      penaltiesHomeScore: 4,
      penaltiesAwayScore: 3,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza penales empatados tras prórroga empatada", () => {
    const result = setMatchResultSchema.safeParse({
      matchId: UUID,
      homeScore: 1,
      awayScore: 1,
      status: "finished",
      extraTimeHomeScore: 2,
      extraTimeAwayScore: 2,
      penaltiesHomeScore: 3,
      penaltiesAwayScore: 3,
    });
    expect(result.success).toBe(false);
  });
});

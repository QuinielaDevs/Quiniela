import { describe, expect, it } from "vitest";

import { MAX_PREDICTION_SCORE } from "@/app/actions/predictions.constants";
import { savePredictionSchema } from "@/app/actions/predictions.schema";

const VALID_INPUT = {
  leagueId: "11111111-1111-4111-8111-111111111111",
  matchId: "22222222-2222-4222-8222-222222222222",
  homeScorePred: 2,
  awayScorePred: 1,
};

describe("savePredictionSchema", () => {
  it("acepta UUIDs y marcadores enteros no negativos", () => {
    const result = savePredictionSchema.safeParse(VALID_INPUT);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(VALID_INPUT);
  });

  it.each([
    ["leagueId invalido", { leagueId: "liga-1" }],
    ["matchId invalido", { matchId: "partido-1" }],
    ["homeScorePred negativo", { homeScorePred: -1 }],
    ["awayScorePred decimal", { awayScorePred: 1.5 }],
    ["homeScorePred NaN", { homeScorePred: Number.NaN }],
    ["homeScorePred demasiado alto", { homeScorePred: MAX_PREDICTION_SCORE + 1 }],
    ["awayScorePred demasiado alto", { awayScorePred: MAX_PREDICTION_SCORE + 1 }],
  ])("rechaza %s", (_caseName, override) => {
    const result = savePredictionSchema.safeParse({
      ...VALID_INPUT,
      ...override,
    });

    expect(result.success).toBe(false);
  });
});

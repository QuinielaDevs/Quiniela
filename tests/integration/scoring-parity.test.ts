import { describe, expect, it } from "vitest";
import { createServiceRoleClient } from "./setup";
import { calculateBasePoints, calculatePredictionPoints } from "../../src/utils/scoring";

const admin = createServiceRoleClient();

type TestCase = {
  homePred: number;
  awayPred: number;
  homeScore: number;
  awayScore: number;
  multiplier: number;
  expectedBase: number;
  expectedFinal: number;
};

const GOLDEN_VECTORS: TestCase[] = [
  // 1. Exacto
  { homePred: 2, awayPred: 1, homeScore: 2, awayScore: 1, multiplier: 1.00, expectedBase: 5, expectedFinal: 5.00 },
  { homePred: 0, awayPred: 0, homeScore: 0, awayScore: 0, multiplier: 1.60, expectedBase: 5, expectedFinal: 8.00 },
  { homePred: 1, awayPred: 3, homeScore: 1, awayScore: 3, multiplier: 2.50, expectedBase: 5, expectedFinal: 12.50 },
  { homePred: 3, awayPred: 2, homeScore: 3, awayScore: 2, multiplier: 1.30, expectedBase: 5, expectedFinal: 6.50 },

  // 2. Solo resultado (ganador/empate)
  { homePred: 3, awayPred: 1, homeScore: 1, awayScore: 0, multiplier: 1.00, expectedBase: 2, expectedFinal: 2.00 },
  { homePred: 1, awayPred: 1, homeScore: 2, awayScore: 2, multiplier: 1.90, expectedBase: 2, expectedFinal: 3.80 },
  { homePred: 0, awayPred: 2, homeScore: 1, awayScore: 4, multiplier: 2.20, expectedBase: 2, expectedFinal: 4.40 },

  // 3. Nada
  { homePred: 2, awayPred: 1, homeScore: 0, awayScore: 2, multiplier: 1.50, expectedBase: 0, expectedFinal: 0.00 },
  { homePred: 1, awayPred: 0, homeScore: 1, awayScore: 1, multiplier: 2.50, expectedBase: 0, expectedFinal: 0.00 },
];

describe("Scoring Parity Contract Test", () => {
  it("compara la logica de scoring en JS vs la funcion SQL score_prediction", async () => {
    for (const vector of GOLDEN_VECTORS) {
      // 1. Calcular en JS
      const jsBase = calculateBasePoints(
        { home: vector.homePred, away: vector.awayPred },
        { home: vector.homeScore, away: vector.awayScore },
        "finished"
      );
      const jsFinal = calculatePredictionPoints(jsBase, vector.multiplier);

      expect(jsBase).toBe(vector.expectedBase);
      expect(jsFinal).toBe(vector.expectedFinal);

      // 2. Calcular en SQL via RPC
      const { data: sqlVal, error } = await admin
        .rpc("score_prediction", {
          p_home_pred: vector.homePred,
          p_away_pred: vector.awayPred,
          p_home_score: vector.homeScore,
          p_away_score: vector.awayScore,
          p_multiplier: vector.multiplier,
        });

      expect(error).toBeNull();
      // SQL retorna un string o number dependiendo de la conversion. Lo forzamos a Number.
      expect(Number(sqlVal)).toBe(vector.expectedFinal);
    }
  });

  it("verifica que retorne 0 si los goles reales son null", async () => {
    // En JS
    const jsBase = calculateBasePoints(
      { home: 2, away: 1 },
      { home: null as unknown as number, away: null as unknown as number },
      "finished"
    );
    expect(jsBase).toBe(0);

    // En SQL
    const { data: sqlVal, error } = await admin
      .rpc("score_prediction", {
        p_home_pred: 2,
        p_away_pred: 1,
        p_home_score: null,
        p_away_score: null,
        p_multiplier: 1.5,
      });
    expect(error).toBeNull();
    expect(Number(sqlVal)).toBe(0.00);
  });
});

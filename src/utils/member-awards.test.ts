import { describe, expect, it } from "vitest";

import {
  closedMatchdays,
  deriveAwardsForMatchday,
  type AwardMatch,
  type AwardPrediction,
} from "@/utils/member-awards";

const MATCHES: AwardMatch[] = [
  {
    id: "m1",
    matchday: 1,
    status: "finished",
    homeScore: 3,
    awayScore: 1,
  },
  {
    id: "m2",
    matchday: 1,
    status: "finished",
    homeScore: 1,
    awayScore: 0,
  },
  {
    id: "m3",
    matchday: 2,
    status: "scheduled",
    homeScore: null,
    awayScore: null,
  },
  {
    id: "m4",
    matchday: 3,
    status: "suspended",
    homeScore: null,
    awayScore: null,
  },
  {
    id: "m5",
    matchday: 3,
    status: "finished",
    homeScore: 0,
    awayScore: 0,
  },
  {
    id: "m6",
    matchday: 4,
    status: "canceled",
    homeScore: null,
    awayScore: null,
  },
];

function prediction(
  matchId: string,
  homeScorePred: number,
  awayScorePred: number,
  multiplier = 1,
): AwardPrediction {
  return { matchId, homeScorePred, awayScorePred, multiplier };
}

describe("closedMatchdays", () => {
  it("devuelve solo jornadas terminales con al menos un partido finished", () => {
    expect(closedMatchdays(MATCHES)).toEqual([1, 3]);
  });

  it("no considera cerrada una jornada finished sin marcador real", () => {
    expect(
      closedMatchdays([
        {
          id: "m-null",
          matchday: 5,
          status: "finished",
          homeScore: null,
          awayScore: null,
        },
      ]),
    ).toEqual([]);
  });
});

describe("deriveAwardsForMatchday", () => {
  it("otorga Nostradamus por marcador exacto difícil", () => {
    const result = deriveAwardsForMatchday(MATCHES, [prediction("m1", 3, 1)], 1);

    expect(result.badges).toContainEqual(
      expect.objectContaining({
        badgeType: "nostradamus",
        badgeLabel: "Nostradamus",
        points: 5,
      }),
    );
  });

  it("no otorga Nostradamus por exacto que no es difícil", () => {
    const result = deriveAwardsForMatchday(MATCHES, [prediction("m2", 1, 0)], 1);

    expect(result.badges.map((b) => b.badgeType)).not.toContain("nostradamus");
  });

  it("otorga El Salado si jugó la jornada y terminó con cero puntos", () => {
    const result = deriveAwardsForMatchday(
      MATCHES,
      [prediction("m1", 0, 0), prediction("m2", 2, 2)],
      1,
    );

    expect(result.totalPoints).toBe(0);
    expect(result.badges).toContainEqual(
      expect.objectContaining({ badgeType: "el_salado", points: 0 }),
    );
  });

  it("no otorga El Salado por ausencia total de predicciones", () => {
    const result = deriveAwardsForMatchday(MATCHES, [], 1);

    expect(result.predictedCount).toBe(0);
    expect(result.badges).toHaveLength(0);
    expect(result.profile).toBeNull();
  });

  it("ignora partidos finished sin marcador real al derivar premios", () => {
    const result = deriveAwardsForMatchday(
      [
        {
          id: "m-null",
          matchday: 5,
          status: "finished",
          homeScore: null,
          awayScore: null,
        },
      ],
      [prediction("m-null", 0, 0)],
      5,
    );

    expect(result.predictedCount).toBe(0);
    expect(result.badges).toHaveLength(0);
    expect(result.profile).toBeNull();
  });

  it("otorga El Tibio por mayoría de empates pronosticados", () => {
    const result = deriveAwardsForMatchday(
      MATCHES,
      [prediction("m1", 1, 1), prediction("m2", 0, 0)],
      1,
    );

    expect(result.badges).toContainEqual(
      expect.objectContaining({ badgeType: "el_tibio" }),
    );
  });

  it("clasifica Conservador por mayoría de predicciones ajustadas", () => {
    const result = deriveAwardsForMatchday(
      MATCHES,
      [prediction("m1", 1, 1), prediction("m2", 1, 0)],
      1,
    );

    expect(result.profile).toMatchObject({
      profileType: "conservador",
      profileLabel: "Conservador",
    });
  });

  it("clasifica Optimista por promedio alto de goles predichos", () => {
    const result = deriveAwardsForMatchday(
      MATCHES,
      [prediction("m1", 4, 2), prediction("m2", 3, 1)],
      1,
    );

    expect(result.profile).toMatchObject({
      profileType: "optimista",
      profileLabel: "Optimista",
    });
  });

  it("clasifica Cazador de Sorpresas por frecuencia alta de victorias visitantes", () => {
    const result = deriveAwardsForMatchday(
      MATCHES,
      [prediction("m1", 0, 1), prediction("m2", 1, 2)],
      1,
    );

    expect(result.profile).toMatchObject({
      profileType: "cazador_sorpresas",
      profileLabel: "Cazador de Sorpresas",
    });
  });

  it("prioriza Conservador sobre Optimista cuando empatan heurísticas", () => {
    const result = deriveAwardsForMatchday(
      MATCHES,
      [prediction("m1", 2, 0), prediction("m2", 2, 0)],
      1,
    );

    expect(result.averagePredictedGoals).toBe(2);
    expect(result.profile).toMatchObject({ profileType: "conservador" });
  });

  it("aplica multiplicador al puntaje total de la jornada", () => {
    const result = deriveAwardsForMatchday(
      MATCHES,
      [prediction("m1", 3, 1, 2), prediction("m2", 1, 0, 1.5)],
      1,
    );

    expect(result.totalPoints).toBe(17.5);
  });
});

import { describe, expect, it } from "vitest";

import {
  buildProjectedStandings,
  buildStandings,
  type StandingMatch,
  type StandingMember,
  type StandingPrediction,
} from "@/utils/standings";

// Helpers de construcción de fixtures (legibilidad de los casos).
function member(
  userId: string,
  overrides: Partial<StandingMember> = {},
): StandingMember {
  return {
    userId,
    displayName: `Player ${userId}`,
    avatarUrl: "/assets/avatars/default-player.svg",
    paymentStatus: "pending",
    joinedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function match(
  id: string,
  overrides: Partial<StandingMatch> = {},
): StandingMatch {
  return {
    id,
    status: "finished",
    matchday: 1,
    homeScore: 2,
    awayScore: 1,
    ...overrides,
  };
}

function prediction(
  userId: string,
  matchId: string,
  overrides: Partial<StandingPrediction> = {},
): StandingPrediction {
  return {
    userId,
    matchId,
    homeScorePred: 2,
    awayScorePred: 1,
    multiplier: 1,
    ...overrides,
  };
}

describe("buildStandings", () => {
  it("ordena por puntos totales de mayor a menor y asigna rank 1-based", () => {
    const members = [member("a"), member("b")];
    const matches = [match("m1", { homeScore: 2, awayScore: 1 })];
    const predictions = [
      // a: marcador exacto (5 base) → 5 pts
      prediction("a", "m1", { homeScorePred: 2, awayScorePred: 1 }),
      // b: resultado acertado distinto marcador (2 base) → 2 pts
      prediction("b", "m1", { homeScorePred: 3, awayScorePred: 0 }),
    ];

    const rows = buildStandings(members, matches, predictions);

    expect(rows.map((r) => r.userId)).toEqual(["a", "b"]);
    expect(rows[0]).toMatchObject({ rank: 1, totalPoints: 5, exactCount: 1 });
    expect(rows[1]).toMatchObject({ rank: 2, totalPoints: 2, exactCount: 0 });
  });

  it("aplica el multiplicador (exacto con 2.0x = 10 pts)", () => {
    const members = [member("a")];
    const matches = [match("m1", { homeScore: 1, awayScore: 0 })];
    const predictions = [
      prediction("a", "m1", {
        homeScorePred: 1,
        awayScorePred: 0,
        multiplier: 2,
      }),
    ];

    const rows = buildStandings(members, matches, predictions);

    expect(rows[0]).toMatchObject({ totalPoints: 10, exactCount: 1 });
  });

  it("excluye partidos que no estan 'finished'", () => {
    const members = [member("a")];
    const matches = [
      match("m1", { status: "scheduled", homeScore: null, awayScore: null }),
      match("m2", { status: "live", homeScore: 1, awayScore: 0 }),
      match("m3", { status: "canceled", homeScore: 1, awayScore: 0 }),
    ];
    const predictions = [
      prediction("a", "m1", { homeScorePred: 0, awayScorePred: 0 }),
      prediction("a", "m2", { homeScorePred: 1, awayScorePred: 0 }),
      prediction("a", "m3", { homeScorePred: 1, awayScorePred: 0 }),
    ];

    const rows = buildStandings(members, matches, predictions);

    expect(rows[0]).toMatchObject({ totalPoints: 0, exactCount: 0 });
  });

  it("trata un partido 'finished' con marcadores null como 0 puntos", () => {
    const members = [member("a")];
    const matches = [match("m1", { homeScore: null, awayScore: null })];
    const predictions = [
      prediction("a", "m1", { homeScorePred: 0, awayScorePred: 0 }),
    ];

    const rows = buildStandings(members, matches, predictions);

    expect(rows[0]).toMatchObject({ totalPoints: 0, exactCount: 0 });
  });

  it("incluye a miembros sin prediccion con 0 puntos (no los omite)", () => {
    const members = [member("a"), member("b")];
    const matches = [match("m1", { homeScore: 2, awayScore: 1 })];
    const predictions = [
      prediction("a", "m1", { homeScorePred: 2, awayScorePred: 1 }),
      // b no predijo
    ];

    const rows = buildStandings(members, matches, predictions);

    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ userId: "b", totalPoints: 0 });
  });

  it("filtra por jornada y aisla los puntos de esa jornada", () => {
    const members = [member("a")];
    const matches = [
      match("m1", { matchday: 1, homeScore: 1, awayScore: 0 }),
      match("m2", { matchday: 2, homeScore: 0, awayScore: 3 }),
    ];
    const predictions = [
      prediction("a", "m1", { homeScorePred: 1, awayScorePred: 0 }), // exacto J1
      prediction("a", "m2", { homeScorePred: 0, awayScorePred: 3 }), // exacto J2
    ];

    const acumulado = buildStandings(members, matches, predictions);
    expect(acumulado[0]).toMatchObject({ totalPoints: 10, exactCount: 2 });

    const j2 = buildStandings(members, matches, predictions, 2);
    expect(j2[0]).toMatchObject({ totalPoints: 5, exactCount: 1 });
  });

  it("desempata por cantidad de marcadores exactos cuando los puntos empatan", () => {
    // a y b suman 10 pts cada uno, pero a lo logra con 2 exactos y b con 1.
    const members = [member("b"), member("a")]; // orden de entrada inverso a propósito
    const matches = [
      match("m1", { homeScore: 1, awayScore: 0 }),
      match("m2", { homeScore: 2, awayScore: 2 }),
    ];
    const predictions = [
      // a: dos exactos (5 + 5 = 10), 2 exactos
      prediction("a", "m1", { homeScorePred: 1, awayScorePred: 0 }),
      prediction("a", "m2", { homeScorePred: 2, awayScorePred: 2 }),
      // b: un exacto con 2.0x (10) + un fallo, 1 exacto
      prediction("b", "m1", { homeScorePred: 1, awayScorePred: 0, multiplier: 2 }),
      prediction("b", "m2", { homeScorePred: 4, awayScorePred: 0 }),
    ];

    const rows = buildStandings(members, matches, predictions);

    expect(rows[0]).toMatchObject({ userId: "a", totalPoints: 10, exactCount: 2 });
    expect(rows[1]).toMatchObject({ userId: "b", totalPoints: 10, exactCount: 1 });
  });

  it("no desempata por joined_at, sino que comparten rank (empate real) e isTie es true", () => {
    const members = [
      member("late", { joinedAt: "2026-06-02T10:00:00.000Z" }),
      member("early", { joinedAt: "2026-06-01T10:00:00.000Z" }),
    ];
    const matches = [match("m1", { homeScore: 1, awayScore: 0 })];
    const predictions = [
      prediction("late", "m1", { homeScorePred: 1, awayScorePred: 0 }),
      prediction("early", "m1", { homeScorePred: 1, awayScorePred: 0 }),
    ];

    const rows = buildStandings(members, matches, predictions);

    expect(rows[0]).toMatchObject({ userId: "early", rank: 1, isTie: true });
    expect(rows[1]).toMatchObject({ userId: "late", rank: 1, isTie: true });
  });

  it("liga sin partidos finished: todos a 0 con rank compartido 1 e isTie true", () => {
    const members = [
      member("b", { joinedAt: "2026-06-03T00:00:00.000Z" }),
      member("a", { joinedAt: "2026-06-01T00:00:00.000Z" }),
    ];
    const matches: StandingMatch[] = [
      match("m1", { status: "scheduled", homeScore: null, awayScore: null }),
    ];

    const rows = buildStandings(members, matches, []);

    expect(rows.map((r) => r.userId)).toEqual(["a", "b"]);
    expect(rows.every((r) => r.totalPoints === 0)).toBe(true);
    expect(rows[0]).toMatchObject({ rank: 1, isTie: true });
    expect(rows[1]).toMatchObject({ rank: 1, isTie: true });
  });

  it("no puntúa un acierto aparente contra un finished con marcadores null (predicción != 0-0)", () => {
    // Guarda anti-bug: un finished corrupto (home/away null) NO debe puntuar,
    // ni siquiera si la predicción "coincide" numéricamente con 0-0.
    const members = [member("a")];
    const matches = [match("m1", { homeScore: null, awayScore: null })];
    const predictions = [
      prediction("a", "m1", { homeScorePred: 2, awayScorePred: 1 }),
    ];

    const rows = buildStandings(members, matches, predictions);

    expect(rows[0]).toMatchObject({ totalPoints: 0, exactCount: 0 });
  });

  it("desempate final determinista por userId ante empate TOTAL (mismo joined_at)", () => {
    // Mismos puntos, exactos y joined_at → el orden lo decide userId de forma
    // estable (no depende del orden de entrada ni de la implementación de sort),
    // pero ambos comparten el rank 1 y tienen isTie true.
    const sameJoin = "2026-06-01T00:00:00.000Z";
    const members = [
      member("zoe", { joinedAt: sameJoin }),
      member("ana", { joinedAt: sameJoin }),
    ];
    const matches = [match("m1", { homeScore: 1, awayScore: 0 })];
    const predictions = [
      prediction("zoe", "m1", { homeScorePred: 1, awayScorePred: 0 }),
      prediction("ana", "m1", { homeScorePred: 1, awayScorePred: 0 }),
    ];

    const rows = buildStandings(members, matches, predictions);

    expect(rows.map((r) => r.userId)).toEqual(["ana", "zoe"]);
    expect(rows[0]).toMatchObject({ rank: 1, isTie: true });
    expect(rows[1]).toMatchObject({ rank: 1, isTie: true });
  });

  it("filtra por phaseKey de eliminatoria y aisla los puntos de esa fase", () => {
    const members = [member("a")];
    const matches = [
      match("m1", { matchday: null, stage: "round-16", homeScore: 1, awayScore: 0 }),
      match("m2", { matchday: null, stage: "quarter", homeScore: 0, awayScore: 3 }),
    ];
    const predictions = [
      prediction("a", "m1", { homeScorePred: 1, awayScorePred: 0 }),
      prediction("a", "m2", { homeScorePred: 0, awayScorePred: 3 }),
    ];

    const r16 = buildStandings(members, matches, predictions, "round-16");
    expect(r16[0]).toMatchObject({ totalPoints: 5, exactCount: 1 });

    const q = buildStandings(members, matches, predictions, "quarter");
    expect(q[0]).toMatchObject({ totalPoints: 5, exactCount: 1 });
  });

  it("desempata por cantidad de resultados acertados (resultCount) cuando puntos y exactos empatan", () => {
    const members = [member("b"), member("a")];
    const matches = [
      match("m1", { homeScore: 2, awayScore: 1 }),
      match("m2", { homeScore: 1, awayScore: 1 }),
    ];
    const predictions = [
      // a: 1 exacto (5 pts) + 1 resultado (2 pts, mult 1.0) = 7 pts. exacts = 1, results = 1
      prediction("a", "m1", { homeScorePred: 2, awayScorePred: 1, multiplier: 1 }),
      prediction("a", "m2", { homeScorePred: 2, awayScorePred: 2, multiplier: 1 }), // result (empate diferente)
      // b: 1 exacto con mult 1.4 (7 pts). exacts = 1, results = 0
      prediction("b", "m1", { homeScorePred: 2, awayScorePred: 1, multiplier: 1.4 }),
    ];

    const rows = buildStandings(members, matches, predictions);
    expect(rows[0]).toMatchObject({ userId: "a", totalPoints: 7, exactCount: 1, resultCount: 1, isTie: false });
    expect(rows[1]).toMatchObject({ userId: "b", totalPoints: 7, exactCount: 1, resultCount: 0, isTie: false });
  });

  it("desempata por puntos de premios especiales (awardPoints) cuando puntos, exactos y resultados empatan", () => {
    const members = [
      member("b", { awardPoints: 0 }),
      member("a", { awardPoints: 15 }),
    ];
    const matches = [
      match("m1", { homeScore: 2, awayScore: 1 }),
      match("m2", { homeScore: 1, awayScore: 1 }),
    ];
    const predictions = [
      // a: 2 exactos (10 pts) + 15 awards = 25 pts. exacts = 2, results = 0
      prediction("a", "m1", { homeScorePred: 2, awayScorePred: 1, multiplier: 1 }),
      prediction("a", "m2", { homeScorePred: 1, awayScorePred: 1, multiplier: 1 }),
      // b: 2 exactos con mult 2.5 (25 pts). awards = 0 -> exacts = 2, results = 0
      prediction("b", "m1", { homeScorePred: 2, awayScorePred: 1, multiplier: 2.5 }),
      prediction("b", "m2", { homeScorePred: 1, awayScorePred: 1, multiplier: 2.5 }),
    ];

    const rows = buildStandings(members, matches, predictions);
    expect(rows[0]).toMatchObject({ userId: "a", totalPoints: 25, exactCount: 2, awardPoints: 15, isTie: false });
    expect(rows[1]).toMatchObject({ userId: "b", totalPoints: 25, exactCount: 2, awardPoints: 0, isTie: false });
  });

  it("asigna el mismo rank visible a usuarios en empate absoluto y calcula el salto correcto para el siguiente", () => {
    // a y b empatan en todo. c es mejor y d es peor.
    const members = [member("d"), member("b"), member("a"), member("c")];
    const matches = [
      match("m1", { homeScore: 2, awayScore: 1 }),
      match("m2", { homeScore: 1, awayScore: 1 }),
    ];
    const predictions = [
      prediction("c", "m1", { homeScorePred: 2, awayScorePred: 1 }),
      prediction("c", "m2", { homeScorePred: 1, awayScorePred: 1 }),
      prediction("a", "m1", { homeScorePred: 2, awayScorePred: 1 }),
      prediction("b", "m1", { homeScorePred: 2, awayScorePred: 1 }),
      prediction("d", "m2", { homeScorePred: 2, awayScorePred: 2 }),
    ];

    const rows = buildStandings(members, matches, predictions);

    expect(rows[0]).toMatchObject({ userId: "c", rank: 1, isTie: false });
    expect(rows[1]).toMatchObject({ rank: 2, isTie: true });
    expect(rows[2]).toMatchObject({ rank: 2, isTie: true });
    expect(rows[3]).toMatchObject({ userId: "d", rank: 4, isTie: false });
  });
});

describe("buildProjectedStandings", () => {
  it("suma puntos consolidados finished y puntos virtuales live", () => {
    const members = [member("a"), member("b")];
    const matches = [
      match("finished-1", { status: "finished", homeScore: 2, awayScore: 1 }),
      match("live-1", { status: "live", homeScore: 1, awayScore: 0 }),
    ];
    const predictions = [
      prediction("a", "finished-1", { homeScorePred: 2, awayScorePred: 1 }),
      prediction("a", "live-1", { homeScorePred: 1, awayScorePred: 0 }),
      prediction("b", "finished-1", { homeScorePred: 0, awayScorePred: 0 }),
      prediction("b", "live-1", { homeScorePred: 2, awayScorePred: 0 }),
    ];

    const rows = buildProjectedStandings(members, matches, predictions);

    expect(rows.map((r) => r.userId)).toEqual(["a", "b"]);
    expect(rows[0]).toMatchObject({
      userId: "a",
      totalPoints: 10,
      exactCount: 2,
      livePoints: 5,
    });
    expect(rows[1]).toMatchObject({
      userId: "b",
      totalPoints: 2,
      exactCount: 0,
      livePoints: 2,
    });
  });

  it("aplica multiplicador tambien a partidos live proyectados", () => {
    const members = [member("a")];
    const matches = [match("live-1", { status: "live", homeScore: 3, awayScore: 1 })];
    const predictions = [
      prediction("a", "live-1", {
        homeScorePred: 3,
        awayScorePred: 1,
        multiplier: 2,
      }),
    ];

    const rows = buildProjectedStandings(members, matches, predictions);

    expect(rows[0]).toMatchObject({
      totalPoints: 10,
      livePoints: 10,
      exactCount: 1,
    });
  });

  it("excluye scheduled, canceled, suspended y live con marcador null", () => {
    const members = [member("a")];
    const matches = [
      match("scheduled-1", { status: "scheduled", homeScore: 1, awayScore: 0 }),
      match("canceled-1", { status: "canceled", homeScore: 1, awayScore: 0 }),
      match("suspended-1", { status: "suspended", homeScore: 1, awayScore: 0 }),
      match("live-null", { status: "live", homeScore: null, awayScore: null }),
    ];
    const predictions = matches.map((m) =>
      prediction("a", m.id, { homeScorePred: 1, awayScorePred: 0 }),
    );

    const rows = buildProjectedStandings(members, matches, predictions);

    expect(rows[0]).toMatchObject({
      totalPoints: 0,
      livePoints: 0,
      exactCount: 0,
    });
  });

  it("mantiene desempate canonico y orden estable", () => {
    // Ahora no se desempata por joined_at, sino que comparten rank (isTie = true)
    const members = [
      member("late", { joinedAt: "2026-06-02T00:00:00.000Z" }),
      member("early", { joinedAt: "2026-06-01T00:00:00.000Z" }),
    ];
    const matches = [match("live-1", { status: "live", homeScore: 1, awayScore: 0 })];
    const predictions = [
      prediction("late", "live-1", { homeScorePred: 1, awayScorePred: 0 }),
      prediction("early", "live-1", { homeScorePred: 1, awayScorePred: 0 }),
    ];

    const rows = buildProjectedStandings(members, matches, predictions);

    expect(rows.map((r) => r.userId)).toEqual(["early", "late"]);
    expect(rows[0]).toMatchObject({ rank: 1, isTie: true });
    expect(rows[1]).toMatchObject({ rank: 1, isTie: true });
  });
});

describe("buildStandings — detalle de criterios (exactos/resultado/duelos)", () => {
  it("cuenta exactos (5 pts) y resultados (2 pts) por separado", () => {
    const members = [member("a")];
    const matches = [
      match("m1", { homeScore: 2, awayScore: 1 }),
      match("m2", { homeScore: 0, awayScore: 0 }),
      match("m3", { homeScore: 1, awayScore: 3 }),
    ];
    const predictions = [
      // exacto
      prediction("a", "m1", { homeScorePred: 2, awayScorePred: 1 }),
      // resultado (empate) pero marcador distinto → result
      prediction("a", "m2", { homeScorePred: 1, awayScorePred: 1 }),
      // fallado (predijo local, ganó visitante) → ni exacto ni result
      prediction("a", "m3", { homeScorePred: 2, awayScorePred: 0 }),
    ];

    const rows = buildStandings(members, matches, predictions);

    expect(rows[0]).toMatchObject({ exactCount: 1, resultCount: 1 });
  });

  it("usa el saldo de duelos (duelPoints) como desempate tras puntos y exactos", () => {
    // Mismos puntos y exactos: gana quien tiene más saldo de duelos.
    const members = [
      member("low", { duelPoints: 3, joinedAt: "2026-06-01T00:00:00.000Z" }),
      member("high", { duelPoints: 50, joinedAt: "2026-06-02T00:00:00.000Z" }),
    ];
    const matches = [match("m1", { homeScore: 2, awayScore: 1 })];
    const predictions = [
      prediction("low", "m1", { homeScorePred: 2, awayScorePred: 1 }),
      prediction("high", "m1", { homeScorePred: 2, awayScorePred: 1 }),
    ];

    const rows = buildStandings(members, matches, predictions);

    expect(rows.map((r) => r.userId)).toEqual(["high", "low"]);
    expect(rows[0]).toMatchObject({ userId: "high", duelPoints: 50 });
  });

  it("duelPoints por defecto es 0 cuando el miembro no lo provee", () => {
    const rows = buildStandings([member("a")], [], []);
    expect(rows[0]).toMatchObject({ duelPoints: 0, resultCount: 0 });
  });
});

describe("puntos de premios especiales (BUG-004)", () => {
  it("suman al total en el acumulado General y pueden decidir el orden", () => {
    const members = [
      member("a"),
      // b pierde en partidos (2 vs 5) pero acertó el campeón (+50).
      member("b", { awardPoints: 50 }),
    ];
    const matches = [match("m1", { homeScore: 2, awayScore: 1 })];
    const predictions = [
      prediction("a", "m1", { homeScorePred: 2, awayScorePred: 1 }),
      prediction("b", "m1", { homeScorePred: 3, awayScorePred: 0 }),
    ];

    const rows = buildStandings(members, matches, predictions, "general");

    expect(rows.map((r) => r.userId)).toEqual(["b", "a"]);
    expect(rows[0]).toMatchObject({ totalPoints: 52, awardPoints: 50 });
    expect(rows[1]).toMatchObject({ totalPoints: 5, awardPoints: 0 });
  });

  it("NO suman en una pestaña de jornada/fase (no pertenecen a ninguna)", () => {
    const members = [member("a", { awardPoints: 50 })];
    const matches = [match("m1", { matchday: 1, homeScore: 2, awayScore: 1 })];
    const predictions = [
      prediction("a", "m1", { homeScorePred: 2, awayScorePred: 1 }),
    ];

    const rows = buildStandings(members, matches, predictions, 1);

    expect(rows[0]).toMatchObject({ totalPoints: 5, awardPoints: 0 });
  });

  it("la proyectada (live) los incluye sin contarlos como livePoints", () => {
    const members = [member("a", { awardPoints: 25 })];
    const matches = [match("m1", { status: "live", homeScore: 1, awayScore: 0 })];
    const predictions = [
      prediction("a", "m1", { homeScorePred: 1, awayScorePred: 0 }),
    ];

    const rows = buildProjectedStandings(members, matches, predictions);

    expect(rows[0]).toMatchObject({
      totalPoints: 30,
      livePoints: 5,
      awardPoints: 25,
    });
  });

  it("awardPoints por defecto es 0 cuando el miembro no lo provee", () => {
    const rows = buildStandings([member("a")], [], []);
    expect(rows[0]).toMatchObject({ awardPoints: 0, totalPoints: 0 });
  });
});

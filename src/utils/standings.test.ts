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

  it("desempata por joined_at (el que entro antes va primero) con puntos y exactos iguales", () => {
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

    expect(rows.map((r) => r.userId)).toEqual(["early", "late"]);
  });

  it("liga sin partidos finished: todos a 0 ordenados por joined_at", () => {
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
    // estable (no depende del orden de entrada ni de la implementación de sort).
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
  });
});

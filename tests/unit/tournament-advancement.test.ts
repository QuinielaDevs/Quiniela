import { describe, expect, it } from "vitest";

import {
  calculateTournamentAdvancement,
  getThirdPlaceAssignments,
  rankBestThirds,
  THIRD_PLACE_DESTINATIONS,
  THIRD_PLACE_LOOKUP,
  type GroupStandingTable,
  type TournamentMatch,
} from "@/utils/tournament-advancement";

const GROUPS = "ABCDEFGHIJKL".split("");

function groupMatch(
  group: string,
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
  idx = 1,
): TournamentMatch {
  return {
    id: `${group}-${home}-${away}`,
    external_ref: `test:${group}:${home}-${away}`,
    home_team: `${home} Team`,
    away_team: `${away} Team`,
    home_team_code: `${group}${home}`,
    away_team_code: `${group}${away}`,
    home_score: homeScore,
    away_score: awayScore,
    penalties_home_score: null,
    penalties_away_score: null,
    match_time: `2026-06-${String(10 + idx).padStart(2, "0")}T12:00:00.000Z`,
    status: "finished",
    matchday: idx,
    stage: "group",
    group_label: group,
    bracket_slot: null,
    home_source: null,
    away_source: null,
    venue: null,
  };
}

function knockoutMatch(
  slot: number,
  homeSource: string,
  awaySource: string,
  stage = "round-32",
): TournamentMatch {
  return {
    id: `ko-${slot}`,
    external_ref: `wc2026:ko:${slot}`,
    home_team: "Por definir",
    away_team: "Por definir",
    home_team_code: null,
    away_team_code: null,
    home_score: null,
    away_score: null,
    penalties_home_score: null,
    penalties_away_score: null,
    match_time: `2026-07-${String(slot - 72).padStart(2, "0")}T12:00:00.000Z`,
    status: "scheduled",
    matchday: null,
    stage,
    group_label: null,
    bracket_slot: slot,
    home_source: homeSource,
    away_source: awaySource,
    venue: null,
  };
}

function completeGroup(
  group: string,
  scores: Array<[string, string, number, number]>,
): TournamentMatch[] {
  return scores.map(([home, away, homeScore, awayScore], index) =>
    groupMatch(group, home, away, homeScore, awayScore, index + 1),
  );
}

function completeTournamentGroups(): TournamentMatch[] {
  return GROUPS.flatMap((group, index) =>
    completeGroup(group, [
      ["A", "B", 3, 0],
      ["C", "D", 2, 0],
      ["A", "C", 2 + (index % 2), 1],
      ["B", "D", 2, 1],
      ["A", "D", 1, 0],
      ["B", "C", index % 3, 0],
    ]),
  );
}

describe("tournament advancement motor", () => {
  it("ordena un grupo por puntos, diferencia de goles y goles a favor", () => {
    const result = calculateTournamentAdvancement([
      ...completeGroup("A", [
        ["A", "B", 2, 0],
        ["C", "D", 1, 0],
        ["A", "C", 1, 1],
        ["B", "D", 1, 1],
        ["A", "D", 0, 0],
        ["B", "C", 1, 0],
      ]),
    ]);

    const groupA = result.groupTables.A;
    expect(groupA.complete).toBe(true);
    expect(groupA.rows.map((row) => row.teamCode)).toEqual([
      "AA",
      "AC",
      "AB",
      "AD",
    ]);
    expect(groupA.rows[0]).toMatchObject({
      points: 5,
      goalDifference: 2,
      goalsFor: 3,
    });
  });

  it("aplica mini-tabla head-to-head para empates múltiples", () => {
    const result = calculateTournamentAdvancement([
      ...completeGroup("B", [
        ["A", "B", 1, 0],
        ["A", "C", 0, 2],
        ["B", "C", 3, 1],
        ["A", "D", 4, 0],
        ["B", "D", 4, 0],
        ["C", "D", 4, 0],
      ]),
    ]);

    // A/B/C empatan en puntos, GD y GF globales; el head-to-head los ordena:
    // B (+1), C (0), A (-1).
    expect(result.groupTables.B.rows.map((row) => row.teamCode)).toEqual([
      "BB",
      "BC",
      "BA",
      "BD",
    ]);
  });

  it("ordena terceros y selecciona exactamente los 8 mejores", () => {
    const groupTables: Record<string, GroupStandingTable> = Object.fromEntries(
      GROUPS.map((group, index) => [
        group,
        {
          group,
          complete: true,
          rows: [
            { group, teamCode: `${group}1`, teamName: `${group}1`, rank: 1, played: 3, wins: 3, draws: 0, losses: 0, goalsFor: 9, goalsAgainst: 0, goalDifference: 9, points: 9 },
            { group, teamCode: `${group}2`, teamName: `${group}2`, rank: 2, played: 3, wins: 2, draws: 0, losses: 1, goalsFor: 5, goalsAgainst: 2, goalDifference: 3, points: 6 },
            { group, teamCode: `${group}3`, teamName: `${group}3`, rank: 3, played: 3, wins: 0, draws: index, losses: 3 - index, goalsFor: index, goalsAgainst: 3, goalDifference: index - 3, points: index },
            { group, teamCode: `${group}4`, teamName: `${group}4`, rank: 4, played: 3, wins: 0, draws: 0, losses: 3, goalsFor: 0, goalsAgainst: 6, goalDifference: -6, points: 0 },
          ],
        },
      ]),
    );

    const thirds = rankBestThirds(groupTables);
    expect(thirds).toHaveLength(8);
    expect(thirds.map((row) => row.group)).toEqual([
      "L",
      "K",
      "J",
      "I",
      "H",
      "G",
      "F",
      "E",
    ]);
  });

  it("incluye las 495 combinaciones oficiales de Annexe C y resuelve destinos", () => {
    expect(Object.keys(THIRD_PLACE_LOOKUP)).toHaveLength(495);
    expect(THIRD_PLACE_DESTINATIONS).toEqual([
      "1A",
      "1B",
      "1D",
      "1E",
      "1G",
      "1I",
      "1K",
      "1L",
    ]);

    expect(
      getThirdPlaceAssignments(["E", "F", "G", "H", "I", "J", "K", "L"]),
    ).toMatchObject({
      "1A": "3E",
      "1B": "3J",
      "1D": "3I",
      "1E": "3F",
      "1G": "3H",
      "1I": "3G",
      "1K": "3L",
      "1L": "3K",
    });
    expect(
      getThirdPlaceAssignments(["C", "E", "F", "H", "I", "J", "K", "L"]),
    ).toMatchObject({
      "1A": "3E",
      "1B": "3J",
      "1D": "3I",
      "1E": "3C",
      "1G": "3H",
      "1I": "3F",
      "1K": "3L",
      "1L": "3K",
    });
    expect(
      getThirdPlaceAssignments(["A", "B", "C", "D", "F", "G", "H", "I"]),
    ).toMatchObject({
      "1A": "3H",
      "1B": "3G",
      "1D": "3B",
      "1E": "3C",
      "1G": "3A",
      "1I": "3F",
      "1K": "3D",
      "1L": "3I",
    });
  });

  it("resuelve R32 desde 1X/2X/3X-Y-Z cuando todos los grupos están completos", () => {
    const result = calculateTournamentAdvancement([
      ...completeTournamentGroups(),
      knockoutMatch(74, "1E", "3A/B/C/D/F"),
      knockoutMatch(79, "1A", "3C/E/F/H/I"),
      knockoutMatch(87, "1K", "3D/E/I/J/L"),
    ]);

    const bySlot = new Map(result.knockoutSlots.map((slot) => [slot.bracketSlot, slot]));
    expect(bySlot.get(74)).toMatchObject({
      homeTeamCode: "EA",
      awayTeamCode: expect.stringMatching(/^[A-L][A-D]$/),
    });
    expect(bySlot.get(79)?.homeTeamCode).toBe("AA");
    expect(bySlot.get(87)?.homeTeamCode).toBe("KA");
  });

  it("resuelve mejores terceros con placeholders comprimidos de seed", () => {
    const slashResult = calculateTournamentAdvancement([
      ...completeTournamentGroups(),
      knockoutMatch(74, "1E", "3A/B/C/D/F"),
    ]);
    const compactResult = calculateTournamentAdvancement([
      ...completeTournamentGroups(),
      knockoutMatch(74, "1E", "3ABCDF"),
    ]);

    expect(compactResult.knockoutSlots[0]).toMatchObject({
      bracketSlot: 74,
      homeTeamCode: "EA",
      awayTeamCode: slashResult.knockoutSlots[0]?.awayTeamCode,
    });
    expect(compactResult.knockoutSlots[0]?.awayTeamCode).toBeTruthy();
  });

  it("propaga W/L para rondas posteriores y conserva TBD si falta ganador", () => {
    const result = calculateTournamentAdvancement([
      ...completeTournamentGroups(),
      {
        ...knockoutMatch(74, "1E", "3A/B/C/D/F"),
        home_team: "Equipo Uno",
        away_team: "Equipo Dos",
        home_team_code: "UNO",
        away_team_code: "DOS",
        home_score: 2,
        away_score: 1,
        status: "finished",
      },
      knockoutMatch(89, "W74", "W77", "round-16"),
      {
        ...knockoutMatch(90, "W73", "W75", "round-16"),
        home_team: "Ganador R16",
        away_team: "Perdedor R16",
        home_team_code: "R16",
        away_team_code: "R1L",
        home_score: 3,
        away_score: 2,
        status: "finished",
      },
      knockoutMatch(97, "W89", "W90", "quarter"),
      {
        ...knockoutMatch(98, "W93", "W94", "quarter"),
        home_team: "Ganador QF",
        away_team: "Perdedor QF",
        home_team_code: "QFW",
        away_team_code: "QFL",
        home_score: 1,
        away_score: 0,
        status: "finished",
      },
      knockoutMatch(101, "W97", "W98", "semi"),
      {
        ...knockoutMatch(102, "W99", "W100", "semi"),
        home_team: "Ganador SF",
        away_team: "Perdedor SF",
        home_team_code: "SFW",
        away_team_code: "SFL",
        home_score: 2,
        away_score: 0,
        status: "finished",
      },
      knockoutMatch(103, "L101", "L102", "third-place"),
      knockoutMatch(104, "W101", "W102", "final"),
    ]);

    const bySlot = new Map(result.knockoutSlots.map((slot) => [slot.bracketSlot, slot]));
    expect(bySlot.get(89)).toMatchObject({
      homeTeam: "Equipo Uno",
      homeTeamCode: "UNO",
      awayTeam: "Por definir",
      awayTeamCode: null,
    });
    expect(bySlot.get(97)).toMatchObject({
      awayTeam: "Ganador R16",
      awayTeamCode: "R16",
    });
    expect(bySlot.get(101)).toMatchObject({
      awayTeam: "Ganador QF",
      awayTeamCode: "QFW",
    });
    expect(bySlot.get(103)).toMatchObject({
      homeTeam: "Por definir",
      awayTeam: "Perdedor SF",
      awayTeamCode: "SFL",
    });
    expect(bySlot.get(104)).toMatchObject({
      homeTeam: "Por definir",
      awayTeam: "Ganador SF",
      awayTeamCode: "SFW",
    });
  });

  it("usa fallback determinista y conserva TBD cuando los grupos están incompletos", () => {
    const fallback = calculateTournamentAdvancement([
      ...completeGroup("C", [
        ["A", "B", 0, 0],
        ["A", "C", 0, 0],
        ["A", "D", 0, 0],
        ["B", "C", 0, 0],
        ["B", "D", 0, 0],
        ["C", "D", 0, 0],
      ]),
    ]);
    expect(fallback.groupTables.C.rows.map((row) => row.teamCode)).toEqual([
      "CA",
      "CB",
      "CC",
      "CD",
    ]);

    const incomplete = calculateTournamentAdvancement([
      ...completeGroup("A", [["A", "B", 1, 0]]),
      knockoutMatch(79, "1A", "3C/E/F/H/I"),
    ]);
    expect(incomplete.groupTables.A.complete).toBe(false);
    expect(incomplete.bestThirds).toEqual([]);
    expect(incomplete.knockoutSlots[0]).toMatchObject({
      homeTeam: "Por definir",
      homeTeamCode: null,
      awayTeam: "Por definir",
      awayTeamCode: null,
    });
  });

  it("resuelve ganador por penales en partidos de eliminatoria empatados", () => {
    const result = calculateTournamentAdvancement([
      ...completeTournamentGroups(),
      {
        ...knockoutMatch(74, "1E", "3A/B/C/D/F"),
        home_team: "Equipo Uno",
        away_team: "Equipo Dos",
        home_team_code: "UNO",
        away_team_code: "DOS",
        home_score: 1,
        away_score: 1,
        penalties_home_score: 5,
        penalties_away_score: 4,
        status: "finished",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as TournamentMatch,
      knockoutMatch(89, "W74", "W77", "round-16"),
    ]);

    const bySlot = new Map(result.knockoutSlots.map((slot) => [slot.bracketSlot, slot]));
    expect(bySlot.get(89)).toMatchObject({
      homeTeam: "Equipo Uno",
      homeTeamCode: "UNO",
      awayTeam: "Por definir",
      awayTeamCode: null,
    });
  });

  it("es idempotente para el mismo input", () => {
    const matches = [...completeTournamentGroups(), knockoutMatch(74, "1E", "3A/B/C/D/F")];
    expect(calculateTournamentAdvancement(matches)).toEqual(
      calculateTournamentAdvancement(matches),
    );
  });
});

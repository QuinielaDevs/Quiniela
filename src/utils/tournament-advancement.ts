import {
  getThirdPlaceAssignments,
  THIRD_PLACE_DESTINATIONS,
  THIRD_PLACE_LOOKUP,
  type GroupLabel,
  type ThirdPlaceAssignment,
  type ThirdPlaceDestination,
} from "@/utils/third-place-annex-c";

export {
  getThirdPlaceAssignments,
  THIRD_PLACE_DESTINATIONS,
  THIRD_PLACE_LOOKUP,
};

export type TournamentMatch = {
  id: string;
  external_ref: string | null;
  home_team: string;
  away_team: string;
  home_team_code: string | null;
  away_team_code: string | null;
  home_score: number | null;
  away_score: number | null;
  penalties_home_score: number | null;
  penalties_away_score: number | null;
  match_time: string;
  status: string;
  matchday: number | null;
  stage: string | null;
  group_label: string | null;
  bracket_slot: number | null;
  home_source: string | null;
  away_source: string | null;
  venue: string | null;
};

export type GroupStandingRow = {
  group: string;
  teamCode: string;
  teamName: string;
  rank: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
};

export type GroupStandingTable = {
  group: string;
  complete: boolean;
  rows: GroupStandingRow[];
};

export type QualifiedTeam = GroupStandingRow & {
  qualification: "winner" | "runner-up" | "third";
};

export type ResolvedKnockoutSlot = {
  bracketSlot: number;
  homeTeam: string;
  awayTeam: string;
  homeTeamCode: string | null;
  awayTeamCode: string | null;
};

export type TournamentPhaseBoundaries = {
  round32StartAt: string | null;
  semiStartAt: string | null;
  groupsComplete: boolean;
  round32Complete: boolean;
  semiComplete: boolean;
};

export type TournamentAdvancement = {
  groupTables: Record<GroupLabel, GroupStandingTable>;
  qualifiedTeams: QualifiedTeam[];
  bestThirds: GroupStandingRow[];
  knockoutSlots: ResolvedKnockoutSlot[];
  phaseBoundaries: TournamentPhaseBoundaries;
};

type MutableStanding = Omit<GroupStandingRow, "rank">;
type TeamRef = { teamCode: string; teamName: string };

const GROUP_LABELS = "ABCDEFGHIJKL".split("") as GroupLabel[];
const TBD_TEAM = "Por definir";

function isGroupLabel(value: string | null): value is GroupLabel {
  return GROUP_LABELS.includes(value as GroupLabel);
}

function hasScore(match: TournamentMatch): boolean {
  return Number.isInteger(match.home_score) && Number.isInteger(match.away_score);
}

function isFinishedWithScore(match: TournamentMatch): boolean {
  return match.status === "finished" && hasScore(match);
}

function createStanding(group: string, team: TeamRef): MutableStanding {
  return {
    group,
    teamCode: team.teamCode,
    teamName: team.teamName,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
  };
}

function applyResult(
  row: MutableStanding,
  goalsFor: number,
  goalsAgainst: number,
): void {
  row.played += 1;
  row.goalsFor += goalsFor;
  row.goalsAgainst += goalsAgainst;
  row.goalDifference = row.goalsFor - row.goalsAgainst;

  if (goalsFor > goalsAgainst) {
    row.wins += 1;
    row.points += 3;
  } else if (goalsFor === goalsAgainst) {
    row.draws += 1;
    row.points += 1;
  } else {
    row.losses += 1;
  }
}

function compareBasic(a: GroupStandingRow | MutableStanding, b: GroupStandingRow | MutableStanding): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.goalDifference !== a.goalDifference) {
    return b.goalDifference - a.goalDifference;
  }
  if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
  return 0;
}

function compareStable(a: GroupStandingRow | MutableStanding, b: GroupStandingRow | MutableStanding): number {
  const byGroup = a.group.localeCompare(b.group);
  if (byGroup !== 0) return byGroup;
  return a.teamCode.localeCompare(b.teamCode);
}

function compareRows(
  matches: TournamentMatch[],
  tiedCodes: Set<string>,
  a: MutableStanding,
  b: MutableStanding,
): number {
  const basic = compareBasic(a, b);
  if (basic !== 0) return basic;

  const mini = buildMiniTable(matches, tiedCodes);
  const miniA = mini.get(a.teamCode);
  const miniB = mini.get(b.teamCode);
  if (miniA && miniB) {
    const miniBasic = compareBasic(miniA, miniB);
    if (miniBasic !== 0) return miniBasic;
  }

  return compareStable(a, b);
}

function buildMiniTable(
  matches: TournamentMatch[],
  tiedCodes: Set<string>,
): Map<string, MutableStanding> {
  const rows = new Map<string, MutableStanding>();

  for (const match of matches) {
    if (!isFinishedWithScore(match)) continue;
    const homeCode = match.home_team_code;
    const awayCode = match.away_team_code;
    if (!homeCode || !awayCode) continue;
    if (!tiedCodes.has(homeCode) || !tiedCodes.has(awayCode)) continue;

    if (!rows.has(homeCode)) {
      rows.set(
        homeCode,
        createStanding(match.group_label ?? "", {
          teamCode: homeCode,
          teamName: match.home_team,
        }),
      );
    }
    if (!rows.has(awayCode)) {
      rows.set(
        awayCode,
        createStanding(match.group_label ?? "", {
          teamCode: awayCode,
          teamName: match.away_team,
        }),
      );
    }

    applyResult(rows.get(homeCode)!, match.home_score!, match.away_score!);
    applyResult(rows.get(awayCode)!, match.away_score!, match.home_score!);
  }

  return rows;
}

export function buildGroupStandings(
  matches: TournamentMatch[],
): Record<GroupLabel, GroupStandingTable> {
  const byGroup = Object.fromEntries(
    GROUP_LABELS.map((group) => [group, [] as TournamentMatch[]]),
  ) as Record<GroupLabel, TournamentMatch[]>;

  for (const match of matches) {
    if (match.stage !== "group" || !isGroupLabel(match.group_label)) continue;
    byGroup[match.group_label].push(match);
  }

  return Object.fromEntries(
    GROUP_LABELS.map((group) => {
      const groupMatches = byGroup[group];
      const rows = new Map<string, MutableStanding>();

      for (const match of groupMatches) {
        const teams: TeamRef[] = [
          { teamCode: match.home_team_code ?? "", teamName: match.home_team },
          { teamCode: match.away_team_code ?? "", teamName: match.away_team },
        ];
        for (const team of teams) {
          if (!team.teamCode || rows.has(team.teamCode)) continue;
          rows.set(team.teamCode, createStanding(group, team));
        }

        if (!isFinishedWithScore(match)) continue;
        const homeCode = match.home_team_code;
        const awayCode = match.away_team_code;
        if (!homeCode || !awayCode) continue;
        applyResult(rows.get(homeCode)!, match.home_score!, match.away_score!);
        applyResult(rows.get(awayCode)!, match.away_score!, match.home_score!);
      }

      const sorted = [...rows.values()].sort((a, b) => {
        const tiedCodes = new Set(
          [...rows.values()]
            .filter((row) => compareBasic(row, a) === 0)
            .map((row) => row.teamCode),
        );
        return compareRows(groupMatches, tiedCodes, a, b);
      });

      return [
        group,
        {
          group,
          complete:
            groupMatches.filter(isFinishedWithScore).length === 6 &&
            sorted.length === 4,
          rows: sorted.map((row, index) => ({ ...row, rank: index + 1 })),
        },
      ];
    }),
  ) as Record<GroupLabel, GroupStandingTable>;
}

export function rankBestThirds(
  groupTables: Record<string, GroupStandingTable>,
): GroupStandingRow[] {
  return Object.values(groupTables)
    .filter((table) => table.complete)
    .map((table) => table.rows[2])
    .filter((row): row is GroupStandingRow => Boolean(row))
    .sort((a, b) => {
      const basic = compareBasic(a, b);
      if (basic !== 0) return basic;
      return compareStable(a, b);
    })
    .slice(0, 8);
}

function teamFromRow(row: GroupStandingRow | undefined): TeamRef | null {
  if (!row) return null;
  return { teamCode: row.teamCode, teamName: row.teamName };
}

function resolveWinnerLoser(match: TournamentMatch, wantWinner: boolean): TeamRef | null {
  if (!isFinishedWithScore(match)) return null;
  
  if (match.home_score !== match.away_score) {
    const homeWins = match.home_score! > match.away_score!;
    const useHome = wantWinner ? homeWins : !homeWins;
    const teamCode = useHome ? match.home_team_code : match.away_team_code;
    if (!teamCode) return null;
    return {
      teamCode,
      teamName: useHome ? match.home_team : match.away_team,
    };
  }

  // Si hay empate reglamentario, resolver por goles de la tanda de penales
  const penHome = match.penalties_home_score;
  const penAway = match.penalties_away_score;
  if (penHome !== null && penAway !== null && penHome !== penAway) {
    const homeWins = penHome > penAway;
    const useHome = wantWinner ? homeWins : !homeWins;
    const teamCode = useHome ? match.home_team_code : match.away_team_code;
    if (!teamCode) return null;
    return {
      teamCode,
      teamName: useHome ? match.home_team : match.away_team,
    };
  }

  return null;
}

type ResolveContext = {
  groupTables: Record<GroupLabel, GroupStandingTable>;
  bestThirdAssignments: ThirdPlaceAssignment | null;
  knockoutBySlot: Map<number, TournamentMatch>;
  destination?: ThirdPlaceDestination;
};

export function resolveSourceCode(
  code: string | null,
  context: ResolveContext,
): TeamRef | null {
  if (!code) return null;

  const directGroup = /^([12])([A-L])$/.exec(code);
  if (directGroup) {
    const rank = Number(directGroup[1]);
    const group = directGroup[2] as GroupLabel;
    return teamFromRow(context.groupTables[group].complete ? context.groupTables[group].rows[rank - 1] : undefined);
  }

  if (/^3[A-L](?:\/[A-L])+$/.test(code)) {
    if (!context.destination || !context.bestThirdAssignments) return null;
    const thirdCode = context.bestThirdAssignments[context.destination];
    const group = thirdCode.slice(1) as GroupLabel;
    return teamFromRow(context.groupTables[group].rows[2]);
  }

  const knockout = /^([WL])(\d{2,3})$/.exec(code);
  if (knockout) {
    const match = context.knockoutBySlot.get(Number(knockout[2]));
    if (!match) return null;
    return resolveWinnerLoser(match, knockout[1] === "W");
  }

  return null;
}

function destinationForThirdPlaceSource(
  source: string | null,
  counterpart: string | null,
): ThirdPlaceDestination | undefined {
  if (!source || !/^3[A-L](?:\/[A-L])+$/.test(source)) return undefined;
  return THIRD_PLACE_DESTINATIONS.find((destination) => destination === counterpart);
}

function resolvedOrTbd(team: TeamRef | null): { team: string; code: string | null } {
  return team
    ? { team: team.teamName, code: team.teamCode }
    : { team: TBD_TEAM, code: null };
}

function phaseStart(matches: TournamentMatch[], stage: string): string | null {
  const times = matches
    .filter((match) => match.stage === stage)
    .map((match) => match.match_time)
    .filter(Boolean)
    .sort();
  return times[0] ?? null;
}

function stageComplete(matches: TournamentMatch[], stage: string, expected: number): boolean {
  return (
    matches.filter((match) => match.stage === stage && isFinishedWithScore(match))
      .length === expected
  );
}

export function calculateTournamentAdvancement(
  matches: TournamentMatch[],
): TournamentAdvancement {
  const groupTables = buildGroupStandings(matches);
  const allGroupsComplete = GROUP_LABELS.every((group) => groupTables[group].complete);
  const bestThirds = allGroupsComplete ? rankBestThirds(groupTables) : [];
  const bestThirdAssignments =
    bestThirds.length === 8
      ? getThirdPlaceAssignments(bestThirds.map((row) => row.group as GroupLabel))
      : null;

  const qualifiedTeams: QualifiedTeam[] = [];
  for (const group of GROUP_LABELS) {
    const table = groupTables[group];
    if (!table.complete) continue;
    if (table.rows[0]) {
      qualifiedTeams.push({ ...table.rows[0], qualification: "winner" });
    }
    if (table.rows[1]) {
      qualifiedTeams.push({ ...table.rows[1], qualification: "runner-up" });
    }
  }
  for (const row of bestThirds) {
    qualifiedTeams.push({ ...row, qualification: "third" });
  }

  const knockoutMatches = matches
    .filter((match) => match.bracket_slot !== null && match.stage !== "group")
    .sort((a, b) => (a.bracket_slot ?? 0) - (b.bracket_slot ?? 0));
  const knockoutBySlot = new Map(
    knockoutMatches.map((match) => [match.bracket_slot!, match]),
  );

  const knockoutSlots = knockoutMatches.map((match) => {
    const baseContext = {
      groupTables,
      bestThirdAssignments,
      knockoutBySlot,
    };
    const home = resolveSourceCode(match.home_source, {
      ...baseContext,
      destination: destinationForThirdPlaceSource(
        match.home_source,
        match.away_source,
      ),
    });
    const away = resolveSourceCode(match.away_source, {
      ...baseContext,
      destination: destinationForThirdPlaceSource(
        match.away_source,
        match.home_source,
      ),
    });
    const resolvedHome = resolvedOrTbd(home);
    const resolvedAway = resolvedOrTbd(away);
    return {
      bracketSlot: match.bracket_slot!,
      homeTeam: resolvedHome.team,
      awayTeam: resolvedAway.team,
      homeTeamCode: resolvedHome.code,
      awayTeamCode: resolvedAway.code,
    };
  });

  return {
    groupTables,
    qualifiedTeams,
    bestThirds,
    knockoutSlots,
    phaseBoundaries: {
      round32StartAt: phaseStart(matches, "round-32"),
      semiStartAt: phaseStart(matches, "semi"),
      groupsComplete: allGroupsComplete,
      round32Complete: stageComplete(matches, "round-32", 16),
      semiComplete: stageComplete(matches, "semi", 2),
    },
  };
}

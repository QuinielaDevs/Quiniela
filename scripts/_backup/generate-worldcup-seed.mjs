import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const dataDir = join(projectRoot, "supabase", "seed-data", "worldcup-2026");
const outputPath = join(
  projectRoot,
  "supabase",
  "migrations",
  "20260604131000_seed_worldcup_2026.sql",
);

const STAGE_BY_ROUND = new Map([
  ["Round of 32", "round-32"],
  ["Round of 16", "round-16"],
  ["Quarter-final", "quarter"],
  ["Semi-final", "semi"],
  ["Match for third place", "third-place"],
  ["Final", "final"],
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fail(message) {
  throw new Error(`[worldcup seed] ${message}`);
}

function sqlString(value) {
  if (value === null || value === undefined) {
    return "null";
  }

  return `'${String(value).replaceAll("'", "''")}'`;
}

function parseGroupLabel(group) {
  const match = /^Group ([A-L])$/.exec(group ?? "");
  if (!match) {
    fail(`Invalid group label: ${group}`);
  }
  return match[1];
}

function parseKickoffUtc(date, time) {
  const match = /^(\d{2}):(\d{2}) UTC([+-])(\d{1,2})$/.exec(time ?? "");
  if (!match) {
    fail(`Invalid kickoff time format for ${date}: ${time}`);
  }

  const [, hours, minutes, sign, offsetHoursRaw] = match;
  const offsetHours = Number(offsetHoursRaw);
  const localUtcMs = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    Number(hours),
    Number(minutes),
  );
  const signedOffset = sign === "+" ? offsetHours : -offsetHours;
  const kickoffUtc = new Date(localUtcMs - signedOffset * 60 * 60 * 1000);

  return kickoffUtc.toISOString();
}

function normalizeTeam(team) {
  return team.name_normalised ?? team.name;
}

function validateCount(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label}: expected ${expected}, got ${actual}`);
  }
}

function buildRows() {
  const worldcup = readJson(join(dataDir, "worldcup.json"));
  const teams = readJson(join(dataDir, "worldcup.teams.json"));
  const stadiumsFile = readJson(join(dataDir, "worldcup.stadiums.json"));

  const matches = worldcup.matches;
  const stadiums = stadiumsFile.stadiums;

  if (!Array.isArray(matches)) {
    fail("worldcup.json must expose a matches array");
  }
  if (!Array.isArray(teams)) {
    fail("worldcup.teams.json must be an array");
  }
  if (!Array.isArray(stadiums)) {
    fail("worldcup.stadiums.json must expose a stadiums array");
  }

  validateCount(matches.length, 104, "matches count");
  validateCount(teams.length, 48, "teams count");
  validateCount(stadiums.length, 16, "stadiums count");

  const teamByName = new Map(teams.map((team) => [team.name, team]));
  const stadiumByCity = new Map(stadiums.map((stadium) => [stadium.city, stadium]));

  const groupMatches = matches.filter((match) => match.group);
  const knockoutMatches = matches.filter((match) => !match.group);
  validateCount(groupMatches.length, 72, "group matches count");
  validateCount(knockoutMatches.length, 32, "knockout matches count");

  const matchdayByGroupKey = new Map();
  const groupMatchesByGroup = new Map();
  for (const match of groupMatches) {
    const groupLabel = parseGroupLabel(match.group);
    groupMatchesByGroup.set(groupLabel, [
      ...(groupMatchesByGroup.get(groupLabel) ?? []),
      match,
    ]);
  }

  for (const [groupLabel, groupRows] of groupMatchesByGroup.entries()) {
    validateCount(groupRows.length, 6, `matches in group ${groupLabel}`);

    groupRows
      .map((match) => ({
        match,
        kickoffUtc: parseKickoffUtc(match.date, match.time),
      }))
      .sort((a, b) => a.kickoffUtc.localeCompare(b.kickoffUtc))
      .forEach(({ match }, index) => {
        matchdayByGroupKey.set(
          `${groupLabel}:${match.team1}:${match.team2}:${match.date}:${match.time}`,
          Math.floor(index / 2) + 1,
        );
      });
  }

  const rows = matches.map((match) => {
    const matchTime = parseKickoffUtc(match.date, match.time);
    const venue = stadiumByCity.get(match.ground)?.name ?? match.ground;

    if (match.group) {
      const groupLabel = parseGroupLabel(match.group);
      const home = teamByName.get(match.team1);
      const away = teamByName.get(match.team2);
      if (!home) fail(`Unknown home team: ${match.team1}`);
      if (!away) fail(`Unknown away team: ${match.team2}`);
      if (home.group !== groupLabel) {
        fail(`${home.name} is in group ${home.group}, not ${groupLabel}`);
      }
      if (away.group !== groupLabel) {
        fail(`${away.name} is in group ${away.group}, not ${groupLabel}`);
      }

      const matchday = matchdayByGroupKey.get(
        `${groupLabel}:${match.team1}:${match.team2}:${match.date}:${match.time}`,
      );

      return {
        external_ref: `wc2026:grp:${groupLabel}:${home.fifa_code}-${away.fifa_code}`,
        home_team: normalizeTeam(home),
        away_team: normalizeTeam(away),
        home_team_code: home.fifa_code,
        away_team_code: away.fifa_code,
        home_score: null,
        away_score: null,
        match_time: matchTime,
        status: "scheduled",
        matchday,
        stage: "group",
        group_label: groupLabel,
        bracket_slot: null,
        home_source: null,
        away_source: null,
        venue,
      };
    }

    const stage = STAGE_BY_ROUND.get(match.round);
    if (!stage) {
      fail(`Unknown knockout round: ${match.round}`);
    }
    if (!Number.isInteger(match.num)) {
      fail(`Knockout match is missing numeric num: ${JSON.stringify(match)}`);
    }

    return {
      external_ref: `wc2026:ko:${match.num}`,
      home_team: "Por definir",
      away_team: "Por definir",
      home_team_code: null,
      away_team_code: null,
      home_score: null,
      away_score: null,
      match_time: matchTime,
      status: "scheduled",
      matchday: null,
      stage,
      group_label: null,
      bracket_slot: match.num,
      home_source: match.team1,
      away_source: match.team2,
      venue,
    };
  });

  validateUnique(rows.map((row) => row.external_ref), "external_ref");
  validateUnique(
    rows.filter((row) => row.bracket_slot !== null).map((row) => row.bracket_slot),
    "bracket_slot",
  );

  return rows;
}

function validateUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      fail(`Duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

function rowToSql(row) {
  return `(${[
    row.external_ref,
    row.home_team,
    row.away_team,
    row.home_team_code,
    row.away_team_code,
    row.home_score,
    row.away_score,
    row.match_time,
    row.status,
    row.matchday,
    row.stage,
    row.group_label,
    row.bracket_slot,
    row.home_source,
    row.away_source,
    row.venue,
  ]
    .map(sqlString)
    .join(", ")})`;
}

function buildSql(rows) {
  return `-- GENERATED by scripts/generate-worldcup-seed.mjs. Do not edit by hand.
-- Story 7.1: seed del calendario Mundial 2026 desde supabase/seed-data/worldcup-2026.

insert into public.matches (
  external_ref,
  home_team,
  away_team,
  home_team_code,
  away_team_code,
  home_score,
  away_score,
  match_time,
  status,
  matchday,
  stage,
  group_label,
  bracket_slot,
  home_source,
  away_source,
  venue
) values
${rows.map(rowToSql).join(",\n")}
on conflict (external_ref) do update set
  home_team = case
    when public.matches.bracket_slot is not null
      and public.matches.home_team_code is not null
    then public.matches.home_team
    else excluded.home_team
  end,
  away_team = case
    when public.matches.bracket_slot is not null
      and public.matches.away_team_code is not null
    then public.matches.away_team
    else excluded.away_team
  end,
  home_team_code = case
    when public.matches.bracket_slot is not null
      and public.matches.home_team_code is not null
    then public.matches.home_team_code
    else excluded.home_team_code
  end,
  away_team_code = case
    when public.matches.bracket_slot is not null
      and public.matches.away_team_code is not null
    then public.matches.away_team_code
    else excluded.away_team_code
  end,
  match_time = excluded.match_time,
  matchday = excluded.matchday,
  stage = excluded.stage,
  group_label = excluded.group_label,
  bracket_slot = excluded.bracket_slot,
  home_source = excluded.home_source,
  away_source = excluded.away_source,
  venue = excluded.venue;
`;
}

const rows = buildRows();
writeFileSync(outputPath, buildSql(rows), "utf8");
console.log(`Generated ${rows.length} World Cup 2026 matches at ${outputPath}`);

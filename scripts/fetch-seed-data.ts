import { config } from "dotenv";
import { writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  zafronixResponseSchema,
  deriveMatchStatus,
  normalizeStage,
  extractGroupLabel,
  resolveMatchNo,
  normalizeTeamName,
  isPlaceholderTeam,
  type ZafronixMatch,
  type ZafronixTeam,
  type RosterPlayer,
} from "../src/lib/zafronix/matches";
import { TOURNAMENT_PHASES_2026 } from "../src/config/tournamentPhases";
import {
  fetchWithRetry,
  runInBatches,
  computeMatchdays,
  fetchTournamentTeams,
  fetchTeamRoster,
  ZAFRONIX_MATCHES_URL,
} from "./restore-zafronix-data";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const SEED_DIR = join(projectRoot, "supabase", "seed-data", "worldcup-2026");
const MATCHES_FILE = join(SEED_DIR, "matches.json");
const AWARD_CANDIDATES_FILE = join(SEED_DIR, "award_candidates.json");
const PHASES_FILE = join(SEED_DIR, "tournament_phases.json");

interface SeedMatch {
  external_ref: string;
  home_team: string;
  away_team: string;
  home_team_code: string | null;
  away_team_code: string | null;
  home_score: number | null;
  away_score: number | null;
  match_time: string;
  status: string;
  matchday: number | null;
  stage: string | null;
  group_label: string | null;
  bracket_slot: number | null;
  home_source: string | null;
  away_source: string | null;
  venue: string | null;
}

interface SeedAwardCandidate {
  category: string;
  name: string;
  team_name: string | null;
  flag_code: string | null;
  display_order: number;
}

interface SeedPhase {
  phase_code: string;
  reward_points: number;
  starts_at: string | null;
  ends_at: string | null;
  edits_locked: boolean;
  label: string;
  sort_order: number;
}

function transformMatch(
  apiMatch: ZafronixMatch,
  matchday: number | null,
  teamCodeMap: Map<string, string>,
): SeedMatch | null {
  if (!apiMatch.kickoffUtc) return null;

  const mappedStatus = deriveMatchStatus(apiMatch);
  const matchNum = resolveMatchNo(apiMatch);
  const isKnockout = matchNum !== null && matchNum >= 73;
  const homeTeam = apiMatch.homeTeam ?? "";
  const awayTeam = apiMatch.awayTeam ?? "";
  const homeIsReal = !isPlaceholderTeam(homeTeam);
  const awayIsReal = !isPlaceholderTeam(awayTeam);

  return {
    external_ref: apiMatch.id,
    home_team:
      isKnockout && !homeIsReal ? "Por definir" : homeTeam || "Por definir",
    away_team:
      isKnockout && !awayIsReal ? "Por definir" : awayTeam || "Por definir",
    home_team_code: homeTeam
      ? (teamCodeMap.get(normalizeTeamName(homeTeam)) ?? null)
      : null,
    away_team_code: awayTeam
      ? (teamCodeMap.get(normalizeTeamName(awayTeam)) ?? null)
      : null,
    home_source: isKnockout ? (apiMatch.homeRef ?? null) : null,
    away_source: isKnockout ? (apiMatch.awayRef ?? null) : null,
    home_score: apiMatch.homeScore,
    away_score: apiMatch.awayScore,
    match_time: apiMatch.kickoffUtc,
    status: mappedStatus,
    matchday,
    stage: normalizeStage(apiMatch.stage),
    group_label: isKnockout ? null : extractGroupLabel(apiMatch.stage),
    bracket_slot: isKnockout ? matchNum : null,
    venue: apiMatch.stadium ?? null,
  };
}

function transformAwardCandidates(
  teams: ZafronixTeam[],
  rosterMap: Map<string, RosterPlayer[]>,
): SeedAwardCandidate[] {
  const candidates: SeedAwardCandidate[] = [];

  const sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name));
  let champOrder = 0;
  for (const t of sorted) {
    champOrder++;
    candidates.push({
      category: "champion",
      name: t.name,
      team_name: null,
      flag_code: t.iso,
      display_order: champOrder,
    });
  }

  let globalOrder = 0;
  for (const team of sorted) {
    const players = rosterMap.get(team.name) ?? [];
    for (const player of players) {
      globalOrder++;
      candidates.push({
        category: "top_scorer",
        name: player.name,
        team_name: team.name,
        flag_code: team.iso,
        display_order: globalOrder,
      });
      candidates.push({
        category: "mvp",
        name: player.name,
        team_name: team.name,
        flag_code: team.iso,
        display_order: globalOrder,
      });
    }
  }

  return candidates;
}

function transformPhases(): SeedPhase[] {
  return TOURNAMENT_PHASES_2026.map((p, idx) => ({
    phase_code: p.code,
    reward_points: p.rewardPoints,
    starts_at: p.startsAt,
    ends_at: p.endsAt,
    edits_locked: p.editsLocked,
    label: p.label,
    sort_order: idx,
  }));
}

async function main(): Promise<void> {
  if (
    existsSync(MATCHES_FILE) &&
    existsSync(AWARD_CANDIDATES_FILE) &&
    existsSync(PHASES_FILE)
  ) {
    console.log("Seed data files already exist. Skipping API fetch.");
    console.log("To re-fetch, delete these files first:");
    console.log(`  ${MATCHES_FILE}`);
    console.log(`  ${AWARD_CANDIDATES_FILE}`);
    console.log(`  ${PHASES_FILE}`);
    process.exit(0);
  }

  config({ path: ".env.local" });
  config({ path: ".env" });

  const apiKey = process.env.WC_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    console.error("Required env var WC_API_KEY is missing or empty.");
    console.error("Create a .env.local file with:  WC_API_KEY=zwc_pk_...");
    process.exit(1);
  }

  // 1. Fetch matches
  console.log("Fetching matches from Zafronix API...");
  const matchesResponse = await fetchWithRetry(
    ZAFRONIX_MATCHES_URL,
    { headers: { "X-API-Key": apiKey } },
  );

  if (!matchesResponse.ok) {
    const errorBody = await matchesResponse.text().catch(() => "");
    throw new Error(
      `Matches API error: HTTP ${matchesResponse.status} ${matchesResponse.statusText}. Body: ${errorBody}`,
    );
  }

  const rawMatches: unknown = await matchesResponse.json();
  const parsedMatches = zafronixResponseSchema.safeParse(rawMatches);

  if (!parsedMatches.success) {
    throw new Error(
      `Matches validation error: ${JSON.stringify(parsedMatches.error.issues)}`,
    );
  }

  const seenIds = new Set<string>();
  const apiMatches = parsedMatches.data.data.filter((match) => {
    if (seenIds.has(match.id)) {
      console.warn(`Duplicate match ID in API response: ${match.id}. Skipping.`);
      return false;
    }
    seenIds.add(match.id);
    return true;
  });

  console.log(`  ${apiMatches.length} matches fetched.`);

  // 2. Fetch teams
  console.log("Fetching tournament teams...");
  const teams = await fetchTournamentTeams(apiKey);
  console.log(`  ${teams.length} teams fetched.`);

  const teamCodeMap = new Map(
    teams.map((t) => [normalizeTeamName(t.name), t.code]),
  );

  // 3. Compute matchdays
  const matchdayMap = computeMatchdays(apiMatches);

  // 4. Transform matches to DB-ready format
  const seedMatches: SeedMatch[] = [];
  let skipped = 0;
  for (const apiMatch of apiMatches) {
    const row = transformMatch(
      apiMatch,
      matchdayMap.get(apiMatch.id) ?? null,
      teamCodeMap,
    );
    if (row) {
      seedMatches.push(row);
    } else {
      skipped++;
      console.warn(`  Match ${apiMatch.id}: missing kickoffUtc, skipping.`);
    }
  }

  // 5. Fetch rosters for all teams
  console.log("Fetching team rosters...");
  const rosterMap = new Map<string, RosterPlayer[]>();

  await runInBatches(teams, 5, async (team) => {
    const players = await fetchTeamRoster(team.name, apiKey);
    rosterMap.set(team.name, players);
    if (players.length > 0) {
      console.log(`  ${team.name}: ${players.length} players`);
    }
  });

  const totalPlayers = Array.from(rosterMap.values()).reduce(
    (sum, p) => sum + p.length, 0,
  );
  console.log(`  ${totalPlayers} total players across ${rosterMap.size} teams.`);

  // 6. Transform award candidates
  const seedAwardCandidates = transformAwardCandidates(teams, rosterMap);

  // 7. Transform tournament phases
  const seedPhases = transformPhases();

  // 8. Write JSON files
  writeFileSync(MATCHES_FILE, JSON.stringify(seedMatches, null, 2), "utf8");
  writeFileSync(
    AWARD_CANDIDATES_FILE,
    JSON.stringify(seedAwardCandidates, null, 2),
    "utf8",
  );
  writeFileSync(PHASES_FILE, JSON.stringify(seedPhases, null, 2), "utf8");

  console.log(`\nSeed data written to ${SEED_DIR}:`);
  console.log(`  matches.json: ${seedMatches.length} matches (${skipped} skipped)`);
  console.log(
    `  award_candidates.json: ${seedAwardCandidates.length} candidates` +
    ` (champion: ${teams.length}, top_scorer+mvp: ${totalPlayers * 2})`,
  );
  console.log(`  tournament_phases.json: ${seedPhases.length} phases`);
  console.log("\nRun `npm run seed:generate` to produce seed.sql from this data.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

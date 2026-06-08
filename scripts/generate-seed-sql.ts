import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const SEED_DIR = join(projectRoot, "supabase", "seed-data", "worldcup-2026");
const OUTPUT = join(projectRoot, "supabase", "seed.sql");

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

const MATCHES_COLUMNS: (keyof SeedMatch)[] = [
  "external_ref", "home_team", "away_team", "home_team_code", "away_team_code",
  "home_score", "away_score", "match_time", "status", "matchday", "stage",
  "group_label", "bracket_slot", "home_source", "away_source", "venue",
];

const AWARD_COLUMNS: (keyof SeedAwardCandidate)[] = [
  "category", "name", "team_name", "flag_code", "display_order",
];

const PHASE_COLUMNS: (keyof SeedPhase)[] = [
  "phase_code", "reward_points", "starts_at", "ends_at", "edits_locked", "label", "sort_order",
];

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "null";
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  const str = String(value);
  return `'${str.replace(/'/g, "''")}'`;
}

function escapeCol(name: string | number | symbol): string {
  return `"${String(name)}"`;
}

function readJson<T>(path: string, label: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read ${label} from ${path}: ${msg}`);
  }
}

function buildInsert<T>(
  table: string,
  columns: (keyof T)[],
  rows: T[],
  conflictClause: string,
): string {
  const colList = columns.map(escapeCol).join(", ");
  const values = rows.map((row) => {
    const vals = columns.map((col) => sqlValue(row[col]));
    return `(${vals.join(", ")})`;
  });

  return `insert into public.${table} (${colList})
values
${values.join(",\n")}
${conflictClause};`;
}

function validateMatches(matches: SeedMatch[]): void {
  if (matches.length !== 104) {
    throw new Error(`Expected 104 matches, got ${matches.length}`);
  }

  const refs = new Set<string>();
  for (const m of matches) {
    if (refs.has(m.external_ref)) {
      throw new Error(`Duplicate external_ref: ${m.external_ref}`);
    }
    refs.add(m.external_ref);
    if (!m.match_time) {
      throw new Error(`Match ${m.external_ref} has no match_time`);
    }
  }

  const groupMatches = matches.filter((m) => m.group_label !== null);
  const knockoutMatches = matches.filter((m) => m.bracket_slot !== null);

  if (groupMatches.length !== 72) {
    throw new Error(`Expected 72 group matches, got ${groupMatches.length}`);
  }
  if (knockoutMatches.length !== 32) {
    throw new Error(`Expected 32 knockout matches, got ${knockoutMatches.length}`);
  }

  const groupCounts = new Map<string, number>();
  for (const m of groupMatches) {
    const g = m.group_label!;
    groupCounts.set(g, (groupCounts.get(g) ?? 0) + 1);
  }
  for (const [g, count] of groupCounts) {
    if (count !== 6) {
      throw new Error(`Group ${g} has ${count} matches, expected 6`);
    }
  }

  const slots = new Set<number>();
  for (const m of knockoutMatches) {
    const slot = m.bracket_slot!;
    if (slots.has(slot)) {
      throw new Error(`Duplicate bracket_slot ${slot}`);
    }
    slots.add(slot);
  }
}

function validateAwardCandidates(candidates: SeedAwardCandidate[]): void {
  const champions = candidates.filter((c) => c.category === "champion");
  const topScorers = candidates.filter((c) => c.category === "top_scorer");
  const mvps = candidates.filter((c) => c.category === "mvp");

  if (champions.length !== 48) {
    throw new Error(`Expected 48 champion candidates, got ${champions.length}`);
  }
  if (topScorers.length === 0) {
    throw new Error("No top_scorer candidates found");
  }
  if (mvps.length === 0) {
    throw new Error("No mvp candidates found");
  }
}

function validatePhases(phases: SeedPhase[]): void {
  if (phases.length !== 4) {
    throw new Error(`Expected 4 tournament phases, got ${phases.length}`);
  }

  const codes = new Set(phases.map((p) => p.phase_code));
  const expected = new Set(["A", "B", "C", "D"]);
  if (![...expected].every((c) => codes.has(c))) {
    throw new Error(`Missing phase codes. Expected A,B,C,D, got ${[...codes].join(",")}`);
  }
}

function buildSql(
  matches: SeedMatch[],
  candidates: SeedAwardCandidate[],
  phases: SeedPhase[],
): string {
  const lines: string[] = [
    "-- GENERATED by scripts/generate-seed-sql.ts. Do not edit by hand.",
    "-- World Cup 2026 seed data sourced from Zafronix API.",
    "",
    "-- ============================================================",
    "-- 1. Tournament phases (A-D from src/config/tournamentPhases.ts)",
    "-- ============================================================",
    buildInsert("tournament_phases", PHASE_COLUMNS, phases, "on conflict (phase_code) do nothing"),
    "",
    "-- ============================================================",
    "-- 2. Award candidates (champion / top_scorer / mvp)",
    "-- DELETE + INSERT ensures idempotency on re-seed.",
    "-- ============================================================",
    "delete from public.award_candidates;",
    buildInsert("award_candidates", AWARD_COLUMNS, candidates, ""),
    "",
    "-- ============================================================",
    `-- 3. Matches (${matches.length} rows: ${matches.filter(m => m.group_label).length} group + ${matches.filter(m => m.bracket_slot).length} knockout)`,
    "-- ============================================================",
    buildInsert("matches", MATCHES_COLUMNS, matches, "on conflict (external_ref) do nothing"),
    "",
  ];

  return lines.join("\n");
}

function main(): void {
  const matches = readJson<SeedMatch[]>(
    join(SEED_DIR, "matches.json"),
    "matches",
  );
  const candidates = readJson<SeedAwardCandidate[]>(
    join(SEED_DIR, "award_candidates.json"),
    "award_candidates",
  );
  const phases = readJson<SeedPhase[]>(
    join(SEED_DIR, "tournament_phases.json"),
    "tournament_phases",
  );

  validateMatches(matches);
  validateAwardCandidates(candidates);
  validatePhases(phases);

  const sql = buildSql(matches, candidates, phases);
  writeFileSync(OUTPUT, sql, "utf8");

  console.log(`Generated ${OUTPUT}`);
  console.log(`  Matches: ${matches.length}`);
  console.log(`  Award candidates: ${candidates.length}`);
  console.log(`  Tournament phases: ${phases.length}`);
}

main();

/**
 * scripts/verify-zafronix-schema.ts
 *
 * Script de diagnóstico: consulta los 3 endpoints de Zafronix que usa el
 * proyecto y reporta la compatibilidad de cada campo contra los schemas Zod
 * actuales. Vuelca las respuestas reales a fixtures para referencia futura.
 *
 * Uso: npm run verify-zafronix-schema
 *      npx tsx scripts/verify-zafronix-schema.ts
 *
 * Requiere: WC_API_KEY en .env o .env.local
 */

import { config } from "dotenv";
import { z } from "zod";

// Interfaces locales para narrowing seguro de respuestas JSON sin usar `any`
interface ApiEnvelope {
  data?: ApiMatch[];
}
interface ApiMatch {
  id?: string;
  matchNo?: number | null;
  kickoffUtc?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  result?: string | null;
  referee?: string | { name?: string; country?: string } | null;
  [key: string]: unknown;
}
interface TournamentTeam {
  name?: string;
  iso?: string | null;
  code?: string;
  [key: string]: unknown;
}
interface TournamentEnvelope {
  teams?: TournamentTeam[];
}
interface RosterPlayer {
  name?: string;
  position?: string | null;
  jersey?: number | null;
  [key: string]: unknown;
}

// Cargar variables de entorno
config({ path: ".env.local" });
config({ path: ".env" });

// ── Constantes ──────────────────────────────────────────────────────

const BASE_URL = "https://api.zafronix.com/fifa/worldcup/v1";
const MATCHES_URL = `${BASE_URL}/matches?year=2026`;
const TOURNAMENT_URL = `${BASE_URL}/tournaments/2026`;
const ROSTER_URL = (team: string) =>
  `${BASE_URL}/teams/${encodeURIComponent(team)}/roster?year=2026`;

// ── Schemas (importados del módulo canónico) ────────────────────────

import {
  zafronixMatchSchema as currentMatchSchema,
  zafronixResponseSchema as currentMatchesResponseSchema,
  tournamentTeamsSchema as currentTournamentTeamsSchema,
  rosterPlayerSchema as currentRosterPlayerSchema,
} from "../src/lib/zafronix/matches";

// ── Helpers ─────────────────────────────────────────────────────────

interface FieldReport {
  field: string;
  expectedType: string;
  actualType: string;
  sampleValue: unknown;
  status: "ok" | "missing" | "type_mismatch" | "extra";
}

interface EndpointReport {
  endpoint: string;
  overallStatus: "pass" | "fail" | "partial";
  issues: FieldReport[];
  rawSampleFirst: unknown;
  rawSampleLast?: unknown;
  specialFields: Record<string, unknown[]>;
}

async function fetchWithRetry(
  url: string,
  apiKey: string,
  retries = 3,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, {
        headers: { "X-API-Key": apiKey },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      lastErr = err;
      if (attempt < retries) {
        console.warn(`  Reintento ${attempt}/${retries}...`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  throw lastErr;
}

function getType(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (Array.isArray(val)) return "array";
  return typeof val;
}

function analyzeField(
  field: string,
  schemaShape: Record<string, z.ZodTypeAny>,
  realMatch: Record<string, unknown>,
): FieldReport {
  const schemaField = schemaShape[field];
  const realValue = realMatch[field];
  const realType = getType(realValue);
  const expectedType = (schemaField as { _def?: { typeName?: string } })?._def?.typeName ?? "not_in_schema";

  if (!schemaField) {
    return {
      field,
      expectedType: "not_in_schema",
      actualType: realType,
      sampleValue: realValue,
      status: "extra",
    };
  }

  if (!(field in realMatch)) {
    return {
      field,
      expectedType,
      actualType: "missing",
      sampleValue: undefined,
      status: "missing",
    };
  }

  // Validate with individual schema
  const result = schemaField.safeParse(realValue);
  if (!result.success) {
    return {
      field,
      expectedType,
      actualType: realType,
      sampleValue: realValue,
      status: "type_mismatch",
    };
  }

  return {
    field,
    expectedType,
    actualType: realType,
    sampleValue: realValue,
    status: "ok",
  };
}

// ── Verificación por endpoint ───────────────────────────────────────

async function verifyMatchesEndpoint(
  apiKey: string,
): Promise<EndpointReport> {
  console.log("\n━━━ GET /matches?year=2026 ━━━━━━━━━━━━━━━━━━━━━━━━━");
  const res = await fetchWithRetry(MATCHES_URL, apiKey);
  const raw: unknown = await res.json();

  console.log(`  HTTP ${res.status} | ETag: ${res.headers.get("etag") ?? "none"}`);
  console.log(`  RateLimit-Remaining: ${res.headers.get("x-ratelimit-remaining") ?? "N/A"}`);

  const parseResult = currentMatchesResponseSchema.safeParse(raw);
  const envelopeOk = parseResult.success;
  console.log(`  Envelope validation: ${envelopeOk ? "PASS" : "FAIL"}`);
  if (!envelopeOk) {
    console.log(`  Zod errors: ${JSON.stringify(parseResult.error?.issues)}`);
  }

  const data: ApiMatch[] = (raw as ApiEnvelope)?.data ?? [];
  console.log(`  Match count: ${data.length}`);

  // Analyze first, last, and a finished match
  const first = data[0] as Record<string, unknown> | undefined;
  const last = data[data.length - 1] as Record<string, unknown> | undefined;

  const issues: FieldReport[] = [];
  const specialFields: Record<string, unknown[]> = {
    result_values: [],
    referee_types: [],
    matchNo_present: [],
    kickoffUtc_present: [],
  };

  // Analyze first match
  if (first) {
    const schemaShape = currentMatchSchema.shape as Record<string, z.ZodTypeAny>;
    for (const field of Object.keys(schemaShape)) {
      issues.push(analyzeField(field, schemaShape, first));
    }
    for (const field of Object.keys(first)) {
      if (!(field in schemaShape)) {
        issues.push(analyzeField(field, schemaShape, first));
      }
    }
  }

  // Collect special fields across all matches
  const resultValues = specialFields.result_values ?? [];
  const refereeTypes = specialFields.referee_types ?? [];
  const matchNoPresent = specialFields.matchNo_present ?? [];
  const kickoffUtcPresent = specialFields.kickoffUtc_present ?? [];
  for (const m of data as Record<string, unknown>[]) {
    if (m.result !== undefined && m.result !== null) {
      const val = String(m.result);
      if (!resultValues.includes(val)) {
        resultValues.push(val);
      }
    }
    if (m.referee !== undefined && m.referee !== null) {
      const t = getType(m.referee);
      const label = t === "object" ? `object{${Object.keys(m.referee as object).join(",")}}` : `${t}:${JSON.stringify(m.referee)}`;
      if (!refereeTypes.includes(label)) {
        refereeTypes.push(label);
      }
    }
    matchNoPresent.push(m.matchNo);
    kickoffUtcPresent.push(m.kickoffUtc);
  }
  specialFields.result_values = resultValues;
  specialFields.referee_types = refereeTypes;
  specialFields.matchNo_present = matchNoPresent;
  specialFields.kickoffUtc_present = kickoffUtcPresent;

  const overallStatus = envelopeOk && issues.every((i) => i.status === "ok")
    ? "pass"
    : envelopeOk
      ? "partial"
      : "fail";

  return {
    endpoint: "GET /matches?year=2026",
    overallStatus,
    issues,
    rawSampleFirst: first ?? null,
    rawSampleLast: last ?? null,
    specialFields,
  };
}

async function verifyTournamentEndpoint(
  apiKey: string,
): Promise<EndpointReport> {
  console.log("\n━━━ GET /tournaments/2026 ━━━━━━━━━━━━━━━━━━━━━━━━━");
  const res = await fetchWithRetry(TOURNAMENT_URL, apiKey);
  const raw: unknown = await res.json();

  console.log(`  HTTP ${res.status}`);

  const parseResult = currentTournamentTeamsSchema.safeParse(raw);
  const ok = parseResult.success;
  console.log(`  Schema validation: ${ok ? "PASS" : "FAIL"}`);
  if (!ok) {
    console.log(`  Zod errors: ${JSON.stringify(parseResult.error?.issues)}`);
  }

  const teams = (raw as TournamentEnvelope)?.teams ?? [];
  console.log(`  Team count: ${teams.length}`);

  // Check all teams have required fields
  const issues: FieldReport[] = [];
  for (let i = 0; i < Math.min(teams.length, 3); i++) {
    const t = teams[i] as Record<string, unknown>;
    if (!t.name || typeof t.name !== "string") {
      issues.push({ field: `teams[${i}].name`, expectedType: "string", actualType: getType(t.name), sampleValue: t.name, status: "type_mismatch" });
    }
    if (!t.code || typeof t.code !== "string") {
      issues.push({ field: `teams[${i}].code`, expectedType: "string", actualType: getType(t.code), sampleValue: t.code, status: "type_mismatch" });
    }
  }

  const allHaveCode = teams.every((t: TournamentTeam) => typeof t.code === "string" && (t.code as string).length > 0);
  if (!allHaveCode) {
    issues.push({ field: "teams[*].code", expectedType: "string", actualType: "missing_in_some", sampleValue: null, status: "missing" });
  }

  const isoValues = new Set(teams.filter((t: TournamentTeam) => t.iso !== null && t.iso !== undefined).map((t: TournamentTeam) => t.iso));
  const nullIsoCount = teams.filter((t: TournamentTeam) => t.iso === null || t.iso === undefined).length;

  const specialFields: Record<string, unknown[]> = {
    iso_sample: [...isoValues].slice(0, 5),
    null_iso_count: [nullIsoCount],
    extra_top_level_keys: Object.keys(raw as object).filter((k) => k !== "teams"),
  };

  return {
    endpoint: "GET /tournaments/2026",
    overallStatus: ok ? "pass" : "fail",
    issues,
    rawSampleFirst: teams[0] ?? null,
    specialFields,
  };
}

async function verifyRosterEndpoint(
  apiKey: string,
  teamName: string,
): Promise<EndpointReport> {
  console.log(`\n━━━ GET /teams/${teamName}/roster?year=2026 ━━━━━`);
  const res = await fetchWithRetry(ROSTER_URL(teamName), apiKey);
  const raw = (await res.json()) as RosterPlayer[];

  console.log(`  HTTP ${res.status}`);

  if (!Array.isArray(raw)) {
    return {
      endpoint: `GET /teams/${teamName}/roster?year=2026`,
      overallStatus: "fail",
      issues: [{
        field: "top_level",
        expectedType: "array",
        actualType: getType(raw),
        sampleValue: raw,
        status: "type_mismatch",
      }],
      rawSampleFirst: raw,
      specialFields: {},
    };
  }

  console.log(`  Player count: ${raw.length}`);

  // Validate each player
  let ok = true;
  const issues: FieldReport[] = [];
  for (let i = 0; i < Math.min(raw.length, 3); i++) {
    const p = raw[i] as Record<string, unknown>;
    const result = currentRosterPlayerSchema.safeParse(p);
    if (!result.success) {
      ok = false;
      issues.push({
        field: `players[${i}]`,
        expectedType: "RosterPlayer",
        actualType: JSON.stringify(result.error?.issues),
        sampleValue: p,
        status: "type_mismatch",
      });
    }
  }

  // Count extra fields not in our schema
  const ourFields = ["name", "position", "jersey"];
  const extraFields = new Set<string>();
  for (const p of raw.slice(0, 3)) {
    for (const k of Object.keys(p as object)) {
      if (!ourFields.includes(k)) extraFields.add(k);
    }
  }

  const allHaveName = raw.every((p: RosterPlayer) => typeof p.name === "string" && (p.name as string).length > 0);

  return {
    endpoint: `GET /teams/${teamName}/roster?year=2026`,
    overallStatus: ok ? "pass" : "fail",
    issues,
    rawSampleFirst: raw[0] ?? null,
    specialFields: {
      extra_fields: [...extraFields],
      all_have_name: [allHaveName],
      total_players: [raw.length],
    },
  };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.WC_API_KEY;
  if (!apiKey) {
    console.error("❌ WC_API_KEY not found in .env or .env.local");
    process.exit(1);
  }

  console.log("🔍 Zafronix Schema Verification\n");
  console.log(`   API Key: ${apiKey.slice(0, 8)}...`);
  console.log(`   Base URL: ${BASE_URL}`);

  const reports: EndpointReport[] = [];

  try {
    // 1. Matches
    reports.push(await verifyMatchesEndpoint(apiKey));

    // 2. Tournament
    reports.push(await verifyTournamentEndpoint(apiKey));

    // 3. Roster (use first team from tournament)
    const tourneyRes = await fetchWithRetry(TOURNAMENT_URL, apiKey);
    const tourneyRaw: unknown = await tourneyRes.json();
    const firstTeam = (tourneyRaw as TournamentEnvelope)?.teams?.[0]?.name;
    if (firstTeam) {
      reports.push(await verifyRosterEndpoint(apiKey, firstTeam));
    } else {
      console.log("\n⚠️  Skipping roster verification: no teams found in /tournaments/2026");
    }
  } catch (err) {
    console.error("\n❌ Fatal error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // ── Summary ───────────────────────────────────────────────────────

  console.log("\n\n══════════════════════════════════════════════════════");
  console.log("  VERIFICATION SUMMARY");
  console.log("══════════════════════════════════════════════════════\n");

  for (const report of reports) {
    const icon = report.overallStatus === "pass" ? "✅" : report.overallStatus === "partial" ? "⚠️" : "❌";
    console.log(`${icon} ${report.endpoint}: ${report.overallStatus.toUpperCase()}`);

    if (report.issues.length > 0) {
      console.log("   Field issues:");
      for (const issue of report.issues) {
        const s = issue.status === "ok" ? "  " : issue.status === "extra" ? "➕" : "🔴";
        console.log(`     ${s} ${issue.field.padEnd(20)} | expected: ${issue.expectedType.padEnd(16)} | actual: ${String(issue.actualType).padEnd(16)} | sample: ${JSON.stringify(issue.sampleValue)?.slice(0, 60)}`);
      }
    }

    // Special fields for matches
    if (report.specialFields.result_values?.length) {
      console.log(`   🎯 result values found: [${(report.specialFields.result_values as string[]).join(", ")}]`);
    }
    if (report.specialFields.referee_types?.length) {
      console.log(`   🎯 referee types found: [${(report.specialFields.referee_types as string[]).join(", ")}]`);
    }
    const matchNoAll = report.specialFields.matchNo_present as unknown[];
    if (matchNoAll?.length) {
      const present = matchNoAll.filter((v) => v !== undefined && v !== null).length;
      const absent = matchNoAll.filter((v) => v === undefined || v === null).length;
      console.log(`   🎯 matchNo: ${present} present, ${absent} absent (of ${matchNoAll.length})`);
    }
    const kickoffAll = report.specialFields.kickoffUtc_present as unknown[];
    if (kickoffAll?.length) {
      const present = kickoffAll.filter((v) => v !== undefined && v !== null).length;
      const absent = kickoffAll.filter((v) => v === undefined || v === null).length;
      console.log(`   🎯 kickoffUtc: ${present} present, ${absent} absent (of ${kickoffAll.length})`);
    }

    // Extra fields found in roster/tournament
    if (report.specialFields.extra_fields?.length) {
      console.log(`   🎯 Extra fields (not in our schema): [${(report.specialFields.extra_fields as string[]).join(", ")}]`);
    }
    if (report.specialFields.extra_top_level_keys?.length) {
      console.log(`   🎯 Extra top-level keys: [${(report.specialFields.extra_top_level_keys as string[]).join(", ")}]`);
    }

    console.log("");
  }

  // Overall verdict
  const allPass = reports.every((r) => r.overallStatus === "pass");
  const allFail = reports.every((r) => r.overallStatus === "fail");
  if (allPass) {
    console.log("🏆 VERDICT: All schemas match the real API. No changes needed.");
  } else if (allFail) {
    console.log("💥 VERDICT: All schemas FAIL against the real API. Urgent fixes required.");
  } else {
    console.log("🔧 VERDICT: Some schemas need adjustments. Review the issues above.");
  }
}

main();

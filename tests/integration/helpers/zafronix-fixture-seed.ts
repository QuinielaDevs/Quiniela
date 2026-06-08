/**
 * tests/integration/helpers/zafronix-fixture-seed.ts
 *
 * Helper de seed para tests de integración: genera 104 partidos del Mundial
 * 2026 con la misma forma/estructura que produce `restoreZafronixData`
 * (12 grupos × 6 + 32 eliminatorias = 104), sin llamar a la API ni a Zod.
 *
 * Por qué existe:
 *   - El seed SQL original (`20260604131000_seed_worldcup_2026.sql`) está
 *     deshabilitado (migrado a seed vía API). Varios tests de integración
 *     necesitan 104 partidos en la DB con la forma correcta.
 *   - Llamar a `restoreZafronixData` con fetch mockeado en cada `beforeAll`
 *     es overkill: corre Zod, normalización, runInBatches, scoring.
 *   - Este helper hace UN solo bulk insert con datos generados
 *     programáticamente: ~50× más rápido y sin red ni validación.
 *
 * Trade-off: los nombres son `Team A1`, `Team A2` (placeholders). Los tests
 * que validan FORMA (knockout-advancement, tournament-phases-contract) no
 * los necesitan; los tests que validan DATOS usan fixtures inline.
 *
 * Cobertura end-to-end de `restoreZafronixData` está en
 * `tests/integration/restore-zafronix-seed.test.ts` (UN test con mock).
 *
 * Ver: docs/zafronix-api-unification.md sección 5.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Prefijo para que cleanup sea trivial y no choque con otros seeds. */
export const ZAFRONIX_FIXTURE_PREFIX = "test-fixture-zfx-";

/** Inicio del Mundial 2026 (UTC). */
const INAUGURAL_KICKOFF = "2026-06-11T19:00:00.000Z";

/** Minutos entre partidos del mismo grupo/matchday. */
const GROUP_MATCH_GAP_MIN = 180; // 3 horas
/** Días entre matchdays de grupo. */
const MATCHDAY_GAP_DAYS = 4;
/** Días entre la última jornada de grupos y la primera de eliminatorias. */
const GROUP_TO_KNOCKOUT_GAP_DAYS = 4;

/** Stage de cada rango de eliminatorias, con `homeSource`/`awaySource`
 *  en formato FIFA para que `calculateTournamentAdvancement` pueda
 *  resolver los equipos desde las tablas de grupos. Patrón simplificado:
 *  round-32 = 1X vs 2Y (top-2 de grupos adyacentes), round-16 = W(prev) vs
 *  W(prev), etc. Suficiente para que el motor resuelva al menos un equipo. */
const KNOCKOUT_STAGES: ReadonlyArray<{
  range: readonly [number, number];
  stage: "round-32" | "round-16" | "quarter" | "semi" | "third-place" | "final";
}> = [
  { range: [73, 88], stage: "round-32" },
  { range: [89, 96], stage: "round-16" },
  { range: [97, 100], stage: "quarter" },
  { range: [101, 102], stage: "semi" },
  { range: [103, 103], stage: "third-place" },
  { range: [104, 104], stage: "final" },
];

/** Devuelve los FIFA bracket source codes (e.g. "1A", "2B", "W73") para
 *  una eliminatoria en `bracketSlot`, de modo que el motor de avance pueda
 *  resolver el equipo desde la fase previa. */
function knockoutSources(bracketSlot: number): { homeSource: string; awaySource: string } {
  // Round of 32: 16 partidos. Emparejamos top-2 de grupos adyacentes.
  if (bracketSlot >= 73 && bracketSlot <= 88) {
    const idx = bracketSlot - 73; // 0..15
    const homeGroup = String.fromCharCode(65 + (idx % 12)); // A..L
    const awayGroup = String.fromCharCode(65 + ((idx + 4) % 12));
    return { homeSource: `1${homeGroup}`, awaySource: `2${awayGroup}` };
  }
  // Round of 16: 8 partidos. Source = ganador del match previo.
  if (bracketSlot >= 89 && bracketSlot <= 96) {
    const prevSlot = 73 + (bracketSlot - 89) * 2;
    return { homeSource: `W${prevSlot}`, awaySource: `W${prevSlot + 1}` };
  }
  // Quarter-finals: 4 partidos.
  if (bracketSlot >= 97 && bracketSlot <= 100) {
    const prevSlot = 89 + (bracketSlot - 97) * 2;
    return { homeSource: `W${prevSlot}`, awaySource: `W${prevSlot + 1}` };
  }
  // Semi-finals: 2 partidos.
  if (bracketSlot >= 101 && bracketSlot <= 102) {
    const prevSlot = 97 + (bracketSlot - 101) * 2;
    return { homeSource: `W${prevSlot}`, awaySource: `W${prevSlot + 1}` };
  }
  // Third-place play-off.
  if (bracketSlot === 103) {
    return { homeSource: "L101", awaySource: "L102" };
  }
  // Final.
  return { homeSource: "W101", awaySource: "W102" };
}

interface FixtureMatchRow {
  external_ref: string;
  home_team: string;
  away_team: string;
  home_team_code: string | null;
  away_team_code: string | null;
  home_score: null;
  away_score: null;
  match_time: string;
  status: "scheduled";
  matchday: number | null;
  stage: string;
  group_label: string | null;
  bracket_slot: number | null;
  home_source: string | null;
  away_source: string | null;
  venue: string;
}

/**
 * Convierte minutos desde INAUGURAL_KICKOFF a un ISO string UTC.
 * Helper interno para calcular `match_time` de cada partido.
 */
function isoFromOffsetMinutes(minutes: number): string {
  const base = new Date(INAUGURAL_KICKOFF).getTime();
  return new Date(base + minutes * 60_000).toISOString();
}

/**
 * Genera las 104 filas de partidos con la estructura esperada por
 * `restoreZafronixData` (mismos campos, mismos stages normalizados,
 * misma distribución 72 grupos + 32 eliminatorias).
 *
 * Estructura de grupos: 4 equipos por grupo, 6 partidos (3 jornadas × 2):
 *   - Matchday 1: A1-A2, A3-A4
 *   - Matchday 2: A1-A3, A2-A4
 *   - Matchday 3: A1-A4, A2-A3
 * Esto satisface el invariante de `calculateTournamentAdvancement` que
 * requiere 4 equipos únicos por grupo.
 */
export function generateZafronixFixtureMatches(): FixtureMatchRow[] {
  const matches: FixtureMatchRow[] = [];

  // Parejas de cada jornada en un grupo de 4 equipos.
  // 6 partidos por grupo (3 jornadas × 2 partidos).
  const GROUP_PAIRINGS: ReadonlyArray<readonly [number, number]> = [
    [1, 2], [3, 4], // matchday 1
    [1, 3], [2, 4], // matchday 2
    [1, 4], [2, 3], // matchday 3
  ];

  for (let g = 0; g < 12; g++) {
    const groupLabel = String.fromCharCode(65 + g); // A..L
    for (let matchday = 1; matchday <= 3; matchday++) {
      // 2 partidos por jornada.
      const matchdayOffsetMin =
        (g * 6 + (matchday - 1) * 2) * (GROUP_MATCH_GAP_MIN / 60) +
        (matchday - 1) * MATCHDAY_GAP_DAYS * 24 * 60;
      for (let m = 0; m < 2; m++) {
        const matchNo = g * 6 + (matchday - 1) * 2 + m + 1;
        const [homeTeamNum, awayTeamNum] = GROUP_PAIRINGS[(matchday - 1) * 2 + m]!;
        matches.push({
          external_ref: `${ZAFRONIX_FIXTURE_PREFIX}${String(matchNo).padStart(3, "0")}`,
          home_team: `Team ${groupLabel}${homeTeamNum}`,
          away_team: `Team ${groupLabel}${awayTeamNum}`,
          home_team_code: `T${groupLabel}${homeTeamNum}`,
          away_team_code: `T${groupLabel}${awayTeamNum}`,
          home_score: null,
          away_score: null,
          match_time: isoFromOffsetMinutes(matchdayOffsetMin + m * 90),
          status: "scheduled",
          matchday,
          stage: "group",
          group_label: groupLabel,
          bracket_slot: null,
          home_source: null,
          away_source: null,
          venue: `Venue ${groupLabel}`,
        });
      }
    }
  }

  // 32 partidos eliminatorios. Los kickoffs empiezan tras la última jornada
  // de grupos (offset = 12 grupos × 3 jornadas × 2 partidos × 3h ≈ 216h)
  // más GROUP_TO_KNOCKOUT_GAP_DAYS.
  const knockoutBaseOffsetMin =
    12 * 6 * (GROUP_MATCH_GAP_MIN / 60) +
    GROUP_TO_KNOCKOUT_GAP_DAYS * 24 * 60;

  for (const { range, stage } of KNOCKOUT_STAGES) {
    for (let matchNo = range[0]; matchNo <= range[1]; matchNo++) {
      // Offset dentro del bloque knockout: 4h entre partidos, agrupados por stage.
      const offsetWithinStageMin = (matchNo - range[0]) * 240;
      const stageBaseOffsetMin =
        knockoutBaseOffsetMin +
        KNOCKOUT_STAGES.findIndex((s) => s.stage === stage) * 24 * 60 * 2;
      const sources = knockoutSources(matchNo);
      matches.push({
        external_ref: `${ZAFRONIX_FIXTURE_PREFIX}${String(matchNo).padStart(3, "0")}`,
        home_team: "Por definir",
        away_team: "Por definir",
        home_team_code: null,
        away_team_code: null,
        home_score: null,
        away_score: null,
        match_time: isoFromOffsetMinutes(stageBaseOffsetMin + offsetWithinStageMin),
        status: "scheduled",
        matchday: null,
        stage,
        group_label: null,
        bracket_slot: matchNo,
        home_source: sources.homeSource,
        away_source: sources.awaySource,
        venue: `Knockout Venue ${matchNo}`,
      });
    }
  }

  return matches;
}

/**
 * Puebla la DB con los 104 partidos del fixture. Idempotente: borra
 * cualquier partido previo en el rango 1-104 (de cualquier formato
 * `external_ref`) antes de insertar, para evitar violaciones del
 * unique constraint `idx_matches_bracket_slot_unique` y de
 * `external_ref` cuando hay residuos de corridas anteriores.
 *
 * @param admin Cliente de Supabase con service_role (bypassa RLS).
 * @returns Conteo de partidos insertados (debe ser 104).
 */
export async function seedZafronixFixture(
  admin: SupabaseClient,
): Promise<{ inserted: number }> {
  await cleanupZafronixFixture(admin);

  const rows = generateZafronixFixtureMatches();
  // Supabase soporta hasta 1000 filas por insert; 104 entra en una sola.
  const { error } = await admin.from("matches").insert(rows);
  if (error) {
    throw new Error(`seedZafronixFixture failed: ${error.message}`);
  }
  return { inserted: rows.length };
}

/**
 * Borra partidos en el rango 1-104 del Mundial 2026 por `bracket_slot`
 * (eliminatorias) o `matchday` (grupos con datos del fixture). Es más
 * agresivo que filtrar por prefijo: limpia residuos de tests previos que
 * usaron formato `external_ref` distinto (Zafronix `2026-073`, SQL
 * antiguo `wc2026:grp:*`, etc.).
 *
 * ADVERTENCIA: usar solo en suites de test que asumen control exclusivo
 * del rango 1-104 de partidos. NO invocar en producción.
 */
export async function cleanupZafronixFixture(admin: SupabaseClient): Promise<void> {
  // Borrar por rango de bracket_slot (eliminatorias 73-104).
  const { error: e1 } = await admin
    .from("matches")
    .delete()
    .gte("bracket_slot", 73)
    .lte("bracket_slot", 104);
  if (e1) {
    throw new Error(`cleanupZafronixFixture (bracket) failed: ${e1.message}`);
  }
  // Borrar por external_ref con el prefijo del fixture y por formato
  // Zafronix `2026-NNN` para los grupos (1-72).
  const { error: e2 } = await admin
    .from("matches")
    .delete()
    .or(
      `external_ref.like.${ZAFRONIX_FIXTURE_PREFIX}%,` +
        `external_ref.like.2026-0%,` +
        `external_ref.like.wc2026:%`,
    );
  if (e2) {
    throw new Error(`cleanupZafronixFixture (refs) failed: ${e2.message}`);
  }
}

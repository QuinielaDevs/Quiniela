/**
 * scripts/sync-matches.ts
 *
 * Story 8.2 — Sincronización Periódica de Respaldo con ETags.
 *
 * Script autónomo ejecutado por un cron job de GitHub Actions cada 30 minutos.
 * Realiza una solicitud condicional (If-None-Match) a la API de Zafronix
 * para sincronizar marcadores del Mundial 2026 sin agotar la cuota gratuita.
 *
 * Uso local:  npm run sync-matches          (requiere .env.local o variables de entorno)
 * Uso CI:     npx tsx scripts/sync-matches.ts  (variables inyectadas por GitHub Actions)
 */

import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// ── Cargar variables de entorno (solo relevante en ejecución local) ──
config({ path: ".env.local" });
config({ path: ".env" });

// ── Constantes ──────────────────────────────────────────────────────

const ZAFRONIX_API_URL =
  "https://api.zafronix.com/fifa/worldcup/v1/matches?year=2026";
const ETAG_CONFIG_KEY = "zafronix_matches_etag";

// ── Zod Schemas ─────────────────────────────────────────────────────

/**
 * Schema para un partido individual de la respuesta de la API de Zafronix.
 * El endpoint GET /matches?year=2026 retorna un array de estos objetos.
 */
const zafronixMatchSchema = z.object({
  id: z.string(), // external_ref en nuestra DB
  homeTeam: z.string(),
  awayTeam: z.string(),
  homeScore: z.number().int().nonnegative().nullable(),
  awayScore: z.number().int().nonnegative().nullable(),
  status: z.string(),
  stage: z.string().optional(),
  bracketSlot: z.number().int().nullable().optional(),
});

const zafronixResponseSchema = z.array(zafronixMatchSchema);

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Mapea el status de la API de Zafronix a los status válidos de nuestra DB.
 * La DB acepta: 'scheduled' | 'live' | 'finished' | 'suspended' | 'canceled'.
 */
function mapApiStatus(
  apiStatus: string,
): "scheduled" | "live" | "finished" | "suspended" | "canceled" {
  switch (apiStatus.toLowerCase()) {
    case "finished":
    case "completed":
      return "finished";
    case "live":
    case "in_progress":
    case "in-progress":
      return "live";
    case "suspended":
    case "postponed":
      return "suspended";
    case "canceled":
    case "cancelled":
    case "abandoned":
      return "canceled";
    case "scheduled":
    default:
      return "scheduled";
  }
}

// ── Funciones principales exportadas para testing ───────────────────

/**
 * Obtiene el ETag almacenado en la base de datos.
 * Retorna null si no existe ningún ETag guardado.
 */
export async function getStoredETag(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("system_config")
    .select("value")
    .eq("key", ETAG_CONFIG_KEY)
    .maybeSingle();

  if (error) {
    console.error("Error al leer ETag de system_config:", error.message);
    return null;
  }

  return data?.value ?? null;
}

/**
 * Guarda o actualiza el ETag en la base de datos.
 */
export async function saveETag(
  supabase: SupabaseClient,
  etag: string,
): Promise<void> {
  const { error } = await supabase.from("system_config").upsert(
    {
      key: ETAG_CONFIG_KEY,
      value: etag,
      description: "ETag de la última respuesta 200 de Zafronix matches API",
    },
    { onConflict: "key" },
  );

  if (error) {
    throw new Error(`Error al guardar ETag en system_config: ${error.message}`);
  }
}

/**
 * Ejecuta la lógica de sincronización principal.
 * Exportada como función para facilitar el testing sin depender de process.exit.
 *
 * @returns Un objeto con el resultado de la sincronización:
 *   - { status: "not_modified" } si la API respondió 304
 *   - { status: "updated", updated: number } si hubo cambios
 *   - Lanza un error en caso de fallo
 */
export async function syncMatches(
  supabase: SupabaseClient,
  apiKey: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ status: "not_modified" } | { status: "updated"; updated: number }> {
  // 1. Consultar el ETag anterior de la base de datos
  const storedETag = await getStoredETag(supabase);

  // 2. Preparar cabeceras de la solicitud
  const headers: Record<string, string> = {
    "X-API-Key": apiKey,
  };
  if (storedETag) {
    headers["If-None-Match"] = storedETag;
  }

  // 3. Realizar la solicitud a la API de Zafronix
  const response = await fetchFn(ZAFRONIX_API_URL, { headers });

  // 4. Procesar según status de respuesta
  if (response.status === 304) {
    console.log(
      "✅ 304 Not Modified — No hay cambios en la API. Sin consumo de cuota.",
    );
    return { status: "not_modified" };
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `Error de la API de Zafronix: HTTP ${response.status} ${response.statusText}. Body: ${errorBody}`,
    );
  }

  // 5. Respuesta 200 OK — Procesar cambios
  const newETag =
    response.headers.get("etag") || response.headers.get("ETag");

  // 6. Parsear y validar el body JSON
  const rawBody = await response.json();
  const parseResult = zafronixResponseSchema.safeParse(rawBody);

  if (!parseResult.success) {
    throw new Error(
      `Error de validación del body de la API: ${JSON.stringify(parseResult.error.issues)}`,
    );
  }

  const apiMatches = parseResult.data;

  // 7. Consultar todos los partidos locales para comparar
  const { data: localMatches, error: fetchError } = await supabase
    .from("matches")
    .select(
      "id, external_ref, home_score, away_score, status, home_team, away_team, bracket_slot",
    );

  if (fetchError) {
    throw new Error(
      `Error al consultar partidos locales: ${fetchError.message}`,
    );
  }

  // 8. Crear mapa de partidos locales por external_ref para búsqueda rápida
  const localByRef = new Map(
    (localMatches ?? [])
      .filter((m) => m.external_ref)
      .map((m) => [m.external_ref, m]),
  );

  // 9. Comparar y actualizar solo los partidos que cambiaron
  let updatedCount = 0;

  for (const apiMatch of apiMatches) {
    const local = localByRef.get(apiMatch.id);
    if (!local) {
      // Partido no encontrado en la base de datos local — ignorar
      continue;
    }

    const mappedStatus = mapApiStatus(apiMatch.status);

    // Detectar si hay cambios relevantes
    const scoreChanged =
      local.home_score !== apiMatch.homeScore ||
      local.away_score !== apiMatch.awayScore;
    const statusChanged = local.status !== mappedStatus;
    const teamsChanged =
      local.bracket_slot !== null &&
      (local.home_team !== apiMatch.homeTeam ||
        local.away_team !== apiMatch.awayTeam);

    if (!scoreChanged && !statusChanged && !teamsChanged) {
      continue;
    }

    // Construir objeto de actualización
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = {
      home_score: apiMatch.homeScore,
      away_score: apiMatch.awayScore,
      status: mappedStatus,
      updated_at: new Date().toISOString(),
    };

    // Solo actualizar equipos para partidos de eliminatoria (bracket_slot != null)
    if (local.bracket_slot !== null) {
      updateData.home_team = apiMatch.homeTeam;
      updateData.away_team = apiMatch.awayTeam;
    }

    const { error: updateError } = await supabase
      .from("matches")
      .update(updateData)
      .eq("id", local.id);

    if (updateError) {
      console.error(
        `Error al actualizar partido ${apiMatch.id}: ${updateError.message}`,
      );
      continue;
    }

    updatedCount++;
  }

  // 10. Guardar el nuevo ETag si fue proporcionado
  if (newETag) {
    await saveETag(supabase, newETag);
  }

  console.log(
    `✅ Sincronización completada. Partidos actualizados: ${updatedCount}. ` +
      `ETag actualizado: ${newETag ?? "(no proporcionado)"}`,
  );

  return { status: "updated", updated: updatedCount };
}

// ── Entry Point (ejecución directa) ────────────────────────────────

async function main(): Promise<void> {
  // Validar variables de entorno requeridas
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const wcApiKey = process.env.WC_API_KEY;

  const missing: string[] = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!wcApiKey) missing.push("WC_API_KEY");

  if (missing.length > 0) {
    console.error(
      `❌ Faltan variables de entorno requeridas: ${missing.join(", ")}`,
    );
    process.exit(1);
  }

  // Instanciar cliente de Supabase con service_role (bypass RLS)
  const supabase = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { persistSession: false },
  });

  try {
    await syncMatches(supabase, wcApiKey!);
  } catch (error) {
    console.error("❌ Error fatal durante la sincronización:", error);
    process.exit(1);
  }
}

// Solo ejecutar main() si se invoca directamente (no importado como módulo)
// Se detecta verificando si el módulo es el punto de entrada.
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("sync-matches.ts") ||
    process.argv[1].endsWith("sync-matches.js"));

if (isDirectRun) {
  main();
}

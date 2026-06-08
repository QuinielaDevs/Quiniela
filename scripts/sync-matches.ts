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

import {
  zafronixResponseSchema,
  deriveMatchStatus,
  resolveMatchNo,
  normalizeTeamName,
  isPlaceholderTeam,
} from "../src/lib/zafronix/matches";

// ── Cargar variables de entorno (solo relevante en ejecución local) ──
config({ path: ".env.local" });
config({ path: ".env" });

// ── Constantes ──────────────────────────────────────────────────────

const ZAFRONIX_API_URL =
  "https://api.zafronix.com/fifa/worldcup/v1/matches?year=2026";
const ETAG_CONFIG_KEY = "zafronix_matches_etag";



/**
 * Realiza una petición externa con reintentos y tiempo límite de respuesta (timeout).
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
  retries = 3,
  delayMs = 1000,
): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 segundos timeout

    try {
      const response = await fetchFn(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      clearTimeout(timeoutId);
      if (attempt === retries) {
        throw new Error(`Fallo tras ${retries} intentos de red. Último error: ${message}`);
      }
      console.warn(`Intento de red ${attempt} fallido: ${message}. Reintentando en ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("Petición de red no alcanzada");
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
    throw new Error(`Error al leer ETag de system_config: ${error.message}`);
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
 */
export async function syncMatches(
  supabase: SupabaseClient,
  apiKey: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ status: "not_modified" } | { status: "updated"; updated: number }> {
  // Validación de API Key
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("El X-API-Key de Zafronix no puede estar vacío.");
  }

  // 1. Consultar el ETag anterior de la base de datos
  const storedETag = await getStoredETag(supabase);

  // 2. Preparar cabeceras de la solicitud
  const headers: Record<string, string> = {
    "X-API-Key": apiKey,
  };
  if (storedETag) {
    headers["If-None-Match"] = storedETag;
  }

  // 3. Realizar la solicitud a la API de Zafronix con timeout y reintentos
  const response = await fetchWithRetry(
    ZAFRONIX_API_URL,
    { headers },
    fetchFn,
  );

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

  // 6. Parsear y validar el body JSON (con control de excepciones de parsing)
  let rawBody: unknown;
  try {
    rawBody = await response.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Error al parsear el JSON de la respuesta de la API: ${message}`);
  }

  const parseResult = zafronixResponseSchema.safeParse(rawBody);
  if (!parseResult.success) {
    throw new Error(
      `Error de validación del body de la API: ${JSON.stringify(parseResult.error.issues)}`,
    );
  }

  const apiMatches = parseResult.data.data;

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

  // 8. Crear mapas en memoria para búsquedas eficientes y mapeo de IDs
  const localByRef = new Map(
    (localMatches ?? [])
      .filter((m) => m.external_ref)
      .map((m) => [m.external_ref, m]),
  );

  const localKnockoutBySlot = new Map(
    (localMatches ?? [])
      .filter((m) => m.bracket_slot !== null && m.bracket_slot !== undefined)
      .map((m) => [m.bracket_slot, m]),
  );

  const localGroupByTeams = new Map(
    (localMatches ?? [])
      .filter((m) => m.bracket_slot === null || m.bracket_slot === undefined)
      .map((m) => [`${normalizeTeamName(m.home_team)}|${normalizeTeamName(m.away_team)}`, m]),
  );

  // 9. Comparar y preparar actualizaciones solo de los partidos que cambiaron
  const updateDataList: Array<{ id: string; [key: string]: unknown }> = [];

  for (const apiMatch of apiMatches) {
    // 9.1 Mapear dinámicamente el partido de la API al local
    let local = localByRef.get(apiMatch.id);

    if (!local) {
      const matchNum = resolveMatchNo(apiMatch);

      if (matchNum !== null) {
        if (matchNum >= 73) {
          local = localKnockoutBySlot.get(matchNum);
        } else if (apiMatch.homeTeam && apiMatch.awayTeam) {
          const key = `${normalizeTeamName(apiMatch.homeTeam)}|${normalizeTeamName(apiMatch.awayTeam)}`;
          local = localGroupByTeams.get(key);
        }
      }
    }

    if (!local) {
      // Partido no encontrado en la base de datos local — ignorar
      continue;
    }

    const mappedStatus = deriveMatchStatus(apiMatch);

    // Detectar si hay cambios relevantes
    const scoreChanged =
      local.home_score !== apiMatch.homeScore ||
      local.away_score !== apiMatch.awayScore;
    const statusChanged = local.status !== mappedStatus;
    
    // Solo actualizar nombres de equipos en eliminatoria si recibimos equipos reales (no placeholders)
    const canUpdateTeams =
      local.bracket_slot !== null &&
      local.bracket_slot !== undefined &&
      apiMatch.homeTeam !== null &&
      apiMatch.awayTeam !== null &&
      !isPlaceholderTeam(apiMatch.homeTeam) &&
      !isPlaceholderTeam(apiMatch.awayTeam);

    const teamsChanged =
      canUpdateTeams &&
      (local.home_team !== apiMatch.homeTeam ||
        local.away_team !== apiMatch.awayTeam);

    if (!scoreChanged && !statusChanged && !teamsChanged) {
      continue;
    }

    // Construir objeto de actualización
    const updateData: { id: string; [key: string]: unknown } = {
      id: local.id,
      home_score: apiMatch.homeScore,
      away_score: apiMatch.awayScore,
      status: mappedStatus,
      updated_at: new Date().toISOString(),
    };

    if (canUpdateTeams) {
      updateData.home_team = apiMatch.homeTeam;
      updateData.away_team = apiMatch.awayTeam;
    }

    updateDataList.push(updateData);
  }

  // 9.2 Ejecutar las consultas en paralelo con Promise.all para evitar consultas N+1 secuenciales
  let allUpdatesSucceeded = true;
  if (updateDataList.length > 0) {
    const promises = updateDataList.map((data) => {
      const { id, ...fields } = data;
      return supabase.from("matches").update(fields).eq("id", id);
    });

    const results = await Promise.all(promises);
    for (const r of results) {
      if (r.error) {
        console.error("Error al actualizar partido:", r.error.message);
        allUpdatesSucceeded = false;
      }
    }
  }

  // 10. Guardar el nuevo ETag si fue proporcionado y las actualizaciones tuvieron éxito
  if (newETag && allUpdatesSucceeded) {
    await saveETag(supabase, newETag);
  } else if (!allUpdatesSucceeded) {
    console.warn("⚠️ Algunas actualizaciones de partidos fallaron. No se guardará el nuevo ETag para reintentar.");
  }

  console.log(
    `✅ Sincronización completada. Partidos actualizados: ${updateDataList.length}. ` +
      `ETag actualizado: ${newETag && allUpdatesSucceeded ? newETag : "(no actualizado)"}`,
  );

  return { status: "updated", updated: updateDataList.length };
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

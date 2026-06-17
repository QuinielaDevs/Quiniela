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
): Promise<
  | { status: "not_modified"; changes: never[] }
  | { status: "no_changes"; updated: 0; changes: never[] }
  | {
      status: "updated";
      updated: number;
      changes: Array<{
        id: string;
        home_team: string | null;
        away_team: string | null;
        changes: Record<string, { from: unknown; to: unknown }>;
      }>;
    }
> {
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
    return { status: "not_modified", changes: [] };
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
      "id, external_ref, home_score, away_score, status, home_team, away_team, bracket_slot, match_time",
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
  const changesList: Array<{
    id: string;
    home_team: string | null;
    away_team: string | null;
    changes: Record<string, { from: unknown; to: unknown }>;
  }> = [];

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

    // Salvaguarda: No sobreescribir marcadores locales existentes con valores nulos de la API
    const apiHomeScore = apiMatch.homeScore !== null ? apiMatch.homeScore : local.home_score;
    const apiAwayScore = apiMatch.awayScore !== null ? apiMatch.awayScore : local.away_score;

    // Salvaguarda: No degradar el estado local a un estado de menor peso.
    // Jerarquía: finished > live > scheduled (canceled/suspended son terminales igual que finished)
    // Un partido finalizado nunca puede volver a 'live' o 'scheduled'.
    // Un partido en vivo nunca puede volver a 'scheduled'.
    const STATUS_WEIGHT: Record<string, number> = {
      scheduled: 0,
      live: 1,
      finished: 2,
      suspended: 2,
      canceled: 2,
    };
    let finalStatus = mappedStatus;
    const localWeight = STATUS_WEIGHT[local.status] ?? 0;
    const mappedWeight = STATUS_WEIGHT[mappedStatus] ?? 0;
    if (mappedWeight < localWeight) {
      finalStatus = local.status;
    }

    // Salvaguarda: No sobreescribir marcadores de un partido ya finalizado localmente
    // a menos que la API también lo reporte como finished (tiene result string).
    // Esto evita que un estado inconsistente temporal de la API (scores sin result) 
    // corrompa un resultado ya guardado. Las correcciones legítimas llegan vía webhook (match.patched).
    const apiReportsFinished = mappedStatus === "finished";
    const effectiveHomeScore = (local.status === "finished" && !apiReportsFinished)
      ? local.home_score
      : apiHomeScore;
    const effectiveAwayScore = (local.status === "finished" && !apiReportsFinished)
      ? local.away_score
      : apiAwayScore;

    // Detectar si hay cambios relevantes
    const scoreChanged =
      local.home_score !== effectiveHomeScore ||
      local.away_score !== effectiveAwayScore;
    const statusChanged = local.status !== finalStatus;

    // Detectar si el horario (match_time) cambió en la API
    const timeChanged = apiMatch.kickoffUtc
      ? new Date(local.match_time).getTime() !== new Date(apiMatch.kickoffUtc).getTime()
      : false;
    
    // Solo actualizar nombres de equipos en eliminatoria si recibimos equipos reales (no placeholders)
    const canUpdateTeams =
      local.bracket_slot !== null &&
      local.bracket_slot !== undefined &&
      typeof apiMatch.homeTeam === "string" &&
      typeof apiMatch.awayTeam === "string" &&
      !isPlaceholderTeam(apiMatch.homeTeam) &&
      !isPlaceholderTeam(apiMatch.awayTeam);

    const teamsChanged =
      canUpdateTeams &&
      (local.home_team !== apiMatch.homeTeam ||
        local.away_team !== apiMatch.awayTeam);

    if (!scoreChanged && !statusChanged && !teamsChanged && !timeChanged) {
      continue;
    }

    // Construir objeto de actualización
    const updateData: { id: string; [key: string]: unknown } = {
      id: local.id,
      home_score: effectiveHomeScore,
      away_score: effectiveAwayScore,
      status: finalStatus,
      updated_at: new Date().toISOString(),
    };

    if (canUpdateTeams) {
      updateData.home_team = apiMatch.homeTeam;
      updateData.away_team = apiMatch.awayTeam;
    }

    if (timeChanged && apiMatch.kickoffUtc) {
      updateData.match_time = apiMatch.kickoffUtc;
    }

    updateDataList.push(updateData);

    const changesObj: Record<string, { from: unknown; to: unknown }> = {};
    if (scoreChanged) {
      changesObj.home_score = { from: local.home_score, to: effectiveHomeScore };
      changesObj.away_score = { from: local.away_score, to: effectiveAwayScore };
    }
    if (statusChanged) {
      changesObj.status = { from: local.status, to: finalStatus };
    }
    if (timeChanged && apiMatch.kickoffUtc) {
      changesObj.match_time = { from: local.match_time, to: apiMatch.kickoffUtc };
    }
    if (teamsChanged) {
      changesObj.home_team = { from: local.home_team, to: apiMatch.homeTeam };
      changesObj.away_team = { from: local.away_team, to: apiMatch.awayTeam };
    }

    changesList.push({
      id: local.id,
      home_team: canUpdateTeams ? apiMatch.homeTeam : local.home_team,
      away_team: canUpdateTeams ? apiMatch.awayTeam : local.away_team,
      changes: changesObj,
    });
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

  // Si la API devolvió 200 pero ningún partido tuvo diferencias reales, indicarlo explícitamente
  if (updateDataList.length === 0) {
    console.log(
      `✅ Sincronización completada. La API retornó datos nuevos (200) pero sin diferencias aplicables en la DB. ` +
        `ETag actualizado: ${newETag && allUpdatesSucceeded ? newETag : "(no actualizado)"}`,
    );
    return { status: "no_changes", updated: 0, changes: [] };
  }

  console.log(
    `✅ Sincronización completada. Partidos actualizados: ${updateDataList.length}. ` +
      `ETag actualizado: ${newETag && allUpdatesSucceeded ? newETag : "(no actualizado)"}`,
  );

  return { status: "updated", updated: updateDataList.length, changes: changesList };
}

// ── Lógica de Salida Temprana (Smart Polling) ──────────────────────

/**
 * Evalúa si debemos realizar la sincronización con la API de Zafronix
 * basado en ventanas de tiempo críticas de los partidos.
 */
export async function shouldRunSync(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<boolean> {
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();

  // 1. Ventana de sincronización diaria completa: 3:00 AM - 3:10 AM UTC (actualizar fixtures/bracket)
  if (utcH === 3 && utcM < 10) {
    console.log(" Daily full sync window active (3:00 AM UTC). Running full synchronization.");
    return true;
  }

  // 2. Consultar partidos que no estén finalizados ni cancelados
  const { data: matches, error } = await supabase
    .from("matches")
    .select("status, match_time")
    .in("status", ["scheduled", "live"]);

  if (error) {
    console.error("⚠️ Error querying matches for sync window:", error.message);
    return true; // En caso de error de DB, procedemos por seguridad
  }

  if (!matches || matches.length === 0) {
    console.log("💤 No scheduled or live matches found in database.");
    return false;
  }

  const nowMs = now.getTime();
  const twoMinutesInMs = 2 * 60 * 1000;
  const oneHundredTwentyMinutesInMs = 120 * 60 * 1000;
  const limitInMs = 210 * 60 * 1000; // 3 horas y 30 minutos

  for (const match of matches) {
    const matchTimeMs = new Date(match.match_time).getTime();

    // Condición A: Faltan 2 minutos o menos para el inicio
    const isJustBeforeKickoff = nowMs >= matchTimeMs - twoMinutesInMs && nowMs < matchTimeMs;

    // Condición B: Ya pasaron entre 120 y 210 minutos desde el inicio y sigue sin finalizar localmente
    const isPostMatchPolling = nowMs >= matchTimeMs + oneHundredTwentyMinutesInMs && nowMs < matchTimeMs + limitInMs;

    if (isJustBeforeKickoff || isPostMatchPolling) {
      console.log(
        `🎯 Sync window active for match starting at ${match.match_time} (status: ${match.status}). ` +
        `Current state: isJustBeforeKickoff=${isJustBeforeKickoff}, isPostMatchPolling=${isPostMatchPolling}`,
      );
      return true;
    }
  }

  return false;
}

// ── Entry Point (ejecución directa) ────────────────────────────────

async function main(): Promise<void> {
  // Validar variables de entorno requeridas
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const wcApiKey = process.env.WC_API_KEY;
  const forceSync = process.env.FORCE_SYNC === "true";

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
    if (forceSync) {
      console.log("🔄 Force sync enabled (FORCE_SYNC=true). Bypassing early-exit check.");
    } else {
      const runSync = await shouldRunSync(supabase);
      if (!runSync) {
        console.log("💤 No active match windows found (early exit). Exiting successfully.");
        process.exit(0);
      }
    }

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

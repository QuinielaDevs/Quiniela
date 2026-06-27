import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  isWithinReplayWindow,
  verifySignature,
  baseEventSchema,
  matchFinalizedPayload,
  matchPatchedPayload,
  matchPostponedPayload,
  ZAFRONIX_HEADERS,
} from "@/lib/zafronix/contract";
import { normalizeTeamName, isPlaceholderTeam } from "@/lib/zafronix/matches";

// Ver especificación de contrato y runbook de drift en docs/zafronix-webhook-contract.md

/**
 * Mapea el status de Zafronix a los status válidos de la tabla matches.
 * Zafronix usa "postponed"/"abandoned"/"cancelled"; nuestra DB usa "suspended"/"canceled".
 */
function mapPostponedStatus(
  zafronixStatus: string,
): "suspended" | "canceled" {
  switch (zafronixStatus) {
    case "cancelled":
    case "canceled":
    case "abandoned":
      return "canceled";
    case "postponed":
    default:
      return "suspended";
  }
}

/**
 * Encuentra un partido local correspondiente al ID y equipos de Zafronix.
 * Soporta resolución por external_ref, bracket_slot (eliminatorias) o nombres normalizados (fase de grupos).
 */
interface LocalMatch {
  id: string;
  bracket_slot: number | null;
  home_team: string;
  away_team: string;
  status: string;
  external_last_sync_at: string | null;
}

async function findLocalMatch(
  supabase: SupabaseClient,
  matchId: string,
  homeTeam?: string | null,
  awayTeam?: string | null,
): Promise<{ data: LocalMatch | null; error: unknown }> {
  // 1. Intentar coincidencia directa por external_ref (tests)
  const { data: directMatch, error: directError } = await supabase
    .from("matches")
    .select("id, bracket_slot, home_team, away_team, status, external_last_sync_at")
    .eq("external_ref", matchId)
    .maybeSingle();

  if (directError) {
    return { data: null, error: directError };
  }

  if (directMatch) {
    return { data: directMatch, error: null };
  }

  // 2. Si no coincide, traducir ID de Zafronix (2026-NNN)
  const parts = matchId.split("-");
  const matchNum = parts.length > 1 && parts[1] ? parseInt(parts[1], 10) : NaN;

  if (isNaN(matchNum)) {
    return { data: null, error: null };
  }

  if (matchNum >= 73) {
    // Eliminatorias: buscar por bracket_slot
    const { data, error } = await supabase
      .from("matches")
      .select("id, bracket_slot, home_team, away_team, status, external_last_sync_at")
      .eq("bracket_slot", matchNum)
      .maybeSingle();
    return { data, error };
  } else {
    // Fase de grupos: buscar por nombres de equipos normalizados
    if (!homeTeam || !awayTeam) {
      return { data: null, error: null };
    }
    const normHome = normalizeTeamName(homeTeam);
    const normAway = normalizeTeamName(awayTeam);

    const { data, error } = await supabase
      .from("matches")
      .select("id, bracket_slot, home_team, away_team, status, external_last_sync_at")
      .eq("home_team", normHome)
      .eq("away_team", normAway)
      .maybeSingle();
    return { data, error };
  }
}

// ── Route Handler ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1. Validar variable de entorno
  const webhookSecret = process.env.ZAFRONIX_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("ZAFRONIX_WEBHOOK_SECRET is not configured on the server");
    return NextResponse.json(
      { error: "internal_error", message: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  // 2. Extraer y validar cabeceras requeridas
  const timestamp = req.headers.get(ZAFRONIX_HEADERS.timestamp);
  const signature = req.headers.get(ZAFRONIX_HEADERS.signature);

  if (!timestamp || !signature) {
    return NextResponse.json(
      {
        error: "invalid_request",
        message: "Missing required headers: X-Zafronix-Timestamp and X-Zafronix-Signature-256",
      },
      { status: 400 },
    );
  }

  // 3. Validar ventana de replay (AC #2) con validación dual (segundos/milisegundos) sin límites arbitrarios
  let timestampMs = Number(timestamp);
  let replayValid = false;
  if (!isNaN(timestampMs)) {
    if (isWithinReplayWindow(timestampMs)) {
      replayValid = true;
    } else {
      const asMs = timestampMs * 1000;
      if (isWithinReplayWindow(asMs)) {
        timestampMs = asMs;
        replayValid = true;
      }
    }
  }

  if (!replayValid) {
    console.warn(
      `[Zafronix Webhook] Replay window check failed. Header timestamp: ${timestamp} (parsed as ${timestampMs} ms), current server time: ${Date.now()}`
    );
    return NextResponse.json(
      {
        error: "replay_rejected",
        message: "Timestamp outside acceptable window (5 minutes)",
      },
      { status: 401 },
    );
  }

  // 4. Leer raw body como texto para verificación HMAC (AC #1) con manejo de reseteo de conexión
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (err) {
    console.error("[Zafronix Webhook] Error reading request body stream:", err);
    return NextResponse.json(
      { error: "invalid_request", message: "Failed to read request body stream" },
      { status: 400 },
    );
  }

  // 5. Verificar firma HMAC-SHA256 con comparación en tiempo constante y logs diagnósticos
  if (!verifySignature(rawBody, timestamp, signature, webhookSecret)) {
    console.warn(
      `[Zafronix Webhook] HMAC signature verification failed. Header timestamp: ${timestamp}, signature: ${signature}`
    );
    return NextResponse.json(
      {
        error: "signature_mismatch",
        message: "HMAC-SHA256 signature verification failed",
      },
      { status: 401 },
    );
  }

  // 6. Parsear JSON desde rawBody
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Failed to parse request body as JSON" },
      { status: 400 },
    );
  }

  // 7. Validar estructura base del evento con zod
  const parseResult = baseEventSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: "validation_failed",
        message: "Invalid event payload structure",
        details: parseResult.error.issues,
      },
      { status: 400 },
    );
  }

  const event = parseResult.data;

  // 8. Configurar cliente de Supabase con service_role (bypass RLS)
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "Database configuration missing (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)",
    );
    return NextResponse.json(
      { error: "internal_error", message: "Database configuration missing" },
      { status: 500 },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // 9. Procesar evento según tipo
  try {
    switch (event.type) {
      case "match.finalized":
        return await handleMatchFinalized(supabase, event);
      case "match.patched":
        return await handleMatchPatched(supabase, event);
      case "match.postponed":
        return await handleMatchPostponed(supabase, event);
      default:
        // Tipos desconocidos se aceptan silenciosamente (forward compatibility)
        return NextResponse.json(
          { ok: true, message: `Event type '${event.type}' acknowledged but not processed` },
          { status: 200 },
        );
    }
  } catch (error) {
    console.error("Error processing webhook event:", error);
    return NextResponse.json(
      { error: "internal_error", message: "Failed to process webhook event" },
      { status: 500 },
    );
  }
}

// ── Event Handlers ──────────────────────────────────────────────────

/**
 * Procesa match.finalized: actualiza marcador y status a 'finished'.
 * Si el partido es eliminatorio (bracket_slot != null), también actualiza equipos.
 * (AC #3, #4)
 */
async function handleMatchFinalized(
  supabase: SupabaseClient,
  event: z.infer<typeof baseEventSchema>,
) {
  const payloadResult = matchFinalizedPayload.safeParse(event.payload);
  if (!payloadResult.success) {
    return NextResponse.json(
      { error: "validation_failed", message: "Invalid match.finalized payload" },
      { status: 400 },
    );
  }

  const { homeTeam, awayTeam, homeScore, awayScore, penalties } = payloadResult.data;

  // Buscar el partido usando el helper de mapeo
  const { data: match, error: findError } = await findLocalMatch(
    supabase,
    event.matchId,
    homeTeam,
    awayTeam,
  );

  if (findError) {
    console.error("Error looking up match:", findError);
    return NextResponse.json(
      { error: "internal_error", message: "Failed to look up match" },
      { status: 500 },
    );
  }

  if (!match) {
    return NextResponse.json(
      { error: "not_found", message: `Match with external_ref / mapping '${event.matchId}' not found` },
      { status: 404 },
    );
  }

  // Control de orden (concurrencia)
  const incomingTs = new Date(event.ts).getTime();
  if (match.external_last_sync_at) {
    const existingTs = new Date(match.external_last_sync_at).getTime();
    if (incomingTs < existingTs) {
      console.warn(
        `[Zafronix Webhook] Ignoring out-of-order match.finalized event. Incoming ts: ${event.ts}, existing ts: ${match.external_last_sync_at}`
      );
      return NextResponse.json(
        { ok: true, ignored: true, reason: "out_of_order" },
        { status: 200 },
      );
    }
  }

  let penHome: number | null = null;
  let penAway: number | null = null;
  if (penalties && typeof penalties === "string") {
    const parts = penalties.split("-");
    const h = parseInt(parts[0] ?? "", 10);
    const a = parseInt(parts[1] ?? "", 10);
    if (Number.isInteger(h) && Number.isInteger(a)) {
      penHome = h;
      penAway = a;
    }
  }

  // Preparar la actualización
  const updateData: Record<string, unknown> = {
    home_score: homeScore,
    away_score: awayScore,
    status: "finished",
    penalties_home_score: penHome,
    penalties_away_score: penAway,
    updated_at: new Date().toISOString(),
    external_last_sync_at: event.ts,
  };

  // AC #4: Si es eliminatoria (bracket_slot no nulo), actualizar equipos si no son placeholders
  if (match.bracket_slot !== null && match.bracket_slot !== undefined) {
    if (!isPlaceholderTeam(homeTeam) && !isPlaceholderTeam(awayTeam)) {
      updateData.home_team = homeTeam;
      updateData.away_team = awayTeam;
    }
  }

  const { error: updateError } = await supabase
    .from("matches")
    .update(updateData)
    .eq("id", match.id);

  if (updateError) {
    console.error("Error updating match:", updateError);
    return NextResponse.json(
      { error: "internal_error", message: "Failed to update match" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { ok: true, matchId: match.id, event: "match.finalized" },
    { status: 200 },
  );
}

/**
 * Procesa match.patched: actualiza marcador corregido.
 * Si el partido es eliminatorio, también actualiza equipos.
 * (AC #3, #4)
 */
async function handleMatchPatched(
  supabase: SupabaseClient,
  event: z.infer<typeof baseEventSchema>,
) {
  const payloadResult = matchPatchedPayload.safeParse(event.payload);
  if (!payloadResult.success) {
    return NextResponse.json(
      { error: "validation_failed", message: "Invalid match.patched payload" },
      { status: 400 },
    );
  }

  const { homeTeam, awayTeam, changes } = payloadResult.data;

  // Buscar el partido usando el helper de mapeo
  const { data: match, error: findError } = await findLocalMatch(
    supabase,
    event.matchId,
    homeTeam,
    awayTeam,
  );

  if (findError) {
    console.error("Error looking up match:", findError);
    return NextResponse.json(
      { error: "internal_error", message: "Failed to look up match" },
      { status: 500 },
    );
  }

  if (!match) {
    return NextResponse.json(
      { error: "not_found", message: `Match with external_ref / mapping '${event.matchId}' not found` },
      { status: 404 },
    );
  }

  // Control de orden (concurrencia)
  const incomingTs = new Date(event.ts).getTime();
  if (match.external_last_sync_at) {
    const existingTs = new Date(match.external_last_sync_at).getTime();
    if (incomingTs < existingTs) {
      console.warn(
        `[Zafronix Webhook] Ignoring out-of-order match.patched event. Incoming ts: ${event.ts}, existing ts: ${match.external_last_sync_at}`
      );
      return NextResponse.json(
        { ok: true, ignored: true, reason: "out_of_order" },
        { status: 200 },
      );
    }
  }

  // Construir actualización a partir del diff
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    status: match.status, // Preservar el estado actual del partido en lugar de forzar finished
    external_last_sync_at: event.ts,
  };

  if (changes.homeScore) {
    const val = changes.homeScore.to;
    if (typeof val !== "number" || !Number.isInteger(val) || val < 0) {
      return NextResponse.json(
        { error: "validation_failed", message: "Invalid homeScore correction value" },
        { status: 400 },
      );
    }
    updateData.home_score = val;
  }
  if (changes.awayScore) {
    const val = changes.awayScore.to;
    if (typeof val !== "number" || !Number.isInteger(val) || val < 0) {
      return NextResponse.json(
        { error: "validation_failed", message: "Invalid awayScore correction value" },
        { status: 400 },
      );
    }
    updateData.away_score = val;
  }
  if (changes.penalties) {
    const val = changes.penalties.to;
    if (val === null) {
      updateData.penalties_home_score = null;
      updateData.penalties_away_score = null;
    } else if (typeof val === "string") {
      const parts = val.split("-");
      const h = parseInt(parts[0] ?? "", 10);
      const a = parseInt(parts[1] ?? "", 10);
      if (Number.isInteger(h) && Number.isInteger(a)) {
        updateData.penalties_home_score = h;
        updateData.penalties_away_score = a;
      } else {
        return NextResponse.json(
          { error: "validation_failed", message: "Invalid penalties correction value" },
          { status: 400 },
        );
      }
    }
  }

  // AC #4: Si es eliminatoria, actualizar equipos si se proveen y no son placeholders
  if (match.bracket_slot !== null && match.bracket_slot !== undefined) {
    if (homeTeam && !isPlaceholderTeam(homeTeam)) updateData.home_team = homeTeam;
    if (awayTeam && !isPlaceholderTeam(awayTeam)) updateData.away_team = awayTeam;
  }

  const { error: updateError } = await supabase
    .from("matches")
    .update(updateData)
    .eq("id", match.id);

  if (updateError) {
    console.error("Error patching match:", updateError);
    return NextResponse.json(
      { error: "internal_error", message: "Failed to patch match" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { ok: true, matchId: match.id, event: "match.patched" },
    { status: 200 },
  );
}

/**
 * Procesa match.postponed: actualiza status y anula predicciones.
 * La cancelación de duelos y reembolso de escrow se gatillan automáticamente
 * en cascada mediante el trigger `tr_resolve_challenges_on_match_status_change`.
 * (AC #5)
 */
async function handleMatchPostponed(
  supabase: SupabaseClient,
  event: z.infer<typeof baseEventSchema>,
) {
  const payloadResult = matchPostponedPayload.safeParse(event.payload);
  if (!payloadResult.success) {
    return NextResponse.json(
      { error: "validation_failed", message: "Invalid match.postponed payload" },
      { status: 400 },
    );
  }

  const { status: zafronixStatus, homeTeam, awayTeam } = payloadResult.data;
  const dbStatus = mapPostponedStatus(zafronixStatus);

  // Buscar el partido usando el helper de mapeo
  const { data: match, error: findError } = await findLocalMatch(
    supabase,
    event.matchId,
    homeTeam,
    awayTeam,
  );

  if (findError) {
    console.error("Error looking up match:", findError);
    return NextResponse.json(
      { error: "internal_error", message: "Failed to look up match" },
      { status: 500 },
    );
  }

  if (!match) {
    return NextResponse.json(
      { error: "not_found", message: `Match with external_ref / mapping '${event.matchId}' not found` },
      { status: 404 },
    );
  }

  // Control de orden (concurrencia)
  const incomingTs = new Date(event.ts).getTime();
  if (match.external_last_sync_at) {
    const existingTs = new Date(match.external_last_sync_at).getTime();
    if (incomingTs < existingTs) {
      console.warn(
        `[Zafronix Webhook] Ignoring out-of-order match.postponed event. Incoming ts: ${event.ts}, existing ts: ${match.external_last_sync_at}`
      );
      return NextResponse.json(
        { ok: true, ignored: true, reason: "out_of_order" },
        { status: 200 },
      );
    }
  }

  // Llamar al RPC transaccional que actualiza el partido y anula predicciones
  const { error: rpcError } = await supabase.rpc(
    "fn_postpone_match_and_predictions",
    {
      p_match_id: match.id,
      p_status: dbStatus,
    }
  );

  if (rpcError) {
    console.error("Error executing postpone RPC:", rpcError);
    return NextResponse.json(
      { error: "internal_error", message: "Failed to update match and predictions" },
      { status: 500 },
    );
  }

  // Actualizar la marca de tiempo de sincronización
  const { error: updateError } = await supabase
    .from("matches")
    .update({ external_last_sync_at: event.ts })
    .eq("id", match.id);

  if (updateError) {
    console.error("Error updating external_last_sync_at after postpone:", updateError);
    return NextResponse.json(
      { error: "internal_error", message: "Failed to update sync timestamp" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { ok: true, matchId: match.id, event: "match.postponed", dbStatus },
    { status: 200 },
  );
}

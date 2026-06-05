import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// ── Constantes ──────────────────────────────────────────────────────

/** Ventana máxima de replay (5 minutos en milisegundos). */
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

// ── Zod Schemas ─────────────────────────────────────────────────────

/**
 * Schema base del evento de webhook de Zafronix.
 * Forma: { type, id, matchId, year, ts, payload }
 */
const baseEventSchema = z.object({
  type: z.string(),
  id: z.string(),
  matchId: z.string(),
  year: z.number().int(),
  ts: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

const matchFinalizedPayload = z.object({
  homeTeam: z.string(),
  awayTeam: z.string(),
  homeScore: z.number().int().nonnegative(),
  awayScore: z.number().int().nonnegative(),
  result: z.string().optional(),
  extraTime: z.boolean().optional(),
  penalties: z.unknown().optional(),
  stage: z.string().optional(),
  actor: z.string().optional(),
});

const matchPatchedChangesValue = z.object({
  from: z.unknown(),
  to: z.unknown(),
});

const matchPatchedPayload = z.object({
  homeTeam: z.string().optional(),
  awayTeam: z.string().optional(),
  changes: z.record(z.string(), matchPatchedChangesValue),
  actor: z.string().optional(),
});

const matchPostponedPayload = z.object({
  homeTeam: z.string().optional(),
  awayTeam: z.string().optional(),
  status: z.string(),
  rescheduledTo: z.string().optional(),
  reason: z.string().optional(),
  actor: z.string().optional(),
});

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Verifica la firma HMAC-SHA256 de la solicitud de webhook de Zafronix.
 *
 * Esquema: firma = "sha256=" + HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
 * El timestamp se incluye en el material firmado para derrotar replay attacks.
 */
function verifySignature(
  rawBody: string,
  timestamp: string,
  signature: string,
  secret: string,
): boolean {
  const expected =
    "sha256=" +
    createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(sigBuffer, expectedBuffer);
}

/**
 * Verifica que el timestamp esté dentro de la ventana de replay de 5 minutos.
 * El timestamp de Zafronix viene en milisegundos.
 */
function isWithinReplayWindow(timestampMs: number): boolean {
  return Math.abs(Date.now() - timestampMs) <= REPLAY_WINDOW_MS;
}

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
  const timestamp = req.headers.get("x-zafronix-timestamp");
  const signature = req.headers.get("x-zafronix-signature-256");

  if (!timestamp || !signature) {
    return NextResponse.json(
      {
        error: "invalid_request",
        message: "Missing required headers: X-Zafronix-Timestamp and X-Zafronix-Signature-256",
      },
      { status: 400 },
    );
  }

  // 3. Validar ventana de replay (AC #2)
  const timestampMs = Number(timestamp);
  if (isNaN(timestampMs) || !isWithinReplayWindow(timestampMs)) {
    return NextResponse.json(
      {
        error: "replay_rejected",
        message: "Timestamp outside acceptable window (5 minutes)",
      },
      { status: 401 },
    );
  }

  // 4. Leer raw body como texto para verificación HMAC (AC #1)
  const rawBody = await req.text();

  // 5. Verificar firma HMAC-SHA256 con comparación en tiempo constante
  if (!verifySignature(rawBody, timestamp, signature, webhookSecret)) {
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

  const { homeTeam, awayTeam, homeScore, awayScore } = payloadResult.data;

  // Buscar el partido por external_ref
  const { data: match, error: findError } = await supabase
    .from("matches")
    .select("id, bracket_slot")
    .eq("external_ref", event.matchId)
    .single();

  if (findError || !match) {
    return NextResponse.json(
      { error: "not_found", message: `Match with external_ref '${event.matchId}' not found` },
      { status: 404 },
    );
  }

  // Preparar la actualización
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: Record<string, any> = {
    home_score: homeScore,
    away_score: awayScore,
    status: "finished",
    updated_at: new Date().toISOString(),
  };

  // AC #4: Si es eliminatoria (bracket_slot no nulo), actualizar equipos
  if (match.bracket_slot !== null && match.bracket_slot !== undefined) {
    updateData.home_team = homeTeam;
    updateData.away_team = awayTeam;
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

  // Buscar el partido por external_ref
  const { data: match, error: findError } = await supabase
    .from("matches")
    .select("id, bracket_slot")
    .eq("external_ref", event.matchId)
    .single();

  if (findError || !match) {
    return NextResponse.json(
      { error: "not_found", message: `Match with external_ref '${event.matchId}' not found` },
      { status: 404 },
    );
  }

  // Construir actualización a partir del diff
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: Record<string, any> = {
    updated_at: new Date().toISOString(),
    status: "finished", // Un patch implica que el partido sigue finished
  };

  if (changes.homeScore) {
    updateData.home_score = changes.homeScore.to as number;
  }
  if (changes.awayScore) {
    updateData.away_score = changes.awayScore.to as number;
  }

  // AC #4: Si es eliminatoria, actualizar equipos si se proveen
  if (match.bracket_slot !== null && match.bracket_slot !== undefined) {
    if (homeTeam) updateData.home_team = homeTeam;
    if (awayTeam) updateData.away_team = awayTeam;
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

  const { status: zafronixStatus } = payloadResult.data;
  const dbStatus = mapPostponedStatus(zafronixStatus);

  // Buscar el partido por external_ref
  const { data: match, error: findError } = await supabase
    .from("matches")
    .select("id")
    .eq("external_ref", event.matchId)
    .single();

  if (findError || !match) {
    return NextResponse.json(
      { error: "not_found", message: `Match with external_ref '${event.matchId}' not found` },
      { status: 404 },
    );
  }

  // Actualizar el status del partido.
  // Esto gatilla el trigger tr_resolve_challenges_on_match_status_change
  // que cancela duelos y reembolsa escrow automáticamente.
  const { error: updateError } = await supabase
    .from("matches")
    .update({
      status: dbStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", match.id);

  if (updateError) {
    console.error("Error updating match status:", updateError);
    return NextResponse.json(
      { error: "internal_error", message: "Failed to update match status" },
      { status: 500 },
    );
  }

  // Anular predicciones: points_earned = 0.00, evaluated_at = now()
  // Esto se hace para todas las predicciones del partido
  // que aún no hayan sido evaluadas.
  const { error: predError } = await supabase
    .from("predictions")
    .update({
      points_earned: 0.0,
      evaluated_at: new Date().toISOString(),
    })
    .eq("match_id", match.id)
    .is("evaluated_at", null);

  if (predError) {
    console.error("Error nullifying predictions:", predError);
    // No retornamos error al webhook — el match ya se actualizó correctamente.
    // Loggeamos para investigación pero damos 200 para que Zafronix no reintente.
  }

  return NextResponse.json(
    { ok: true, matchId: match.id, event: "match.postponed", dbStatus },
    { status: 200 },
  );
}

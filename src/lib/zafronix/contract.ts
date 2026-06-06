import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// ── Constantes ──────────────────────────────────────────────────────

/** Ventana máxima de replay (5 minutos en milisegundos). */
export const REPLAY_WINDOW_MS = 5 * 60 * 1000;

/**
 * Cabeceras oficiales del contrato de webhooks de Zafronix.
 */
export const ZAFRONIX_HEADERS = {
  signature: "X-Zafronix-Signature-256",
  timestamp: "X-Zafronix-Timestamp",
  eventType: "X-Zafronix-Event-Type",
  eventId: "X-Zafronix-Event-Id",
  webhookId: "X-Zafronix-Webhook-Id",
  deliveryAttempt: "X-Zafronix-Delivery-Attempt",
} as const;

// ── Zod Schemas ─────────────────────────────────────────────────────

/**
 * Schema base del evento de webhook de Zafronix.
 * Forma: { type, id, matchId, year, ts, payload }
 */
export const baseEventSchema = z.object({
  type: z.string(),
  id: z.string(),
  matchId: z.string(),
  year: z.number().int(),
  ts: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

export const matchFinalizedPayload = z.object({
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

export const matchPatchedChangesValue = z.object({
  from: z.unknown(),
  to: z.unknown(),
});

export const matchPatchedPayload = z.object({
  homeTeam: z.string().optional(),
  awayTeam: z.string().optional(),
  changes: z.record(z.string(), matchPatchedChangesValue),
  actor: z.string().optional(),
});

export const matchPostponedPayload = z.object({
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
export function verifySignature(
  rawBody: string,
  timestamp: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature || signature.length !== 71 || !signature.startsWith("sha256=")) {
    return false;
  }

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
export function isWithinReplayWindow(timestampMs: number): boolean {
  return Math.abs(Date.now() - timestampMs) <= REPLAY_WINDOW_MS;
}

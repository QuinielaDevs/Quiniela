// Envío de eventos firmados al webhook de Zafronix desde los tests E2E
// (Fase 1 del plan). Reutiliza la lógica de firma HMAC centralizada de
// tests/integration/helpers/hmac.ts (NO la copia) y construye el body con la
// misma forma que los fixtures de tests/fixtures/zafronix/*.sample.json:
//   { type, id, matchId, year, ts, payload }
//
// Resolución del partido en el handler (route.ts → findLocalMatch):
//   1) external_ref == matchId           → usar opts.matchExternalRef
//   2) matchId "2026-NNN" con NNN >= 73  → bracket_slot (usar opts.bracketSlot)
//   3) NNN < 73 + payload.homeTeam/awayTeam → nombres normalizados (opts.teams)

import type { APIRequestContext, APIResponse } from "@playwright/test";

import {
  signWebhookBody,
  TEST_WEBHOOK_SECRET,
} from "../../integration/helpers/hmac";

export const ZAFRONIX_WEBHOOK_PATH = "/api/webhooks/zafronix";

export type ZafronixEventType =
  | "match.finalized"
  | "match.patched"
  | "match.postponed"
  | (string & {});

export interface SendZafronixEventOpts {
  type: ZafronixEventType;
  /** Resolución por external_ref (ruta 1 del handler). */
  matchExternalRef?: string;
  /** Resolución por bracket_slot: genera matchId "2026-<slot>" (ruta 2). */
  bracketSlot?: number;
  /** Resolución por nombres (grupos, ruta 3): se inyectan en el payload y el
   *  matchId default queda en la franja < 73. */
  teams?: { home: string; away: string };
  /** Campos del payload del evento (homeScore, changes, status, etc.). */
  payload?: Record<string, unknown>;
  /** event.ts (control out-of-order del handler). Default: ahora. */
  ts?: string;
  /** id del evento. Default: aleatorio. */
  eventId?: string;
  /** Override del matchId literal (gana sobre matchExternalRef/bracketSlot). */
  matchId?: string;
  /** Timestamp (ms) usado en cabecera Y firma. Útil para probar la ventana
   *  anti-replay: la firma es válida pero el timestamp queda fuera de ±5 min. */
  timestampOverride?: number;
  /** Corrompe la firma para probar el 401 signature_mismatch. */
  badSignature?: boolean;
  /** Secreto alternativo (default: el mismo que ve el dev server). */
  secret?: string;
}

export interface ZafronixEventResult {
  response: APIResponse;
  status: number;
  body: unknown;
  /** El body crudo enviado (para reenviar/replay en tests). */
  rawBody: string;
  headers: Record<string, string>;
}

function resolveMatchId(opts: SendZafronixEventOpts): string {
  if (opts.matchId) return opts.matchId;
  if (opts.matchExternalRef) return opts.matchExternalRef;
  if (opts.bracketSlot !== undefined) return `2026-${opts.bracketSlot}`;
  // Franja de grupos (< 73) para que el handler caiga al match por nombres.
  return "2026-001";
}

function randomEventId(): string {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

/**
 * Construye, firma y envía un evento de Zafronix. `request` puede ser
 * `page.request` (hereda el baseURL del proyecto) o un APIRequestContext
 * creado con `playwright.request.newContext({ baseURL })`.
 */
export async function sendZafronixEvent(
  request: APIRequestContext,
  opts: SendZafronixEventOpts,
): Promise<ZafronixEventResult> {
  const payload: Record<string, unknown> = { ...(opts.payload ?? {}) };
  if (opts.teams) {
    payload.homeTeam = payload.homeTeam ?? opts.teams.home;
    payload.awayTeam = payload.awayTeam ?? opts.teams.away;
  }

  const event = {
    type: opts.type,
    id: opts.eventId ?? randomEventId(),
    matchId: resolveMatchId(opts),
    year: 2026,
    ts: opts.ts ?? new Date().toISOString(),
    payload,
  };

  const rawBody = JSON.stringify(event);
  const timestampMs = opts.timestampOverride ?? Date.now();
  const secret = opts.secret ?? TEST_WEBHOOK_SECRET;

  let signature = signWebhookBody(rawBody, secret, timestampMs);
  if (opts.badSignature) {
    // Mantiene formato/longitud válidos (sha256= + 64 hex) con dígitos corruptos.
    signature = signature.slice(0, -6) + (signature.endsWith("000000") ? "111111" : "000000");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Zafronix-Timestamp": String(timestampMs),
    "X-Zafronix-Signature-256": signature,
  };

  const response = await request.post(ZAFRONIX_WEBHOOK_PATH, {
    headers,
    data: rawBody,
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = await response.text().catch(() => null);
  }

  return { response, status: response.status(), body, rawBody, headers };
}

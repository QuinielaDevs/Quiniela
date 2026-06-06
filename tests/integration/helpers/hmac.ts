/**
 * tests/integration/helpers/hmac.ts
 *
 * Helper centralizado de firma HMAC-SHA256 para los webhooks de Zafronix.
 *
 * Replica EXACTAMENTE el esquema que valida el handler de producción
 * (`src/app/api/webhooks/zafronix/route.ts`):
 *
 *   signature = "sha256=" + HMAC-SHA256(secret, `${timestampMs}.${rawBody}`)
 *
 * El timestamp (en milisegundos) se incluye en el material firmado para
 * derrotar replay attacks. Este módulo es la ÚNICA fuente de verdad del
 * esquema de firma del lado de los tests: lo reutilizan
 *   - tests/integration/zafronix-webhook.test.ts (firma sintética), y
 *   - tests/integration/zafronix-sandbox-e2e.test.ts (re-firma del puente local).
 *
 * NO es código de producción; vive solo bajo tests/.
 */
import { createHmac } from "node:crypto";

/**
 * Secreto de firma para el entorno de tests.
 *
 * CRÍTICO: el handler `POST` lee `process.env.ZAFRONIX_WEBHOOK_SECRET` y
 * responde 500 si falta. La firma del lado del test DEBE usar exactamente el
 * mismo valor que ve el handler, o la verificación HMAC fallará (401).
 *
 * Por eso esta constante prioriza `process.env.ZAFRONIX_WEBHOOK_SECRET`
 * (cargado por setup-env.ts / exportado por CI) y solo cae a un valor de
 * prueba determinista cuando la variable no está presente. Para que el handler
 * vea ese mismo fallback en CI, el workflow exporta la misma cadena
 * (ver .github/workflows/ci.yml).
 */
export const TEST_WEBHOOK_SECRET =
  process.env.ZAFRONIX_WEBHOOK_SECRET ??
  "whsec_test_secret_for_integration_tests_only";

/**
 * Calcula la firma `sha256=<hex>` sobre `${timestampMs}.${rawBody}`.
 */
export function signWebhookBody(
  rawBody: string,
  secret: string = TEST_WEBHOOK_SECRET,
  timestampMs: number = Date.now(),
): string {
  return (
    "sha256=" +
    createHmac("sha256", secret)
      .update(`${timestampMs}.${rawBody}`)
      .digest("hex")
  );
}

/**
 * Genera el set completo de cabeceras de webhook firmadas para un body dado.
 * Equivale al `signPayload` histórico de zafronix-webhook.test.ts, ahora
 * centralizado para evitar duplicar el esquema HMAC.
 */
export function signWebhookHeaders(
  rawBody: string,
  secret: string = TEST_WEBHOOK_SECRET,
  timestampMs: number = Date.now(),
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Zafronix-Timestamp": String(timestampMs),
    "X-Zafronix-Signature-256": signWebhookBody(rawBody, secret, timestampMs),
  };
}

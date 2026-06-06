import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  verifySignature,
  baseEventSchema,
  matchFinalizedPayload,
  matchPatchedPayload,
  matchPostponedPayload,
} from "../../src/lib/zafronix/contract";

const fixturePath = join(__dirname, "../fixtures/zafronix/real-delivery.local.json");
const fixtureExists = existsSync(fixturePath);

describe.skipIf(!fixtureExists)("Zafronix webhook - Real delivery verification (Gated)", () => {
  it("debe validar la firma real de Zafronix usando el secreto de producción", () => {
    const rawData = readFileSync(fixturePath, "utf-8");
    const { headers, rawBody } = JSON.parse(rawData);
    
    const signature = headers["x-zafronix-signature-256"] || headers["X-Zafronix-Signature-256"];
    const timestamp = headers["x-zafronix-timestamp"] || headers["X-Zafronix-Timestamp"];
    
    const secret = process.env.ZAFRONIX_WEBHOOK_SECRET;
    expect(secret, "Falta definir ZAFRONIX_WEBHOOK_SECRET real en el entorno").toBeDefined();
    
    const isValid = verifySignature(rawBody, timestamp, signature, secret!);
    expect(isValid, "La firma real de Zafronix no coincide con el secreto configurado").toBe(true);
  });

  it("debe parsear el payload real y validar con su esquema específico", () => {
    const rawData = readFileSync(fixturePath, "utf-8");
    const { rawBody } = JSON.parse(rawData);
    const body = JSON.parse(rawBody);

    const baseResult = baseEventSchema.safeParse(body);
    expect(baseResult.success, "El payload real no cumple con el esquema base").toBe(true);

    const event = baseResult.data!;
    
    if (event.type === "match.finalized") {
      const payloadResult = matchFinalizedPayload.safeParse(event.payload);
      expect(payloadResult.success, "El payload real no cumple con matchFinalizedPayload").toBe(true);
    } else if (event.type === "match.patched") {
      const payloadResult = matchPatchedPayload.safeParse(event.payload);
      expect(payloadResult.success, "El payload real no cumple con matchPatchedPayload").toBe(true);
    } else if (event.type === "match.postponed") {
      const payloadResult = matchPostponedPayload.safeParse(event.payload);
      expect(payloadResult.success, "El payload real no cumple con matchPostponedPayload").toBe(true);
    } else {
      throw new Error(`Tipo de evento no soportado para test de contrato real: ${event.type}`);
    }
  });
});

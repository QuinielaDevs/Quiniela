import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  baseEventSchema,
  matchFinalizedPayload,
  matchPatchedPayload,
  matchPostponedPayload,
  verifySignature,
  ZAFRONIX_HEADERS,
} from "../../src/lib/zafronix/contract";

import matchFinalizedSample from "../fixtures/zafronix/match-finalized.sample.json";
import matchPatchedSample from "../fixtures/zafronix/match-patched.sample.json";
import matchPostponedSample from "../fixtures/zafronix/match-postponed.sample.json";

describe("Zafronix Webhook Contract Tests (Offline, Deterministic)", () => {
  
  describe("Pin de Payloads (AC #1)", () => {
    it("debe validar correctamente el sample de match.finalized", () => {
      const parsedBase = baseEventSchema.safeParse(matchFinalizedSample);
      expect(parsedBase.success, `Divergencia en baseEventSchema para match.finalized: ${JSON.stringify(parsedBase.error?.issues)}`).toBe(true);

      const payloadResult = matchFinalizedPayload.safeParse(matchFinalizedSample.payload);
      expect(payloadResult.success, `Divergencia en matchFinalizedPayload: ${JSON.stringify(payloadResult.error?.issues)}`).toBe(true);
    });

    it("debe validar correctamente el sample de match.patched", () => {
      const parsedBase = baseEventSchema.safeParse(matchPatchedSample);
      expect(parsedBase.success, `Divergencia en baseEventSchema para match.patched: ${JSON.stringify(parsedBase.error?.issues)}`).toBe(true);

      const payloadResult = matchPatchedPayload.safeParse(matchPatchedSample.payload);
      expect(payloadResult.success, `Divergencia en matchPatchedPayload: ${JSON.stringify(payloadResult.error?.issues)}`).toBe(true);
    });

    it("debe validar correctamente el sample de match.postponed", () => {
      const parsedBase = baseEventSchema.safeParse(matchPostponedSample);
      expect(parsedBase.success, `Divergencia en baseEventSchema para match.postponed: ${JSON.stringify(parsedBase.error?.issues)}`).toBe(true);

      const payloadResult = matchPostponedPayload.safeParse(matchPostponedSample.payload);
      expect(payloadResult.success, `Divergencia en matchPostponedPayload: ${JSON.stringify(payloadResult.error?.issues)}`).toBe(true);
    });
  });

  describe("Pin de Firma (AC #2)", () => {
    const testSecret = "super_secret_signing_key_for_testing";
    const rawBody = JSON.stringify({ event: "test" });
    const timestamp = String(Date.now());
    
    // Generar firma válida usando el recipe oficial
    const expectedSignature =
      "sha256=" +
      createHmac("sha256", testSecret)
        .update(`${timestamp}.${rawBody}`)
        .digest("hex");

    it("debe retornar true para una firma válida", () => {
      const result = verifySignature(rawBody, timestamp, expectedSignature, testSecret);
      expect(result).toBe(true);
    });

    it("debe retornar false si el body ha sido manipulado", () => {
      const manipulatedBody = rawBody + " ";
      const result = verifySignature(manipulatedBody, timestamp, expectedSignature, testSecret);
      expect(result).toBe(false);
    });

    it("debe retornar false si el secreto de firma es distinto", () => {
      const result = verifySignature(rawBody, timestamp, expectedSignature, "wrong_secret");
      expect(result).toBe(false);
    });

    it("debe retornar false y no lanzar error si la firma tiene una longitud distinta", () => {
      const invalidSignature = "sha256=12345";
      expect(() => {
        const result = verifySignature(rawBody, timestamp, invalidSignature, testSecret);
        expect(result).toBe(false);
      }).not.toThrow();
    });
  });

  describe("Pin de Cabeceras (AC #3)", () => {
    it("debe coincidir con las cabeceras documentadas de Zafronix", () => {
      expect(ZAFRONIX_HEADERS.signature).toBe("X-Zafronix-Signature-256");
      expect(ZAFRONIX_HEADERS.timestamp).toBe("X-Zafronix-Timestamp");
      expect(ZAFRONIX_HEADERS.eventType).toBe("X-Zafronix-Event-Type");
      expect(ZAFRONIX_HEADERS.eventId).toBe("X-Zafronix-Event-Id");
      expect(ZAFRONIX_HEADERS.webhookId).toBe("X-Zafronix-Webhook-Id");
      expect(ZAFRONIX_HEADERS.deliveryAttempt).toBe("X-Zafronix-Delivery-Attempt");
    });
  });
});

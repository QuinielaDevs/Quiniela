import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  verifySignature,
  baseEventSchema,
  matchFinalizedPayload,
  matchPatchedPayload,
  matchPostponedPayload,
  ZAFRONIX_HEADERS,
} from "../../src/lib/zafronix/contract";

const fixturePath = join(__dirname, "../fixtures/zafronix/real-delivery.local.json");
const fixtureExists = existsSync(fixturePath);

describe.skipIf(!fixtureExists)("Zafronix webhook - Real delivery verification (Gated)", () => {
  const loadFixture = () => {
    const rawData = readFileSync(fixturePath, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawData);
    } catch (e) {
      throw new Error(`El archivo real-delivery.local.json no es un JSON válido: ${(e as Error).message}`);
    }

    const wrapper = parsed as { headers: Record<string, string>; rawBody: string };
    if (!wrapper || typeof wrapper !== "object" || !wrapper.headers || wrapper.rawBody === undefined) {
      throw new Error(
        "El fixture real-delivery.local.json debe ser un objeto wrapper JSON que contenga las propiedades 'headers' y 'rawBody'. " +
        "Ejemplo:\n{\n  \"headers\": { \"X-Zafronix-Signature-256\": \"...\", \"X-Zafronix-Timestamp\": \"...\" },\n  \"rawBody\": \"{\\\"type\\\":\\\"match.finalized\\\",...}\"\n}"
      );
    }

    return wrapper;
  };

  it("debe contener todas las cabeceras obligatorias del contrato de Zafronix", () => {
    const { headers } = loadFixture();
    
    // Normalizar cabeceras a minúsculas para búsqueda insensible a mayúsculas
    const normalizedHeaders = Object.keys(headers).reduce((acc, key) => {
      acc[key.toLowerCase()] = headers[key] ?? "";
      return acc;
    }, {} as Record<string, string>);

    for (const [, headerName] of Object.entries(ZAFRONIX_HEADERS)) {
      const lowerHeaderName = headerName.toLowerCase();
      expect(normalizedHeaders[lowerHeaderName], `Falta la cabecera del contrato: ${headerName}`).toBeDefined();
      expect(normalizedHeaders[lowerHeaderName], `La cabecera ${headerName} no puede estar vacía`).not.toBe("");
    }
  });

  it("debe validar la firma real de Zafronix usando el secreto de producción", () => {
    const { headers, rawBody } = loadFixture();
    
    // Buscar cabeceras de firma y timestamp de forma insensible a mayúsculas
    const normalizedHeaders = Object.keys(headers).reduce((acc, key) => {
      acc[key.toLowerCase()] = headers[key] ?? "";
      return acc;
    }, {} as Record<string, string>);

    const signature = normalizedHeaders[ZAFRONIX_HEADERS.signature.toLowerCase()];
    const timestamp = normalizedHeaders[ZAFRONIX_HEADERS.timestamp.toLowerCase()];

    expect(signature, "Falta la cabecera de firma").toBeDefined();
    expect(timestamp, "Falta la cabecera de timestamp").toBeDefined();
    
    if (!signature || !timestamp) {
      throw new Error("Missing signature or timestamp headers");
    }
    
    const secret = process.env.ZAFRONIX_WEBHOOK_SECRET;
    expect(secret, "Falta definir ZAFRONIX_WEBHOOK_SECRET real en el entorno").toBeDefined();
    
    const isValid = verifySignature(rawBody, timestamp, signature, secret!);
    expect(isValid, "La firma real de Zafronix no coincide con el secreto configurado").toBe(true);
  });

  it("debe parsear el payload real y validar con su esquema específico", () => {
    const { rawBody } = loadFixture();
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch (e) {
      throw new Error(`El campo rawBody de real-delivery.local.json no es un JSON válido: ${(e as Error).message}`);
    }

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

import { describe, expect, it } from "vitest";

import { createLeagueSchema } from "@/app/actions/leagues.schema";

// Story 1.3 — validación del formulario de creación de liga (AC #1, #2, #6).

const base = {
  name: "Liga de Cris",
  headerWord: "PIJA",
  predictionMode: "dual" as const,
  requiresPayment: false,
};

describe("createLeagueSchema", () => {
  it("acepta una liga válida sin pago", () => {
    const result = createLeagueSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("acepta una liga válida con pago (monto ≥ 0 e instrucciones)", () => {
    const result = createLeagueSchema.safeParse({
      ...base,
      requiresPayment: true,
      paymentAmount: 10,
      paymentInstructions: "Zelle: cris@pija.com",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza nombre vacío", () => {
    const result = createLeagueSchema.safeParse({ ...base, name: "   " });
    expect(result.success).toBe(false);
  });

  it("rechaza un modo de predicción no permitido", () => {
    const result = createLeagueSchema.safeParse({
      ...base,
      predictionMode: "otro",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza monto negativo cuando requiere pago", () => {
    const result = createLeagueSchema.safeParse({
      ...base,
      requiresPayment: true,
      paymentAmount: -5,
      paymentInstructions: "Zelle",
    });
    expect(result.success).toBe(false);
  });

  it("exige monto cuando requiere pago", () => {
    const result = createLeagueSchema.safeParse({
      ...base,
      requiresPayment: true,
      paymentInstructions: "Zelle",
    });
    expect(result.success).toBe(false);
  });

  it("exige instrucciones no vacías cuando requiere pago", () => {
    const result = createLeagueSchema.safeParse({
      ...base,
      requiresPayment: true,
      paymentAmount: 10,
      paymentInstructions: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza una primera palabra del encabezado vacía", () => {
    const result = createLeagueSchema.safeParse({ ...base, headerWord: "   " });
    expect(result.success).toBe(false);
  });

  it("rechaza una primera palabra del encabezado de más de 20 caracteres", () => {
    const result = createLeagueSchema.safeParse({
      ...base,
      headerWord: "x".repeat(21),
    });
    expect(result.success).toBe(false);
  });

  it("ignora los campos de pago cuando no requiere pago", () => {
    const result = createLeagueSchema.safeParse({
      ...base,
      requiresPayment: false,
      paymentAmount: null,
      paymentInstructions: null,
    });
    expect(result.success).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  generateInviteCode,
} from "@/utils/invite-code";

// Story 1.3 — generador de invite_code: longitud/alfabeto correctos y sin
// caracteres ambiguos (O/0, I/1, L) para que sea fácil de dictar/teclear.

describe("generateInviteCode", () => {
  it("usa la longitud por defecto", () => {
    expect(generateInviteCode()).toHaveLength(INVITE_CODE_LENGTH);
  });

  it("respeta una longitud explícita", () => {
    expect(generateInviteCode(6)).toHaveLength(6);
    expect(generateInviteCode(12)).toHaveLength(12);
  });

  it("solo emite caracteres del alfabeto permitido", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateInviteCode();
      for (const ch of code) {
        expect(INVITE_CODE_ALPHABET).toContain(ch);
      }
    }
  });

  it("nunca incluye caracteres ambiguos (O, 0, I, 1, L)", () => {
    expect(INVITE_CODE_ALPHABET).not.toMatch(/[O0I1L]/);
    const sample = Array.from({ length: 200 }, () => generateInviteCode()).join(
      "",
    );
    expect(sample).not.toMatch(/[O0I1L]/);
  });

  it("produce códigos distintos en llamadas sucesivas (no constante)", () => {
    const codes = new Set(
      Array.from({ length: 50 }, () => generateInviteCode()),
    );
    // Con 8 chars de 31 símbolos, 50 códigos deberían ser casi siempre únicos.
    // No exigimos 50/50 exacto (una colisión es improbable pero posible y haría
    // el test no determinista); basta con confirmar alta entropía / no-constante.
    expect(codes.size).toBeGreaterThanOrEqual(49);
  });
});

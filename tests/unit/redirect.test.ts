import { describe, expect, it } from "vitest";

import { getSafeNextPath } from "@/utils/redirect";

describe("getSafeNextPath", () => {
  it("usa /predictions como fallback para destinos inseguros", () => {
    expect(getSafeNextPath("https://evil.test/phish")).toBe("/predictions");
    expect(getSafeNextPath("//evil.test/phish")).toBe("/predictions");
  });

  it("normaliza la ruta legado /protected hacia /predictions", () => {
    expect(getSafeNextPath("/protected")).toBe("/predictions");
    expect(getSafeNextPath("/protected?joined=1")).toBe("/predictions");
  });

  it("permite rutas internas válidas", () => {
    expect(getSafeNextPath("/join/ABCDN234")).toBe("/join/ABCDN234");
    expect(getSafeNextPath("/desafio/challenge-1")).toBe("/desafio/challenge-1");
  });
});

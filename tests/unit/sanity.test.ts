import { describe, it, expect } from "vitest";

// Smoke test trivial que valida que el proyecto "unit" de Vitest está bien
// configurado (entorno jsdom + matchers de jest-dom).
describe("unit smoke", () => {
  it("ejecuta lógica pura", () => {
    expect(1 + 1).toBe(2);
  });

  it("dispone de jsdom y matchers de jest-dom", () => {
    const el = document.createElement("div");
    el.textContent = "Pija Quiniela";
    document.body.appendChild(el);

    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("Pija Quiniela");
  });
});

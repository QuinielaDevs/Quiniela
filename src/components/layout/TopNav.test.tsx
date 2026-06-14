import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TopNav } from "@/components/layout/TopNav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/standings",
}));

describe("TopNav", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DUELS", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    cleanup();
  });

  it("muestra el brand enlazando a Pronósticos y marca la sección activa", () => {
    render(<TopNav />);

    const brand = screen.getByRole("link", { name: /pija quiniela/i });
    expect(brand).toHaveAttribute("href", "/predictions");

    // En /standings, Posiciones queda activa; el resto no.
    const standings = screen.getByRole("link", { name: /posiciones/i });
    expect(standings).toHaveAttribute("href", "/standings");
    expect(standings).toHaveAttribute("aria-current", "page");

    const duels = screen.getByRole("link", { name: /duelos/i });
    expect(duels).not.toHaveAttribute("aria-current", "page");

    const rules = screen.getByRole("link", { name: /reglas/i });
    expect(rules).toHaveAttribute("href", "/rules");
    expect(rules).not.toHaveAttribute("aria-current", "page");
  });

  it("oculta el link de Duelos cuando están deshabilitados", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DUELS", "false");
    render(<TopNav />);

    const duels = screen.queryByRole("link", { name: /duelos/i });
    expect(duels).toBeNull();
  });

  it("usa 'PIJA' como primera palabra del brand por defecto", () => {
    render(<TopNav />);
    expect(
      screen.getByRole("link", { name: /pija quiniela/i }),
    ).toBeInTheDocument();
  });

  it("respeta la primera palabra de la liga activa vía brandWord", () => {
    render(<TopNav brandWord="Compadres" />);
    expect(
      screen.getByRole("link", { name: /compadres quiniela/i }),
    ).toBeInTheDocument();
  });
});

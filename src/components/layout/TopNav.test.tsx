import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TopNav } from "@/components/layout/TopNav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/standings",
}));

describe("TopNav", () => {
  afterEach(() => {
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
  });
});

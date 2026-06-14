import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BottomNavbar } from "@/components/layout/BottomNavbar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/account",
}));

describe("BottomNavbar", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DUELS", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    cleanup();
  });

  it("activa Mi Cuenta y expone Duelos como destino real cuando los duelos están habilitados (Epic 5)", () => {
    render(<BottomNavbar />);

    const account = screen.getByRole("link", { name: /mi cuenta/i });
    expect(account).toHaveAttribute("href", "/account");
    expect(account).toHaveAttribute("aria-current", "page");

    const duels = screen.getByRole("link", { name: /duelos/i });
    expect(duels).toHaveAttribute("href", "/duels");
    expect(duels).not.toHaveAttribute("aria-current", "page");

    const rules = screen.getByRole("link", { name: /reglas/i });
    expect(rules).toHaveAttribute("href", "/rules");
    expect(rules).not.toHaveAttribute("aria-current", "page");
  });

  it("oculta el link de Duelos cuando están deshabilitados", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DUELS", "false");
    render(<BottomNavbar />);

    const duels = screen.queryByRole("link", { name: /duelos/i });
    expect(duels).toBeNull();
  });
});

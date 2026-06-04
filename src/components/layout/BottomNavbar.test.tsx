import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BottomNavbar } from "@/components/layout/BottomNavbar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/account",
}));

describe("BottomNavbar", () => {
  afterEach(() => {
    cleanup();
  });

  it("activa Mi Cuenta y mantiene Duelos deshabilitado", () => {
    render(<BottomNavbar />);

    const account = screen.getByRole("link", { name: /mi cuenta/i });
    expect(account).toHaveAttribute("href", "/account");
    expect(account).toHaveAttribute("aria-current", "page");

    expect(screen.queryByRole("link", { name: /duelos/i })).not.toBeInTheDocument();
    expect(screen.getByText("Duelos").closest("[aria-disabled='true']")).toBeInTheDocument();
  });
});

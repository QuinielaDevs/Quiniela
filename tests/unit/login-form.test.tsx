import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/components/login-form";

const push = vi.fn();
const signInWithPassword = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/utils/supabase/client", () => ({
  createClient: () => ({
    auth: { signInWithPassword },
  }),
}));

vi.mock("@/components/google-signin-button", () => ({
  GoogleSignInButton: ({ next }: { next?: string }) => (
    <button type="button">Google next: {next}</button>
  ),
}));

describe("LoginForm", () => {
  beforeEach(() => {
    cleanup();
    push.mockReset();
    signInWithPassword.mockReset();
  });

  it("redirige al next path después de login email/password", async () => {
    signInWithPassword.mockResolvedValue({ error: null });

    render(<LoginForm next="/join/ABCDN234" />);

    await userEvent.type(screen.getByLabelText("Correo electrónico"), "cris@test.local");
    await userEvent.type(screen.getByLabelText("Contraseña"), "Password123!");
    await userEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/join/ABCDN234");
    });
    expect(screen.getByText("Google next: /join/ABCDN234")).toBeInTheDocument();
  });

  it("normaliza next inseguro antes de redirigir o pasarlo a Google", async () => {
    signInWithPassword.mockResolvedValue({ error: null });

    render(<LoginForm next="https://evil.test/phish" />);

    await userEvent.type(screen.getByLabelText("Correo electrónico"), "cris@test.local");
    await userEvent.type(screen.getByLabelText("Contraseña"), "Password123!");
    await userEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/predictions");
    });
    expect(screen.getByText("Google next: /predictions")).toBeInTheDocument();
  });

  it("normaliza /protected hacia /predictions para evitar la vista legado", async () => {
    signInWithPassword.mockResolvedValue({ error: null });

    render(<LoginForm next="/protected" />);

    await userEvent.type(screen.getByLabelText("Correo electrónico"), "cris@test.local");
    await userEvent.type(screen.getByLabelText("Contraseña"), "Password123!");
    await userEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/predictions");
    });
    expect(screen.getByText("Google next: /predictions")).toBeInTheDocument();
  });
});

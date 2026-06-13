import type { ComponentPropsWithoutRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const single = vi.fn();
const getClaims = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  redirect,
}));

vi.mock("next/image", () => ({
  default: ({ src, alt, ...props }: ComponentPropsWithoutRef<"img">) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt ?? ""} {...props} />;
  },
}));

vi.mock("@/components/google-signin-button", () => ({
  GoogleSignInButton: () => (
    <button type="button">Continuar con Google</button>
  ),
}));

vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc,
    auth: { getClaims },
  })),
}));

describe("/join/[invite_code]", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    rpc.mockImplementation((fnName: string) => {
      if (fnName === "fn_get_invite_landing") return { single };

      return Promise.resolve({
        data: {
          id: "member-1",
          league_id: "league-1",
          user_id: "user-1",
          role: "member",
          payment_status: "pending",
          joined_at: "2026-06-02T00:00:00.000Z",
        },
        error: null,
      });
    });
    getClaims.mockResolvedValue({ data: null, error: null });
  });

  afterEach(async () => {
    cleanup();
    // Flush pending microtasks/timers so they run before JSDOM is destroyed
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("renderiza nombre de liga y CTA Google para visitantes no autenticados", async () => {
    single.mockResolvedValue({
      data: {
        league_name: "La Pija Quiniela",
        creator_display_name: "Cris",
        creator_avatar_url: "/assets/avatars/default-player.svg",
        requires_payment: true,
        payment_amount: 10,
        payment_instructions: "Zelle: cris@test.local",
        invite_code: "ABCDN234",
      },
      error: null,
    });
    const { JoinPageContent } = await import("@/app/join/[invite_code]/page");

    render(
      await JoinPageContent({
        params: Promise.resolve({ invite_code: "abcdn234" }),
      }),
    );

    expect(screen.getByText("Únete a La Pija Quiniela")).toBeInTheDocument();
    expect(screen.getByText("Invitación de")).toBeInTheDocument();
    expect(screen.getByText("Cris")).toBeInTheDocument();
    expect(
      screen.getByText(/Tarifa de inscripción: \$10 USD/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continuar con Google" }),
    ).toBeInTheDocument();
  });

  it("renderiza estado inválido para códigos inexistentes", async () => {
    single.mockResolvedValue({
      data: null,
      error: { message: "Invitación inválida" },
    });
    const { JoinPageContent } = await import("@/app/join/[invite_code]/page");

    render(
      await JoinPageContent({
        params: Promise.resolve({ invite_code: "nope9999" }),
      }),
    );

    expect(screen.getByText("Invitación no disponible")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Revisa el enlace o pídele al administrador que te comparta uno nuevo.",
      ),
    ).toBeInTheDocument();
  });

  it("une automáticamente y redirige cuando el visitante ya está autenticado", async () => {
    single.mockResolvedValue({
      data: {
        league_name: "La Pija Quiniela",
        creator_display_name: "Cris",
        creator_avatar_url: "https://lh3.googleusercontent.com/avatar.jpg",
        requires_payment: false,
        payment_amount: null,
        payment_instructions: null,
        invite_code: "ABCDN234",
      },
      error: null,
    });
    getClaims.mockResolvedValue({
      data: { claims: { sub: "user-1" } },
      error: null,
    });
    const { JoinPageContent } = await import("@/app/join/[invite_code]/page");

    await expect(
      JoinPageContent({
        params: Promise.resolve({ invite_code: "abcdn234" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/predictions?joined=1&league=league-1");

    expect(rpc).toHaveBeenCalledWith("fn_join_league_by_invite", {
      p_invite_code: "ABCDN234",
    });
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
const from = vi.fn();
const materializeCurrentMemberAwards = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect,
  usePathname: () => "/account",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims }, from })),
}));

vi.mock("@/app/account/account-awards", () => ({
  materializeCurrentMemberAwards: (...args: unknown[]) =>
    materializeCurrentMemberAwards(...args),
}));

vi.mock("@/components/layout/BottomNavbar", () => ({
  BottomNavbar: () => <nav data-testid="bottom-nav" />,
}));

function tableBuilder(result: { data: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    builder[method] = () => builder;
  }
  builder.single = () =>
    Promise.resolve({ error: result.error ?? null, data: result.data });
  builder.maybeSingle = () =>
    Promise.resolve({ error: result.error ?? null, data: result.data });
  builder.then = (
    resolve: (value: { data: unknown; error: unknown }) => unknown,
  ) => resolve({ error: result.error ?? null, data: result.data });
  return builder;
}

function mockTables(byTable: Record<string, { data: unknown; error?: unknown }>) {
  from.mockImplementation((table: string) =>
    tableBuilder(byTable[table] ?? { data: null }),
  );
}

async function renderBoard() {
  const { AccountBoard } = await import("@/app/account/page");
  render(await AccountBoard());
}

describe("/account (AccountBoard)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
    materializeCurrentMemberAwards.mockResolvedValue({
      closedMatchdays: [],
      predictedClosedMatchdays: [],
      materializedMatchdays: [],
      errors: [],
    });
  });

  afterEach(async () => {
    cleanup();
    // Flush pending microtasks/timers so they run before JSDOM is destroyed
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("redirige a login si no hay sesion", async () => {
    getClaims.mockResolvedValue({ data: null });
    const { AccountBoard } = await import("@/app/account/page");
    await expect(AccountBoard()).rejects.toThrow("NEXT_REDIRECT:/auth/login");
  });

  it("muestra estado vacio si el usuario no pertenece a ninguna liga", async () => {
    mockTables({ league_members: { data: [] } });
    await renderBoard();

    expect(screen.getByText("Aún no perteneces a una liga")).toBeInTheDocument();
  });

  it("renderiza perfil, liga, medallas y perfil psicologico", async () => {
    materializeCurrentMemberAwards.mockResolvedValue({
      closedMatchdays: [1],
      predictedClosedMatchdays: [1],
      materializedMatchdays: [],
      errors: [],
    });
    mockTables({
      league_members: {
        data: [{ league_id: "league-1", joined_at: "2026-06-01T00:00:00Z" }],
      },
      profiles: {
        data: {
          display_name: "Ana",
          avatar_url: "/assets/avatars/default-player.svg",
        },
      },
      leagues: { data: { name: "Liga de Ana" } },
      member_badges: {
        data: [
          {
            badge_type: "nostradamus",
            badge_label: "Nostradamus",
            matchday: 1,
            reason: "Marcador exacto difícil",
            points: 5,
          },
        ],
      },
      member_game_profiles: {
        data: [
          {
            profile_type: "optimista",
            profile_label: "Optimista",
            matchday: 1,
            summary: "Juega esperando marcadores amplios.",
          },
        ],
      },
    });

    await renderBoard();

    expect(materializeCurrentMemberAwards).toHaveBeenCalledWith(
      expect.objectContaining({ leagueId: "league-1", userId: "user-1" }),
    );
    expect(screen.getByText("Mi Cuenta")).toBeInTheDocument();
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("Liga de Ana")).toBeInTheDocument();
    expect(screen.getByText("Optimista")).toBeInTheDocument();
    expect(screen.getByText("Nostradamus")).toBeInTheDocument();
  });

  it("distingue jornadas cerradas sin predicciones evaluables", async () => {
    materializeCurrentMemberAwards.mockResolvedValue({
      closedMatchdays: [1],
      predictedClosedMatchdays: [],
      materializedMatchdays: [],
      errors: [],
    });
    mockTables({
      league_members: {
        data: [{ league_id: "league-1", joined_at: "2026-06-01T00:00:00Z" }],
      },
      profiles: {
        data: {
          display_name: "Ana",
          avatar_url: "/assets/avatars/default-player.svg",
        },
      },
      leagues: { data: { name: "Liga de Ana" } },
      member_badges: { data: [] },
      member_game_profiles: { data: [] },
    });

    await renderBoard();

    expect(
      screen.getByText(
        "Hay jornadas cerradas, pero todavía no tienes predicciones evaluables para perfilar tu juego.",
      ),
    ).toBeInTheDocument();
  });

  it("muestra error recuperable si falla la carga de membresia", async () => {
    mockTables({
      league_members: {
        data: null,
        error: new Error("permission denied"),
      },
    });

    await renderBoard();

    expect(screen.getByText("No pudimos cargar tu cuenta")).toBeInTheDocument();
  });
});

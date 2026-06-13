import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
const from = vi.fn();
// RPC fn_get_league_award_points (BUG-004): por defecto sin premios resueltos.
const rpc = vi.fn(async () => ({ data: [], error: null }));
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect,
  usePathname: () => "/live",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims }, from, rpc })),
}));

vi.mock("@/components/layout/BottomNavbar", () => ({
  BottomNavbar: () => <nav data-testid="bottom-nav" />,
}));

vi.mock("@/components/live/LiveStandingsBoard", () => ({
  LiveStandingsBoard: ({
    members,
    initialMatches,
    initialPredictions,
  }: {
    members: unknown[];
    initialMatches: unknown[];
    initialPredictions: unknown[];
  }) => (
    <div data-testid="live-board">
      miembros: {members.length}; partidos: {initialMatches.length};
      predicciones: {initialPredictions.length}
    </div>
  ),
}));

function tableBuilder(result: { data: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "in"]) {
    builder[method] = () => builder;
  }
  builder.single = () => Promise.resolve({ error: null, ...result });
  builder.maybeSingle = () => Promise.resolve({ error: null, ...result });
  builder.then = (resolve: (value: { data: unknown; error: null }) => unknown) =>
    resolve({ error: null, ...result });
  return builder;
}

function mockTables(byTable: Record<string, { data: unknown }>) {
  from.mockImplementation((table: string) =>
    tableBuilder(byTable[table] ?? { data: null }),
  );
}

async function renderBoard() {
  const { LiveBoard } = await import("@/app/live/page");
  render(await LiveBoard());
}

const MEMBERSHIPS = [{ league_id: "L1", joined_at: "2026-06-01T00:00:00.000Z" }];

const MEMBERS = [
  {
    user_id: "user-1",
    payment_status: "pending",
    joined_at: "2026-06-01T00:00:00.000Z",
    profiles: { display_name: "Ana", avatar_url: "/a.svg" },
  },
  {
    user_id: "user-2",
    payment_status: "paid",
    joined_at: "2026-06-02T00:00:00.000Z",
    profiles: { display_name: "Beto", avatar_url: "/b.svg" },
  },
];

const MATCHES = [
  {
    id: "m1",
    status: "finished",
    matchday: 1,
    home_team: "Ecuador",
    away_team: "Qatar",
    home_team_code: "ECU",
    away_team_code: "QAT",
    home_score: 1,
    away_score: 0,
    match_time: "2026-06-11T20:00:00.000Z",
  },
  {
    id: "m2",
    status: "live",
    matchday: 1,
    home_team: "Mexico",
    away_team: "Polonia",
    home_team_code: "MEX",
    away_team_code: "POL",
    home_score: 0,
    away_score: 0,
    match_time: "2026-06-12T20:00:00.000Z",
  },
];

describe("/live (LiveBoard)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
  });

  afterEach(async () => {
    cleanup();
    // Flush pending microtasks/timers so they run before JSDOM is destroyed
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("redirige a login si no hay sesion", async () => {
    getClaims.mockResolvedValue({ data: null });
    const { LiveBoard } = await import("@/app/live/page");
    await expect(LiveBoard()).rejects.toThrow("NEXT_REDIRECT:/auth/login");
  });

  it("muestra estado vacio si el usuario no pertenece a ninguna liga", async () => {
    mockTables({ league_members: { data: [] } });
    await renderBoard();
    expect(screen.getByText("Aún no perteneces a una liga")).toBeInTheDocument();
  });

  it("renderiza la tabla en vivo con miembros, partidos y predicciones iniciales", async () => {
    mockTables({
      league_members: { data: MEMBERS },
      matches: { data: MATCHES },
      predictions: {
        data: [
          {
            user_id: "user-1",
            match_id: "m1",
            home_score_pred: 1,
            away_score_pred: 0,
            multiplier: 1,
          },
        ],
      },
    });
    // La primera consulta a league_members resuelve membresia; la segunda lista
    // miembros de la liga.
    from.mockImplementation((table: string) => {
      if (table === "league_members") {
        const calls = from.mock.calls.filter(([name]) => name === "league_members").length;
        return tableBuilder(calls === 1 ? { data: MEMBERSHIPS } : { data: MEMBERS });
      }
      return tableBuilder(
        table === "matches"
          ? { data: MATCHES }
          : table === "predictions"
            ? {
                data: [
                  {
                    user_id: "user-1",
                    match_id: "m1",
                    home_score_pred: 1,
                    away_score_pred: 0,
                    multiplier: 1,
                  },
                ],
              }
            : { data: null },
      );
    });

    await renderBoard();

    expect(screen.getByTestId("live-board")).toHaveTextContent("miembros: 2");
    expect(screen.getByTestId("live-board")).toHaveTextContent("partidos: 2");
    expect(screen.getByTestId("live-board")).toHaveTextContent("predicciones: 1");
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
const from = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({ redirect }));

vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims }, from })),
}));

// Los componentes cliente se stubbean: el test enfoca el gating server-side.
vi.mock("@/components/standings/MemberAdminList", () => ({
  MemberAdminList: ({ members }: { members: unknown[] }) => (
    <div data-testid="member-admin-list">miembros: {members.length}</div>
  ),
}));
vi.mock("@/components/standings/MatchAdminList", () => ({
  MatchAdminList: ({ matches }: { matches: unknown[] }) => (
    <div data-testid="match-admin-list">partidos: {matches.length}</div>
  ),
}));
vi.mock("@/components/layout/BottomNavbar", () => ({
  BottomNavbar: () => <nav data-testid="bottom-nav" />,
}));

function tableBuilder(result: { data: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "in", "not"]) {
    builder[method] = () => builder;
  }
  builder.single = () => Promise.resolve({ error: null, ...result });
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
  const { ManageBoard } = await import("@/app/standings/manage/page");
  render(await ManageBoard());
}

const MEMBERS_ADMIN = [
  {
    league_id: "L1",
    user_id: "user-1",
    role: "admin",
    payment_status: "pending",
    joined_at: "2026-06-01T00:00:00.000Z",
    profiles: { display_name: "Cris", avatar_url: "/c.svg" },
  },
  {
    league_id: "L1",
    user_id: "user-2",
    role: "member",
    payment_status: "paid",
    joined_at: "2026-06-02T00:00:00.000Z",
    profiles: { display_name: "Diego", avatar_url: "/d.svg" },
  },
];

const MEMBERS_NON_ADMIN = [
  { ...MEMBERS_ADMIN[0], role: "member" },
  MEMBERS_ADMIN[1],
];

describe("/standings/manage (ManageBoard)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
  });

  afterEach(() => {
    cleanup();
  });

  it("redirige a login si no hay sesión", async () => {
    getClaims.mockResolvedValue({ data: null });
    const { ManageBoard } = await import("@/app/standings/manage/page");
    await expect(ManageBoard()).rejects.toThrow("NEXT_REDIRECT:/auth/login");
  });

  it("muestra estado vacío si el usuario no pertenece a ninguna liga", async () => {
    mockTables({ league_members: { data: [] } });
    await renderBoard();
    expect(screen.getByText("Aún no perteneces a una liga")).toBeInTheDocument();
  });

  it("redirige a /standings si el usuario no es admin", async () => {
    mockTables({ league_members: { data: MEMBERS_NON_ADMIN } });
    const { ManageBoard } = await import("@/app/standings/manage/page");
    await expect(ManageBoard()).rejects.toThrow("NEXT_REDIRECT:/standings");
  });

  it("renderiza los paneles de miembros y de partidos para un admin", async () => {
    mockTables({
      league_members: { data: MEMBERS_ADMIN },
      matches: {
        data: [
          {
            id: "M1",
            home_team: "México",
            away_team: "Sudáfrica",
            home_team_code: "MEX",
            away_team_code: "RSA",
            match_time: "2026-06-11T19:00:00.000Z",
            status: "scheduled",
            home_score: null,
            away_score: null,
            group_label: "A",
            matchday: 1,
          },
        ],
      },
    });
    await renderBoard();
    expect(screen.getByTestId("member-admin-list")).toHaveTextContent(
      "miembros: 2",
    );
    expect(screen.getByTestId("match-admin-list")).toHaveTextContent(
      "partidos: 1",
    );
  });
});

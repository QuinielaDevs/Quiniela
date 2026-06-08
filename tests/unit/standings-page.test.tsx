import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
const from = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect,
  usePathname: () => "/standings",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims }, from })),
}));

// Componentes cliente stubbeados: el test enfoca el plumbing de datos de la página.
vi.mock("@/components/standings/StandingsTable", () => ({
  StandingsTable: ({ members }: { members: unknown[] }) => (
    <div data-testid="standings-table">miembros: {members.length}</div>
  ),
}));
vi.mock("@/components/standings/PaymentBanner", () => ({
  PaymentBanner: ({ amount }: { amount: number | null }) => (
    <div data-testid="payment-banner">pago: {amount}</div>
  ),
}));
vi.mock("@/components/layout/BottomNavbar", () => ({
  BottomNavbar: () => <nav data-testid="bottom-nav" />,
}));

// Builder encadenable + thenable. select/eq/order/limit/in devuelven el builder;
// await resuelve {data}; single() resuelve {data} (para el query de leagues).
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
  const { StandingsBoard } = await import("@/app/standings/page");
  render(await StandingsBoard());
}

const MEMBERS = [
  {
    league_id: "L1",
    user_id: "user-1",
    role: "member",
    payment_status: "pending",
    joined_at: "2026-06-01T00:00:00.000Z",
    profiles: { display_name: "Ana", avatar_url: "/a.svg" },
  },
  {
    league_id: "L1",
    user_id: "user-2",
    role: "member",
    payment_status: "paid",
    joined_at: "2026-06-02T00:00:00.000Z",
    profiles: { display_name: "Beto", avatar_url: "/b.svg" },
  },
];

const MEMBERS_AS_ADMIN = [
  { ...MEMBERS[0], role: "admin" },
  MEMBERS[1],
];

describe("/standings (StandingsBoard)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
  });

  afterEach(() => {
    cleanup();
  });

  it("redirige a login si no hay sesion", async () => {
    getClaims.mockResolvedValue({ data: null });
    const { StandingsBoard } = await import("@/app/standings/page");
    await expect(StandingsBoard()).rejects.toThrow("NEXT_REDIRECT:/auth/login");
  });

  it("muestra estado vacio si el usuario no pertenece a ninguna liga", async () => {
    mockTables({ league_members: { data: [] } });
    await renderBoard();
    expect(screen.getByText("Aún no perteneces a una liga")).toBeInTheDocument();
  });

  it("renderiza la tabla y muestra el banner de pago a un deudor de liga con pago requerido", async () => {
    mockTables({
      league_members: { data: MEMBERS },
      matches: { data: [] },
      leagues: {
        data: {
          name: "La Pija",
          requires_payment: true,
          payment_amount: 20,
          payment_instructions: "Bizum",
        },
      },
    });

    await renderBoard();

    expect(screen.getByTestId("standings-table")).toHaveTextContent(
      "miembros: 2",
    );
    expect(screen.getByTestId("payment-banner")).toBeInTheDocument();
  });

  it("no muestra banner si la liga no requiere pago", async () => {
    mockTables({
      league_members: { data: MEMBERS },
      matches: { data: [] },
      leagues: {
        data: {
          name: "La Pija",
          requires_payment: false,
          payment_amount: null,
          payment_instructions: null,
        },
      },
    });

    await renderBoard();

    expect(screen.queryByTestId("payment-banner")).not.toBeInTheDocument();
  });

  it("muestra el engranaje de gestión solo si el usuario actual es admin", async () => {
    mockTables({
      league_members: { data: MEMBERS_AS_ADMIN },
      matches: { data: [] },
      leagues: {
        data: {
          name: "La Pija",
          requires_payment: false,
          payment_amount: null,
          payment_instructions: null,
        },
      },
    });

    await renderBoard();

    const gear = screen.getByLabelText("Gestionar liga");
    expect(gear).toBeInTheDocument();
    expect(gear).toHaveAttribute("href", "/standings/manage");
  });

  it("muestra enlace a la tabla en vivo", async () => {
    mockTables({
      league_members: { data: MEMBERS },
      matches: { data: [] },
      leagues: {
        data: {
          name: "La Pija",
          requires_payment: false,
          payment_amount: null,
          payment_instructions: null,
        },
      },
    });

    await renderBoard();

    const liveLink = screen.getByLabelText("Ver tabla en vivo");
    expect(liveLink).toBeInTheDocument();
    expect(liveLink).toHaveAttribute("href", "/live");
  });

  it("no muestra el engranaje si el usuario actual no es admin", async () => {
    mockTables({
      league_members: { data: MEMBERS },
      matches: { data: [] },
      leagues: {
        data: {
          name: "La Pija",
          requires_payment: false,
          payment_amount: null,
          payment_instructions: null,
        },
      },
    });

    await renderBoard();

    expect(screen.queryByLabelText("Gestionar liga")).not.toBeInTheDocument();
  });
});

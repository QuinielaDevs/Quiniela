import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
const from = vi.fn();
const rpc = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims }, from, rpc })),
}));

// MatchCard es un client component que dispara la Server Action; lo stubbeamos
// para enfocar el test en el plumbing de datos de la página.
vi.mock("@/components/predictions/MatchCard", () => ({
  MatchCard: ({
    match,
    initialPrediction,
  }: {
    match: { home_team: string; away_team: string };
    initialPrediction: { homeScorePred: number; awayScorePred: number } | null;
  }) => (
    <div data-testid="match-card">
      {match.home_team} vs {match.away_team}
      {initialPrediction
        ? ` (${initialPrediction.homeScorePred}-${initialPrediction.awayScorePred})`
        : " (sin pronostico)"}
    </div>
  ),
}));

// Builder encadenable y "thenable": select/eq/order/limit devuelven el mismo
// builder, y await resuelve el resultado configurado para esa tabla.
function tableBuilder(result: { data: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "not", "order", "limit"]) {
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
  const { PredictionsBoard } = await import("@/app/predictions/page");
  render(await PredictionsBoard());
}

describe("/predictions (PredictionsBoard)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
    rpc.mockResolvedValue({
      data: [
        {
          edits_locked: false,
          label: "Before inaugural match",
          phase_code: "A",
        },
      ],
      error: null,
    });
  });

  it("redirige a login si no hay sesion", async () => {
    getClaims.mockResolvedValue({ data: null });
    const { PredictionsBoard } = await import("@/app/predictions/page");

    await expect(PredictionsBoard()).rejects.toThrow(
      "NEXT_REDIRECT:/auth/login",
    );
  });

  it("muestra estado vacio si el usuario no pertenece a ninguna liga", async () => {
    mockTables({ league_members: { data: [] } });

    await renderBoard();

    expect(
      screen.getByText("Aún no perteneces a una liga"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Crear una liga" })).toHaveAttribute(
      "href",
      "/leagues/new",
    );
  });

  it("muestra estado vacio si no hay partidos programados", async () => {
    mockTables({
      league_members: { data: [{ league_id: "league-1" }] },
      matches: { data: [] },
      predictions: { data: [] },
    });

    await renderBoard();

    expect(
      screen.getByText("No hay partidos disponibles aún"),
    ).toBeInTheDocument();
  });

  it("renderiza un MatchCard por partido y precarga la prediccion existente", async () => {
    mockTables({
      league_members: { data: [{ league_id: "league-1" }] },
      matches: {
        data: [
          {
            id: "m1",
            home_team: "Argentina",
            away_team: "Mexico",
            stage: "group",
            matchday: 1,
            group_label: "A",
          },
          {
            id: "m2",
            home_team: "Espana",
            away_team: "Alemania",
            stage: "group",
            matchday: 1,
            group_label: "B",
          },
        ],
      },
      predictions: {
        data: [
          {
            id: "p1",
            match_id: "m1",
            home_score_pred: 2,
            away_score_pred: 1,
            updated_at: "2026-06-03T00:00:00.000Z",
          },
        ],
      },
    });

    await renderBoard();

    const cards = screen.getAllByTestId("match-card");
    expect(cards).toHaveLength(2);
    expect(screen.getByText(/Argentina vs Mexico \(2-1\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/Espana vs Alemania \(sin pronostico\)/),
    ).toBeInTheDocument();
  });
});

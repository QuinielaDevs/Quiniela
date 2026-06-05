import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MatchAdminList } from "@/components/standings/MatchAdminList";
import type { AdminMatchView } from "@/components/standings/MatchAdminList";

const refresh = vi.fn();
const setMatchResult = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/app/actions/matches.actions", () => ({
  setMatchResult: (...args: unknown[]) => setMatchResult(...args),
}));

function makeMatch(overrides: Partial<AdminMatchView> = {}): AdminMatchView {
  return {
    id: "M1",
    homeTeam: "México",
    awayTeam: "Sudáfrica",
    homeTeamCode: "MEX",
    awayTeamCode: "RSA",
    matchTime: "2026-06-11T19:00:00.000Z",
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    groupLabel: "A",
    matchday: 1,
    ...overrides,
  };
}

describe("MatchAdminList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMatchResult.mockResolvedValue({ success: true, data: {}, error: null });
  });

  afterEach(() => cleanup());

  it("muestra un estado vacío sin partidos", () => {
    render(<MatchAdminList matches={[]} />);
    expect(screen.getByText("Sin partidos")).toBeInTheDocument();
  });

  it("renderiza el partido con equipos y estado", () => {
    render(<MatchAdminList matches={[makeMatch()]} />);
    expect(screen.getAllByText(/México/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Sudáfrica/).length).toBeGreaterThan(0);
    // Badge de estado (programado) presente.
    expect(screen.getAllByText("Programado").length).toBeGreaterThan(0);
  });

  it("un partido scheduled no muestra el editor de marcador hasta elegir live/finished", async () => {
    const user = userEvent.setup();
    render(<MatchAdminList matches={[makeMatch()]} />);

    // Sin GoalPicker al inicio (estado sin marcador).
    expect(
      screen.queryByLabelText("Incrementar goles de México"),
    ).not.toBeInTheDocument();

    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "finished");

    expect(
      screen.getByLabelText("Incrementar goles de México"),
    ).toBeInTheDocument();
  });

  it("guarda el resultado: llama setMatchResult y refresca", async () => {
    const user = userEvent.setup();
    render(<MatchAdminList matches={[makeMatch()]} />);

    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "finished");

    await user.click(screen.getByLabelText("Incrementar goles de México"));
    await user.click(screen.getByLabelText("Incrementar goles de México"));
    await user.click(screen.getByLabelText("Incrementar goles de Sudáfrica"));

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(setMatchResult).toHaveBeenCalledWith({
        matchId: "M1",
        homeScore: 2,
        awayScore: 1,
        status: "finished",
      });
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("muestra el error y no refresca si la acción falla", async () => {
    setMatchResult.mockResolvedValue({
      success: false,
      data: null,
      error: "No tienes permisos para realizar esta acción.",
    });
    const user = userEvent.setup();
    render(<MatchAdminList matches={[makeMatch({ status: "live", homeScore: 1, awayScore: 0 })]} />);

    // Estado live ya muestra editor; modificar para habilitar Guardar.
    await user.click(screen.getByLabelText("Incrementar goles de Sudáfrica"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(
        screen.getByText("No tienes permisos para realizar esta acción."),
      ).toBeInTheDocument(),
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("el botón Guardar está deshabilitado sin cambios", () => {
    render(<MatchAdminList matches={[makeMatch()]} />);
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("un partido finished solo ofrece transiciones válidas (finished, live)", () => {
    render(
      <MatchAdminList
        matches={[makeMatch({ status: "finished", homeScore: 2, awayScore: 0 })]}
      />,
    );
    const options = screen
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(["finished", "live"]);
  });

  it("muestra diálogo de confirmación para transición destructiva (finished -> live) y cancela/guarda", async () => {
    const user = userEvent.setup();
    render(
      <MatchAdminList
        matches={[makeMatch({ status: "finished", homeScore: 2, awayScore: 0 })]}
      />,
    );

    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "live");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(screen.getByText("¿Confirmar cambio destructivo?")).toBeInTheDocument();
    expect(setMatchResult).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText("¿Confirmar cambio destructivo?")).not.toBeInTheDocument();
    expect(setMatchResult).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await user.click(screen.getByRole("button", { name: "Sí, cambiar" }));

    await waitFor(() => {
      expect(setMatchResult).toHaveBeenCalledWith({
        matchId: "M1",
        homeScore: 2,
        awayScore: 0,
        status: "live",
      });
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

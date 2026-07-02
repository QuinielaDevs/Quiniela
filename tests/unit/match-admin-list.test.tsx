import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MatchAdminList } from "@/components/standings/MatchAdminList";
import type { AdminMatchView } from "@/components/standings/MatchAdminList";

const refresh = vi.fn();
const setMatchResult = vi.fn();
const recalculateTournamentAdvancement = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/app/actions/matches.actions", () => ({
  recalculateTournamentAdvancement: (...args: unknown[]) =>
    recalculateTournamentAdvancement(...args),
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
    stage: "group",
    homeScore: null,
    awayScore: null,
    groupLabel: "A",
    matchday: 1,
    bracketSlot: null,
    penaltiesHomeScore: null,
    penaltiesAwayScore: null,
    extraTimeHomeScore: null,
    extraTimeAwayScore: null,
    ...overrides,
  };
}

describe("MatchAdminList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMatchResult.mockResolvedValue({ success: true, data: {}, error: null });
    recalculateTournamentAdvancement.mockResolvedValue({
      success: true,
      data: null,
      error: null,
    });
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

  it("agrupa por acordeón y deja colapsadas las jornadas finalizadas", () => {
    render(
      <MatchAdminList
        matches={[
          makeMatch({
            id: "J1",
            status: "finished",
            homeScore: 2,
            awayScore: 0,
          }),
          makeMatch({
            id: "R32",
            homeTeam: "Germany",
            awayTeam: "Mexico",
            homeTeamCode: "GER",
            awayTeamCode: "MEX",
            matchTime: "2026-06-29T20:30:00.000Z",
            stage: "round-32",
            matchday: null,
            bracketSlot: 74,
          }),
        ]}
      />,
    );

    const jornada = screen.getByText("Jueves, 11 de junio de 2026").closest("details");
    const round32 = screen.getByText("Lunes, 29 de junio de 2026").closest("details");

    expect(jornada).not.toHaveAttribute("open");
    expect(round32).not.toHaveAttribute("open");
  });

  it("recalcula el bracket sin modificar resultados", async () => {
    const user = userEvent.setup();
    render(<MatchAdminList matches={[makeMatch()]} />);

    await user.click(screen.getByRole("button", { name: "Recalcular bracket" }));

    await waitFor(() => {
      expect(recalculateTournamentAdvancement).toHaveBeenCalledTimes(1);
    });
    expect(setMatchResult).not.toHaveBeenCalled();
    expect(screen.getByText("Bracket recalculado.")).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("muestra error si falla el recálculo del bracket", async () => {
    recalculateTournamentAdvancement.mockResolvedValue({
      success: false,
      data: null,
      error: "No se pudo actualizar el bracket.",
    });
    const user = userEvent.setup();
    render(<MatchAdminList matches={[makeMatch()]} />);

    await user.click(screen.getByRole("button", { name: "Recalcular bracket" }));

    await waitFor(() => {
      expect(
        screen.getByText("No se pudo actualizar el bracket."),
      ).toBeInTheDocument();
    });
    expect(refresh).not.toHaveBeenCalled();
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
        penaltiesHomeScore: null,
        penaltiesAwayScore: null,
        extraTimeHomeScore: null,
        extraTimeAwayScore: null,
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
        penaltiesHomeScore: null,
        penaltiesAwayScore: null,
        extraTimeHomeScore: null,
        extraTimeAwayScore: null,
      });
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("muestra selectores de penales para partido de knockout finalizado en empate y guarda", async () => {
    const user = userEvent.setup();
    render(
      <MatchAdminList
        matches={[
          makeMatch({
            id: "M2",
            bracketSlot: 74,
            status: "finished",
            homeScore: 1,
            awayScore: 1,
          }),
        ]}
      />,
    );

    // Deben aparecer los selectores de penales
    expect(screen.getByText("Tanda de Penales (Desempate)")).toBeInTheDocument();
    expect(screen.getByLabelText("Incrementar goles de Penales México")).toBeInTheDocument();
    expect(screen.getByLabelText("Incrementar goles de Penales Sudáfrica")).toBeInTheDocument();

    // Modificar penales: México 3 - 2 Sudáfrica
    await user.click(screen.getByLabelText("Incrementar goles de Penales México"));
    await user.click(screen.getByLabelText("Incrementar goles de Penales México"));
    await user.click(screen.getByLabelText("Incrementar goles de Penales México"));
    await user.click(screen.getByLabelText("Incrementar goles de Penales Sudáfrica"));
    await user.click(screen.getByLabelText("Incrementar goles de Penales Sudáfrica"));

    // Guardar
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(setMatchResult).toHaveBeenCalledWith({
        matchId: "M2",
        homeScore: 1,
        awayScore: 1,
        status: "finished",
        penaltiesHomeScore: 3,
        penaltiesAwayScore: 2,
        extraTimeHomeScore: 1,
        extraTimeAwayScore: 1,
      });
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("muestra tiempo extra y oculta penales si la prórroga tiene desempate y guarda", async () => {
    const user = userEvent.setup();
    render(
      <MatchAdminList
        matches={[
          makeMatch({
            id: "M3",
            bracketSlot: 75,
            status: "finished",
            homeScore: 1,
            awayScore: 1,
          }),
        ]}
      />,
    );

    // Al inicio (prórroga 0-0), deben aparecer penales
    expect(screen.getByText("Tiempo Extra / Prórroga")).toBeInTheDocument();
    expect(screen.getByText("Tanda de Penales (Desempate)")).toBeInTheDocument();

    // Modificar prórroga: México 2 - 1 Sudáfrica
    await user.click(screen.getByLabelText("Incrementar goles de Prórroga México"));
    await user.click(screen.getByLabelText("Incrementar goles de Prórroga México"));
    await user.click(screen.getByLabelText("Incrementar goles de Prórroga Sudáfrica"));

    // Tanda de penales debe desaparecer ya que no hay empate en prórroga
    expect(screen.queryByText("Tanda de Penales (Desempate)")).not.toBeInTheDocument();

    // Guardar
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(setMatchResult).toHaveBeenCalledWith({
        matchId: "M3",
        homeScore: 1,
        awayScore: 1,
        status: "finished",
        penaltiesHomeScore: null,
        penaltiesAwayScore: null,
        extraTimeHomeScore: 3,
        extraTimeAwayScore: 2,
      });
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JoinByCodeForm } from "./JoinByCodeForm";

const push = vi.fn();
const joinLeagueByInvite = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/app/actions/leagues.actions", () => ({
  joinLeagueByInvite: (code: string) => joinLeagueByInvite(code),
}));

describe("JoinByCodeForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("envía el código en mayúsculas y redirige al unirse con éxito", async () => {
    joinLeagueByInvite.mockResolvedValue({
      success: true,
      data: { league_id: "league-9" },
      error: null,
    });

    render(<JoinByCodeForm />);

    fireEvent.change(screen.getByLabelText("Código de invitación"), {
      target: { value: "abc123" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Unirme con el código" }),
    );

    await waitFor(() => {
      expect(joinLeagueByInvite).toHaveBeenCalledWith("ABC123");
    });
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(
        "/predictions?joined=1&league=league-9",
      );
    });
  });

  it("muestra el mensaje de error cuando la acción falla", async () => {
    joinLeagueByInvite.mockResolvedValue({
      success: false,
      data: null,
      error: "Código de invitación inválido.",
    });

    render(<JoinByCodeForm />);

    fireEvent.change(screen.getByLabelText("Código de invitación"), {
      target: { value: "ZZZ999" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Unirme con el código" }),
    );

    expect(
      await screen.findByText("Código de invitación inválido."),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("deshabilita el botón cuando el campo está vacío", () => {
    render(<JoinByCodeForm />);
    expect(
      screen.getByRole("button", { name: "Unirme con el código" }),
    ).toBeDisabled();
  });
});

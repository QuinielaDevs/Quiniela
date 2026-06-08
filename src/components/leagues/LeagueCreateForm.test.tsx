import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LeagueCreateForm } from "./LeagueCreateForm";

const push = vi.fn();
const createLeague = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/app/actions/leagues.actions", () => ({
  createLeague: (input: unknown) => createLeague(input),
}));

describe("LeagueCreateForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createLeague.mockResolvedValue({
      success: true,
      data: { id: "league-1" },
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("propone 'PIJA' como primera palabra del encabezado por defecto", () => {
    render(<LeagueCreateForm />);
    expect(
      screen.getByLabelText("Primera palabra del encabezado"),
    ).toHaveValue("PIJA");
  });

  it("envía headerWord junto con el resto del formulario", async () => {
    render(<LeagueCreateForm />);

    fireEvent.change(screen.getByLabelText("Nombre de la liga"), {
      target: { value: "La Liga de los Compadres" },
    });
    fireEvent.change(
      screen.getByLabelText("Primera palabra del encabezado"),
      { target: { value: "Compadres" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Crear Liga" }));

    await waitFor(() => {
      expect(createLeague).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "La Liga de los Compadres",
          headerWord: "Compadres",
          requiresPayment: false,
        }),
      );
    });
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/predictions");
    });
  });
});

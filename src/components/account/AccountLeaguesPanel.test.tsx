import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountLeaguesPanel } from "@/components/account/AccountLeaguesPanel";

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
  writeText.mockReset();
});

describe("AccountLeaguesPanel", () => {
  it("muestra liga actual y ligas donde participa", async () => {
    render(
      <AccountLeaguesPanel
        leagues={[
          {
            leagueId: "league-1",
            leagueName: "Liga Principal",
            inviteCode: "ABCDN234",
            role: "admin",
            paymentStatus: "paid",
            joinedAt: "2026-06-05T12:00:00.000Z",
            wagerBalance: 12.5,
            requiresPayment: true,
            isCurrent: true,
          },
          {
            leagueId: "league-2",
            leagueName: "Liga Amigos",
            inviteCode: "WXYZ9876",
            role: "member",
            paymentStatus: "pending",
            joinedAt: "2026-06-01T12:00:00.000Z",
            wagerBalance: 4,
            requiresPayment: false,
            isCurrent: false,
          },
        ]}
      />,
    );

    expect(screen.getAllByRole("heading", { name: "Liga Principal" })).toHaveLength(2);
    expect(screen.getByText("Estás jugando en 2 ligas.")).toBeInTheDocument();
    expect(screen.getByText("Liga actual")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Miembro")).toBeInTheDocument();
    expect(screen.getByText("Pago al día")).toBeInTheDocument();
    expect(screen.getByText("Sin pago requerido")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /crear liga/i })).toBeNull();
    expect(screen.getByText("ABCDN234")).toBeInTheDocument();
    expect(screen.getByText("WXYZ9876")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", {
        name: "Copiar código de invitación de Liga Principal",
      }),
    );

    expect(writeText).toHaveBeenCalledWith("ABCDN234");
    expect(
      screen.getByRole("button", {
        name: "Código de invitación de Liga Principal copiado",
      }),
    ).toBeInTheDocument();
  });

  it("copia el enlace de invitación de la liga", async () => {
    render(
      <AccountLeaguesPanel
        leagues={[
          {
            leagueId: "league-1",
            leagueName: "Liga Principal",
            inviteCode: "ABCDN234",
            role: "admin",
            paymentStatus: "paid",
            joinedAt: "2026-06-05T12:00:00.000Z",
            wagerBalance: 12.5,
            requiresPayment: true,
            isCurrent: true,
          },
        ]}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: "Copiar enlace de invitación de Liga Principal",
      }),
    );

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/join/ABCDN234`,
    );
    expect(
      screen.getByRole("button", {
        name: "Enlace de invitación de Liga Principal copiado",
      }),
    ).toBeInTheDocument();
  });
});

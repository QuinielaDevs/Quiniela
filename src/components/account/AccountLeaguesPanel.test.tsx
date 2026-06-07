import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AccountLeaguesPanel } from "@/components/account/AccountLeaguesPanel";

describe("AccountLeaguesPanel", () => {
  it("muestra liga actual y ligas donde participa", () => {
    render(
      <AccountLeaguesPanel
        leagues={[
          {
            leagueId: "league-1",
            leagueName: "Liga Principal",
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
    expect(screen.queryByRole("link", { name: /crear liga/i })).toBeNull();
    expect(screen.getByRole("button", { name: /crear liga/i })).toBeDisabled();
  });
});

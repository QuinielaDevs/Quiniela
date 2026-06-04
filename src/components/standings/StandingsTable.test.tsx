import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StandingsTable } from "@/components/standings/StandingsTable";
import { PaymentBanner } from "@/components/standings/PaymentBanner";
import type {
  StandingMatch,
  StandingMember,
  StandingPrediction,
} from "@/utils/standings";

// jsdom no implementa scrollIntoView/scrollBy → stub para que JornadaTabs no falle.
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollBy = vi.fn();
});

afterEach(() => {
  cleanup();
});

const MEMBERS: StandingMember[] = [
  {
    userId: "a",
    displayName: "Ana",
    avatarUrl: "/assets/avatars/default-player.svg",
    paymentStatus: "pending",
    joinedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    userId: "b",
    displayName: "Beto",
    avatarUrl: "/assets/avatars/default-player.svg",
    paymentStatus: "paid",
    joinedAt: "2026-06-02T00:00:00.000Z",
  },
];

const MATCHES: StandingMatch[] = [
  { id: "m1", status: "finished", matchday: 1, homeScore: 1, awayScore: 0 },
  { id: "m2", status: "finished", matchday: 2, homeScore: 0, awayScore: 2 },
];

const PREDICTIONS: StandingPrediction[] = [
  // Ana: exacto en ambos → General 10, J1 5, J2 5
  { userId: "a", matchId: "m1", homeScorePred: 1, awayScorePred: 0, multiplier: 1 },
  { userId: "a", matchId: "m2", homeScorePred: 0, awayScorePred: 2, multiplier: 1 },
  // Beto: resultado acertado en m1 (2 pts), nada en m2
  { userId: "b", matchId: "m1", homeScorePred: 2, awayScorePred: 0, multiplier: 1 },
];

function renderTable() {
  return render(
    <StandingsTable
      members={MEMBERS}
      matches={MATCHES}
      predictions={PREDICTIONS}
      matchdays={[1, 2]}
    />,
  );
}

describe("StandingsTable", () => {
  it("renderiza una fila por miembro con sus puntos acumulados (General por defecto)", () => {
    renderTable();
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("Beto")).toBeInTheDocument();
    expect(screen.getByText("10.0")).toBeInTheDocument();
    expect(screen.getByText("2.0")).toBeInTheDocument();
  });

  it("destaca al líder con la posición 1", () => {
    renderTable();
    // Ana es #1 (10 pts).
    const leaderRank = screen.getByLabelText("Posición 1");
    expect(leaderRank).toHaveTextContent("1");
  });

  it("muestra los badges de pago públicos", () => {
    renderTable();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText("Pagado")).toBeInTheDocument();
  });

  it("al cambiar de pestaña recalcula los puntos de esa jornada", () => {
    renderTable();
    // General: Ana 10.0
    expect(screen.getByText("10.0")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Jornada 2" }));

    // Jornada 2: Ana 5.0 y Beto 0.0
    expect(screen.getByText("5.0")).toBeInTheDocument();
    expect(screen.getByText("0.0")).toBeInTheDocument();
    expect(screen.queryByText("10.0")).not.toBeInTheDocument();
  });

  it("muestra empty state si la liga no tiene miembros", () => {
    render(
      <StandingsTable members={[]} matches={[]} predictions={[]} matchdays={[]} />,
    );
    expect(screen.getByText("Aún no hay participantes")).toBeInTheDocument();
  });
});

describe("PaymentBanner", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("se muestra y, al descartarlo, desaparece y persiste el descarte en sesión", () => {
    render(
      <PaymentBanner
        leagueId="league-1"
        leagueName="La Pija"
        amount={20}
        instructions="Bizum al 600..."
      />,
    );

    expect(screen.getByText("Tienes el pago pendiente")).toBeInTheDocument();
    expect(screen.getByText("Bizum al 600...")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Descartar aviso de pago"));

    expect(screen.queryByText("Tienes el pago pendiente")).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem("pq:payBannerDismissed:league-1")).toBe(
      "1",
    );
  });

  it("queda oculto si ya fue descartado esta sesión", () => {
    window.sessionStorage.setItem("pq:payBannerDismissed:league-1", "1");
    render(
      <PaymentBanner
        leagueId="league-1"
        leagueName="La Pija"
        amount={null}
        instructions={null}
      />,
    );
    expect(
      screen.queryByText("Tienes el pago pendiente"),
    ).not.toBeInTheDocument();
  });
});

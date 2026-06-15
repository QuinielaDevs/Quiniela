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
  { id: "m1", status: "finished", matchday: 1, stage: "group", homeScore: 1, awayScore: 0, homeTeam: "México", awayTeam: "Canadá" },
  { id: "m2", status: "finished", matchday: 2, stage: "group", homeScore: 0, awayScore: 2, homeTeam: "Brasil", awayTeam: "Argentina" },
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
      <StandingsTable members={[]} matches={[]} predictions={[]} />,
    );
    expect(screen.getByText("Aún no hay participantes")).toBeInTheDocument();
  });

  it("muestra el indicador de tendencia de posición (subió, bajó, sin cambios)", () => {
    const members: StandingMember[] = [
      { userId: "a", displayName: "Ana", avatarUrl: "", paymentStatus: "paid", joinedAt: "2026-06-01T00:00:00Z" },
      { userId: "b", displayName: "Beto", avatarUrl: "", paymentStatus: "paid", joinedAt: "2026-06-02T00:00:00Z" },
    ];
    const matches: StandingMatch[] = [
      { id: "m1", status: "finished", matchday: 1, homeScore: 1, awayScore: 0, updatedAt: "2026-06-14T10:00:00Z" },
      { id: "m2", status: "finished", matchday: 1, homeScore: 2, awayScore: 0, updatedAt: "2026-06-14T11:00:00Z" },
    ];
    const predictions: StandingPrediction[] = [
      { userId: "b", matchId: "m1", homeScorePred: 1, awayScorePred: 0, multiplier: 1 },
      { userId: "a", matchId: "m2", homeScorePred: 2, awayScorePred: 0, multiplier: 2 },
    ];

    render(
      <StandingsTable
        members={members}
        matches={matches}
        predictions={predictions}
      />
    );

    const trendAna = screen.getByLabelText("Subió 1 posición");
    expect(trendAna).toBeInTheDocument();
    expect(trendAna).toHaveAttribute("data-change", "1");

    const trendBeto = screen.getByLabelText("Bajó 1 posición");
    expect(trendBeto).toBeInTheDocument();
    expect(trendBeto).toHaveAttribute("data-change", "-1");
  });

  describe("Accordion – desglose de puntos", () => {
    it("expande el desglose al hacer clic en una fila y colapsa al clicar de nuevo", () => {
      renderTable();
      // Inicialmente sin acordeón
      expect(screen.queryByTestId("standings-accordion")).not.toBeInTheDocument();

      // Expandir la fila de Ana
      const rows = screen.getAllByTestId("standings-row-toggle");
      fireEvent.click(rows[0]!);
      expect(screen.getByTestId("standings-accordion")).toBeInTheDocument();

      // Colapsar
      fireEvent.click(rows[0]!);
      expect(screen.queryByTestId("standings-accordion")).not.toBeInTheDocument();
    });

    it("muestra el banner resumen con Base y Mults correctos", () => {
      renderTable();
      const rows = screen.getAllByTestId("standings-row-toggle");
      fireEvent.click(rows[0]!); // Ana

      // Ana: m1 exacto (5 base * 1x = 5), m2 exacto (5 base * 1x = 5). Base total = 10, Mults bonus = 0
      expect(screen.getByTestId("summary-base")).toHaveTextContent("10.0");
      expect(screen.getByTestId("summary-mults")).toHaveTextContent("+0.0");
    });

    it("muestra los partidos con nombres de equipos y desglose de predicción", () => {
      renderTable();
      const rows = screen.getAllByTestId("standings-row-toggle");
      fireEvent.click(rows[0]!); // Ana

      expect(screen.getByText(/México vs Canadá/)).toBeInTheDocument();
      expect(screen.getByText(/Brasil vs Argentina/)).toBeInTheDocument();

      // Ambos partidos son "Exacto" para Ana
      const exactLabels = screen.getAllByText(/Exacto/);
      expect(exactLabels.length).toBeGreaterThanOrEqual(2);
    });

    it("agrupa partidos por jornada con encabezados de fase", () => {
      renderTable();
      const rows = screen.getAllByTestId("standings-row-toggle");
      fireEvent.click(rows[0]!); // Ana

      const phaseHeaders = screen.getAllByTestId("standings-phase-header");
      // Dos jornadas distintas (Jornada 1, Jornada 2), orden descendente
      expect(phaseHeaders.length).toBe(2);
      expect(phaseHeaders[0]).toHaveTextContent("Jornada 2");
      expect(phaseHeaders[1]).toHaveTextContent("Jornada 1");
    });

    it("muestra multiplicadores en detalle de partido (con x2 badge)", () => {
      const predsWithMult: StandingPrediction[] = [
        { userId: "a", matchId: "m1", homeScorePred: 1, awayScorePred: 0, multiplier: 2 },
      ];
      render(
        <StandingsTable
          members={[MEMBERS[0]!]}
          matches={[MATCHES[0]!]}
          predictions={predsWithMult}
        />,
      );
      const rows = screen.getAllByTestId("standings-row-toggle");
      fireEvent.click(rows[0]!);

      // Ana: base 5 * 2x = 10 pts. Summary base = 5, mult bonus = 5
      expect(screen.getByTestId("summary-base")).toHaveTextContent("5.0");
      expect(screen.getByTestId("summary-mults")).toHaveTextContent("+5.0");
      expect(screen.getByTestId("match-points-earned")).toHaveTextContent("10.0 pts");
    });

    it("solo expande una fila a la vez", () => {
      renderTable();
      const rows = screen.getAllByTestId("standings-row-toggle");

      // Expandir Ana
      fireEvent.click(rows[0]!);
      expect(screen.getAllByTestId("standings-accordion").length).toBe(1);

      // Expandir Beto → Ana se colapsa
      fireEvent.click(rows[1]!);
      expect(screen.getAllByTestId("standings-accordion").length).toBe(1);
      expect(screen.getByText(/México vs Canadá/)).toBeInTheDocument();
    });
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

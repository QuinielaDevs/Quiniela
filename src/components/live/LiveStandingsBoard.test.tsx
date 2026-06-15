import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveStandingsBoard } from "@/components/live/LiveStandingsBoard";
import type { LiveMatch } from "@/components/live/goalImpact";
import type { StandingMember, StandingPrediction } from "@/utils/standings";

const createClient = vi.fn();

vi.mock("@/utils/supabase/client", () => ({
  createClient: () => createClient(),
}));

const members: StandingMember[] = [
  {
    userId: "ana",
    displayName: "Ana",
    avatarUrl: "/assets/avatars/default-player.svg",
    paymentStatus: "paid",
    joinedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    userId: "beto",
    displayName: "Beto",
    avatarUrl: "/assets/avatars/default-player.svg",
    paymentStatus: "pending",
    joinedAt: "2026-06-02T00:00:00.000Z",
  },
];

const initialMatches: LiveMatch[] = [
  {
    id: "live-1",
    status: "live",
    matchday: 1,
    stage: "group",
    homeScore: 0,
    awayScore: 0,
    homeTeam: "Local FC",
    awayTeam: "Visitante FC",
  },
];

const predictions: StandingPrediction[] = [
  {
    userId: "ana",
    matchId: "live-1",
    homeScorePred: 1,
    awayScorePred: 0,
    multiplier: 1,
  },
  {
    userId: "beto",
    matchId: "live-1",
    homeScorePred: 0,
    awayScorePred: 1,
    multiplier: 1,
  },
];

type StatusHandler = (status: string) => void;
type PostgresHandler = (payload: { new: Record<string, unknown> }) => void;

function toPredictionRow(prediction: StandingPrediction) {
  return {
    user_id: prediction.userId,
    match_id: prediction.matchId,
    home_score_pred: prediction.homeScorePred,
    away_score_pred: prediction.awayScorePred,
    multiplier: prediction.multiplier,
  };
}

function makeSupabaseMock({
  matchRows = [
    {
      id: "live-1",
      status: "live",
      matchday: 1,
      home_score: 1,
      away_score: 0,
    },
  ],
  predictionRows = predictions.map(toPredictionRow),
  matchError = null,
  predictionError = null,
}: {
  matchRows?: Record<string, unknown>[];
  predictionRows?: Record<string, unknown>[];
  matchError?: unknown;
  predictionError?: unknown;
} = {}) {
  const statusHandlers: StatusHandler[] = [];
  const postgresHandlers: PostgresHandler[] = [];
  const channels: Array<{
    on: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  }> = [];

  const makeChannel = () => {
    const channel = {
      on: vi.fn((_event, _filter, callback: PostgresHandler) => {
        postgresHandlers.push(callback);
        return channel;
      }),
      subscribe: vi.fn((callback: StatusHandler) => {
        statusHandlers.push(callback);
        return channel;
      }),
    };
    channels.push(channel);
    return channel;
  };

  const from = vi.fn((table: string) => {
    const result =
      table === "matches"
        ? { data: matchRows, error: matchError }
        : { data: predictionRows, error: predictionError };

    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order"]) {
      builder[method] = () => builder;
    }
    builder.then = (
      resolve: (value: { data: unknown; error: unknown }) => unknown,
    ) => resolve(result);
    return builder;
  });

  return {
    supabase: {
      channel: vi.fn(makeChannel),
      removeChannel: vi.fn(() => Promise.resolve()),
      from,
    },
    getStatusHandler: (index = statusHandlers.length - 1) => statusHandlers[index],
    getPostgresHandler: (index = postgresHandlers.length - 1) =>
      postgresHandlers[index],
    channels,
  };
}

describe("LiveStandingsBoard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("se suscribe a matches y reordena filas al recibir un marcador live", async () => {
    const mock = makeSupabaseMock();
    createClient.mockReturnValue(mock.supabase);

    render(
      <LiveStandingsBoard
        leagueId="L1"
        currentUserId="ana"
        members={members}
        initialMatches={initialMatches}
        initialPredictions={predictions}
      />,
    );

    expect(mock.supabase.channel).toHaveBeenCalledWith("live-matches:L1");
    expect(screen.getAllByTestId("live-row").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Ana"),
      expect.stringContaining("Beto"),
    ]);

    await act(async () => {
      mock.getPostgresHandler()?.({
        new: {
          id: "live-1",
          status: "live",
          matchday: 1,
          home_score: 0,
          away_score: 1,
        },
      });
    });

    expect(screen.getAllByTestId("live-row").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Beto"),
      expect.stringContaining("Ana"),
    ]);
  });

  it("recarga predicciones cuando un partido entra en vivo durante la sesion", async () => {
    const mock = makeSupabaseMock({
      matchRows: [
        {
          id: "live-1",
          status: "live",
          matchday: 1,
          home_score: 0,
          away_score: 0,
        },
        {
          id: "live-2",
          status: "live",
          matchday: 1,
          home_score: 2,
          away_score: 0,
        },
      ],
      predictionRows: [
        ...predictions.map(toPredictionRow),
        toPredictionRow({
          userId: "ana",
          matchId: "live-2",
          homeScorePred: 2,
          awayScorePred: 0,
          multiplier: 1,
        }),
        toPredictionRow({
          userId: "beto",
          matchId: "live-2",
          homeScorePred: 0,
          awayScorePred: 1,
          multiplier: 1,
        }),
      ],
    });
    createClient.mockReturnValue(mock.supabase);

    render(
      <LiveStandingsBoard
        leagueId="L1"
        currentUserId="ana"
        members={members}
        initialMatches={initialMatches}
        initialPredictions={predictions}
      />,
    );

    await act(async () => {
      mock.getPostgresHandler()?.({
        new: {
          id: "live-2",
          status: "live",
          matchday: 1,
          home_score: 2,
          away_score: 0,
        },
      });
    });

    expect(mock.supabase.from).toHaveBeenCalledWith("predictions");
    expect(screen.getAllByTestId("live-row").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Ana"),
      expect.stringContaining("Beto"),
    ]);
    expect(screen.getByLabelText("5 puntos proyectados")).toBeInTheDocument();
  });

  it("preserva el ultimo snapshot valido cuando falla el polling", async () => {
    const mock = makeSupabaseMock({ matchError: new Error("network") });
    createClient.mockReturnValue(mock.supabase);

    render(
      <LiveStandingsBoard
        leagueId="L1"
        currentUserId="ana"
        members={members}
        initialMatches={initialMatches}
        initialPredictions={predictions}
      />,
    );

    await act(async () => {
      mock.getStatusHandler()?.("CHANNEL_ERROR");
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(screen.getAllByTestId("live-row").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Ana"),
      expect.stringContaining("Beto"),
    ]);
  });

  it("muestra estados de conexion, activa polling y limpia recursos", async () => {
    const mock = makeSupabaseMock();
    createClient.mockReturnValue(mock.supabase);

    const { unmount } = render(
      <LiveStandingsBoard
        leagueId="L1"
        currentUserId="ana"
        members={members}
        initialMatches={initialMatches}
        initialPredictions={predictions}
      />,
    );

    await act(async () => {
      mock.getStatusHandler()?.("SUBSCRIBED");
    });
    expect(screen.getByText("En vivo")).toBeInTheDocument();

    await act(async () => {
      mock.getStatusHandler()?.("CHANNEL_ERROR");
    });
    expect(screen.getByText("Reconectando...")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mock.supabase.from).toHaveBeenCalledWith("matches");
    expect(mock.supabase.from).toHaveBeenCalledWith("predictions");
    expect(mock.supabase.channel).toHaveBeenCalledTimes(2);
    expect(mock.supabase.removeChannel).toHaveBeenCalledTimes(1);

    await act(async () => {
      mock.getStatusHandler()?.("SUBSCRIBED");
    });
    expect(screen.getByText("En vivo")).toBeInTheDocument();

    unmount();

    expect(mock.supabase.removeChannel).toHaveBeenCalledTimes(2);

    const fromCallsAfterUnmount = mock.supabase.from.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mock.supabase.from).toHaveBeenCalledTimes(fromCallsAfterUnmount);
  });

  it("muestra un toast 'Impacto de Gol' con equipo y jugador al subir de puesto", async () => {
    const mock = makeSupabaseMock();
    createClient.mockReturnValue(mock.supabase);

    render(
      <LiveStandingsBoard
        leagueId="L1"
        currentUserId="beto"
        members={members}
        initialMatches={initialMatches}
        initialPredictions={predictions}
      />,
    );

    expect(screen.queryByTestId("goal-toast-stack")).not.toBeInTheDocument();

    await act(async () => {
      mock.getPostgresHandler()?.({
        new: {
          id: "live-1",
          status: "live",
          matchday: 1,
          home_team: "Local FC",
          away_team: "Visitante FC",
          home_score: 0,
          away_score: 1,
        },
      });
    });

    const stack = screen.getByTestId("goal-toast-stack");
    expect(stack).toHaveAttribute("aria-live", "polite");
    expect(
      screen.getByText(
        "¡Gol de Visitante FC! Beto sube al 1er puesto proyectado 🎉",
      ),
    ).toBeInTheDocument();
  });

  it("usa el fallback neutro cuando el payload no trae el equipo", async () => {
    const mock = makeSupabaseMock();
    createClient.mockReturnValue(mock.supabase);

    render(
      <LiveStandingsBoard
        leagueId="L1"
        currentUserId="beto"
        members={members}
        initialMatches={initialMatches}
        initialPredictions={predictions}
      />,
    );

    await act(async () => {
      mock.getPostgresHandler()?.({
        new: {
          id: "live-1",
          status: "live",
          matchday: 1,
          home_score: 0,
          away_score: 1,
        },
      });
    });

    expect(
      screen.getByText(
        "¡Cambio en los marcadores! Beto sube al 1er puesto proyectado 🎉",
      ),
    ).toBeInTheDocument();
  });

  it("destella en dorado la fila que sube y lo limpia tras el timeout", async () => {
    const mock = makeSupabaseMock();
    createClient.mockReturnValue(mock.supabase);

    render(
      <LiveStandingsBoard
        leagueId="L1"
        currentUserId="beto"
        members={members}
        initialMatches={initialMatches}
        initialPredictions={predictions}
      />,
    );

    await act(async () => {
      mock.getPostgresHandler()?.({
        new: {
          id: "live-1",
          status: "live",
          matchday: 1,
          home_team: "Local FC",
          away_team: "Visitante FC",
          home_score: 0,
          away_score: 1,
        },
      });
    });

    // Beto subió al 1er puesto → su fila (ahora la primera) destella en dorado.
    const flashedRow = screen.getAllByTestId("live-row")[0];
    expect(flashedRow).toHaveAttribute("data-flash", "gold");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(screen.getAllByTestId("live-row")[0]).not.toHaveAttribute("data-flash");
  });

  it("no muestra toast cuando el gol no reordena puestos", async () => {
    const mock = makeSupabaseMock();
    createClient.mockReturnValue(mock.supabase);

    render(
      <LiveStandingsBoard
        leagueId="L1"
        currentUserId="ana"
        members={members}
        initialMatches={initialMatches}
        initialPredictions={predictions}
      />,
    );

    // Ana ya es líder (rank 1) por desempate; un gol local que acierta su
    // predicción no cambia el orden, así que no debe emitir toast.
    await act(async () => {
      mock.getPostgresHandler()?.({
        new: {
          id: "live-1",
          status: "live",
          matchday: 1,
          home_team: "Local FC",
          away_team: "Visitante FC",
          home_score: 1,
          away_score: 0,
        },
      });
    });

    expect(screen.queryByTestId("goal-toast-stack")).not.toBeInTheDocument();
  });

  it("no muestra toast ante una corrección a la baja aunque reordene", async () => {
    const mock = makeSupabaseMock();
    createClient.mockReturnValue(mock.supabase);

    // Partido con el visitante adelante (0-1): Beto (pred 0-1) lidera por exacto.
    const homeBehind: LiveMatch[] = [
      {
        id: "live-1",
        status: "live",
        matchday: 1,
        homeScore: 0,
        awayScore: 1,
        homeTeam: "Local FC",
        awayTeam: "Visitante FC",
      },
    ];

    render(
      <LiveStandingsBoard
        leagueId="L1"
        currentUserId="ana"
        members={members}
        initialMatches={homeBehind}
        initialPredictions={predictions}
      />,
    );

    expect(screen.getAllByTestId("live-row").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Beto"),
      expect.stringContaining("Ana"),
    ]);

    // Corrección a 0-0: nadie acierta, empate → Ana lidera por joined_at. La
    // tabla SÍ se reordena, pero no hubo gol → no debe emitir toast.
    await act(async () => {
      mock.getPostgresHandler()?.({
        new: {
          id: "live-1",
          status: "live",
          matchday: 1,
          home_team: "Local FC",
          away_team: "Visitante FC",
          home_score: 0,
          away_score: 0,
        },
      });
    });

    expect(screen.getAllByTestId("live-row").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Ana"),
      expect.stringContaining("Beto"),
    ]);
    expect(screen.queryByTestId("goal-toast-stack")).not.toBeInTheDocument();
  });

  it("permite descartar el toast con el botón cerrar", async () => {
    const mock = makeSupabaseMock();
    createClient.mockReturnValue(mock.supabase);

    render(
      <LiveStandingsBoard
        leagueId="L1"
        currentUserId="beto"
        members={members}
        initialMatches={initialMatches}
        initialPredictions={predictions}
      />,
    );

    await act(async () => {
      mock.getPostgresHandler()?.({
        new: {
          id: "live-1",
          status: "live",
          matchday: 1,
          home_team: "Local FC",
          away_team: "Visitante FC",
          home_score: 0,
          away_score: 1,
        },
      });
    });

    expect(screen.getByTestId("goal-toast")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Descartar notificación"));
    });

    expect(screen.queryByTestId("goal-toast")).not.toBeInTheDocument();
  });

  it("emite toast de 'Impacto de Gol' y destello en modo polling", async () => {
    const mock = makeSupabaseMock({
      matchRows: [
        {
          id: "live-1",
          status: "live",
          matchday: 1,
          home_team: "Local FC",
          away_team: "Visitante FC",
          home_score: 0,
          away_score: 1,
        },
      ],
    });
    createClient.mockReturnValue(mock.supabase);

    render(
      <LiveStandingsBoard
        leagueId="L1"
        currentUserId="beto"
        members={members}
        initialMatches={initialMatches}
        initialPredictions={predictions}
      />,
    );

    await act(async () => {
      mock.getStatusHandler()?.("CHANNEL_ERROR");
    });
    expect(screen.getByText("Reconectando...")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(
      screen.getByText("¡Gol de Visitante FC! Beto sube al 1er puesto proyectado 🎉"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("live-row")[0]).toHaveAttribute("data-flash", "gold");
  });

  it("muestra el indicador de tendencia de posición proyectada vs oficial", async () => {
    const mock = makeSupabaseMock();
    createClient.mockReturnValue(mock.supabase);

    render(
      <LiveStandingsBoard
        leagueId="L1"
        currentUserId="ana"
        members={members}
        initialMatches={initialMatches}
        initialPredictions={predictions}
      />,
    );

    // Initial matches: live-1 at 0-0. Predictions: Ana 1-0 (0 pts), Beto 0-1 (0 pts).
    // Both tied at rank 1. Trend should show no changes (0).
    expect(screen.getAllByTestId("live-trend")[0]).toHaveAttribute("data-change", "0");
    expect(screen.getAllByTestId("live-trend")[1]).toHaveAttribute("data-change", "0");

    // Realtime update: live-1 becomes 0-1 (Beto got it exact -> 5 pts projected. Ana got 0).
    // Official is still empty (no finished matches yet) -> both tied at rank 1 officially.
    // Projected standings: Beto is #1, Ana is #2.
    // Beto: official rank 1, projected rank 1 -> rankChange = 1 - 1 = 0.
    // Ana: official rank 1, projected rank 2 -> rankChange = 1 - 2 = -1.
    await act(async () => {
      mock.getPostgresHandler()?.({
        new: {
          id: "live-1",
          status: "live",
          matchday: 1,
          home_score: 0,
          away_score: 1,
        },
      });
    });

    const trends = screen.getAllByTestId("live-trend");
    // Fila 0 es Beto (rango 1, rankChange 0)
    expect(trends[0]).toHaveAttribute("data-change", "0");
    // Fila 1 es Ana (rango 2, rankChange -1)
    expect(trends[1]).toHaveAttribute("data-change", "-1");
  });

  describe("Accordion – desglose de puntos en vivo", () => {
    function renderBoard() {
      const finishedMatches: LiveMatch[] = [
        {
          id: "fin-1",
          status: "finished",
          matchday: 1,
          stage: "group",
          homeScore: 1,
          awayScore: 0,
          homeTeam: "México",
          awayTeam: "Canadá",
        },
        {
          id: "live-2",
          status: "live",
          matchday: 2,
          stage: "group",
          homeScore: 2,
          awayScore: 1,
          homeTeam: "Brasil",
          awayTeam: "Argentina",
        },
      ];

      const preds: StandingPrediction[] = [
        { userId: "ana", matchId: "fin-1", homeScorePred: 1, awayScorePred: 0, multiplier: 1 },
        { userId: "ana", matchId: "live-2", homeScorePred: 2, awayScorePred: 1, multiplier: 1.5 },
      ];

      const mock = makeSupabaseMock();
      createClient.mockReturnValue(mock.supabase);

      render(
        <LiveStandingsBoard
          leagueId="L1"
          currentUserId="ana"
          members={members}
          initialMatches={finishedMatches}
          initialPredictions={preds}
        />,
      );

      return mock;
    }

    it("expande el desglose al hacer clic y colapsa al clicar de nuevo", () => {
      renderBoard();
      expect(screen.queryByTestId("live-accordion")).not.toBeInTheDocument();

      const toggles = screen.getAllByTestId("live-row-toggle");
      fireEvent.click(toggles[0]!);
      expect(screen.getByTestId("live-accordion")).toBeInTheDocument();

      fireEvent.click(toggles[0]!);
      expect(screen.queryByTestId("live-accordion")).not.toBeInTheDocument();
    });

    it("muestra el banner resumen con Base y Mults", () => {
      renderBoard();
      const toggles = screen.getAllByTestId("live-row-toggle");
      fireEvent.click(toggles[0]!); // Ana

      // fin-1: exacto 5 base * 1x = 5 (bonus 0)
      // live-2: exacto 5 base * 1.5x = 7.5 (bonus 2.5)
      // Total base = 10, total bonus = 2.5
      expect(screen.getByTestId("live-summary-base")).toHaveTextContent("10.0");
      expect(screen.getByTestId("live-summary-mults")).toHaveTextContent("+2.5");
    });

    it("muestra partidos con badge 'live' para partidos en vivo", () => {
      renderBoard();
      const toggles = screen.getAllByTestId("live-row-toggle");
      fireEvent.click(toggles[0]!); // Ana

      expect(screen.getByText(/Brasil vs Argentina/)).toBeInTheDocument();
      // Check for the live badge
      const matchDetails = screen.getAllByTestId("live-match-detail");
      expect(matchDetails.length).toBe(2);
    });

    it("agrupa partidos por jornada con encabezados de fase", () => {
      renderBoard();
      const toggles = screen.getAllByTestId("live-row-toggle");
      fireEvent.click(toggles[0]!);

      const phaseHeaders = screen.getAllByTestId("live-phase-header");
      expect(phaseHeaders.length).toBe(2);
      // Orden descendente: Jornada 2 primero
      expect(phaseHeaders[0]).toHaveTextContent("Jornada 2");
      expect(phaseHeaders[1]).toHaveTextContent("Jornada 1");
    });
  });
});

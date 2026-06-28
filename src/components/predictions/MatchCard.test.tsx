import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MatchCard, type MatchCardMatch } from "@/components/predictions/MatchCard";
import {
  revertPrediction,
  savePrediction,
} from "@/app/actions/predictions.actions";
import {
  MAX_PREDICTION_SCORE,
  PREDICTION_LOCKED_ERROR,
  TRANSIENT_SAVE_ERROR,
} from "@/app/actions/predictions.constants";

vi.mock("@/app/actions/predictions.actions", () => ({
  savePrediction: vi.fn(),
  revertPrediction: vi.fn(),
}));

const MATCH = {
  id: "22222222-2222-4222-8222-222222222222",
  home_team: "Argentina",
  away_team: "Mexico",
  home_team_code: "ARG",
  away_team_code: "MEX",
  match_time: "2026-06-11T20:00:00.000Z",
  status: "scheduled",
  stage: "group",
  matchday: 1,
  home_source: null,
  away_source: null,
  bracket_slot: null,
  venue: "Estadio Monumental",
  group_label: "A",
  home_score: null,
  away_score: null,
};

// Jornada 2+: el multiplicador escala por antelación (la Jornada 1 es línea base
// fija 1.0x, por eso las pruebas de degradación usan este fixture).
const MATCH_JORNADA2 = { ...MATCH, matchday: 2 };

const LEAGUE_ID = "11111111-1111-4111-8111-111111111111";

const SAVED_PREDICTION = {
  id: "44444444-4444-4444-8444-444444444444",
  league_id: LEAGUE_ID,
  match_id: MATCH.id,
  user_id: "33333333-3333-4333-8333-333333333333",
  home_score_pred: 1,
  away_score_pred: 0,
  multiplier: 1,
  points_earned: null,
  evaluated_at: null,
  prev_home_score_pred: null,
  prev_away_score_pred: null,
  prev_multiplier: null,
  prev_saved_at: null,
  created_at: "2026-06-03T18:00:00.000Z",
  updated_at: "2026-06-03T18:00:00.000Z",
};

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
}

function renderMatchCard(
  props: Partial<ComponentProps<typeof MatchCard>> = {},
) {
  return render(
    <MatchCard
      leagueId={LEAGUE_ID}
      match={MATCH}
      initialPrediction={{ homeScorePred: 0, awayScorePred: 0 }}
      {...props}
    />,
  );
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("MatchCard", () => {
  beforeEach(() => {
    cleanup();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T20:00:00.000Z"));
    vi.mocked(savePrediction).mockReset();
    vi.mocked(revertPrediction).mockReset();
    setOnline(true);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
  });

  it("actualiza la UI inmediatamente y guarda una vez tras 500ms", async () => {
    vi.mocked(savePrediction).mockResolvedValue({
      success: true,
      data: SAVED_PREDICTION,
      error: null,
    });
    renderMatchCard();

    fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(savePrediction).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1499);
    });
    expect(savePrediction).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    await flushPromises();
    expect(savePrediction).toHaveBeenCalledTimes(1);
    expect(savePrediction).toHaveBeenCalledWith({
      leagueId: LEAGUE_ID,
      matchId: MATCH.id,
      homeScorePred: 1,
      awayScorePred: 0,
    });
  });

  it("no guarda automaticamente en el primer render", async () => {
    vi.mocked(savePrediction).mockResolvedValue({
      success: true,
      data: SAVED_PREDICTION,
      error: null,
    });

    renderMatchCard();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await flushPromises();

    expect(savePrediction).not.toHaveBeenCalled();
  });

  it("muestra nota de resultado al 90 para eliminatorias", () => {
    renderMatchCard({
      match: {
        ...MATCH,
        stage: "round-32",
        matchday: null,
        bracket_slot: 74,
      },
    });

    expect(screen.getByTestId("regulation-time-note")).toHaveTextContent(
      "Resultado al 90",
    );
  });

  it("no muestra nota de resultado al 90 en fase de grupos", () => {
    renderMatchCard();

    expect(screen.queryByTestId("regulation-time-note")).not.toBeInTheDocument();
  });

  it("cancela el timer anterior y guarda solo el ultimo marcador", async () => {
    vi.mocked(savePrediction).mockResolvedValue({
      success: true,
      data: SAVED_PREDICTION,
      error: null,
    });
    renderMatchCard();

    fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
    await act(async () => {
      vi.advanceTimersByTime(1499);
    });

    expect(savePrediction).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    await flushPromises();
    expect(savePrediction).toHaveBeenCalledTimes(1);
    expect(savePrediction).toHaveBeenCalledWith(
      expect.objectContaining({ homeScorePred: 2, awayScorePred: 0 }),
    );
  });

  it("guarda una prediccion nueva 0-0 si el usuario edita y vuelve al marcador inicial", async () => {
    vi.mocked(savePrediction).mockResolvedValue({
      success: true,
      data: { ...SAVED_PREDICTION, home_score_pred: 0, away_score_pred: 0 },
      error: null,
    });
    renderMatchCard({ initialPrediction: null });

    fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.click(screen.getByLabelText("Disminuir goles de Argentina"));

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await flushPromises();

    expect(savePrediction).toHaveBeenCalledTimes(1);
    expect(savePrediction).toHaveBeenCalledWith(
      expect.objectContaining({ homeScorePred: 0, awayScorePred: 0 }),
    );
  });

  it("muestra Guardando y luego Guardado con check al completar", async () => {
    let resolveSave: (value: Awaited<ReturnType<typeof savePrediction>>) => void;
    vi.mocked(savePrediction).mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    renderMatchCard();

    fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByText("Guardando...")).toBeInTheDocument();
    expect(screen.getByLabelText("Incrementar goles de Argentina")).toBeDisabled();

    await act(async () => {
      resolveSave!({ success: true, data: SAVED_PREDICTION, error: null });
    });

    await flushPromises();
    expect(screen.getByText("Guardado ✓")).toBeInTheDocument();
    expect(screen.getByLabelText("Incrementar goles de Argentina")).not.toBeDisabled();
  });

  it("marca pendiente offline y reintenta al volver online", async () => {
    setOnline(false);
    vi.mocked(savePrediction).mockResolvedValue({
      success: true,
      data: SAVED_PREDICTION,
      error: null,
    });
    renderMatchCard();

    fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(savePrediction).not.toHaveBeenCalled();
    expect(screen.getByText("Sin conexion - Pendiente")).toBeInTheDocument();
    expect(screen.getByLabelText("Incrementar goles de Argentina")).toBeDisabled();

    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    await flushPromises();
    expect(savePrediction).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Guardado ✓")).toBeInTheDocument();
  });

  it("trata una promesa rechazada como pendiente offline", async () => {
    vi.mocked(savePrediction).mockRejectedValueOnce(new Error("network down"));
    renderMatchCard();

    fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await flushPromises();

    expect(savePrediction).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Sin conexion - Pendiente")).toBeInTheDocument();
  });

  it("trata un fallo transitorio retornado por la accion como pendiente offline y reintenta", async () => {
    vi.mocked(savePrediction)
      .mockResolvedValueOnce({
        success: false,
        data: null,
        error: TRANSIENT_SAVE_ERROR,
      })
      .mockResolvedValueOnce({
        success: true,
        data: SAVED_PREDICTION,
        error: null,
      });
    renderMatchCard();

    fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await flushPromises();

    expect(screen.getByText("Sin conexion - Pendiente")).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await flushPromises();

    expect(savePrediction).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Guardado ✓")).toBeInTheDocument();
  });

  it("no reintenta automaticamente errores definitivos", async () => {
    vi.mocked(savePrediction).mockResolvedValue({
      success: false,
      data: null,
      error: "No pudimos guardar tu prediccion. Intenta de nuevo.",
    });
    renderMatchCard();

    fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    await flushPromises();
    expect(
      screen.getByText("No pudimos guardar tu prediccion. Intenta de nuevo."),
    ).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    expect(savePrediction).toHaveBeenCalledTimes(1);
  });

  it("limpia un error definitivo cuando el usuario vuelve al ultimo valor guardado", async () => {
    vi.mocked(savePrediction).mockResolvedValue({
      success: false,
      data: null,
      error: "No pudimos guardar tu prediccion. Intenta de nuevo.",
    });
    renderMatchCard({ initialPrediction: { homeScorePred: 1, awayScorePred: 0 } });

    fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await flushPromises();

    expect(
      screen.getByText("No pudimos guardar tu prediccion. Intenta de nuevo."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Disminuir goles de Argentina"));

    expect(
      screen.queryByText("No pudimos guardar tu prediccion. Intenta de nuevo."),
    ).toBeNull();
  });

  it("sincroniza el estado si cambia el partido en la misma instancia", async () => {
    vi.mocked(savePrediction).mockResolvedValue({
      success: true,
      data: SAVED_PREDICTION,
      error: null,
    });
    const nextMatch = {
      ...MATCH,
      id: "55555555-5555-4555-8555-555555555555",
      home_team: "Brasil",
      away_team: "Canada",
      home_team_code: "BRA",
      away_team_code: "CAN",
      matchday: 2,
    };
    const { rerender } = renderMatchCard({
      initialPrediction: { homeScorePred: 1, awayScorePred: 0 },
    });

    rerender(
      <MatchCard
        leagueId={LEAGUE_ID}
        match={nextMatch}
        initialPrediction={{ homeScorePred: 2, awayScorePred: 1 }}
      />,
    );

    expect(screen.getByText("Brasil")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await flushPromises();

    expect(savePrediction).not.toHaveBeenCalled();
  });

  it("no permite incrementar por encima del marcador maximo compartido", () => {
    renderMatchCard({
      initialPrediction: {
        homeScorePred: MAX_PREDICTION_SCORE,
        awayScorePred: 0,
      },
    });

    expect(screen.getByLabelText("Incrementar goles de Argentina")).toBeDisabled();
  });

  it("mantiene el contrato anti-teclado: no introduce inputs", () => {
    renderMatchCard();

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(document.querySelector("input")).toBeNull();
  });

  // ---- Story 2.4: multiplicador, advertencia de degradación y candado ----

  it("muestra el estadio (venue) cuando está presente", () => {
    renderMatchCard({
      match: { ...MATCH, venue: "Estadio Azteca" },
    });

    expect(screen.getByText("Estadio Azteca")).toBeInTheDocument();
  });

  it("no muestra estadio cuando venue es null", () => {
    renderMatchCard({ match: { ...MATCH, venue: null } });

    expect(screen.queryByText(/Estadio/)).toBeNull();
  });

  it("muestra el multiplicador guardado de la prediccion", () => {
    renderMatchCard({
      initialPrediction: { homeScorePred: 1, awayScorePred: 0, multiplier: 2.5 },
    });

    expect(screen.getByText("2.5x")).toBeInTheDocument();
  });

  // ---- Chip de drift del multiplicador (would-be) ----
  // El chip aparece cuando el multiplicador guardado es mayor que el que el
  // servidor daría AHORA (por avance del torneo). Muestra el valor
  // "would-be" con icono TrendingDown para que el usuario sepa que si
  // re-edita obtendrá menos.

  it("muestra chip de drift cuando saved > next", () => {
    // J2 con saved=2.5x y currentRoundOrdinal=0 → next=1.25x → drift
    vi.setSystemTime(new Date("2026-06-03T20:00:00.000Z"));
    renderMatchCard({
      match: MATCH_JORNADA2,
      initialPrediction: { homeScorePred: 1, awayScorePred: 0, multiplier: 2.5 },
    });

    // El guardado sigue mostrándose en gold
    expect(screen.getByText("2.5x")).toBeInTheDocument();
    // El chip muestra el would-be inline con icono TrendingDown:
    // contiene el valor "1.25x" (2 decimales para evitar confusión con
    // el guardado que usa 1 decimal)
    const chip = screen.getByTestId("multiplier-drift-chip");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent("1.25x");
  });

  it("NO muestra chip de drift cuando saved === next", () => {
    // J1 con saved=1.0x y next=1.0x → no hay drift
    renderMatchCard({
      match: MATCH_JORNADA2, // J2 saved=1.25 next=1.25 → no drift
      initialPrediction: { homeScorePred: 1, awayScorePred: 0, multiplier: 1.25 },
    });

    expect(screen.getByText("1.3x")).toBeInTheDocument();
    expect(screen.queryByTestId("multiplier-drift-chip")).toBeNull();
  });

  it("NO muestra chip de drift cuando saved es MIN_MULTIPLIER (1.0x)", () => {
    // Aunque el servidor pueda degradar, si el guardado ya es 1.0x no
    // tiene sentido mostrar drift (no se puede bajar más).
    renderMatchCard({
      match: MATCH_JORNADA2,
      initialPrediction: { homeScorePred: 1, awayScorePred: 0, multiplier: 1.0 },
    });

    expect(screen.getByText("1.0x")).toBeInTheDocument();
    expect(screen.queryByTestId("multiplier-drift-chip")).toBeNull();
  });

  it("NO muestra chip de drift cuando no hay predicción guardada", () => {
    // Sin initialPrediction: no hay "guardado" contra el cual comparar
    renderMatchCard({
      match: MATCH_JORNADA2,
      initialPrediction: null,
    });

    // El nextMultiplier (1.25) se muestra solo
    expect(screen.getByText("1.3x")).toBeInTheDocument();
    expect(screen.queryByTestId("multiplier-drift-chip")).toBeNull();
  });

  it("el chip tiene aria-label descriptivo accesible", () => {
    vi.setSystemTime(new Date("2026-06-03T20:00:00.000Z"));
    renderMatchCard({
      match: MATCH_JORNADA2,
      initialPrediction: { homeScorePred: 1, awayScorePred: 0, multiplier: 2.5 },
    });

    const chip = screen.getByTestId("multiplier-drift-chip");
    expect(chip).toHaveAttribute(
      "aria-label",
      "Si editas ahora el multiplicador bajaría a 1.25x",
    );
  });

  it("una edicion que NO degrada el multiplicador no abre advertencia y guarda normal", async () => {
    // J2 con jornada en curso 0 (default) → nextMultiplier = 1.25; igual al
    // guardado, así que editar NO degrada y no abre advertencia.
    vi.setSystemTime(new Date("2026-06-03T20:00:00.000Z"));
    vi.mocked(savePrediction).mockResolvedValue({
      success: true,
      data: SAVED_PREDICTION,
      error: null,
    });
    renderMatchCard({
      match: MATCH_JORNADA2,
      initialPrediction: { homeScorePred: 1, awayScorePred: 0, multiplier: 1.25 },
    });

    fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await flushPromises();

    expect(savePrediction).toHaveBeenCalledTimes(1);
  });

  it("actualiza el display al nuevo multiplier devuelto por el servidor tras guardar", async () => {
    vi.setSystemTime(new Date("2026-06-03T20:00:00.000Z"));
    vi.mocked(savePrediction).mockResolvedValue({
      success: true,
      data: { ...SAVED_PREDICTION, home_score_pred: 2, multiplier: 1.3 },
      error: null,
    });
    renderMatchCard({
      match: MATCH_JORNADA2,
      initialPrediction: { homeScorePred: 1, awayScorePred: 0, multiplier: 2.5 },
    });

    expect(screen.getByText("2.5x")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await flushPromises();

    expect(screen.queryByText("2.5x")).toBeNull();
    expect(screen.getByText("1.3x")).toBeInTheDocument();
  });

  it("nextMultiplier refleja la jornada en curso (currentRoundOrdinal), no el reloj", () => {
    vi.setSystemTime(new Date("2026-06-01T20:00:00.000Z"));
    // Final (ordinal 8) con equipos resueltos (no TBD) y aún programada.
    const matchFinal = { ...MATCH, stage: "final", matchday: null };

    // Pre-torneo (jornada en curso 0 → referencia 1): la Final queda a distancia
    // 7 → tope 2.5x.
    const { rerender } = render(
      <MatchCard
        leagueId={LEAGUE_ID}
        match={matchFinal}
        initialPrediction={null}
        currentRoundOrdinal={0}
      />,
    );
    expect(screen.getByText("2.5x")).toBeInTheDocument();

    // Cuando la jornada en curso avanza a semis (7), la Final queda a distancia 1
    // → 1.25x (mostrado como 1.3x por el redondeo a 1 decimal). El multiplicador
    // lo dirige el ordinal en curso, no el tiempo.
    rerender(
      <MatchCard
        leagueId={LEAGUE_ID}
        match={matchFinal}
        initialPrediction={null}
        currentRoundOrdinal={7}
      />,
    );
    expect(screen.queryByText("2.5x")).toBeNull();
    expect(screen.getByText("1.3x")).toBeInTheDocument();
  });

  it("el texto de la advertencia muestra el saved vs next multiplier correctos", async () => {
    vi.setSystemTime(new Date("2026-06-03T20:00:00.000Z")); // next 1.3x
    vi.mocked(savePrediction).mockResolvedValue({
      success: true,
      data: SAVED_PREDICTION,
      error: null,
    });
    renderMatchCard({
      match: MATCH_JORNADA2,
      initialPrediction: { homeScorePred: 1, awayScorePred: 0, multiplier: 2.5 },
    });

    fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));

    expect(
      screen.getByText(/Tu multiplicador bajara de 2\.5x a 1\.3x/),
    ).toBeInTheDocument();
  });

  it("una edicion que degrada abre advertencia; cancelar no guarda", async () => {
    vi.setSystemTime(new Date("2026-06-03T20:00:00.000Z")); // next 1.3x < 2.5x
    vi.mocked(savePrediction).mockResolvedValue({
      success: true,
      data: SAVED_PREDICTION,
      error: null,
    });
    renderMatchCard({
      match: MATCH_JORNADA2,
      initialPrediction: { homeScorePred: 1, awayScorePred: 0, multiplier: 2.5 },
    });

    fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await flushPromises();

    expect(savePrediction).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("confirmar la advertencia aplica el cambio y guarda tras 500ms", async () => {
    vi.setSystemTime(new Date("2026-06-03T20:00:00.000Z"));
    vi.mocked(savePrediction).mockResolvedValue({
      success: true,
      data: SAVED_PREDICTION,
      error: null,
    });
    renderMatchCard({
      match: MATCH_JORNADA2,
      initialPrediction: { homeScorePred: 1, awayScorePred: 0, multiplier: 2.5 },
    });

    fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await flushPromises();

    expect(savePrediction).toHaveBeenCalledTimes(1);
    expect(savePrediction).toHaveBeenCalledWith(
      expect.objectContaining({ homeScorePred: 2, awayScorePred: 0 }),
    );
  });

  it("bloquea la edicion cuando llega la hora del kickoff y muestra candado", () => {
    vi.setSystemTime(new Date("2026-06-11T20:00:00.000Z")); // hora exacta de kickoff
    renderMatchCard({ initialPrediction: { homeScorePred: 0, awayScorePred: 0 } });

    expect(screen.getByText("Pronostico cerrado")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Incrementar goles de Argentina"),
    ).toBeDisabled();
    expect(
      screen.getByLabelText("Disminuir goles de Mexico"),
    ).toBeDisabled();
  });

  it("no bloquea la edicion antes de la hora del kickoff", () => {
    vi.setSystemTime(new Date("2026-06-11T19:59:59.000Z")); // 1 segundo antes del kickoff
    renderMatchCard({ initialPrediction: { homeScorePred: 0, awayScorePred: 0 } });

    expect(screen.queryByText("Pronostico cerrado")).toBeNull();
    expect(
      screen.getByLabelText("Incrementar goles de Argentina"),
    ).not.toBeDisabled();
  });

  it("un error de kickoff del servidor es definitivo y no entra en retry offline", async () => {
    vi.setSystemTime(new Date("2026-06-03T20:00:00.000Z")); // cliente NO bloqueado
    vi.mocked(savePrediction).mockResolvedValue({
      success: false,
      data: null,
      error: PREDICTION_LOCKED_ERROR,
    });
    renderMatchCard({ initialPrediction: null });

    fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await flushPromises();

    expect(screen.getByText(PREDICTION_LOCKED_ERROR)).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    expect(savePrediction).toHaveBeenCalledTimes(1);
  });

  it("reporta el valor persistido vía onPersisted tras guardar", async () => {
    const onPersisted = vi.fn();
    vi.mocked(savePrediction).mockResolvedValue({
      success: true,
      data: {
        ...SAVED_PREDICTION,
        home_score_pred: 1,
        away_score_pred: 0,
        multiplier: 1,
      },
      error: null,
    });
    renderMatchCard({ onPersisted });

    fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await flushPromises();

    expect(onPersisted).toHaveBeenCalledWith(
      expect.objectContaining({
        homeScorePred: 1,
        awayScorePred: 0,
        multiplier: 1,
      }),
    );
  });

  // ---- Slot TBD de eliminatoria (equipos aun sin resolver) ----

  it("muestra el origen del bracket y deja el slot TBD en solo-lectura", () => {
    const tbdMatch = {
      ...MATCH,
      id: "66666666-6666-4666-8666-666666666666",
      home_team: "Por definir",
      away_team: "Por definir",
      home_team_code: null,
      away_team_code: null,
      stage: "semi",
      matchday: null,
      home_source: "W97",
      away_source: "W98",
      bracket_slot: 101,
      home_score: null,
      away_score: null,
    };

    render(
      <MatchCard
        leagueId={LEAGUE_ID}
        match={tbdMatch}
        initialPrediction={null}
      />,
    );

    expect(screen.getByText("Ganador 97")).toBeInTheDocument();
    expect(screen.getByText("Ganador 98")).toBeInTheDocument();
    expect(screen.getByText("Pendiente de clasificacion")).toBeInTheDocument();
    expect(screen.getByText("Semis")).toBeInTheDocument();
    // El número de partido del bracket permite ubicar a qué cruce se refiere.
    expect(screen.getByText("Partido 101")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Incrementar goles de Ganador 97"),
    ).toBeDisabled();
  });

  // ---- Deshacer cambio (ventana de gracia) ----

  async function editAndSave() {
    fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await flushPromises();
  }

  it("muestra 'Deshacer cambio' tras editar una prediccion existente y la restaura", async () => {
    vi.mocked(savePrediction).mockResolvedValue({
      success: true,
      data: { ...SAVED_PREDICTION, home_score_pred: 2, multiplier: 1 },
      error: null,
    });
    vi.mocked(revertPrediction).mockResolvedValue({
      success: true,
      data: {
        ...SAVED_PREDICTION,
        home_score_pred: 1,
        away_score_pred: 0,
        multiplier: 2.5,
      },
      error: null,
    });
    renderMatchCard({
      initialPrediction: { homeScorePred: 1, awayScorePred: 0, multiplier: 1 },
    });

    await editAndSave();
    expect(savePrediction).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Deshacer cambio" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Deshacer cambio" }));
    await flushPromises();

    expect(revertPrediction).toHaveBeenCalledWith({
      leagueId: LEAGUE_ID,
      matchId: MATCH.id,
    });
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2.5x")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Deshacer cambio" }),
    ).toBeNull();
  });

  it("no ofrece deshacer al guardar una prediccion nueva (sin cambio previo)", async () => {
    vi.mocked(savePrediction).mockResolvedValue({
      success: true,
      data: { ...SAVED_PREDICTION, home_score_pred: 1, away_score_pred: 0 },
      error: null,
    });
    renderMatchCard({ initialPrediction: null });

    await editAndSave();

    expect(savePrediction).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Deshacer cambio" }),
    ).toBeNull();
  });

  it("oculta 'Deshacer cambio' al expirar la ventana de gracia (2 min)", async () => {
    vi.mocked(savePrediction).mockResolvedValue({
      success: true,
      data: { ...SAVED_PREDICTION, home_score_pred: 2, multiplier: 1 },
      error: null,
    });
    renderMatchCard({
      initialPrediction: { homeScorePred: 1, awayScorePred: 0, multiplier: 1 },
    });

    await editAndSave();
    expect(
      screen.getByRole("button", { name: "Deshacer cambio" }),
    ).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2 * 60 * 1000);
    });

    expect(
      screen.queryByRole("button", { name: "Deshacer cambio" }),
    ).toBeNull();
    expect(revertPrediction).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════
  // Modo resultado (partidos finalizados con marcador)
  // ═══════════════════════════════════════════

  const FINISHED_MATCH = {
    ...MATCH,
    status: "finished",
    home_score: 2,
    away_score: 1,
  };

  function renderFinishedMatchCard(
    props: Partial<ComponentProps<typeof MatchCard>> = {},
  ) {
    return render(
      <MatchCard
        leagueId={LEAGUE_ID}
        match={FINISHED_MATCH}
        initialPrediction={{ homeScorePred: 1, awayScorePred: 0, multiplier: 1 }}
        {...props}
      />,
    );
  }

  describe("finished match — result mode", () => {
    it("muestra el resultado real (home_score - away_score)", () => {
      renderFinishedMatchCard();

      expect(screen.getByTestId("actual-home-score")).toHaveTextContent("2");
      expect(screen.getByTestId("actual-away-score")).toHaveTextContent("1");
      expect(screen.getByTestId("result-divider")).toHaveTextContent("Resultado");
    });

    it("muestra la tanda de penales en el result-divider si el partido finalizó empatado en eliminatoria con penales", () => {
      const matchWithPenalties: MatchCardMatch = {
        id: "m_pen_card",
        home_team: "Argentina",
        away_team: "Brasil",
        home_team_code: "ARG",
        away_team_code: "BRA",
        match_time: "2026-06-25T20:00:00Z",
        status: "finished",
        stage: "final",
        matchday: null,
        home_source: null,
        away_source: null,
        bracket_slot: 104,
        venue: "MetLife Stadium",
        group_label: null,
        home_score: 1,
        away_score: 1,
        penalties_home_score: 4,
        penalties_away_score: 3,
      };

      render(
        <MatchCard
          match={matchWithPenalties}
          leagueId="league-1"
          initialPrediction={{ homeScorePred: 1, awayScorePred: 1, multiplier: 1 }}
        />,
      );

      expect(screen.getByTestId("result-divider")).toHaveTextContent("Resultado(4-3 pen.)");
    });

    it("muestra la predicción del usuario junto al resultado", () => {
      renderFinishedMatchCard();

      expect(screen.getByTestId("your-prediction")).toHaveTextContent(
        "Tu pronóstico: 1 - 0",
      );
    });

    it("muestra badge verde con '¡Exacto!' para acierto exacto (5 pts)", () => {
      renderFinishedMatchCard({
        initialPrediction: {
          homeScorePred: 2,
          awayScorePred: 1,
          multiplier: 1,
        },
      });

      const badge = screen.getByTestId("points-badge");
      expect(badge).toHaveAttribute("data-variant", "exact");
      expect(badge).toHaveTextContent("¡Exacto!");
      expect(badge).toHaveTextContent("+5.00 pts");
    });

    it("muestra badge amarillo con 'Acierto parcial' para mismo resultado (2 pts)", () => {
      // Resultado 2-1, predicción 1-0 → mismo ganador (local)
      renderFinishedMatchCard({
        initialPrediction: {
          homeScorePred: 1,
          awayScorePred: 0,
          multiplier: 1.25,
        },
      });

      const badge = screen.getByTestId("points-badge");
      expect(badge).toHaveAttribute("data-variant", "result");
      expect(badge).toHaveTextContent("Acierto parcial");
      expect(badge).toHaveTextContent("+2.50 pts"); // 2 base × 1.25
      expect(badge).toHaveTextContent("x1.25");
    });

    it("muestra multiplicador en acierto parcial incluso con multiplier 1.0", () => {
      // Multiplier = 1.0x (caso base, J1). Aunque el multiplicador es 1.0,
      // el badge lo muestra para que el usuario vea cómo se calculó.
      renderFinishedMatchCard({
        initialPrediction: {
          homeScorePred: 1,
          awayScorePred: 0,
          multiplier: 1.0,
        },
      });

      const badge = screen.getByTestId("points-badge");
      expect(badge).toHaveAttribute("data-variant", "result");
      expect(badge).toHaveTextContent("Acierto parcial");
      expect(badge).toHaveTextContent("+2.00 pts");
      expect(badge).toHaveTextContent("x1.00");
    });

    it("muestra badge gris con 'Sin puntos' para fallo (0 pts)", () => {
      // Resultado 2-1, predicción 0-2 → ganador distinto
      renderFinishedMatchCard({
        initialPrediction: {
          homeScorePred: 0,
          awayScorePred: 2,
          multiplier: 1,
        },
      });

      const badge = screen.getByTestId("points-badge");
      expect(badge).toHaveAttribute("data-variant", "miss");
      expect(badge).toHaveTextContent("Sin puntos");
      expect(badge).toHaveTextContent("+0.00 pts");
    });

    it("NO renderiza GoalPickers en modo resultado", () => {
      renderFinishedMatchCard();

      expect(
        screen.queryByLabelText("Incrementar goles de Argentina"),
      ).toBeNull();
      expect(
        screen.queryByLabelText("Disminuir goles de Argentina"),
      ).toBeNull();
    });

    it("NO muestra el botón de deshacer en modo resultado", () => {
      renderFinishedMatchCard();

      expect(
        screen.queryByRole("button", { name: "Deshacer cambio" }),
      ).toBeNull();
    });

    it("muestra el multiplicador aplicado en los puntos cuando > 1.00", () => {
      // 2 pts base × 1.25 = 2.50 pts
      renderFinishedMatchCard({
        initialPrediction: {
          homeScorePred: 1,
          awayScorePred: 0,
          multiplier: 1.25,
        },
      });

      const badge = screen.getByTestId("points-badge");
      expect(badge).toHaveTextContent("+2.50 pts");
      expect(badge).toHaveTextContent("x1.25");
    });

    it("usa el points_earned del servidor si está disponible", () => {
      renderFinishedMatchCard({
        initialPrediction: {
          homeScorePred: 2,
          awayScorePred: 1,
          multiplier: 1,
        },
        pointsEarned: 6.25,
      });

      // points_earned=6.25 (servidor) gana sobre el cálculo local 5*1=5
      const badge = screen.getByTestId("points-badge");
      expect(badge).toHaveTextContent("+6.25 pts");
    });

    it("muestra 'Finalizado' como texto de estado en el candado", () => {
      renderFinishedMatchCard();

      expect(screen.getByText("Finalizado")).toBeInTheDocument();
    });

    it("muestra el venue si está presente", () => {
      renderFinishedMatchCard({
        match: { ...FINISHED_MATCH, venue: "Estadio Azteca" },
      });

      expect(screen.getByText("Estadio Azteca")).toBeInTheDocument();
    });

    it("oculta el venue cuando es null", () => {
      renderFinishedMatchCard({
        match: { ...FINISHED_MATCH, venue: null },
      });

      expect(screen.queryByText(/Estadio/)).toBeNull();
    });

    it("muestra la fecha y hora del partido", () => {
      renderFinishedMatchCard();

      // formattedTime usa match_time, debe mostrarse independientemente del estado
      expect(screen.getByText(/11 jun/i)).toBeInTheDocument();
    });

    it("muestra la fase (Jornada 1) en el header", () => {
      renderFinishedMatchCard();

      expect(screen.getByText("Jornada 1")).toBeInTheDocument();
    });

    it("muestra los nombres de equipos y banderas", () => {
      renderFinishedMatchCard();

      expect(screen.getByText("Argentina")).toBeInTheDocument();
      expect(screen.getByText("Mexico")).toBeInTheDocument();
      expect(screen.getByText("ARG")).toBeInTheDocument();
      expect(screen.getByText("MEX")).toBeInTheDocument();
    });

    it("NO muestra el multiplicador en la cabecera cuando está finalizada", () => {
      // En cards finalizadas el multiplicador vive en el PointsBadge, no en
      // la cabecera (donde solo está el formato "Resultado 3 - 0"). La
      // cabecera solo muestra el multiplicador en partidos scheduled.
      renderFinishedMatchCard({
        initialPrediction: {
          homeScorePred: 1,
          awayScorePred: 0,
          multiplier: 1.5,
        },
      });

      expect(screen.queryByText("1.5x")).toBeNull();
      // El PointsBadge sí lo muestra
      expect(screen.getByTestId("points-badge")).toHaveTextContent("x1.50");
    });
  });

  // ═══════════════════════════════════════════
  // Estado finished sin scores (edge case)
  // ═══════════════════════════════════════════

  describe("finished match — edge cases de datos", () => {
    it("no muestra resultado real si home_score es null", () => {
      renderMatchCard({
        match: { ...MATCH, status: "finished", home_score: null, away_score: 1 },
      });

      expect(screen.queryByTestId("actual-home-score")).toBeNull();
      expect(screen.queryByTestId("result-divider")).toBeNull();
    });

    it("no muestra resultado real si away_score es null", () => {
      renderMatchCard({
        match: { ...MATCH, status: "finished", home_score: 2, away_score: null },
      });

      expect(screen.queryByTestId("actual-away-score")).toBeNull();
    });

    it("muestra 'Finalizado' pero sin bloque de resultado si scores son null", () => {
      renderMatchCard({
        match: {
          ...MATCH,
          status: "finished",
          home_score: null,
          away_score: null,
        },
      });

      expect(screen.getByText("Finalizado")).toBeInTheDocument();
      expect(screen.queryByTestId("result-summary")).toBeNull();
    });

    it("muestra 'Finalizado' sin badge de puntos si no hay predicción", () => {
      render(
        <MatchCard
          leagueId={LEAGUE_ID}
          match={{ ...FINISHED_MATCH, status: "finished" }}
          initialPrediction={null}
        />,
      );

      expect(screen.getByTestId("result-summary")).toBeInTheDocument();
      expect(screen.queryByTestId("points-badge")).toBeNull();
    });
  });

  // ═══════════════════════════════════════════
  // Estados cerrados con candado (live, suspended, canceled)
  // ═══════════════════════════════════════════

  describe("estados cerrados con candado", () => {
    it("muestra 'En vivo' y GoalPickers deshabilitados para status='live'", () => {
      renderMatchCard({
        match: { ...MATCH, status: "live" },
      });

      expect(screen.getByText("En vivo")).toBeInTheDocument();
      expect(
        screen.getByLabelText("Incrementar goles de Argentina"),
      ).toBeDisabled();
      // No entra en modo resultado (solo aplica a 'finished')
      expect(screen.queryByTestId("actual-home-score")).toBeNull();
    });

    it("muestra 'Suspendido' para status='suspended'", () => {
      renderMatchCard({
        match: { ...MATCH, status: "suspended" },
      });

      expect(screen.getByText("Suspendido")).toBeInTheDocument();
      expect(
        screen.getByLabelText("Incrementar goles de Argentina"),
      ).toBeDisabled();
    });

    it("muestra 'Cancelado' para status='canceled'", () => {
      renderMatchCard({
        match: { ...MATCH, status: "canceled" },
      });

      expect(screen.getByText("Cancelado")).toBeInTheDocument();
      expect(
        screen.getByLabelText("Incrementar goles de Argentina"),
      ).toBeDisabled();
    });

    it("NO muestra resultado real para partidos suspended", () => {
      renderMatchCard({
        match: { ...MATCH, status: "suspended" },
      });

      expect(screen.queryByTestId("result-summary")).toBeNull();
    });

    it("NO muestra resultado real para partidos canceled", () => {
      renderMatchCard({
        match: { ...MATCH, status: "canceled" },
      });

      expect(screen.queryByTestId("result-summary")).toBeNull();
    });

    it("NO muestra el multiplicador en la cabecera cuando status='live'", () => {
      // J2 con multiplicador 1.25 para verificar que se omite en cabecera
      // aunque existiría. En cards live el multiplicador no aplica (no se
      // puede editar) y la cabecera debe centrarse en el estado del partido.
      renderMatchCard({
        match: { ...MATCH_JORNADA2, status: "live" },
        initialPrediction: {
          homeScorePred: 1,
          awayScorePred: 0,
          multiplier: 1.25,
        },
      });

      expect(screen.getByText("En vivo")).toBeVisible();
      expect(screen.queryByText("1.3x")).toBeNull();
    });

    it("NO muestra el multiplicador en la cabecera cuando status='suspended'", () => {
      renderMatchCard({
        match: { ...MATCH_JORNADA2, status: "suspended" },
        initialPrediction: {
          homeScorePred: 1,
          awayScorePred: 0,
          multiplier: 1.25,
        },
      });

      expect(screen.getByText("Suspendido")).toBeVisible();
      expect(screen.queryByText("1.3x")).toBeNull();
    });

    it("NO muestra el multiplicador en la cabecera cuando status='canceled'", () => {
      renderMatchCard({
        match: { ...MATCH_JORNADA2, status: "canceled" },
        initialPrediction: {
          homeScorePred: 1,
          awayScorePred: 0,
          multiplier: 1.25,
        },
      });

      expect(screen.getByText("Cancelado")).toBeVisible();
      expect(screen.queryByText("1.3x")).toBeNull();
    });
  });

  // ═══════════════════════════════════════════
  // TBD state (knockout sin equipos)
  // ═══════════════════════════════════════════

  describe("TBD state (knockout sin equipos)", () => {
    const tbdMatch = {
      ...MATCH,
      id: "77777777-7777-4777-8777-777777777777",
      home_team: "Por definir",
      away_team: "Por definir",
      home_team_code: null,
      away_team_code: null,
      stage: "semi",
      matchday: null,
      home_source: "W97",
      away_source: "W98",
      bracket_slot: 101,
      home_score: null,
      away_score: null,
    };

    it("muestra 'Pendiente de clasificacion' con candado", () => {
      render(
        <MatchCard
          leagueId={LEAGUE_ID}
          match={tbdMatch}
          initialPrediction={null}
        />,
      );

      expect(screen.getByText("Pendiente de clasificacion")).toBeInTheDocument();
    });

    it("NO renderiza GoalPickers", () => {
      render(
        <MatchCard
          leagueId={LEAGUE_ID}
          match={tbdMatch}
          initialPrediction={null}
        />,
      );

      expect(
        screen.queryByLabelText("Incrementar goles de Por definir"),
      ).toBeNull();
    });

    it("multiplicador oculto", () => {
      render(
        <MatchCard
          leagueId={LEAGUE_ID}
          match={tbdMatch}
          initialPrediction={null}
        />,
      );

      expect(screen.queryByText(/x\d/)).toBeNull();
    });

    it("contador de tiempo restante oculto", () => {
      render(
        <MatchCard
          leagueId={LEAGUE_ID}
          match={tbdMatch}
          initialPrediction={null}
        />,
      );

      expect(screen.queryByText(/Faltan? /)).toBeNull();
    });

    it("muestra el badge de bracket slot", () => {
      render(
        <MatchCard
          leagueId={LEAGUE_ID}
          match={tbdMatch}
          initialPrediction={null}
        />,
      );

      expect(screen.getByText("Partido 101")).toBeInTheDocument();
    });

    it("NO entra en modo resultado aunque status=finished (TBD prevalece)", () => {
      // Un slot TBD con status='finished' sigue siendo TBD (no editable), y no
      // debería entrar en modo resultado porque faltan los scores reales.
      render(
        <MatchCard
          leagueId={LEAGUE_ID}
          match={{ ...tbdMatch, status: "finished" }}
          initialPrediction={null}
        />,
      );

      expect(screen.getByText("Pendiente de clasificacion")).toBeInTheDocument();
      expect(screen.queryByTestId("result-summary")).toBeNull();
    });
  });

  // ═══════════════════════════════════════════
  // Edge case: match_time inválido
  // ═══════════════════════════════════════════

  describe("edge cases de fecha", () => {
    it("no bloquea la edición si match_time es inválido", () => {
      // match_time no es una fecha parseable → isMatchLocked devuelve false
      // → GoalPickers siguen habilitados
      renderMatchCard({
        match: { ...MATCH, match_time: "not-a-date" },
      });

      expect(screen.queryByText("Pronostico cerrado")).toBeNull();
      expect(
        screen.getByLabelText("Incrementar goles de Argentina"),
      ).not.toBeDisabled();
    });
  });

  // ═══════════════════════════════════════════
  // Edge case: scoring edge cases
  // ═══════════════════════════════════════════

  describe("scoring edge cases en modo resultado", () => {
    it("predicción 0-0 con resultado 0-0 → 5 pts (exacto)", () => {
      render(
        <MatchCard
          leagueId={LEAGUE_ID}
          match={{ ...MATCH, status: "finished", home_score: 0, away_score: 0 }}
          initialPrediction={{ homeScorePred: 0, awayScorePred: 0, multiplier: 1 }}
        />,
      );

      const badge = screen.getByTestId("points-badge");
      expect(badge).toHaveAttribute("data-variant", "exact");
    });

    it("predicción 0-0 con resultado 1-1 → 2 pts (empate exacto por outcome)", () => {
      // Math.sign(0-0) === 0, Math.sign(1-1) === 0 → mismo outcome
      render(
        <MatchCard
          leagueId={LEAGUE_ID}
          match={{ ...MATCH, status: "finished", home_score: 1, away_score: 1 }}
          initialPrediction={{ homeScorePred: 0, awayScorePred: 0, multiplier: 1 }}
        />,
      );

      const badge = screen.getByTestId("points-badge");
      expect(badge).toHaveAttribute("data-variant", "result");
    });

    it("predicción 1-0 con resultado 0-1 → 0 pts (ganador distinto)", () => {
      render(
        <MatchCard
          leagueId={LEAGUE_ID}
          match={{ ...MATCH, status: "finished", home_score: 0, away_score: 1 }}
          initialPrediction={{ homeScorePred: 1, awayScorePred: 0, multiplier: 1 }}
        />,
      );

      const badge = screen.getByTestId("points-badge");
      expect(badge).toHaveAttribute("data-variant", "miss");
    });

    it("predicción 5-3 con resultado 5-3 → 5 pts (exacto con goleada)", () => {
      render(
        <MatchCard
          leagueId={LEAGUE_ID}
          match={{ ...MATCH, status: "finished", home_score: 5, away_score: 3 }}
          initialPrediction={{ homeScorePred: 5, awayScorePred: 3, multiplier: 1 }}
        />,
      );

      const badge = screen.getByTestId("points-badge");
      expect(badge).toHaveAttribute("data-variant", "exact");
    });

    it("multiplicador máximo 2.5: 5 pts × 2.5 = 12.50 pts", () => {
      render(
        <MatchCard
          leagueId={LEAGUE_ID}
          match={{ ...MATCH, status: "finished", home_score: 2, away_score: 1 }}
          initialPrediction={{
            homeScorePred: 2,
            awayScorePred: 1,
            multiplier: 2.5,
          }}
        />,
      );

      const badge = screen.getByTestId("points-badge");
      expect(badge).toHaveTextContent("+12.50 pts");
      expect(badge).toHaveTextContent("x2.50");
    });
  });

  // ═══════════════════════════════════════════
  // Edge case: Undo y multiplicador degradado
  // ═══════════════════════════════════════════

  describe("undo en modo resultado", () => {
    it("no muestra el botón deshacer aunque haya predicción guardada", () => {
      // Aunque tengamos undoDeadline (escenario de edit y save previo), el
      // modo resultado lo oculta porque no tiene sentido deshacer un partido
      // ya finalizado.
      renderFinishedMatchCard();

      expect(
        screen.queryByRole("button", { name: "Deshacer cambio" }),
      ).toBeNull();
    });
  });
});

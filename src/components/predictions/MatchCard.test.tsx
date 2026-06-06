import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MatchCard } from "@/components/predictions/MatchCard";
import { savePrediction } from "@/app/actions/predictions.actions";
import {
  MAX_PREDICTION_SCORE,
  PREDICTION_LOCKED_ERROR,
  TRANSIENT_SAVE_ERROR,
} from "@/app/actions/predictions.constants";

vi.mock("@/app/actions/predictions.actions", () => ({
  savePrediction: vi.fn(),
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
};

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
    vi.mocked(savePrediction).mockReset();
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

  it("muestra el multiplicador guardado de la prediccion", () => {
    renderMatchCard({
      initialPrediction: { homeScorePred: 1, awayScorePred: 0, multiplier: 2.5 },
    });

    expect(screen.getByText("2.5x")).toBeInTheDocument();
  });

  it("una edicion que NO degrada el multiplicador no abre advertencia y guarda normal", async () => {
    vi.setSystemTime(new Date("2026-06-03T20:00:00.000Z")); // 8 dias → 1.3x
    vi.mocked(savePrediction).mockResolvedValue({
      success: true,
      data: SAVED_PREDICTION,
      error: null,
    });
    renderMatchCard({
      initialPrediction: { homeScorePred: 1, awayScorePred: 0, multiplier: 1.3 },
    });

    fireEvent.click(screen.getByLabelText("Incrementar goles de Argentina"));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await flushPromises();

    expect(savePrediction).toHaveBeenCalledTimes(1);
  });

  it("una edicion que degrada abre advertencia; cancelar no guarda", async () => {
    vi.setSystemTime(new Date("2026-06-03T20:00:00.000Z")); // next 1.3x < 2.5x
    vi.mocked(savePrediction).mockResolvedValue({
      success: true,
      data: SAVED_PREDICTION,
      error: null,
    });
    renderMatchCard({
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
    expect(
      screen.getByLabelText("Incrementar goles de Ganador 97"),
    ).toBeDisabled();
  });
});

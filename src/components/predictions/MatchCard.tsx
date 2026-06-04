"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";

import { savePrediction } from "@/app/actions/predictions.actions";
import {
  MAX_PREDICTION_SCORE,
  SAVE_ERROR,
  TRANSIENT_SAVE_ERROR,
} from "@/app/actions/predictions.constants";
import { GoalPicker } from "@/components/predictions/GoalPicker";
import { calculatePredictionMultiplier, MIN_MULTIPLIER } from "@/utils/scoring";
import type { Match } from "@/types";
import { cn } from "@/utils/utils";

type MatchCardPrediction = {
  id?: string;
  homeScorePred: number;
  awayScorePred: number;
  multiplier?: number;
  updatedAt?: string;
};

type MatchCardProps = {
  leagueId: string;
  match: Pick<
    Match,
    | "id"
    | "home_team"
    | "away_team"
    | "home_team_code"
    | "away_team_code"
    | "match_time"
    | "status"
    | "stage"
    | "matchday"
  >;
  initialPrediction?: MatchCardPrediction | null;
  disabled?: boolean;
};

type SaveState = "idle" | "dirty" | "saving" | "saved" | "offline" | "error";

type PendingPrediction = {
  homeScorePred: number;
  awayScorePred: number;
};

const DEBOUNCE_MS = 500;
const OFFLINE_COPY = "Sin conexion - Pendiente";
const LOCKED_COPY = "Pronostico cerrado";
const KICKOFF_LOCK_MS = 60_000;
const CLOSED_STATUSES = new Set(["live", "finished", "suspended", "canceled"]);

function isBrowserOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

// Bloqueo de UI: defensivo/ergonómico. La AUTORIDAD del bloqueo es la DB (la RPC
// fn_save_prediction rechaza tras match_time - 1min con la hora del servidor).
function isMatchLocked(match: MatchCardProps["match"]): boolean {
  if (CLOSED_STATUSES.has(match.status)) return true;
  const kickoffMs = new Date(match.match_time).getTime();
  if (!Number.isFinite(kickoffMs)) return false;
  return Date.now() >= kickoffMs - KICKOFF_LOCK_MS;
}

function formatMultiplier(value: number): string {
  return `${value.toFixed(1)}x`;
}

export function MatchCard({
  leagueId,
  match,
  initialPrediction,
  disabled = false,
}: MatchCardProps) {
  const hasInitialPrediction =
    initialPrediction !== null && initialPrediction !== undefined;
  const initialPredictionId = initialPrediction?.id;
  const initialHomeScore = initialPrediction?.homeScorePred ?? 0;
  const initialAwayScore = initialPrediction?.awayScorePred ?? 0;
  const savedMultiplier = initialPrediction?.multiplier ?? MIN_MULTIPLIER;

  const [homeScore, setHomeScore] = useState(initialHomeScore);
  const [awayScore, setAwayScore] = useState(initialAwayScore);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [warningOpen, setWarningOpen] = useState(false);

  const requestIdRef = useRef(0);
  const hasUserEditedRef = useRef(false);
  const pendingRef = useRef<PendingPrediction | null>(null);
  // Una confirmación de degradación cubre el resto de la sesión de edición de
  // esta tarjeta; evita re-abrir el modal en cada click posterior.
  const degradeAckRef = useRef(false);
  const pendingEditRef = useRef<(() => void) | null>(null);
  const lastSavedRef = useRef<PendingPrediction | null>(
    hasInitialPrediction
      ? {
          homeScorePred: initialHomeScore,
          awayScorePred: initialAwayScore,
        }
      : null,
  );

  // Multiplicador: el guardado (saved) y el que se obtendría al editar AHORA.
  // El valor autoritativo final siempre lo calcula el backend; esto es UI.
  const isLocked = isMatchLocked(match);
  const nextMultiplier = calculatePredictionMultiplier(
    Date.now(),
    match.match_time,
  );
  const displayMultiplier = hasInitialPrediction
    ? savedMultiplier
    : nextMultiplier;

  useEffect(() => {
    const nextInitial = {
      homeScorePred: initialHomeScore,
      awayScorePred: initialAwayScore,
    };

    requestIdRef.current += 1;
    hasUserEditedRef.current = false;
    pendingRef.current = null;
    degradeAckRef.current = false;
    pendingEditRef.current = null;
    lastSavedRef.current = hasInitialPrediction ? nextInitial : null;
    setHomeScore(nextInitial.homeScorePred);
    setAwayScore(nextInitial.awayScorePred);
    setSaveState("idle");
    setError(null);
    setWarningOpen(false);
  }, [
    hasInitialPrediction,
    initialAwayScore,
    initialHomeScore,
    initialPredictionId,
    leagueId,
    match.id,
  ]);

  const runSave = useCallback(
    async (prediction: PendingPrediction) => {
      if (!isBrowserOnline()) {
        pendingRef.current = prediction;
        setSaveState("offline");
        setError(null);
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setSaveState("saving");
      setError(null);

      try {
        const result = await savePrediction({
          leagueId,
          matchId: match.id,
          homeScorePred: prediction.homeScorePred,
          awayScorePred: prediction.awayScorePred,
        });

        if (requestId !== requestIdRef.current) return;

        if (result.success) {
          lastSavedRef.current = prediction;
          pendingRef.current = null;
          setSaveState("saved");
          setError(null);
          return;
        }

        if (result.error === TRANSIENT_SAVE_ERROR) {
          pendingRef.current = prediction;
          setSaveState("offline");
          setError(null);
          return;
        }

        pendingRef.current = null;
        setSaveState("error");
        setError(result.error ?? SAVE_ERROR);
      } catch {
        if (requestId !== requestIdRef.current) return;
        pendingRef.current = prediction;
        setSaveState("offline");
        setError(null);
      }
    },
    [leagueId, match.id],
  );

  useEffect(() => {
    const nextPrediction = {
      homeScorePred: homeScore,
      awayScorePred: awayScore,
    };
    const lastSaved = lastSavedRef.current;
    const isUnchanged =
      lastSaved !== null &&
      nextPrediction.homeScorePred === lastSaved.homeScorePred &&
      nextPrediction.awayScorePred === lastSaved.awayScorePred;

    if (!hasUserEditedRef.current && lastSaved === null) return;

    if (isUnchanged) {
      pendingRef.current = null;
      setSaveState("idle");
      setError(null);
      return;
    }

    pendingRef.current = nextPrediction;
    setSaveState("dirty");
    setError(null);

    const timeoutId = window.setTimeout(() => {
      void runSave(nextPrediction);
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [awayScore, homeScore, runSave]);

  useEffect(() => {
    if (saveState !== "offline") return;

    function retryPendingSave() {
      const pending = pendingRef.current;
      if (!pending) return;
      void runSave(pending);
    }

    window.addEventListener("online", retryPendingSave);
    return () => {
      window.removeEventListener("online", retryPendingSave);
    };
  }, [runSave, saveState]);

  // Intercepta una edición: si bajaría el multiplicador guardado y no se ha
  // confirmado aún, abre la advertencia ANTES de tocar el estado/debounce.
  const requestScoreChange = useCallback(
    (applyEdit: () => void) => {
      const wouldDegrade =
        hasInitialPrediction &&
        !degradeAckRef.current &&
        savedMultiplier > MIN_MULTIPLIER &&
        nextMultiplier < savedMultiplier;

      if (wouldDegrade) {
        pendingEditRef.current = applyEdit;
        setWarningOpen(true);
        return;
      }
      applyEdit();
    },
    [hasInitialPrediction, savedMultiplier, nextMultiplier],
  );

  const handleHomeScoreChange = useCallback(
    (next: number) => {
      requestScoreChange(() => {
        hasUserEditedRef.current = true;
        setHomeScore(next);
      });
    },
    [requestScoreChange],
  );

  const handleAwayScoreChange = useCallback(
    (next: number) => {
      requestScoreChange(() => {
        hasUserEditedRef.current = true;
        setAwayScore(next);
      });
    },
    [requestScoreChange],
  );

  const confirmDegrade = useCallback(() => {
    degradeAckRef.current = true;
    setWarningOpen(false);
    const apply = pendingEditRef.current;
    pendingEditRef.current = null;
    apply?.();
  }, []);

  const cancelDegrade = useCallback(() => {
    pendingEditRef.current = null;
    setWarningOpen(false);
  }, []);

  const controlsDisabled =
    disabled || saveState === "saving" || saveState === "offline" || isLocked;

  const statusCopy = isLocked
    ? null
    : saveState === "saving"
      ? "Guardando..."
      : saveState === "saved"
        ? "Guardado ✓"
        : saveState === "offline"
          ? OFFLINE_COPY
          : saveState === "error"
            ? (error ?? SAVE_ERROR)
            : null;

  return (
    <article
      className={cn(
        "rounded-md border border-border bg-card p-4 text-card-foreground transition-colors",
        saveState === "saved" && "border-success ring-1 ring-success/60",
        saveState === "offline" && "border-destructive",
        saveState === "error" && "border-destructive/80",
      )}
    >
      <div className="mb-3 flex min-h-6 items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{match.matchday ? `Jornada ${match.matchday}` : match.stage}</span>
          <span className="font-semibold text-accent">
            {formatMultiplier(displayMultiplier)}
          </span>
        </div>

        {isLocked ? (
          <div
            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground"
            role="status"
          >
            <Lock className="size-3.5" aria-hidden="true" />
            {LOCKED_COPY}
          </div>
        ) : (
          statusCopy && (
            <div
              className={cn(
                "text-xs font-semibold",
                saveState === "saved" && "text-success",
                saveState === "offline" && "text-destructive",
                saveState === "error" && "text-destructive",
                saveState === "saving" && "text-muted-foreground",
              )}
              role={saveState === "error" ? "alert" : "status"}
            >
              {statusCopy}
            </div>
          )
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex flex-col items-start gap-2">
          <span className="text-sm font-semibold">{match.home_team}</span>
          {match.home_team_code && (
            <span className="text-xs uppercase text-muted-foreground">
              {match.home_team_code}
            </span>
          )}
          <GoalPicker
            value={homeScore}
            onChange={handleHomeScoreChange}
            label={match.home_team}
            disabled={controlsDisabled}
            max={MAX_PREDICTION_SCORE}
          />
        </div>

        <div className="pt-8 font-display text-xl font-bold text-accent">vs</div>

        <div className="flex flex-col items-end gap-2">
          <span className="text-right text-sm font-semibold">
            {match.away_team}
          </span>
          {match.away_team_code && (
            <span className="text-xs uppercase text-muted-foreground">
              {match.away_team_code}
            </span>
          )}
          <GoalPicker
            value={awayScore}
            onChange={handleAwayScoreChange}
            label={match.away_team}
            disabled={controlsDisabled}
            max={MAX_PREDICTION_SCORE}
          />
        </div>
      </div>

      {warningOpen && (
        <div
          role="alertdialog"
          aria-label="Advertencia de multiplicador"
          className="mt-3 rounded-sm border border-accent bg-background p-3 text-sm"
        >
          <p className="text-foreground">
            Tu multiplicador bajara de {formatMultiplier(savedMultiplier)} a{" "}
            {formatMultiplier(nextMultiplier)}.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={cancelDegrade}
              className="h-9 rounded-sm border border-border px-4 text-sm font-medium"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmDegrade}
              className="h-9 rounded-sm bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              Continuar
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lock, MapPin } from "lucide-react";

import {
  revertPrediction,
  savePrediction,
} from "@/app/actions/predictions.actions";
import {
  MAX_PREDICTION_SCORE,
  SAVE_ERROR,
  TRANSIENT_SAVE_ERROR,
  UNDO_ERROR,
  UNDO_WINDOW_MS,
} from "@/app/actions/predictions.constants";
import { GoalPicker } from "@/components/predictions/GoalPicker";
import { calculatePredictionMultiplier, MIN_MULTIPLIER } from "@/utils/scoring";
import { flagForTeamCode } from "@/utils/team-flags";
import { describeMatchSource, stageLabel } from "@/utils/tournament";
import type { Match } from "@/types";
import { cn } from "@/utils/utils";

type MatchCardPrediction = {
  id?: string;
  homeScorePred: number;
  awayScorePred: number;
  multiplier?: number;
  updatedAt?: string;
};

export type MatchCardMatch = Pick<
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
  | "home_source"
  | "away_source"
  | "bracket_slot"
  | "venue"
  | "group_label"
>;

type MatchCardProps = {
  leagueId: string;
  match: MatchCardMatch;
  initialPrediction?: MatchCardPrediction | null;
  disabled?: boolean;
  // Ordinal de la jornada en curso (la mayor cuyo primer partido ya empezó),
  // base de la distancia para el multiplicador predictivo en la UI.
  currentRoundOrdinal?: number;
};

type SaveState = "idle" | "dirty" | "saving" | "saved" | "offline" | "error";

type PendingPrediction = {
  homeScorePred: number;
  awayScorePred: number;
};

const DEBOUNCE_MS = 1500;
const OFFLINE_COPY = "Sin conexion - Pendiente";
const LOCKED_COPY = "Pronostico cerrado";
const TBD_COPY = "Pendiente de clasificacion";
const KICKOFF_LOCK_MS = 0;
const CLOSED_STATUSES = new Set(["live", "finished", "suspended", "canceled"]);

function isBrowserOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

// Slot de eliminatoria aun sin equipos reales: la DB (fn_match_editable) bloquea
// la prediccion hasta que Story 7.3 resuelve el bracket. La UI lo refleja
// mostrando el origen (p.ej. "Ganador 97") y deshabilitando el picker.
function isMatchTbd(match: MatchCardProps["match"]): boolean {
  return (
    match.bracket_slot != null &&
    (match.home_team_code == null || match.away_team_code == null)
  );
}

// Bloqueo de UI: defensivo/ergonómico. La AUTORIDAD del bloqueo es la DB (la RPC
// fn_save_prediction rechaza tras match_time con la hora del servidor).
function isMatchLocked(match: MatchCardProps["match"], time: number = Date.now()): boolean {
  if (CLOSED_STATUSES.has(match.status)) return true;
  const kickoffMs = new Date(match.match_time).getTime();
  if (!Number.isFinite(kickoffMs)) return false;
  return time >= kickoffMs - KICKOFF_LOCK_MS;
}

function formatMultiplier(value: number): string {
  return `${value.toFixed(1)}x`;
}

export function MatchCard({
  leagueId,
  match,
  initialPrediction,
  disabled = false,
  currentRoundOrdinal = 0,
}: MatchCardProps) {
  const hasInitialPrediction =
    initialPrediction !== null && initialPrediction !== undefined;
  const initialPredictionId = initialPrediction?.id;
  const initialHomeScore = initialPrediction?.homeScorePred ?? 0;
  const initialAwayScore = initialPrediction?.awayScorePred ?? 0;
  const initialMultiplier = initialPrediction?.multiplier ?? MIN_MULTIPLIER;

  const [homeScore, setHomeScore] = useState(initialHomeScore);
  const [awayScore, setAwayScore] = useState(initialAwayScore);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [warningOpen, setWarningOpen] = useState(false);
  // Multiplicador realmente guardado en el servidor (se refresca tras cada
  // guardado/deshacer) y si ya existe una predicción persistida. Antes esto se
  // derivaba del prop inicial y quedaba "congelado" mostrando un valor obsoleto.
  const [savedMultiplier, setSavedMultiplier] = useState(initialMultiplier);
  const [hasSavedPrediction, setHasSavedPrediction] =
    useState(hasInitialPrediction);
  // Ventana de gracia local para "deshacer cambio" (espejo de fn_revert_prediction,
  // 2 min). Es el timestamp en que expira; null = no hay nada que deshacer.
  const [undoDeadline, setUndoDeadline] = useState<number | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);

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

  const [now, setNow] = useState(() => Date.now());

  // Multiplicador: el guardado (saved) y el que se obtendría al editar AHORA.
  // El valor autoritativo final siempre lo calcula el backend; esto es UI.
  const isTbd = isMatchTbd(match);
  const isLocked = isMatchLocked(match, now);
  const nextMultiplier = calculatePredictionMultiplier(
    match.matchday,
    match.stage,
    currentRoundOrdinal,
  );
  const displayMultiplier = hasSavedPrediction
    ? savedMultiplier
    : nextMultiplier;

  const formattedTime = useMemo(() => {
    const date = new Date(match.match_time);
    if (!Number.isFinite(date.getTime())) return "";
    return date.toLocaleString("es", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [match.match_time]);

  const [timeLeft, setTimeLeft] = useState<string>("");

  useEffect(() => {
    const kickoffMs = new Date(match.match_time).getTime();
    if (!Number.isFinite(kickoffMs)) return;

    function updateRemaining() {
      const currentNow = Date.now();
      setNow(currentNow);

      const diffMs = kickoffMs - currentNow;
      if (diffMs <= 0) {
        setTimeLeft("");
        return;
      }

      const diffSecs = Math.floor(diffMs / 1000);
      const diffMins = Math.floor(diffSecs / 60);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffDays > 0) {
        setTimeLeft(`Faltan ${diffDays} ${diffDays === 1 ? "día" : "días"}`);
      } else if (diffHours > 0) {
        setTimeLeft(`Falta${diffHours === 1 ? "" : "n"} ${diffHours} h`);
      } else if (diffMins > 0) {
        setTimeLeft(`Falta${diffMins === 1 ? "" : "n"} ${diffMins} min`);
      } else {
        setTimeLeft("Falta < 1 min");
      }
    }

    updateRemaining();
    const interval = setInterval(updateRemaining, 10_000);
    return () => clearInterval(interval);
  }, [match.match_time]);

  const prevLockedRef = useRef(isLocked);
  useEffect(() => {
    if (isLocked && !prevLockedRef.current) {
      degradeAckRef.current = false;
    }
    prevLockedRef.current = isLocked;
  }, [isLocked]);

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
    setNow(Date.now());
    setSavedMultiplier(initialMultiplier);
    setHasSavedPrediction(hasInitialPrediction);
    setUndoDeadline(null);
    setUndoBusy(false);
  }, [
    hasInitialPrediction,
    initialAwayScore,
    initialHomeScore,
    initialMultiplier,
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
          // ¿Este guardado cambió el marcador respecto al último guardado? Solo
          // entonces el servidor stasheó el estado previo y se puede deshacer.
          const prevSaved = lastSavedRef.current;
          const scoreChanged =
            prevSaved !== null &&
            (prevSaved.homeScorePred !== prediction.homeScorePred ||
              prevSaved.awayScorePred !== prediction.awayScorePred);

          lastSavedRef.current = prediction;
          pendingRef.current = null;
          if (result.data) {
            setSavedMultiplier(result.data.multiplier);
          }
          setHasSavedPrediction(true);
          setUndoDeadline(scoreChanged ? Date.now() + UNDO_WINDOW_MS : null);
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

  useEffect(() => {
    if (saveState === "saved") {
      const timer = setTimeout(() => {
        setSaveState("idle");
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [saveState]);

  // Oculta el botón de deshacer al expirar la ventana de gracia (2 min).
  useEffect(() => {
    if (undoDeadline === null) return;
    const remaining = undoDeadline - Date.now();
    if (remaining <= 0) {
      setUndoDeadline(null);
      return;
    }
    const timer = setTimeout(() => setUndoDeadline(null), remaining);
    return () => clearTimeout(timer);
  }, [undoDeadline]);

  // Deshace el último cambio: el servidor restaura marcador + multiplicador
  // previos (server-authoritative) si la ventana sigue vigente. Tras restaurar,
  // alineamos lastSavedRef para que el auto-guardado no vuelva a disparar.
  const handleUndo = useCallback(async () => {
    setUndoBusy(true);
    setError(null);

    const result = await revertPrediction({ leagueId, matchId: match.id });

    if (result.success && result.data) {
      const restored = {
        homeScorePred: result.data.home_score_pred,
        awayScorePred: result.data.away_score_pred,
      };
      requestIdRef.current += 1; // invalida cualquier guardado en vuelo
      lastSavedRef.current = restored;
      pendingRef.current = null;
      hasUserEditedRef.current = true;
      degradeAckRef.current = false;
      setHomeScore(restored.homeScorePred);
      setAwayScore(restored.awayScorePred);
      setSavedMultiplier(result.data.multiplier);
      setHasSavedPrediction(true);
      setUndoDeadline(null);
      setSaveState("saved");
    } else {
      // Ventana vencida u otro error: ocultamos el botón y avisamos.
      setUndoDeadline(null);
      setSaveState("error");
      setError(result.error ?? UNDO_ERROR);
    }

    setUndoBusy(false);
  }, [leagueId, match.id]);

  // Intercepta una edición: si bajaría el multiplicador guardado y no se ha
  // confirmado aún, abre la advertencia ANTES de tocar el estado/debounce.
  const requestScoreChange = useCallback(
    (applyEdit: () => void) => {
      const wouldDegrade =
        hasSavedPrediction &&
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
    [hasSavedPrediction, savedMultiplier, nextMultiplier],
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
    disabled ||
    isTbd ||
    saveState === "saving" ||
    saveState === "offline" ||
    isLocked;

  const canUndo = undoDeadline !== null && !isLocked && !isTbd && !disabled;

  const phaseLabel = match.matchday
    ? `Jornada ${match.matchday}`
    : stageLabel(match.stage);

  // En slots TBD el nombre legible es el origen del bracket (p.ej. "Ganador 97");
  // se usa tanto para mostrar como para la etiqueta accesible del GoalPicker.
  const homeLabel = isTbd
    ? (describeMatchSource(match.home_source) ?? match.home_team)
    : match.home_team;
  const awayLabel = isTbd
    ? (describeMatchSource(match.away_source) ?? match.away_team)
    : match.away_team;

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
      <div className="relative mb-3 min-h-6 flex items-start">
        <div className="flex flex-wrap items-center gap-2 pr-36 text-xs text-muted-foreground min-h-6">
          <span>{phaseLabel}</span>
          {formattedTime && (
            <>
              <span>·</span>
              <span suppressHydrationWarning>{formattedTime}</span>
            </>
          )}
          {!isTbd && (
            <>
              <span>·</span>
              <span className="font-semibold text-accent">
                {formatMultiplier(displayMultiplier)}
              </span>
            </>
          )}
          {timeLeft && !isLocked && !isTbd && (
            <>
              <span>·</span>
              <span className="text-muted-foreground font-medium" suppressHydrationWarning>
                {timeLeft}
              </span>
            </>
          )}
          {match.venue && (
            <span className="flex w-full items-center gap-1 text-muted-foreground">
              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{match.venue}</span>
            </span>
          )}
        </div>

        <div className="absolute right-0 top-0 h-6 flex items-center justify-end whitespace-nowrap">
          {isTbd ? (
            <div
              className="flex items-center gap-1 text-xs font-semibold text-muted-foreground"
              role="status"
            >
              <Lock className="size-3.5" aria-hidden="true" />
              {TBD_COPY}
            </div>
          ) : isLocked ? (
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
      </div>

      {/* Móvil (<md): rejilla con identidad pegada a los bordes y "vs" al centro.
          Desktop (md+): el marcador se agrupa centrado (cada equipo apilado:
          bandera/nombre/código arriba, stepper abajo) flanqueando el "vs", con
          más aire. Así aprovecha el ancho sin truncar nombres ni dejar huecos. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 md:flex md:items-end md:justify-center md:gap-10 lg:gap-14">
        <div className="flex flex-col items-start gap-2 md:items-center md:text-center">
          <span className="flex items-center gap-1.5 text-sm font-semibold md:text-base">
            {flagForTeamCode(match.home_team_code) && (
              <span aria-hidden="true">
                {flagForTeamCode(match.home_team_code)}
              </span>
            )}
            {homeLabel}
          </span>
          {match.home_team_code && (
            <span className="text-xs uppercase text-muted-foreground">
              {match.home_team_code}
            </span>
          )}
          <GoalPicker
            value={homeScore}
            onChange={handleHomeScoreChange}
            label={homeLabel}
            disabled={controlsDisabled}
            max={MAX_PREDICTION_SCORE}
          />
        </div>

        <div className="pt-8 font-display text-xl font-bold text-accent md:pb-2.5 md:pt-0 md:text-2xl">vs</div>

        <div className="flex flex-col items-end gap-2 md:items-center md:text-center">
          <span className="flex items-center gap-1.5 text-right text-sm font-semibold md:text-base">
            {awayLabel}
            {flagForTeamCode(match.away_team_code) && (
              <span aria-hidden="true">
                {flagForTeamCode(match.away_team_code)}
              </span>
            )}
          </span>
          {match.away_team_code && (
            <span className="text-xs uppercase text-muted-foreground">
              {match.away_team_code}
            </span>
          )}
          <GoalPicker
            value={awayScore}
            onChange={handleAwayScoreChange}
            label={awayLabel}
            disabled={controlsDisabled}
            max={MAX_PREDICTION_SCORE}
          />
        </div>
      </div>

      {canUndo && (
        <div className="mt-3 flex flex-col gap-2 rounded-sm border border-border bg-background p-2 pl-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="text-muted-foreground">
            Cambiaste tu pronóstico. Puedes deshacerlo y conservar tu
            multiplicador.
          </span>
          <button
            type="button"
            onClick={handleUndo}
            disabled={undoBusy}
            className="h-9 shrink-0 rounded-sm border border-border px-4 text-sm font-semibold disabled:opacity-50"
          >
            {undoBusy ? "Deshaciendo…" : "Deshacer cambio"}
          </button>
        </div>
      )}

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

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Lock, MapPin, Target, TrendingDown, XCircle } from "lucide-react";

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
import {
  calculateBasePoints,
  calculatePredictionMultiplier,
  MIN_MULTIPLIER,
  POINTS_EXACT,
  POINTS_NONE,
  POINTS_RESULT,
} from "@/utils/scoring";
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
  | "home_score"
  | "away_score"
>;

export type PersistedPrediction = {
  id?: string;
  homeScorePred: number;
  awayScorePred: number;
  multiplier: number;
};

type MatchCardProps = {
  leagueId: string;
  match: MatchCardMatch;
  initialPrediction?: MatchCardPrediction | null;
  disabled?: boolean;
  // Ordinal de la jornada en curso (la mayor cuyo primer partido ya empezó),
  // base de la distancia para el multiplicador predictivo en la UI.
  currentRoundOrdinal?: number;
  // Puntos ya evaluados por el servidor (fn_resolve_challenges_on_match_status_change)
  // para partidos finalizados. Se muestran en modo resultado cuando están disponibles;
  // si no, se calculan en cliente vía calculateBasePoints().
  pointsEarned?: number | null;
  // Notifica al tablero el último valor PERSISTIDO (guardado o deshecho) para que
  // al cambiar de pestaña y volver (remontaje) la tarjeta lo recupere y no muestre
  // el valor del cargado inicial.
  onPersisted?: (prediction: PersistedPrediction) => void;
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
const FINISHED_COPY = "Finalizado";
const LIVE_COPY = "En vivo";
const SUSPENDED_COPY = "Suspendido";
const CANCELED_COPY = "Cancelado";
const KICKOFF_LOCK_MS = 0;
const CLOSED_STATUSES = new Set(["live", "finished", "suspended", "canceled"]);

// Etiqueta del candado a mostrar arriba a la derecha según el estado del
// partido. Refleja la situación que mantiene al usuario sin poder editar.
function closedStatusCopy(status: string): string {
  switch (status) {
    case "finished":
      return FINISHED_COPY;
    case "live":
      return LIVE_COPY;
    case "suspended":
      return SUSPENDED_COPY;
    case "canceled":
      return CANCELED_COPY;
    default:
      return LOCKED_COPY;
  }
}

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
  pointsEarned = null,
  onPersisted,
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

  // Guardamos onPersisted en un ref para llamarlo sin meterlo en las deps de
  // runSave/handleUndo (su identidad puede cambiar en cada render del padre).
  const onPersistedRef = useRef(onPersisted);
  useEffect(() => {
    onPersistedRef.current = onPersisted;
  }, [onPersisted]);

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

  // Drift del multiplicador: ocurre cuando el multiplicador guardado es mayor
  // que el que el servidor daría AHORA (porque el torneo avanzó y la distancia
  // al partido se acortó). Mostramos un chip de "↓ X.xx" al lado del guardado
  // para que el usuario sepa que si re-edita, obtendrá menos. Solo aplica
  // cuando hay predicción guardada, el guardado es > 1.0x, y el nuevo es
  // estrictamente menor.
  const multiplierDrift =
    hasSavedPrediction &&
    savedMultiplier > MIN_MULTIPLIER &&
    nextMultiplier < savedMultiplier;

  // Modo resultado: aplica solo a partidos 'finished' con marcador real entero
  // (no null/NaN). En este modo la tarjeta sustituye los GoalPickers por la
  // comparación resultado vs pronóstico y el badge de puntos.
  const isFinishedWithResult =
    match.status === "finished" &&
    Number.isInteger(match.home_score) &&
    Number.isInteger(match.away_score);
  const basePoints = isFinishedWithResult
    ? calculateBasePoints(
        { home: initialHomeScore, away: initialAwayScore },
        { home: match.home_score as number, away: match.away_score as number },
        "finished",
      )
    : POINTS_NONE;
  // Si el servidor ya evaluó y pobló points_earned, lo preferimos al cálculo
  // cliente (es la fuente de verdad); si no, mostramos el cálculo local
  // (base × multiplicador guardado). El badge SIEMPRE se muestra cuando hay
  // predicción, incluso con 0 pts, para que el usuario sepa que ese partido
  // ya fue evaluado (sin predicción, simplemente no hay qué evaluar).
  const showPointsBadge = isFinishedWithResult && hasInitialPrediction;
  const displayedPoints =
    pointsEarned ??
    Math.round(basePoints * initialMultiplier * 100) / 100;
  const badgeVariant: "exact" | "result" | "miss" =
    basePoints === POINTS_EXACT
      ? "exact"
      : basePoints === POINTS_RESULT
        ? "result"
        : "miss";

  // Se formatea tras el montaje (no en SSR): el servidor renderizaría la hora
  // en SU zona horaria y, con la hidratación, ese texto quedaba pegado en el
  // DOM hasta un remount. En el cliente toLocaleString usa la zona del usuario.
  const [formattedTime, setFormattedTime] = useState("");
  useEffect(() => {
    const date = new Date(match.match_time);
    if (!Number.isFinite(date.getTime())) {
      setFormattedTime("");
      return;
    }
    setFormattedTime(
      date.toLocaleString("es", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
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
            // Reporta el guardado al tablero para sobrevivir al remontaje al
            // cambiar de pestaña (el prop inicial no se actualiza solo).
            onPersistedRef.current?.({
              id: result.data.id,
              homeScorePred: prediction.homeScorePred,
              awayScorePred: prediction.awayScorePred,
              multiplier: result.data.multiplier,
            });
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
      onPersistedRef.current?.({
        id: result.data.id,
        homeScorePred: restored.homeScorePred,
        awayScorePred: restored.awayScorePred,
        multiplier: result.data.multiplier,
      });
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

  const canUndo =
    undoDeadline !== null &&
    !isLocked &&
    !isTbd &&
    !disabled &&
    !isFinishedWithResult;

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
          {/* Número de partido del bracket (solo eliminatorias). Permite ubicar
              a qué cruce se refiere un origen TBD como "Ganador 74". */}
          {match.bracket_slot != null && (
            <span className="rounded-sm border border-accent/60 bg-accent/10 px-1.5 py-0.5 font-semibold text-accent">
              Partido {match.bracket_slot}
            </span>
          )}
          {formattedTime && (
            <>
              <span>·</span>
              <span>{formattedTime}</span>
            </>
          )}
          {/* Multiplicador en cabecera: solo se muestra en partidos scheduled
              (donde el usuario aún puede editar su predicción). En live,
              finished, suspendido o canceled el multiplicador se muestra en el
              PointsBadge (finished) o directamente no aplica, por lo que
              ocultarlo evita redundancia visual y ruido.

              Si el multiplicador guardado es mayor que el actual (el torneo
              avanzó y la distancia se acortó), mostramos un sufijo inline
              "· ↓ X.XXx" en muted al lado del guardado en gold, indicando
              el valor que obtendría si re-edita. Se integra al patrón de
              separadores "·" de la cabecera sin agregar un chip visual. */}
          {match.status === "scheduled" && !isTbd && (
            <>
              <span>·</span>
              <span className="font-semibold text-accent" data-testid="multiplier-badge">
                {formatMultiplier(displayMultiplier)}
              </span>
              {multiplierDrift && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-accent/5 px-1.5 py-0.5 text-[10px] font-medium text-accent"
                  title={`Si editas ahora sería ${nextMultiplier.toFixed(2)}x`}
                  data-testid="multiplier-drift-chip"
                  aria-label={`Si editas ahora el multiplicador bajaría a ${nextMultiplier.toFixed(2)}x`}
                >
                  <TrendingDown
                    className="size-3 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{nextMultiplier.toFixed(2)}x</span>
                </span>
              )}
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
              {closedStatusCopy(match.status)}
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
                data-testid="save-status"
                data-state={saveState}
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
          {isFinishedWithResult ? (
            <span
              className="font-display text-2xl font-extrabold tabular-nums text-foreground md:text-3xl"
              aria-label="Goles del equipo local en el resultado real"
              data-testid="actual-home-score"
            >
              {match.home_score}
            </span>
          ) : (
            <GoalPicker
              value={homeScore}
              onChange={handleHomeScoreChange}
              label={homeLabel}
              disabled={controlsDisabled}
              max={MAX_PREDICTION_SCORE}
            />
          )}
        </div>

        {isFinishedWithResult ? (
          <div
            className="font-display text-sm font-semibold uppercase tracking-widest text-muted-foreground md:text-base"
            aria-hidden="true"
            data-testid="result-divider"
          >
            Resultado
          </div>
        ) : (
          <div className="pt-8 font-display text-xl font-bold text-accent md:pb-2.5 md:pt-0 md:text-2xl">vs</div>
        )}

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
          {isFinishedWithResult ? (
            <span
              className="font-display text-2xl font-extrabold tabular-nums text-foreground md:text-3xl"
              aria-label="Goles del equipo visitante en el resultado real"
              data-testid="actual-away-score"
            >
              {match.away_score}
            </span>
          ) : (
            <GoalPicker
              value={awayScore}
              onChange={handleAwayScoreChange}
              label={awayLabel}
              disabled={controlsDisabled}
              max={MAX_PREDICTION_SCORE}
            />
          )}
        </div>
      </div>

      {isFinishedWithResult && (
        <div
          className="mt-3 flex flex-col items-center gap-1.5 border-t border-border pt-3"
          data-testid="result-summary"
        >
          <p className="text-xs text-muted-foreground" data-testid="your-prediction">
            Tu pronóstico: {initialHomeScore} - {initialAwayScore}
          </p>
          {showPointsBadge && (
            <PointsBadge
              variant={badgeVariant}
              points={displayedPoints}
              multiplier={initialMultiplier}
            />
          )}
        </div>
      )}

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

// Badge de puntos para partidos finalizados. Variante:
//   - 'exact'  → acierto exacto (5 pts base) → verde con CheckCircle2
//   - 'result' → mismo resultado, distinto marcador (2 pts base) → ámbar con Target
//   - 'miss'   → resultado distinto → gris con XCircle
// Muestra los puntos finales (base × multiplicador) cuando el multiplicador es
// > 1.00, para que el usuario vea cómo se calculó su puntaje.
type PointsBadgeProps = {
  variant: "exact" | "result" | "miss";
  points: number;
  multiplier: number;
};

function PointsBadge({ variant, points, multiplier }: PointsBadgeProps) {
  const config = {
    exact: {
      bg: "bg-emerald-500/10",
      text: "text-emerald-600 dark:text-emerald-400",
      Icon: CheckCircle2,
      label: "¡Exacto!",
    },
    result: {
      bg: "bg-amber-500/10",
      text: "text-amber-600 dark:text-amber-400",
      Icon: Target,
      label: "Acierto parcial",
    },
    miss: {
      bg: "bg-zinc-500/10",
      text: "text-zinc-600 dark:text-zinc-400",
      Icon: XCircle,
      label: "Sin puntos",
    },
  }[variant];
  const { Icon, label } = config;
  // Muestra el multiplicador siempre que haya puntos (no miss), incluyendo
  // cuando es 1.0x. Así el usuario ve cómo se calculó su puntaje en todos
  // los casos: exacto, parcial y el baseline de 1.0x.
  const showMultiplier = variant !== "miss";

  return (
    <div
      data-testid="points-badge"
      data-variant={variant}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        config.bg,
        config.text,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span>+{points.toFixed(2)} pts · {label}</span>
      {showMultiplier && (
        <span className="opacity-70" aria-label={`Multiplicador ${multiplier.toFixed(2)}`}>
          (x{multiplier.toFixed(2)})
        </span>
      )}
    </div>
  );
}

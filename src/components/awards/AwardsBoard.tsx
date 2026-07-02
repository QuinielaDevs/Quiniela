"use client";

import { useState, useTransition, useMemo, useCallback } from "react";

import { saveSpecialPrediction } from "@/app/actions/special-predictions.actions";
import { AWARD_CATEGORIES } from "@/utils/awards";
import type { AwardCandidate, AwardCategory } from "@/types";
import { cn } from "@/utils/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AwardSelector } from "./AwardSelector";

type Selections = Record<AwardCategory, string | null>;

/** Puntos ganados por categoría (vista special_predictions_with_points):
 *  solo hay entrada con isCorrect=true cuando el admin resolvió el ganador. */
export type EarnedAwardPoints = Partial<
  Record<AwardCategory, { isCorrect: boolean; points: number }>
>;

interface AwardsBoardProps {
  leagueId: string;
  selectedCandidates: Record<AwardCategory, AwardCandidate | null>;
  initialSelections: Selections;
  initialPredTimes?: Record<AwardCategory, string | null>;
  isLocked?: boolean;
  activePhaseLabel?: string;
  activePhaseCode?: string;
  earnedPoints?: EarnedAwardPoints;
  phases?: Array<{
    phase_code: string;
    reward_points: number;
    starts_at: string | null;
    ends_at: string | null;
    label: string;
  }>;
}

export function AwardsBoard({
  leagueId,
  selectedCandidates,
  initialSelections,
  initialPredTimes,
  isLocked = false,
  activePhaseLabel = "Semifinales en adelante",
  activePhaseCode = "D",
  earnedPoints = {},
  phases,
}: AwardsBoardProps) {
  const [selections, setSelections] = useState<Selections>(initialSelections);
  const [predTimes, setPredTimes] = useState<Record<AwardCategory, string | null>>(initialPredTimes ?? {
    champion: null,
    top_scorer: null,
    mvp: null,
  });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [warningOpen, setWarningOpen] = useState<boolean>(false);
  const [warningData, setWarningData] = useState<{
    category: AwardCategory;
    candidateId: string;
    currentPoints: number;
    activePhasePoints: number;
    previous: string | null;
  } | null>(null);

  const activePhasePoints = useMemo(() => {
    const matched = phases?.find((p) => p.phase_code === activePhaseCode);
    return matched ? matched.reward_points : 2;
  }, [phases, activePhaseCode]);

  const parseSafeDate = useCallback((dateStr: string | null) => {
    if (!dateStr) return null;
    const formatted = dateStr.includes(" ") ? dateStr.replace(" ", "T") : dateStr;
    const time = new Date(formatted).getTime();
    return Number.isNaN(time) ? null : time;
  }, []);

  const getPointsForTimestamp = useCallback((predictedAtStr: string | null) => {
    const time = parseSafeDate(predictedAtStr);
    if (time === null || !phases) return 0;
    const matched = phases.find((phase) => {
      const start = parseSafeDate(phase.starts_at);
      const end = parseSafeDate(phase.ends_at);
      const matchesStart = start === null || time >= start;
      const matchesEnd = end === null || time < end;
      return matchesStart && matchesEnd;
    });
    return matched ? matched.reward_points : 0;
  }, [phases, parseSafeDate]);

  const executeSave = useCallback((category: AwardCategory, candidateId: string, previous: string | null) => {
    setError(null);
    setPendingId(candidateId);
    setSelections((prev) => ({ ...prev, [category]: candidateId }));

    startTransition(async () => {
      const result = await saveSpecialPrediction(
        leagueId,
        category,
        candidateId,
      );

      if (!result.success) {
        setSelections((prev) => ({ ...prev, [category]: previous }));
        setError(result.error ?? "No se pudo guardar tu predicción.");
      } else {
        if (result.data && result.data.predicted_at) {
          const predictedAt = result.data.predicted_at;
          setPredTimes((prev) => ({ ...prev, [category]: predictedAt }));
        } else {
          setPredTimes((prev) => ({ ...prev, [category]: new Date().toISOString() }));
        }
      }

      setPendingId(null);
    });
  }, [leagueId]);

  const cancelDegrade = useCallback(() => {
    setWarningOpen(false);
    setWarningData(null);
  }, []);

  const confirmDegrade = useCallback(() => {
    if (!warningData) return;
    const { category, candidateId, previous } = warningData;
    setWarningOpen(false);
    setWarningData(null);
    executeSave(category, candidateId, previous);
  }, [warningData, executeSave]);

  function handleSelect(category: AwardCategory, candidateId: string): boolean {
    if (isLocked) return false;
    if (selections[category] === candidateId) return false;

    const previous = selections[category];
    const previousTime = predTimes[category];

    const currentPoints = getPointsForTimestamp(previousTime);
    if (previous && currentPoints > activePhasePoints) {
      setWarningData({
        category,
        candidateId,
        currentPoints,
        activePhasePoints,
        previous,
      });
      setWarningOpen(true);
      return false;
    }

    executeSave(category, candidateId, previous);
    return true;
  }

  return (
    <div className="flex flex-col gap-5" data-testid="awards-board">
      {isLocked && (
        <div
          className="flex items-center gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200"
          data-testid="award-locked-notice"
        >
          <span className="text-xl" aria-hidden="true">🔒</span>
          <div>
            <p className="font-semibold">Predicciones bloqueadas</p>
            <p className="text-xs text-yellow-200/80">
              Las predicciones están bloqueadas debido al inicio del partido de la final.
            </p>
          </div>
        </div>
      )}

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
        >
          {error}
        </p>
      ) : null}

      <div
        className="rounded-lg border border-white/10 bg-[#1B263B] p-4 text-sm"
        data-testid="award-phase-points"
        data-active-phase={activePhaseCode}
      >
        <h3 className="font-display font-bold text-white mb-2 flex items-center gap-1.5 text-base">
          <span>🏆</span> Puntuación Especial Decreciente
        </h3>
        <p className="text-xs text-white/70 mb-4">
          ¡Premia tu audacia! Cuanto antes registres tus predicciones de largo plazo en el torneo, más puntos recibirás si aciertas:
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div
            className={cn(
              "rounded border p-2 text-center transition-all duration-300 flex flex-col justify-center",
              activePhaseCode === "A"
                ? "border-[#E9C46A] bg-[#E9C46A]/15 ring-1 ring-[#E9C46A]"
                : "border-white/5 bg-white/5 opacity-60"
            )}
          >
            <span className={cn(
              "block text-[10px] uppercase font-bold tracking-wider",
              activePhaseCode === "A" ? "text-[#E9C46A]" : "text-white/40"
            )}>
              {activePhaseCode === "A" ? "👉 En Curso" : "Antes del Torneo"}
            </span>
            <span className="text-lg font-extrabold text-white mt-0.5">50 pts</span>
          </div>

          <div
            className={cn(
              "rounded border p-2 text-center transition-all duration-300 flex flex-col justify-center",
              activePhaseCode === "B"
                ? "border-[#E9C46A] bg-[#E9C46A]/15 ring-1 ring-[#E9C46A]"
                : "border-white/5 bg-white/5 opacity-60"
            )}
          >
            <span className={cn(
              "block text-[10px] uppercase font-bold tracking-wider",
              activePhaseCode === "B" ? "text-[#E9C46A]" : "text-white/40"
            )}>
              {activePhaseCode === "B" ? "👉 En Curso" : "Fase de Grupos"}
            </span>
            <span className="text-lg font-extrabold text-white mt-0.5">25 pts</span>
          </div>

          <div
            className={cn(
              "rounded border p-2 text-center transition-all duration-300 flex flex-col justify-center",
              activePhaseCode === "C"
                ? "border-[#E9C46A] bg-[#E9C46A]/15 ring-1 ring-[#E9C46A]"
                : "border-white/5 bg-white/5 opacity-60"
            )}
          >
            <span className={cn(
              "block text-[10px] uppercase font-bold tracking-wider",
              activePhaseCode === "C" ? "text-[#E9C46A]" : "text-white/40"
            )}>
              {activePhaseCode === "C" ? "👉 En Curso" : "Eliminatorias"}
            </span>
            <span className="text-lg font-extrabold text-white mt-0.5">10 pts</span>
          </div>

          <div
            className={cn(
              "rounded border p-2 text-center transition-all duration-300 flex flex-col justify-center",
              activePhaseCode === "D"
                ? "border-yellow-500/40 bg-yellow-500/10 ring-1 ring-yellow-500/50"
                : "border-white/5 bg-white/5 opacity-60"
            )}
          >
            <span className={cn(
              "block text-[10px] uppercase font-bold tracking-wider",
              activePhaseCode === "D" ? "text-yellow-400" : "text-white/40"
            )}>
              {activePhaseCode === "D" ? "🔒 Bloqueado" : "Semifinal en adelante"}
            </span>
            <span className="text-lg font-extrabold text-white mt-0.5">2 pts</span>
          </div>
        </div>
        <p className="text-[10px] text-white/50 mt-3 text-center italic">
          * Tu puntuación se calcula en base a la fecha de tu último cambio efectivo.
        </p>
      </div>

      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-3 lg:items-start lg:gap-5">
        {AWARD_CATEGORIES.map(({ category, title, hint }) => (
          <Card
            key={category}
            data-testid="award-category"
            data-category={category}
            className="border-white/10 bg-[#1B263B]"
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-lg text-white">{title}</CardTitle>
              <CardDescription className="text-white/60">{hint}</CardDescription>
              {earnedPoints[category]?.isCorrect && (
                <p
                  className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-[#E9C46A]/40 bg-[#E9C46A]/15 px-3 py-1 text-xs font-bold text-[#E9C46A]"
                  data-testid="award-earned-badge"
                >
                  <span aria-hidden="true">🎉</span> ¡Acertaste! +
                  {earnedPoints[category]!.points} pts
                </p>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              <AwardSelector
                key={category}
                selectedCandidate={selectedCandidates[category]}
                selectedId={selections[category]}
                pendingId={isPending ? pendingId : null}
                disabled={isPending || isLocked}
                onSelect={(candidateId) => handleSelect(category, candidateId)}
                category={category}
              />
              {selections[category] && (
                <p className="text-xs text-white/50 mt-1 flex items-center gap-1" data-testid="award-current-value">
                  <span>🎯</span> Pronóstico actual:{" "}
                  <span className="font-semibold text-accent">
                    +{getPointsForTimestamp(predTimes[category])} pts
                  </span>
                </p>
              )}

              {warningOpen && warningData?.category === category && (
                <div
                  role="alertdialog"
                  aria-label="Advertencia de degradación de puntos"
                  className="mt-3 rounded-sm border border-accent bg-background p-3 text-sm"
                >
                  <p className="text-foreground">
                    Si cambias tu selección ahora (Fase {activePhaseLabel}), tus puntos potenciales para esta categoría disminuirán de {warningData.currentPoints} a {warningData.activePhasePoints} si aciertas.
                  </p>
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={cancelDegrade}
                      className="h-9 rounded-sm border border-border px-3 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={confirmDegrade}
                      className="h-9 rounded-sm bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      Continuar
                    </button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";

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
import { CandidatePicker } from "./CandidatePicker";

type Selections = Record<AwardCategory, string | null>;

interface AwardsBoardProps {
  leagueId: string;
  candidatesByCategory: Record<AwardCategory, AwardCandidate[]>;
  initialSelections: Selections;
  isLocked?: boolean;
  activePhaseLabel?: string;
  activePhaseCode?: string;
}

/**
 * Tablero de Premios Especiales (cliente). Renderiza las tres categorías y
 * gestiona la selección de un tap con guardado optimista vía Server Action.
 * Mientras un guardado está en curso se deshabilitan los taps (useTransition);
 * si la Server Action falla, revierte la selección y muestra el error.
 */
export function AwardsBoard({
  leagueId,
  candidatesByCategory,
  initialSelections,
  isLocked = false,
  activePhaseLabel = "Semifinales en adelante",
  activePhaseCode = "D",
}: AwardsBoardProps) {
  const [selections, setSelections] = useState<Selections>(initialSelections);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSelect(category: AwardCategory, candidateId: string) {
    if (isLocked) return;
    // Tap sobre el ya seleccionado: no-op (evita un upsert sin cambios).
    if (selections[category] === candidateId) return;

    const previous = selections[category];
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
        // Revierte la selección optimista y avisa.
        setSelections((prev) => ({ ...prev, [category]: previous }));
        setError(result.error ?? "No se pudo guardar tu predicción.");
      }

      setPendingId(null);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {isLocked && (
        <div className="flex items-center gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
          <span className="text-xl" aria-hidden="true">🔒</span>
          <div>
            <p className="font-semibold">Predicciones bloqueadas</p>
            <p className="text-xs text-yellow-200/80">
              Las predicciones están bloqueadas por fase del torneo ({activePhaseLabel}).
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

      {/* Leyenda del sistema de puntuación decreciente */}
      <div className="rounded-lg border border-white/10 bg-[#1B263B] p-4 text-sm">
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
          <Card key={category} className="border-white/10 bg-[#1B263B]">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg text-white">{title}</CardTitle>
              <CardDescription className="text-white/60">{hint}</CardDescription>
            </CardHeader>
            <CardContent>
              <CandidatePicker
                candidates={candidatesByCategory[category]}
                selectedId={selections[category]}
                pendingId={isPending ? pendingId : null}
                disabled={isPending || isLocked}
                onSelect={(candidateId) => handleSelect(category, candidateId)}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

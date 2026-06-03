"use client";

import { useState, useTransition } from "react";

import { saveSpecialPrediction } from "@/app/actions/special-predictions.actions";
import { AWARD_CATEGORIES } from "@/utils/awards";
import type { AwardCandidate, AwardCategory } from "@/types";
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
              Las predicciones están bloqueadas por fase del torneo (Semifinales en adelante).
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
  );
}

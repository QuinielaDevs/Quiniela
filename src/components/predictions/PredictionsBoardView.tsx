"use client";

import { useMemo, useState } from "react";

import { MatchCard, type MatchCardMatch } from "@/components/predictions/MatchCard";
import { ScrollableTabs } from "@/components/ui/ScrollableTabs";
import { buildPhases, phaseKeyForMatch } from "@/utils/tournament";
import { AwardsBoard } from "@/components/awards/AwardsBoard";
import type { AwardCandidate, AwardCategory } from "@/types";

export type BoardPrediction = {
  id: string;
  match_id: string;
  home_score_pred: number;
  away_score_pred: number;
  multiplier: number | null;
  updated_at: string | null;
};

type PredictionsBoardViewProps = {
  leagueId: string;
  matches: MatchCardMatch[];
  predictions: BoardPrediction[];
  firstMatchTime?: string;
  candidatesByCategory: Record<AwardCategory, AwardCandidate[]>;
  initialSelections: Record<AwardCategory, string | null>;
  isAwardsLocked: boolean;
  activePhaseLabel: string;
  activePhaseCode: string;
};

// Tablero táctil con navegación por fase (UX-DR-7). Agrupa los partidos por
// Jornada 1/2/3 y por ronda de eliminatoria (32avos → Final), mostrando también
// los slots TBD aún no clasificados (MatchCard los deja en solo-lectura).
// También integra los Premios Especiales como primera pestaña.
export function PredictionsBoardView({
  leagueId,
  matches,
  predictions,
  firstMatchTime,
  candidatesByCategory,
  initialSelections,
  isAwardsLocked,
  activePhaseLabel,
  activePhaseCode,
}: PredictionsBoardViewProps) {
  const phases = useMemo(() => {
    const matchPhases = buildPhases(matches);
    return [{ key: "awards", label: "Premios Copa" }, ...matchPhases];
  }, [matches]);

  const [activeKey, setActiveKey] = useState(() => {
    // Buscar si existe jornada-1 para seleccionarla por defecto
    const hasJornada1 = phases.some((p) => p.key === "jornada-1");
    if (hasJornada1) return "jornada-1";
    // Fallback al primer partido
    return phases[1]?.key ?? phases[0]?.key ?? "";
  });

  const predictionByMatch = useMemo(
    () => new Map(predictions.map((prediction) => [prediction.match_id, prediction])),
    [predictions],
  );

  const visibleMatches = useMemo(
    () => matches.filter((match) => phaseKeyForMatch(match) === activeKey),
    [matches, activeKey],
  );

  return (
    <div className="flex flex-col gap-3">
      {phases.length > 1 && (
        <ScrollableTabs
          tabs={phases}
          activeKey={activeKey}
          onSelect={setActiveKey}
          ariaLabel="Filtro por fase"
        />
      )}

      {activeKey === "awards" ? (
        <AwardsBoard
          leagueId={leagueId}
          candidatesByCategory={candidatesByCategory}
          initialSelections={initialSelections}
          isLocked={isAwardsLocked}
          activePhaseLabel={activePhaseLabel}
          activePhaseCode={activePhaseCode}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {visibleMatches.map((match) => {
            const prediction = predictionByMatch.get(match.id);
            return (
              <MatchCard
                key={match.id}
                leagueId={leagueId}
                match={match}
                firstMatchTime={firstMatchTime}
                initialPrediction={
                  prediction
                    ? {
                        id: prediction.id,
                        homeScorePred: prediction.home_score_pred,
                        awayScorePred: prediction.away_score_pred,
                        multiplier: prediction.multiplier ?? undefined,
                        updatedAt: prediction.updated_at ?? undefined,
                      }
                    : null
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

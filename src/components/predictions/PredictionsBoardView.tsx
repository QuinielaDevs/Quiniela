"use client";

import { useMemo, useState } from "react";

import { MatchCard, type MatchCardMatch } from "@/components/predictions/MatchCard";
import { ScrollableTabs } from "@/components/ui/ScrollableTabs";
import { buildPhases, phaseKeyForMatch } from "@/utils/tournament";

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
};

// Tablero táctil con navegación por fase (UX-DR-7). Agrupa los partidos por
// Jornada 1/2/3 y por ronda de eliminatoria (32avos → Final), mostrando también
// los slots TBD aún no clasificados (MatchCard los deja en solo-lectura).
export function PredictionsBoardView({
  leagueId,
  matches,
  predictions,
  firstMatchTime,
}: PredictionsBoardViewProps) {
  const phases = useMemo(() => buildPhases(matches), [matches]);
  const [activeKey, setActiveKey] = useState(() => phases[0]?.key ?? "");

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
    </div>
  );
}

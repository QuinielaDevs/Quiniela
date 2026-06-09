"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import {
  MatchCard,
  type MatchCardMatch,
  type PersistedPrediction,
} from "@/components/predictions/MatchCard";
import { ScrollableTabs } from "@/components/ui/ScrollableTabs";
import {
  buildPhases,
  groupByGroupLabel,
  phaseKeyForMatch,
  sortKnockoutBySlot,
} from "@/utils/tournament";
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
  selectedCandidates: Record<AwardCategory, AwardCandidate | null>;
  initialSelections: Record<AwardCategory, string | null>;
  isAwardsLocked: boolean;
  activePhaseLabel: string;
  activePhaseCode: string;
  currentRoundOrdinal: number;
};

// Tablero táctil con navegación por fase (UX-DR-7). Agrupa los partidos por
// Jornada 1/2/3 y por ronda de eliminatoria (16avos → Final), mostrando también
// los slots TBD aún no clasificados (MatchCard los deja en solo-lectura).
// También integra los Premios Especiales como primera pestaña.
export function PredictionsBoardView({
  leagueId,
  matches,
  predictions,
  selectedCandidates,
  initialSelections,
  isAwardsLocked,
  activePhaseLabel,
  activePhaseCode,
  currentRoundOrdinal,
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

  // Cache de los últimos valores PERSISTIDOS por el usuario en esta sesión. Vive
  // en un ref (no provoca re-render → no perturba la tarjeta activa ni su botón
  // de "Deshacer"). Al cambiar de pestaña y volver, las tarjetas se remontan y
  // leen de aquí el último guardado en vez del prop del cargado inicial.
  const persistedRef = useRef(new Map<string, PersistedPrediction>());
  const handlePersisted = useCallback(
    (matchId: string, prediction: PersistedPrediction) => {
      persistedRef.current.set(matchId, prediction);
    },
    [],
  );

  const visibleMatches = useMemo(
    () => matches.filter((match) => phaseKeyForMatch(match) === activeKey),
    [matches, activeKey],
  );

  const isGroupPhase = activeKey.startsWith("jornada-");

  // En grupos: secciones por Grupo A–L. En eliminatorias: orden por bracket_slot.
  const groupedSections = useMemo(
    () => (isGroupPhase ? groupByGroupLabel(visibleMatches) : []),
    [isGroupPhase, visibleMatches],
  );
  const knockoutMatches = useMemo(
    () => (isGroupPhase ? [] : sortKnockoutBySlot(visibleMatches)),
    [isGroupPhase, visibleMatches],
  );

  const renderCard = (match: MatchCardMatch) => {
    // El override de la sesión (último guardado/deshecho) gana sobre el prop del
    // cargado inicial, para que el remontaje al volver a la pestaña no muestre
    // un valor obsoleto.
    const override = persistedRef.current.get(match.id);
    const stored = predictionByMatch.get(match.id);
    const initialPrediction = override
      ? {
          id: override.id,
          homeScorePred: override.homeScorePred,
          awayScorePred: override.awayScorePred,
          multiplier: override.multiplier,
        }
      : stored
        ? {
            id: stored.id,
            homeScorePred: stored.home_score_pred,
            awayScorePred: stored.away_score_pred,
            multiplier: stored.multiplier ?? undefined,
            updatedAt: stored.updated_at ?? undefined,
          }
        : null;

    return (
      <MatchCard
        key={match.id}
        leagueId={leagueId}
        match={match}
        currentRoundOrdinal={currentRoundOrdinal}
        initialPrediction={initialPrediction}
        onPersisted={(prediction) => handlePersisted(match.id, prediction)}
      />
    );
  };

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
          selectedCandidates={selectedCandidates}
          initialSelections={initialSelections}
          isLocked={isAwardsLocked}
          activePhaseLabel={activePhaseLabel}
          activePhaseCode={activePhaseCode}
        />
      ) : isGroupPhase ? (
        <div className="flex flex-col gap-6">
          {groupedSections.map((section) => (
            <section key={section.group} className="flex flex-col gap-3">
              <h3 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-accent">
                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm bg-accent/15 px-2 text-accent">
                  {section.group}
                </span>
                Grupo {section.group}
              </h3>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {section.matches.map(renderCard)}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {knockoutMatches.map(renderCard)}
        </div>
      )}
    </div>
  );
}

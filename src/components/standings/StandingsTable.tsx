"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Minus } from "lucide-react";

import {
  buildStandings,
  type StandingMatch,
  type StandingMember,
  type StandingPrediction,
} from "@/utils/standings";
import {
  calculateBasePoints,
  calculatePredictionPoints,
} from "@/utils/scoring";
import { resolvePhase } from "@/utils/awardsScoring";
import { phaseKeyForMatch, buildPhases, stageLabel } from "@/utils/tournament";
import { PaymentStatusBadge } from "@/components/standings/PaymentStatusBadge";
import { ScrollableTabs } from "@/components/ui/ScrollableTabs";
import { cn } from "@/utils/utils";

type StandingsTableProps = {
  members: StandingMember[];
  matches: StandingMatch[];
  predictions: StandingPrediction[];
  specialPredictions?: Array<{
    user_id: string;
    category: string;
    candidate_id: string;
    predicted_at: string;
    award_candidates: { name: string } | null;
  }>;
  isAwardsLocked?: boolean;
  phases?: Array<{
    phase_code: string;
    reward_points: number;
    starts_at: string | null;
    ends_at: string | null;
    label: string;
  }>;
};

type Tab = { key: string; label: string };

/** Etiqueta legible para una clave de fase (jornada-1 → "Jornada 1", quarter → "Cuartos", etc.) */
function phaseLabelForKey(key: string): string {
  const jornadaMatch = /^jornada-(\d+)$/.exec(key);
  if (jornadaMatch) return `Jornada ${jornadaMatch[1]}`;
  return stageLabel(key);
}

/** Ordinal descendente para ordenar fases: knockout stages > jornadas. */
function phaseOrdinalDesc(key: string): number {
  const knockoutOrder: Record<string, number> = {
    final: 100,
    "third-place": 99,
    semi: 98,
    quarter: 97,
    "round-16": 96,
    "round-32": 95,
  };
  if (knockoutOrder[key] != null) return knockoutOrder[key];
  const jornadaMatch = /^jornada-(\d+)$/.exec(key);
  if (jornadaMatch) return Number(jornadaMatch[1]);
  return 0;
}

type MatchDetail = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  predHome: number | null;
  predAway: number | null;
  multiplier: number;
  basePoints: number;
  earnedPoints: number;
  phaseKey: string;
  matchTime?: string;
  penaltiesHomeScore?: number | null;
  penaltiesAwayScore?: number | null;
  extraTimeHomeScore?: number | null;
  extraTimeAwayScore?: number | null;
};

/** Calcula el desglose de puntos de un usuario para los partidos en alcance. */
function computeUserBreakdown(
  userId: string,
  matchesInScope: StandingMatch[],
  predByKey: Map<string, StandingPrediction>,
): MatchDetail[] {
  const details: MatchDetail[] = [];

  for (const match of matchesInScope) {
    const pred = predByKey.get(`${userId}:${match.id}`);
    const base = pred
      ? calculateBasePoints(
        { home: pred.homeScorePred, away: pred.awayScorePred },
        { home: match.homeScore as number, away: match.awayScore as number },
        "finished",
      )
      : 0;
    const earned = pred ? calculatePredictionPoints(base, pred.multiplier) : 0;

    details.push({
      matchId: match.id,
      homeTeam: match.homeTeam ?? "Local",
      awayTeam: match.awayTeam ?? "Visitante",
      homeScore: match.homeScore as number,
      awayScore: match.awayScore as number,
      predHome: pred?.homeScorePred ?? null,
      predAway: pred?.awayScorePred ?? null,
      multiplier: pred?.multiplier ?? 1,
      basePoints: base,
      earnedPoints: earned,
      phaseKey: phaseKeyForMatch({
        stage: match.stage ?? null,
        matchday: match.matchday,
      }),
      matchTime: match.matchTime,
      penaltiesHomeScore: match.penaltiesHomeScore ?? null,
      penaltiesAwayScore: match.penaltiesAwayScore ?? null,
      extraTimeHomeScore: match.extraTimeHomeScore ?? null,
      extraTimeAwayScore: match.extraTimeAwayScore ?? null,
    });
  }

  return details;
}

/** Agrupa partidos por fase, ordenados descendentemente (fases más recientes primero).
 *  Dentro de cada fase los partidos se ordenan por match_time descendente (más reciente primero). */
function groupByPhaseDesc(details: MatchDetail[]): { label: string; matches: MatchDetail[] }[] {
  const grouped = new Map<string, MatchDetail[]>();
  for (const d of details) {
    const bucket = grouped.get(d.phaseKey);
    if (bucket) bucket.push(d);
    else grouped.set(d.phaseKey, [d]);
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => phaseOrdinalDesc(b) - phaseOrdinalDesc(a))
    .map(([key, matches]) => ({
      label: phaseLabelForKey(key),
      matches: [...matches].sort((a, b) => {
        const tA = a.matchTime ? new Date(a.matchTime).getTime() : 0;
        const tB = b.matchTime ? new Date(b.matchTime).getTime() : 0;
        if (tB !== tA) return tB - tA;
        return b.matchId.localeCompare(a.matchId);
      }),
    }));
}

function renderOutcomeBadge(base: number) {
  if (base === 5) {
    return (
      <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
        Exacto
      </span>
    );
  }
  if (base === 2) {
    return (
      <span className="rounded bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
        Parcial
      </span>
    );
  }
  return (
    <span className="rounded bg-muted border border-border px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
      Fallido
    </span>
  );
}

export function StandingsTable({
  members,
  matches,
  predictions,
  specialPredictions,
  isAwardsLocked = false,
  phases,
}: StandingsTableProps) {
  const [activeKey, setActiveKey] = useState("general");
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const specialPredsByUser = useMemo(() => {
    const map = new Map<string, Record<string, { name: string; points: number }>>();
    if (!specialPredictions) return map;
    for (const sp of specialPredictions) {
      let userRec = map.get(sp.user_id);
      if (!userRec) {
        userRec = {};
        map.set(sp.user_id, userRec);
      }

      let points = 0;
      if (sp.predicted_at) {
        let formatted = sp.predicted_at.includes(" ") ? sp.predicted_at.replace(" ", "T") : sp.predicted_at;
        formatted = formatted.replace(/([+-]\d{2})$/, "$1:00");
        const time = new Date(formatted).getTime();
        if (!Number.isNaN(time)) {
          if (phases && phases.length > 0) {
            const matched = phases.find((phase) => {
              const start = phase.starts_at ? new Date(phase.starts_at.includes(" ") ? phase.starts_at.replace(" ", "T") : phase.starts_at).getTime() : null;
              const end = phase.ends_at ? new Date(phase.ends_at.includes(" ") ? phase.ends_at.replace(" ", "T") : phase.ends_at).getTime() : null;
              const matchesStart = start === null || Number.isNaN(start) || time >= start;
              const matchesEnd = end === null || Number.isNaN(end) || time < end;
              return matchesStart && matchesEnd;
            });
            if (matched) points = matched.reward_points;
          } else {
            try {
              points = resolvePhase(new Date(formatted)).rewardPoints;
            } catch (e) {
              console.error("Error calculating points for prediction:", e);
            }
          }
        }
      }

      userRec[sp.category] = {
        name: sp.award_candidates?.name ?? "Candidato Desconocido",
        points,
      };
    }
    return map;
  }, [specialPredictions, phases]);

  const tabs = useMemo<Tab[]>(
    () => [
      { key: "general", label: "General" },
      ...buildPhases(
        matches.map((m) => ({
          stage: m.stage ?? null,
          matchday: m.matchday,
        })),
      ),
    ],
    [matches],
  );

  const rows = useMemo(
    () => buildStandings(members, matches, predictions, activeKey),
    [members, matches, predictions, activeKey],
  );

  // Mapa de predicciones para búsqueda O(1) en el acordeón.
  const predByKey = useMemo(
    () => new Map(predictions.map((p) => [`${p.userId}:${p.matchId}`, p])),
    [predictions],
  );

  // Partidos en alcance de la pestaña activa (solo finished).
  const matchesInScope = useMemo(() => {
    return matches.filter((m) => {
      if (m.status !== "finished") return false;
      if (activeKey === "general") return true;
      return (
        phaseKeyForMatch({ stage: m.stage ?? null, matchday: m.matchday }) ===
        activeKey
      );
    });
  }, [matches, activeKey]);

  // El saldo de duelos es de toda la liga (no por jornada): solo se muestra en
  // la pestaña General para no confundir con un valor por-jornada.
  const showDuels = activeKey === "general";

  if (members.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card p-6 text-center text-card-foreground">
        <h2 className="font-display text-lg font-bold">
          Aún no hay participantes
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          ¡Invita a tus amigos con el enlace de la liga para empezar a competir!
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ScrollableTabs
        tabs={tabs}
        activeKey={activeKey}
        onSelect={(key) => {
          setActiveKey(key);
          setExpandedUserId(null);
        }}
        ariaLabel="Filtro por jornada"
      />

      <p className="text-[11px] text-accent/80 font-medium flex items-center gap-1">
        <span>💡</span>
        <span>Toca una fila para ver el desglose detallado de puntos.</span>
      </p>

      <ol className="flex flex-col gap-2" data-testid="standings-table">
        {rows.map((row) => {
          const isLeader = row.rank === 1;
          const isExpanded = expandedUserId === row.userId;

          // Cálculo del desglose lazy (solo cuando se expande).
          const details = isExpanded
            ? computeUserBreakdown(row.userId, matchesInScope, predByKey)
            : [];
          const grouped = isExpanded ? groupByPhaseDesc(details) : [];

          // Totales del banner resumen.
          const totalBase = details.reduce((sum, d) => sum + d.basePoints, 0);
          const totalMultBonus = details.reduce(
            (sum, d) => sum + (d.earnedPoints - d.basePoints),
            0,
          );

          return (
            <li
              key={row.userId}
              data-testid="standings-row"
              data-user-id={row.userId}
              className={cn(
                "flex flex-col rounded-md border bg-card p-3 transition-colors duration-200 hover:bg-muted/30",
                isLeader ? "border-accent" : "border-border",
              )}
            >
              <button
                type="button"
                className="group flex w-full items-center gap-3 text-left"
                aria-expanded={isExpanded}
                data-testid="standings-row-toggle"
                onClick={() =>
                  setExpandedUserId(isExpanded ? null : row.userId)
                }
              >
                <div className="flex flex-col items-center justify-center w-8 shrink-0">
                  <span
                    className={cn(
                      "font-display text-lg font-bold leading-none",
                      isLeader ? "text-accent" : "text-muted-foreground",
                    )}
                    aria-label={`Posición ${row.rank}${row.isTie ? " empatada" : ""}`}
                    data-testid="standings-rank"
                  >
                    {row.rank}
                  </span>
                  {row.isTie && (
                    <span className="text-[10px] text-muted-foreground leading-none mt-1" data-testid="standings-tie-badge">
                      Empate
                    </span>
                  )}
                  {row.rankChange !== undefined && (
                    <div
                      className={cn(
                        "flex items-center text-[10px] font-bold mt-1.5 leading-none",
                        row.rankChange > 0 && "text-success",
                        row.rankChange < 0 && "text-destructive",
                        row.rankChange === 0 && "text-muted-foreground/50",
                      )}
                      data-testid="standings-trend"
                      data-change={row.rankChange}
                      aria-label={
                        row.rankChange > 0
                          ? `Subió ${row.rankChange} ${row.rankChange === 1 ? "posición" : "posiciones"}`
                          : row.rankChange < 0
                            ? `Bajó ${Math.abs(row.rankChange)} ${Math.abs(row.rankChange) === 1 ? "posición" : "posiciones"}`
                            : "Sin cambios de posición"
                      }
                    >
                      {row.rankChange > 0 ? (
                        <ArrowUp className="size-3 shrink-0" aria-hidden="true" />
                      ) : row.rankChange < 0 ? (
                        <ArrowDown className="size-3 shrink-0" aria-hidden="true" />
                      ) : (
                        <Minus className="size-3 shrink-0 text-muted-foreground/30" aria-hidden="true" />
                      )}
                      {row.rankChange !== 0 && (
                        <span className="ml-0.5">{Math.abs(row.rankChange)}</span>
                      )}
                    </div>
                  )}
                </div>

                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={row.avatarUrl || "/assets/avatars/default-player.svg"}
                  alt=""
                  className="size-9 shrink-0 rounded-full border border-border object-cover"
                />

                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-sm font-semibold">
                    {row.displayName}
                  </span>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <PaymentStatusBadge status={row.paymentStatus} />
                    <span
                      className="text-xs text-muted-foreground"
                      aria-label={`${row.exactCount} aciertos exactos`}
                      data-testid="standings-exact"
                    >
                      <span className="font-semibold text-foreground">
                        {row.exactCount}
                      </span>{" "}
                      exactos
                    </span>
                    <span
                      className="text-xs text-muted-foreground"
                      aria-label={`${row.resultCount} aciertos de resultado`}
                    >
                      <span className="font-semibold text-foreground">
                        {row.resultCount}
                      </span>{" "}
                      result.
                    </span>
                    {showDuels && row.awardPoints > 0 && (
                      <span
                        className="text-xs text-muted-foreground"
                        aria-label={`${row.awardPoints} puntos de premios especiales`}
                        data-testid="standings-awards"
                      >
                        <span className="font-semibold text-foreground">
                          {row.awardPoints.toFixed(1)}
                        </span>{" "}
                        pts premios
                      </span>
                    )}
                    {showDuels && (
                      <span
                        className="text-xs text-muted-foreground"
                        aria-label={`${row.duelPoints} puntos de duelos`}
                      >
                        <span className="font-semibold text-foreground">
                          {row.duelPoints.toFixed(1)}
                        </span>{" "}
                        pts duelos
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <span
                    className="font-display text-lg font-bold text-accent"
                    aria-label={`${row.totalPoints} puntos`}
                    data-testid="standings-points"
                  >
                    {row.totalPoints.toFixed(1)}
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-4 text-muted-foreground transition-all duration-300 group-hover:text-accent",
                      isExpanded
                        ? "rotate-180 group-hover:-translate-y-0.5"
                        : "group-hover:translate-y-0.5",
                    )}
                    aria-hidden="true"
                  />
                </div>
              </button>

              {/* Detalle del Acordeón */}
              {isExpanded && (
                <div
                  className="mt-3 border-t border-border pt-3 flex flex-col gap-2"
                  data-testid="standings-accordion"
                >
                  {/* Banner Resumen */}
                  <div
                    className="grid grid-cols-4 gap-1 rounded-md border border-dashed border-border bg-background/50 p-2 text-center"
                    data-testid="standings-summary"
                  >
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground">Base</span>
                      <span className="text-xs font-bold" data-testid="summary-base">
                        {totalBase.toFixed(1)}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground">Mults.</span>
                      <span className="text-xs font-bold" data-testid="summary-mults">
                        +{totalMultBonus.toFixed(1)}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground">Premios</span>
                      <span className="text-xs font-bold" data-testid="summary-awards">
                        {showDuels ? `+${row.awardPoints.toFixed(1)}` : "—"}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground">Duelos</span>
                      <span
                        className={cn(
                          "text-xs font-bold",
                          showDuels && row.duelPoints < 0 && "text-destructive",
                        )}
                        data-testid="summary-duels"
                      >
                        {showDuels
                          ? `${row.duelPoints >= 0 ? "+" : ""}${row.duelPoints.toFixed(1)}`
                          : "—"}
                      </span>
                    </div>
                  </div>

                  {isAwardsLocked && specialPredsByUser.has(row.userId) && (
                    <div
                      className="rounded-md border border-border/40 bg-[#1B263B]/20 p-2.5 text-xs"
                      data-testid="accordion-special-predictions"
                    >
                      <div className="font-semibold text-accent mb-1.5 flex items-center gap-1.5">
                        <span>🏆</span> Premios Especiales Elegidos:
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1">
                        <div className="flex items-center justify-between sm:flex-col sm:items-start rounded bg-card/45 p-2 border border-border/20 gap-1.5">
                          <span className="text-[10px] text-muted-foreground uppercase font-bold shrink-0">Campeón</span>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-semibold text-foreground text-xs truncate">
                              {specialPredsByUser.get(row.userId)?.champion?.name ?? "Sin pronóstico"}
                            </span>
                            {specialPredsByUser.get(row.userId)?.champion && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent/15 text-accent border border-accent/20 shrink-0">
                                {` (+${specialPredsByUser.get(row.userId)?.champion?.points} pts)`}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between sm:flex-col sm:items-start rounded bg-card/45 p-2 border border-border/20 gap-1.5">
                          <span className="text-[10px] text-muted-foreground uppercase font-bold shrink-0">Goleador</span>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-semibold text-foreground text-xs truncate">
                              {specialPredsByUser.get(row.userId)?.top_scorer?.name ?? "Sin pronóstico"}
                            </span>
                            {specialPredsByUser.get(row.userId)?.top_scorer && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent/15 text-accent border border-accent/20 shrink-0">
                                {` (+${specialPredsByUser.get(row.userId)?.top_scorer?.points} pts)`}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between sm:flex-col sm:items-start rounded bg-card/45 p-2 border border-border/20 gap-1.5">
                          <span className="text-[10px] text-muted-foreground uppercase font-bold shrink-0">MVP</span>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-semibold text-foreground text-xs truncate">
                              {specialPredsByUser.get(row.userId)?.mvp?.name ?? "Sin pronóstico"}
                            </span>
                            {specialPredsByUser.get(row.userId)?.mvp && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent/15 text-accent border border-accent/20 shrink-0">
                                {` (+${specialPredsByUser.get(row.userId)?.mvp?.points} pts)`}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Lista de Partidos con scroll interno y agrupación */}
                  <div
                    className="max-h-64 overflow-y-auto flex flex-col gap-1 pr-1"
                    data-testid="standings-match-list"
                  >
                    {grouped.map((group) => (
                      <div key={group.label}>
                        <div
                          className="mt-1 mb-1 border-l-2 border-accent bg-accent/5 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-accent"
                          data-testid="standings-phase-header"
                        >
                          {group.label}
                        </div>
                        {group.matches.map((d) => (
                          <div
                            key={d.matchId}
                            className="flex items-center justify-between rounded border border-border/30 bg-card/50 px-2 py-1.5 text-xs mb-1"
                            data-testid="standings-match-detail"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-foreground">
                                {d.homeTeam} vs {d.awayTeam}
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[10px] text-muted-foreground">
                                <span className="flex items-center gap-1 rounded bg-muted/40 border border-border/20 px-1.5 py-0.5">
                                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Real:</span>
                                  <span className="font-bold text-foreground">
                                    {d.homeScore}-{d.awayScore}
                                    {d.extraTimeHomeScore != null && d.extraTimeAwayScore != null && (
                                      <span className="text-[10px] text-muted-foreground ml-1">
                                        ({d.extraTimeHomeScore}-{d.extraTimeAwayScore} t.s.)
                                      </span>
                                    )}
                                    {d.penaltiesHomeScore !== null && d.penaltiesAwayScore !== null && (
                                      <span className="text-[10px] text-muted-foreground ml-1">
                                        ({d.penaltiesHomeScore}-{d.penaltiesAwayScore} pen.)
                                      </span>
                                    )}
                                  </span>
                                </span>
                                <span className="flex items-center gap-1 rounded bg-muted/40 border border-border/20 px-1.5 py-0.5">
                                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Pred:</span>
                                  <span className="font-bold text-foreground">
                                    {d.predHome !== null ? `${d.predHome}-${d.predAway}` : "—"}
                                  </span>
                                </span>
                                {d.predHome !== null ? (
                                  renderOutcomeBadge(d.basePoints)
                                ) : (
                                  <span className="rounded bg-yellow-500/10 border border-yellow-500/20 px-1.5 py-0.5 text-[9px] font-bold text-yellow-600 dark:text-yellow-400 uppercase tracking-wider">
                                    Sin pronóstico
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="shrink-0 text-right ml-2">
                              <span className="text-[10px] text-muted-foreground">
                                {d.basePoints} ·{" "}
                                <span className="rounded bg-accent px-1 py-px text-[9px] font-extrabold text-accent-foreground">
                                  x{d.multiplier.toFixed(d.multiplier % 1 === 0 ? 1 : 2)}
                                </span>
                              </span>
                              <span className="block text-xs font-bold text-accent mt-0.5" data-testid="match-points-earned">
                                {d.earnedPoints.toFixed(1)} pts
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                    {grouped.length === 0 && (
                      <p className="py-2 text-center text-xs text-muted-foreground">
                        Sin partidos finalizados en esta jornada.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

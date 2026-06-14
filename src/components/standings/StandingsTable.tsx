"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import {
  buildStandings,
  type StandingMatch,
  type StandingMember,
  type StandingPrediction,
} from "@/utils/standings";
import { PaymentStatusBadge } from "@/components/standings/PaymentStatusBadge";
import { ScrollableTabs } from "@/components/ui/ScrollableTabs";
import { cn } from "@/utils/utils";
import { buildPhases } from "@/utils/tournament";

type StandingsTableProps = {
  members: StandingMember[];
  matches: StandingMatch[];
  predictions: StandingPrediction[];
};

type Tab = { key: string; label: string };

export function StandingsTable({
  members,
  matches,
  predictions,
}: StandingsTableProps) {
  const [activeKey, setActiveKey] = useState("general");

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
        onSelect={setActiveKey}
        ariaLabel="Filtro por jornada"
      />

      <p className="text-xs text-muted-foreground">
        Desempate: puntos → <strong className="font-semibold">exactos</strong>{" "}
        (5 pts) → <strong className="font-semibold">resultados</strong> (ganador/empate, 2 pts) →{" "}
        <strong className="font-semibold">premios acertados</strong> → <strong className="font-semibold">puntos de duelos obtenidos</strong>. En empate absoluto comparten la posición.
      </p>

      <ol className="flex flex-col gap-2" data-testid="standings-table">
        {rows.map((row) => {
          const isLeader = row.rank === 1;
          return (
            <li
              key={row.userId}
              data-testid="standings-row"
              data-user-id={row.userId}
              className={cn(
                "flex items-center gap-3 rounded-md border bg-card p-3",
                isLeader ? "border-accent" : "border-border",
              )}
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

              <span
                className="shrink-0 font-display text-lg font-bold text-accent"
                aria-label={`${row.totalPoints} puntos`}
                data-testid="standings-points"
              >
                {row.totalPoints.toFixed(1)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

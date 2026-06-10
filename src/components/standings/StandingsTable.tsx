"use client";

import { useMemo, useState } from "react";

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
        (marcador exacto, 5 pts) →{" "}
        <strong className="font-semibold">duelos</strong> (saldo). También se
        muestran los aciertos de <strong className="font-semibold">resultado</strong>{" "}
        (solo ganador o empate, 2 pts).
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
              <span
                className={cn(
                  "w-6 shrink-0 text-center font-display text-lg font-bold",
                  isLeader ? "text-accent" : "text-muted-foreground",
                )}
                aria-label={`Posición ${row.rank}`}
                data-testid="standings-rank"
              >
                {row.rank}
              </span>

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
                  {showDuels && (
                    <span
                      className="text-xs text-muted-foreground"
                      aria-label={`${row.duelPoints} puntos de duelos`}
                    >
                      <span className="font-semibold text-foreground">
                        {row.duelPoints.toFixed(1)}
                      </span>{" "}
                      duelos
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

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
  matchdays: number[];
};

type Tab = { key: string; label: string };

export function StandingsTable({
  members,
  matches,
  predictions,
  matchdays,
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

      <ol className="flex flex-col gap-2">
        {rows.map((row) => {
          const isLeader = row.rank === 1;
          return (
            <li
              key={row.userId}
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
              >
                {row.rank}
              </span>

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={row.avatarUrl || "/assets/avatars/default-player.svg"}
                alt=""
                className="size-9 shrink-0 rounded-full border border-border object-cover"
              />

              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold">
                  {row.displayName}
                </span>
                <PaymentStatusBadge
                  status={row.paymentStatus}
                  className="mt-1 self-start"
                />
              </div>

              <span
                className="shrink-0 font-display text-lg font-bold text-accent"
                aria-label={`${row.totalPoints} puntos`}
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

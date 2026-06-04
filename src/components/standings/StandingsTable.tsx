"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  buildStandings,
  type StandingMatch,
  type StandingMember,
  type StandingPrediction,
} from "@/utils/standings";
import { PaymentStatusBadge } from "@/components/standings/PaymentStatusBadge";
import { cn } from "@/utils/utils";

type StandingsTableProps = {
  members: StandingMember[];
  matches: StandingMatch[];
  predictions: StandingPrediction[];
  matchdays: number[];
};

type Tab = { key: string; label: string; matchday?: number };

const FADE_EPSILON = 4;

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
      ...matchdays.map((md) => ({
        key: `jornada-${md}`,
        label: `Jornada ${md}`,
        matchday: md,
      })),
    ],
    [matchdays],
  );

  const activeTab = tabs.find((t) => t.key === activeKey) ?? tabs[0];

  const rows = useMemo(
    () => buildStandings(members, matches, predictions, activeTab?.matchday),
    [members, matches, predictions, activeTab?.matchday],
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
      <JornadaTabs
        tabs={tabs}
        activeKey={activeKey}
        onSelect={setActiveKey}
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

// Tab Bar nivel-2 desplazable (UX-DR-7 / EXPERIENCE tab-bar-container):
// overflow-x con scrollbar oculto, fades + chevrons según scrollLeft, y
// centrado del tab activo vía scrollIntoView.
function JornadaTabs({
  tabs,
  activeKey,
  onSelect,
}: {
  tabs: Tab[];
  activeKey: string;
  onSelect: (key: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);

  function updateFades() {
    const el = scrollerRef.current;
    if (!el) return;
    setShowLeft(el.scrollLeft > FADE_EPSILON);
    setShowRight(
      el.scrollLeft + el.clientWidth < el.scrollWidth - FADE_EPSILON,
    );
  }

  useEffect(() => {
    updateFades();
    const el = scrollerRef.current;
    if (!el) return;
    const handler = () => updateFades();
    el.addEventListener("scroll", handler, { passive: true });
    window.addEventListener("resize", handler);
    return () => {
      el.removeEventListener("scroll", handler);
      window.removeEventListener("resize", handler);
    };
  }, [tabs.length]);

  function select(key: string) {
    onSelect(key);
    const btn = tabRefs.current.get(key);
    btn?.scrollIntoView({ inline: "center", block: "nearest" });
  }

  function nudge(direction: -1 | 1) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.6, behavior: "smooth" });
  }

  return (
    <div className="relative border-b border-border bg-card">
      {showLeft && (
        <>
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-card to-transparent" />
          <button
            type="button"
            onClick={() => nudge(-1)}
            aria-label="Desplazar jornadas a la izquierda"
            className="absolute left-0 top-1/2 z-20 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-secondary text-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
        </>
      )}

      <div
        ref={scrollerRef}
        role="tablist"
        aria-label="Filtro por jornada"
        className="flex gap-1 overflow-x-auto scroll-smooth px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => {
          const isActive = tab.key === activeKey;
          return (
            <button
              key={tab.key}
              ref={(node) => {
                if (node) tabRefs.current.set(tab.key, node);
                else tabRefs.current.delete(tab.key);
              }}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => select(tab.key)}
              className={cn(
                "h-12 shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {showRight && (
        <>
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-card to-transparent" />
          <button
            type="button"
            onClick={() => nudge(1)}
            aria-label="Desplazar jornadas a la derecha"
            className="absolute right-0 top-1/2 z-20 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-secondary text-foreground"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
}

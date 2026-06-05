"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { PaymentStatusBadge } from "@/components/standings/PaymentStatusBadge";
import {
  GoalToastStack,
  MAX_VISIBLE_TOASTS,
  type GoalToastModel,
} from "@/components/live/GoalToast";
import {
  buildGoalToastMessage,
  findMovers,
  hasScoreIncrease,
  resolveScoringTeam,
  selectAnnouncedMover,
  type LiveMatch,
} from "@/components/live/goalImpact";
import { createClient } from "@/utils/supabase/client";
import {
  buildProjectedStandings,
  type StandingMember,
  type StandingPrediction,
} from "@/utils/standings";
import { cn } from "@/utils/utils";

const POLLING_INTERVAL_MS = 60_000;
const FLASH_DURATION_MS = 1500;
const RELEVANT_MATCH_STATUSES = new Set(["finished", "live"]);

type LiveStandingsBoardProps = {
  leagueId: string;
  currentUserId: string;
  members: StandingMember[];
  initialMatches: LiveMatch[];
  initialPredictions: StandingPrediction[];
};

type ConnectionState = "connecting" | "live" | "reconnecting" | "polling";

type Snapshot = {
  matches: LiveMatch[];
  predictions: StandingPrediction[];
};

type MatchPayload = {
  id?: unknown;
  status?: unknown;
  matchday?: unknown;
  home_team?: unknown;
  away_team?: unknown;
  home_score?: unknown;
  away_score?: unknown;
};

function toNullableNumber(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function mapPayloadToMatch(payload: MatchPayload): LiveMatch | null {
  if (typeof payload.id !== "string" || typeof payload.status !== "string") {
    return null;
  }

  return {
    id: payload.id,
    status: payload.status,
    matchday: toNullableNumber(payload.matchday),
    homeScore: toNullableNumber(payload.home_score),
    awayScore: toNullableNumber(payload.away_score),
    homeTeam: toNullableString(payload.home_team),
    awayTeam: toNullableString(payload.away_team),
  };
}

function statusLabel(status: ConnectionState): string {
  if (status === "live") return "En vivo";
  if (status === "polling") return "Polling";
  return "Reconectando...";
}

function statusClass(status: ConnectionState): string {
  if (status === "live") return "border-success bg-success/15 text-success";
  if (status === "polling") return "border-accent bg-accent/15 text-accent";
  return "border-accent bg-accent/15 text-accent";
}

export function LiveStandingsBoard({
  leagueId,
  currentUserId,
  members,
  initialMatches,
  initialPredictions,
}: LiveStandingsBoardProps) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRefreshRef = useRef(0);
  const snapshotVersionRef = useRef(0);
  const snapshotRef = useRef<Snapshot>({
    matches: initialMatches,
    predictions: initialPredictions,
  });
  const connectionRef = useRef<ConnectionState>("connecting");
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const previousRowTopsRef = useRef(new Map<string, number>());
  const toastIdRef = useRef(0);
  const flashTimeoutsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [snapshot, setSnapshot] = useState<Snapshot>({
    matches: initialMatches,
    predictions: initialPredictions,
  });
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [toasts, setToasts] = useState<GoalToastModel[]>([]);
  const [flashedUsers, setFlashedUsers] = useState<Set<string>>(new Set());
  const { matches, predictions } = snapshot;

  const rows = useMemo(
    () => buildProjectedStandings(members, matches, predictions),
    [members, matches, predictions],
  );
  const hasLiveMatches = matches.some((match) => match.status === "live");

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const setConnectionState = useCallback((next: ConnectionState) => {
    connectionRef.current = next;
    setConnection(next);
  }, []);

  const stopReconnect = useCallback(() => {
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((message: string) => {
    toastIdRef.current += 1;
    const id = `goal-${toastIdRef.current}`;
    // Tope de toasts visibles: descarta los más viejos para no inundar el móvil.
    setToasts((current) => [...current, { id, message }].slice(-MAX_VISIBLE_TOASTS));
  }, []);

  const flashRows = useCallback((userIds: string[]) => {
    if (userIds.length === 0) return;
    setFlashedUsers((current) => {
      const next = new Set(current);
      for (const userId of userIds) next.add(userId);
      return next;
    });
    for (const userId of userIds) {
      const existing = flashTimeoutsRef.current.get(userId);
      if (existing) clearTimeout(existing);
      const timeout = setTimeout(() => {
        flashTimeoutsRef.current.delete(userId);
        setFlashedUsers((current) => {
          const next = new Set(current);
          next.delete(userId);
          return next;
        });
      }, FLASH_DURATION_MS);
      flashTimeoutsRef.current.set(userId, timeout);
    }
  }, []);

  const refreshSnapshot = useCallback(
    async (options?: { allowWhenLive?: boolean }) => {
      const supabase = supabaseRef.current;
      if (!supabase) return;

      const requestId = latestRefreshRef.current + 1;
      latestRefreshRef.current = requestId;
      const startedVersion = snapshotVersionRef.current;

      const { data: matchRows, error: matchError } = await supabase
        .from("matches")
        .select("id, status, matchday, home_team, away_team, home_score, away_score")
        .in("status", ["finished", "live"])
        .order("match_time", { ascending: true });
      if (matchError || latestRefreshRef.current !== requestId) return;

      const nextMatches: LiveMatch[] = (matchRows ?? []).map((match) => ({
        id: match.id,
        status: match.status,
        matchday: match.matchday,
        homeScore: match.home_score,
        awayScore: match.away_score,
        homeTeam: match.home_team ?? null,
        awayTeam: match.away_team ?? null,
      }));

      const matchIds = nextMatches.map((match) => match.id);
      if (matchIds.length === 0) {
        if (
          latestRefreshRef.current === requestId &&
          (options?.allowWhenLive || connectionRef.current !== "live")
        ) {
          const nextSnapshot = { matches: nextMatches, predictions: [] };
          snapshotVersionRef.current += 1;
          snapshotRef.current = nextSnapshot;
          setSnapshot(nextSnapshot);
        }
        return;
      }

      const { data: predRows, error: predictionError } = await supabase
        .from("predictions")
        .select("user_id, match_id, home_score_pred, away_score_pred, multiplier")
        .eq("league_id", leagueId)
        .in("match_id", matchIds);
      if (predictionError || latestRefreshRef.current !== requestId) return;

      if (
        !options?.allowWhenLive &&
        connectionRef.current === "live" &&
        snapshotVersionRef.current !== startedVersion
      ) {
        return;
      }

      const nextSnapshot = {
        matches: nextMatches,
        predictions: (predRows ?? []).map((prediction) => ({
          userId: prediction.user_id,
          matchId: prediction.match_id,
          homeScorePred: prediction.home_score_pred,
          awayScorePred: prediction.away_score_pred,
          multiplier: prediction.multiplier,
        })),
      };

      if (connectionRef.current !== "live") {
        let hasGoal = false;
        const current = snapshotRef.current;
        const prevMatches = current.matches;
        for (const nextMatch of nextMatches) {
          const prevMatch = prevMatches.find((m) => m.id === nextMatch.id);
          const isRelevant = RELEVANT_MATCH_STATUSES.has(nextMatch.status);
          if (isRelevant && prevMatch && hasScoreIncrease(prevMatch, nextMatch)) {
            hasGoal = true;
            break;
          }
        }

        if (hasGoal) {
          const prevRows = buildProjectedStandings(
            members,
            prevMatches,
            current.predictions,
          );
          const nextRows = buildProjectedStandings(
            members,
            nextMatches,
            nextSnapshot.predictions,
          );
          const movers = findMovers(prevRows, nextRows);
          if (movers.length > 0) {
            for (const nextMatch of nextMatches) {
              const prevMatch = prevMatches.find((m) => m.id === nextMatch.id);
              const isRelevant = RELEVANT_MATCH_STATUSES.has(nextMatch.status);
              if (isRelevant && prevMatch && hasScoreIncrease(prevMatch, nextMatch)) {
                const announced = selectAnnouncedMover(movers, currentUserId);
                if (announced) {
                  const scoringTeam = resolveScoringTeam(prevMatch, nextMatch);
                  pushToast(buildGoalToastMessage(announced, scoringTeam));
                  flashRows(movers.map((mover) => mover.userId));
                  break;
                }
              }
            }
          }
        }
      }

      snapshotVersionRef.current += 1;
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
    },
    [leagueId, members, currentUserId, pushToast, flashRows],
  );

  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(() => {
      setConnectionState("polling");
      void refreshSnapshot();
    }, POLLING_INTERVAL_MS);
  }, [refreshSnapshot, setConnectionState]);

  const handleMatchUpdate = useCallback(
    (payload: { new: Record<string, unknown> }) => {
      const nextMatch = mapPayloadToMatch(payload.new as MatchPayload);
      if (!nextMatch) return;

      // snapshotRef.current es la fuente autoritativa del estado vigente; se
      // mantiene sincronizada en cada mutación (Realtime y polling).
      const current = snapshotRef.current;
      const currentMatches = current.matches;
      const isRelevant = RELEVANT_MATCH_STATUSES.has(nextMatch.status);
      const prevMatch = currentMatches.find((match) => match.id === nextMatch.id);
      const isNewRelevantMatch = isRelevant && !prevMatch;

      let nextMatches: LiveMatch[];
      if (!isRelevant) {
        nextMatches = currentMatches.filter((match) => match.id !== nextMatch.id);
      } else if (isNewRelevantMatch) {
        nextMatches = [...currentMatches, nextMatch];
      } else {
        nextMatches = currentMatches.map((match) =>
          match.id === nextMatch.id ? { ...match, ...nextMatch } : match,
        );
      }

      const nextSnapshot: Snapshot = {
        matches: nextMatches,
        predictions: current.predictions,
      };
      snapshotVersionRef.current += 1;
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);

      // "Impacto de Gol": solo ante un GOL real (algún lado incrementa) en un
      // partido ya conocido que además reordene puestos. Una corrección a la
      // baja, un partido nuevo (sin predicciones aún) o un cambio que no mueve a
      // nadie no disparan toast.
      if (isRelevant && prevMatch && hasScoreIncrease(prevMatch, nextMatch)) {
        const prevRows = buildProjectedStandings(
          members,
          currentMatches,
          current.predictions,
        );
        const nextRows = buildProjectedStandings(
          members,
          nextMatches,
          current.predictions,
        );
        const movers = findMovers(prevRows, nextRows);
        if (movers.length > 0) {
          const announced = selectAnnouncedMover(movers, currentUserId);
          if (announced) {
            const scoringTeam = resolveScoringTeam(prevMatch, nextMatch);
            pushToast(buildGoalToastMessage(announced, scoringTeam));
            flashRows(movers.map((mover) => mover.userId));
          }
        }
      }

      if (isNewRelevantMatch) {
        void refreshSnapshot({ allowWhenLive: true });
      }
    },
    [members, currentUserId, refreshSnapshot, pushToast, flashRows],
  );

  useLayoutEffect(() => {
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const currentTops = new Map<string, number>();

    for (const row of rows) {
      const element = rowRefs.current.get(row.userId);
      if (!element) continue;

      const top = element.getBoundingClientRect().top;
      currentTops.set(row.userId, top);
      const previousTop = previousRowTopsRef.current.get(row.userId);
      const delta = previousTop == null ? 0 : previousTop - top;
      if (reduceMotion || delta === 0) continue;

      element.style.transition = "none";
      element.style.transform = `translateY(${delta}px)`;
      element.style.opacity = "0.92";

      requestAnimationFrame(() => {
        element.style.transition = "transform 300ms ease, opacity 300ms ease";
        element.style.transform = "";
        element.style.opacity = "";
      });
    }

    previousRowTopsRef.current = currentTops;
  }, [rows]);

  useEffect(() => {
    const supabase = createClient();
    supabaseRef.current = supabase;

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let disposed = false;

    const scheduleReconnect = () => {
      if (reconnectRef.current || disposed) return;
      reconnectRef.current = setTimeout(() => {
        reconnectRef.current = null;
        if (disposed) return;

        if (channel) {
          void supabase.removeChannel(channel);
          channel = null;
        }
        subscribe();
      }, POLLING_INTERVAL_MS);
    };

    const handleStatus = (status: string) => {
      if (status === "SUBSCRIBED") {
        setConnectionState("live");
        stopPolling();
        stopReconnect();
        return;
      }

      if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        setConnectionState("reconnecting");
        startPolling();
        scheduleReconnect();
      }
    };

    function subscribe() {
      if (disposed) return;

      channel = supabase
        .channel(`live-matches:${leagueId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "matches" },
          handleMatchUpdate,
        )
        .subscribe(handleStatus);
    }

    subscribe();

    return () => {
      disposed = true;
      stopPolling();
      stopReconnect();
      if (channel) void supabase.removeChannel(channel);
      supabaseRef.current = null;
    };
  }, [
    handleMatchUpdate,
    leagueId,
    setConnectionState,
    startPolling,
    stopPolling,
    stopReconnect,
  ]);

  useEffect(() => {
    const flashTimeouts = flashTimeoutsRef.current;
    return () => {
      for (const timeout of flashTimeouts.values()) clearTimeout(timeout);
      flashTimeouts.clear();
    };
  }, []);

  return (
    <section className="flex flex-col gap-3" data-testid="live-board">
      <GoalToastStack toasts={toasts} onDismiss={dismissToast} />

      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3">
        <div className="min-w-0">
          <p className="font-display text-lg font-bold">Tabla en Vivo</p>
          <p className="text-sm text-muted-foreground">
            {hasLiveMatches
              ? "Puntos proyectados con marcadores actuales."
              : "No hay partidos en vivo ahora."}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-3 py-1 text-xs font-semibold",
            statusClass(connection),
          )}
        >
          {statusLabel(connection)}
        </span>
      </div>

      <ol className="flex flex-col gap-2">
        {rows.map((row) => {
          const isLeader = row.rank === 1;
          const isFlashing = flashedUsers.has(row.userId);
          return (
            <li
              key={row.userId}
              data-testid="live-row"
              data-flash={isFlashing ? "gold" : undefined}
              ref={(element) => {
                if (element) rowRefs.current.set(row.userId, element);
                else rowRefs.current.delete(row.userId);
              }}
              className={cn(
                "flex items-center gap-3 rounded-md border bg-card p-3 transition-[transform,opacity,border-color,box-shadow,background-color] duration-300 motion-reduce:transition-none",
                isLeader ? "border-accent" : "border-border",
                // Destello dorado (Championship Gold) en la fila que sube; vía
                // tokens, aditivo al reordenamiento FLIP existente.
                isFlashing && "border-accent bg-accent/15 ring-2 ring-accent",
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
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <PaymentStatusBadge status={row.paymentStatus} />
                  {row.livePoints > 0 && (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                      +{row.livePoints.toFixed(1)} live
                    </span>
                  )}
                </div>
              </div>

              <span
                className="shrink-0 font-display text-lg font-bold text-accent"
                aria-label={`${row.totalPoints} puntos proyectados`}
              >
                {row.totalPoints.toFixed(1)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

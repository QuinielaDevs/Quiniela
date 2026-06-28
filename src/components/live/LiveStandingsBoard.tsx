"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowDown, ArrowUp, ChevronDown, Minus, ChevronLeft, ChevronRight } from "lucide-react";

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
import { fetchStandingPredictions } from "@/utils/standing-predictions";
import {
  buildProjectedStandings,
  type StandingMember,
  type StandingPrediction,
} from "@/utils/standings";
import type { Database } from "@/types/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calculateBasePoints,
  calculatePredictionPoints,
} from "@/utils/scoring";
import { phaseKeyForMatch, stageLabel } from "@/utils/tournament";
import { cn } from "@/utils/utils";
import { flagForTeamCode } from "@/utils/team-flags";

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
  stage?: unknown;
  group_label?: unknown;
  home_team?: unknown;
  away_team?: unknown;
  home_team_code?: unknown;
  away_team_code?: unknown;
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
    stage: toNullableString(payload.stage),
    homeScore: toNullableNumber(payload.home_score),
    awayScore: toNullableNumber(payload.away_score),
    homeTeam: toNullableString(payload.home_team),
    awayTeam: toNullableString(payload.away_team),
    homeTeamCode: toNullableString(payload.home_team_code),
    awayTeamCode: toNullableString(payload.away_team_code),
    groupLabel: toNullableString(payload.group_label),
  };
}


function LiveMatchesCarousel({ matches }: { matches: LiveMatch[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  const checkScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      const isScrollable = scrollWidth > clientWidth + 5;
      setShowLeftArrow(isScrollable && scrollLeft > 5);
      setShowRightArrow(isScrollable && scrollLeft < scrollWidth - clientWidth - 5);
    }
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.addEventListener("scroll", checkScroll, { passive: true });
      checkScroll();

      const resizeObserver = new ResizeObserver(() => checkScroll());
      resizeObserver.observe(el);

      return () => {
        el.removeEventListener("scroll", checkScroll);
        resizeObserver.disconnect();
      };
    }
  }, [matches, checkScroll]);

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const amount = direction === "left" ? -200 : 200;
      scrollRef.current.scrollBy({ left: amount, behavior: "smooth" });
    }
  };

  if (matches.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" data-testid="live-matches-section">
      <div className="flex items-center gap-2 px-1">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Partidos en juego
        </span>
      </div>
      <div className="relative group w-full">
        {showLeftArrow && (
          <button
            onClick={() => scroll("left")}
            data-testid="carousel-scroll-left"
            className="absolute left-1 top-1/2 -translate-y-1/2 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card/85 text-foreground shadow-md backdrop-blur-sm transition-all hover:bg-card active:scale-95"
            aria-label="Desplazar a la izquierda"
          >
            <ChevronLeft className="size-4" />
          </button>
        )}
        {showRightArrow && (
          <button
            onClick={() => scroll("right")}
            data-testid="carousel-scroll-right"
            className="absolute right-1 top-1/2 -translate-y-1/2 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card/85 text-foreground shadow-md backdrop-blur-sm transition-all hover:bg-card active:scale-95"
            aria-label="Desplazar a la derecha"
          >
            <ChevronRight className="size-4" />
          </button>
        )}
        <div
          ref={scrollRef}
          className="flex w-full gap-3 overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] snap-x snap-mandatory"
        >
          {matches.map((match) => {
            const homeFlag = flagForTeamCode(match.homeTeamCode);
            const awayFlag = flagForTeamCode(match.awayTeamCode);
            const homeName = match.homeTeamCode || match.homeTeam || "TBD";
            const awayName = match.awayTeamCode || match.awayTeam || "TBD";

            let metaLabel = "";
            if (match.stage === "group" || (!match.stage && match.matchday)) {
              const groupSuffix = match.groupLabel ? ` · Grupo ${match.groupLabel}` : "";
              metaLabel = `Jornada ${match.matchday}${groupSuffix}`;
            } else if (match.stage) {
              metaLabel = stageLabel(match.stage);
            } else {
              metaLabel = "Mundial";
            }

            return (
              <div
                key={match.id}
                className="min-w-[190px] w-[190px] shrink-0 snap-align-none rounded-lg border border-border bg-card/65 backdrop-blur-sm p-3 shadow-sm transition-all hover:bg-card/90"
                data-testid="live-match-card"
                data-match-id={match.id}
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground font-bold">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-destructive"></span>
                    </span>
                    <span className="uppercase tracking-wider">{metaLabel}</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 min-w-0">
                        {homeFlag && <span className="text-sm shrink-0">{homeFlag}</span>}
                        <span className="truncate text-xs font-semibold text-card-foreground">
                          {homeName}
                        </span>
                      </span>
                      <span
                        data-testid="live-match-home-score"
                        className="text-xs font-bold tabular-nums text-accent bg-secondary px-1.5 py-0.5 rounded"
                      >
                        {match.homeScore ?? 0}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 min-w-0">
                        {awayFlag && <span className="text-sm shrink-0">{awayFlag}</span>}
                        <span className="truncate text-xs font-semibold text-card-foreground">
                          {awayName}
                        </span>
                      </span>
                      <span
                        data-testid="live-match-away-score"
                        className="text-xs font-bold tabular-nums text-accent bg-secondary px-1.5 py-0.5 rounded"
                      >
                        {match.awayScore ?? 0}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ────── Accordion helpers ──────

function phaseLabelForKey(key: string): string {
  const jornadaMatch = /^jornada-(\d+)$/.exec(key);
  if (jornadaMatch) return `Jornada ${jornadaMatch[1]}`;
  return stageLabel(key);
}

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
  isLive: boolean;
  matchTime?: string;
};

function computeLiveBreakdown(
  userId: string,
  allMatches: LiveMatch[],
  predByKey: Map<string, StandingPrediction>,
): MatchDetail[] {
  const details: MatchDetail[] = [];

  for (const match of allMatches) {
    if (match.status !== "finished" && match.status !== "live") continue;
    if (match.homeScore == null || match.awayScore == null) continue;

    const pred = predByKey.get(`${userId}:${match.id}`);
    const base = pred
      ? calculateBasePoints(
          { home: pred.homeScorePred, away: pred.awayScorePred },
          { home: match.homeScore, away: match.awayScore },
          "finished",
        )
      : 0;
    const earned = pred ? calculatePredictionPoints(base, pred.multiplier) : 0;

    details.push({
      matchId: match.id,
      homeTeam: match.homeTeam ?? "Local",
      awayTeam: match.awayTeam ?? "Visitante",
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      predHome: pred?.homeScorePred ?? null,
      predAway: pred?.awayScorePred ?? null,
      multiplier: pred?.multiplier ?? 1,
      basePoints: base,
      earnedPoints: earned,
      phaseKey: phaseKeyForMatch({
        stage: match.stage ?? null,
        matchday: match.matchday,
      }),
      isLive: match.status === "live",
      matchTime: match.matchTime,
    });
  }

  return details;
}

function groupByPhaseDesc(
  details: MatchDetail[],
): { label: string; matches: MatchDetail[] }[] {
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
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const { matches, predictions } = snapshot;

  const rows = useMemo(
    () => buildProjectedStandings(members, matches, predictions),
    [members, matches, predictions],
  );
  const hasLiveMatches = matches.some((match) => match.status === "live");
  const liveMatches = useMemo(
    () => matches.filter((match) => match.status === "live"),
    [matches],
  );

  // Mapa de predicciones para búsqueda O(1) en el acordeón.
  const predByKey = useMemo(
    () => new Map(predictions.map((p) => [`${p.userId}:${p.matchId}`, p])),
    [predictions],
  );

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
        .select("id, status, matchday, stage, group_label, home_team, away_team, home_team_code, away_team_code, home_score, away_score")
        .in("status", ["finished", "live"])
        .order("match_time", { ascending: true });
      if (matchError || latestRefreshRef.current !== requestId) return;

      const nextMatches: LiveMatch[] = (matchRows ?? []).map((match) => ({
        id: match.id,
        status: match.status,
        matchday: match.matchday,
        stage: match.stage ?? null,
        homeScore: match.home_score,
        awayScore: match.away_score,
        homeTeam: match.home_team ?? null,
        awayTeam: match.away_team ?? null,
        homeTeamCode: match.home_team_code ?? null,
        awayTeamCode: match.away_team_code ?? null,
        groupLabel: match.group_label ?? null,
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

      const { data: predRows, error: predictionError } =
        await fetchStandingPredictions(
          supabase as SupabaseClient<Database>,
          leagueId,
          matchIds,
        );
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
        predictions: predRows,
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
          const prevRankRows = prevRows.map((row, index) => ({
            userId: row.userId,
            displayName: row.displayName,
            rank: index + 1,
          }));
          const nextRankRows = nextRows.map((row, index) => ({
            userId: row.userId,
            displayName: row.displayName,
            rank: index + 1,
          }));
          const movers = findMovers(prevRankRows, nextRankRows);
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
        const prevRankRows = prevRows.map((row, index) => ({
          userId: row.userId,
          displayName: row.displayName,
          rank: index + 1,
        }));
        const nextRankRows = nextRows.map((row, index) => ({
          userId: row.userId,
          displayName: row.displayName,
          rank: index + 1,
        }));
        const movers = findMovers(prevRankRows, nextRankRows);
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
        void subscribe();
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

    async function subscribe() {
      if (disposed) return;

      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) {
          supabase.realtime.setAuth(token);
        }
      } catch (e) {
        console.warn("[LiveStandingsBoard Client] Error loading session:", e);
      }

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

    void subscribe();

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
    <section
      className="flex flex-col gap-3"
      data-testid="live-board"
      data-connection={connection}
    >
      <GoalToastStack toasts={toasts} onDismiss={dismissToast} />

      {liveMatches.length > 0 && <LiveMatchesCarousel matches={liveMatches} />}

      {!hasLiveMatches && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground">
          <span>💤</span>
          <span>No hay partidos en juego en este momento. Las posiciones proyectadas coinciden con la tabla oficial.</span>
        </div>
      )}

      <p className="text-[11px] text-accent/80 font-medium flex items-center gap-1 px-1">
        <span>💡</span>
        <span>Toca cualquier fila para ver el desglose en vivo.</span>
      </p>

      <ol className="flex flex-col gap-2">
        {rows.map((row) => {
          const isLeader = row.rank === 1;
          const isFlashing = flashedUsers.has(row.userId);
          const isExpanded = expandedUserId === row.userId;

          // Cálculo del desglose lazy (solo cuando se expande).
          const details = isExpanded
            ? computeLiveBreakdown(row.userId, matches, predByKey)
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
              data-testid="live-row"
              data-flash={isFlashing ? "gold" : undefined}
              ref={(element) => {
                if (element) rowRefs.current.set(row.userId, element);
                else rowRefs.current.delete(row.userId);
              }}
              className={cn(
                "flex flex-col rounded-md border bg-card p-3 transition-[transform,opacity,border-color,box-shadow,background-color] duration-300 motion-reduce:transition-none hover:bg-muted/30",
                isLeader ? "border-accent" : "border-border",
                isFlashing && "border-accent bg-accent/15 ring-2 ring-accent",
              )}
            >
              <button
                type="button"
                className="group flex w-full items-center gap-3 text-left"
                aria-expanded={isExpanded}
                data-testid="live-row-toggle"
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
                  >
                    {row.rank}
                  </span>
                  {row.isTie && (
                    <span className="text-[10px] text-muted-foreground leading-none mt-1" data-testid="live-tie-badge">
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
                      data-testid="live-trend"
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

                <div className="flex shrink-0 items-center gap-1">
                  <span
                    className="font-display text-lg font-bold text-accent"
                    aria-label={`${row.totalPoints} puntos proyectados`}
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
                  data-testid="live-accordion"
                >
                  {/* Banner Resumen */}
                  <div
                    className="grid grid-cols-4 gap-1 rounded-md border border-dashed border-border bg-background/50 p-2 text-center"
                    data-testid="live-summary"
                  >
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground">Base</span>
                      <span className="text-xs font-bold" data-testid="live-summary-base">
                        {totalBase.toFixed(1)}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground">Mults.</span>
                      <span className="text-xs font-bold" data-testid="live-summary-mults">
                        +{totalMultBonus.toFixed(1)}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground">Premios</span>
                      <span className="text-xs font-bold" data-testid="live-summary-awards">
                        +{row.awardPoints.toFixed(1)}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground">Duelos</span>
                      <span
                        className={cn(
                          "text-xs font-bold",
                          row.duelPoints < 0 && "text-destructive",
                        )}
                        data-testid="live-summary-duels"
                      >
                        {row.duelPoints >= 0 ? "+" : ""}{row.duelPoints.toFixed(1)}
                      </span>
                    </div>
                  </div>

                  {/* Lista de Partidos con scroll interno y agrupación */}
                  <div
                    className="max-h-64 overflow-y-auto flex flex-col gap-1 pr-1"
                    data-testid="live-match-list"
                  >
                    {grouped.map((group) => (
                      <div key={group.label}>
                        <div
                          className="mt-1 mb-1 border-l-2 border-accent bg-accent/5 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-accent"
                          data-testid="live-phase-header"
                        >
                          {group.label}
                        </div>
                        {group.matches.map((d) => (
                          <div
                            key={d.matchId}
                            className={cn(
                              "flex items-center justify-between rounded border border-border/30 bg-card/50 px-2 py-1.5 text-xs mb-1",
                              d.isLive && "border-accent/40 bg-accent/5",
                            )}
                            data-testid="live-match-detail"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-foreground flex items-center gap-1.5 flex-wrap">
                                <span>{d.homeTeam} vs {d.awayTeam}</span>
                                {d.isLive && (
                                  <span className="rounded-full bg-red-500/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-red-500 animate-pulse">
                                    live
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[10px] text-muted-foreground">
                                <span className="flex items-center gap-1 rounded bg-muted/40 border border-border/20 px-1.5 py-0.5">
                                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Real:</span>
                                  <span className="font-bold text-foreground">{d.homeScore}-{d.awayScore}</span>
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
                              <span className="block text-xs font-bold text-accent mt-0.5" data-testid="live-match-points-earned">
                                {d.earnedPoints.toFixed(1)} pts
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                    {grouped.length === 0 && (
                      <p className="py-2 text-center text-xs text-muted-foreground">
                        Sin partidos con marcador disponible.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

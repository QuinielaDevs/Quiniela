import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";

import { LiveStandingsBoard } from "@/components/live/LiveStandingsBoard";
import type { LiveMatch } from "@/components/live/goalImpact";
import { BottomNavbar } from "@/components/layout/BottomNavbar";
import { AppTopNav } from "@/components/layout/AppTopNav";
import { BrandEyebrow } from "@/components/layout/BrandEyebrow";
import { NoLeagueState } from "@/components/join/NoLeagueState";
import { createClient } from "@/utils/supabase/server";
import { getActiveLeagueMembership } from "@/utils/active-league";
import { fetchStandingPredictions } from "@/utils/standing-predictions";
import type { PaymentStatus } from "@/types";
import type { StandingMember, StandingPrediction } from "@/utils/standings";
import type { Database } from "@/types/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

type MemberRow = {
  user_id: string;
  payment_status: PaymentStatus;
  joined_at: string;
  wager_balance?: number;
  profiles: { display_name: string; avatar_url: string } | null;
};

export async function LiveBoard() {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/auth/login");

  const membership = await getActiveLeagueMembership({ supabase, userId });
  const leagueId = membership?.leagueId;
  if (!leagueId) {
    return (
      <NoLeagueState body="Únete con un código de invitación o crea tu propia quiniela para ver la tabla en vivo." />
    );
  }

  // awardRows: total de premios especiales por usuario (BUG-004); la proyectada
  // los suma igual que la clasificación oficial General.
  const [
    { data: memberRows },
    { data: matchRows },
    { data: awardRows },
    { data: duelRows },
    { data: specialPreds },
    { data: isAwardsLocked },
    { data: dbPhases },
  ] = await Promise.all([
    supabase
      .from("league_members")
      .select("user_id, payment_status, joined_at, profiles(display_name, avatar_url)")
      .eq("league_id", leagueId),
    supabase
      .from("matches")
      .select(
        "id, status, matchday, stage, group_label, home_team, away_team, home_team_code, away_team_code, home_score, away_score, match_time, penalties_home_score, penalties_away_score, extra_time_home_score, extra_time_away_score",
      )
      .in("status", ["finished", "live"])
      .order("match_time", { ascending: true }),
    supabase.rpc("fn_get_league_award_points", { p_league_id: leagueId }),
    supabase.rpc("fn_get_league_duel_points", { p_league_id: leagueId }),
    supabase
      .from("special_predictions")
      .select("user_id, category, candidate_id, predicted_at, award_candidates(name)")
      .eq("league_id", leagueId),
    supabase.rpc("fn_are_special_predictions_locked"),
    supabase
      .from("tournament_phases")
      .select("phase_code, reward_points, starts_at, ends_at, label")
      .order("sort_order", { ascending: true }),
  ]);

  const awardPointsByUser = new Map(
    ((awardRows ?? []) as Array<{ user_id: string; award_points: number }>).map(
      (row) => [row.user_id, Number(row.award_points ?? 0)],
    ),
  );

  const duelPointsByUser = new Map(
    ((duelRows ?? []) as Array<{ user_id: string; duel_points: number }>).map(
      (row) => [row.user_id, Number(row.duel_points ?? 0)],
    ),
  );

  const matches: LiveMatch[] = (matchRows ?? []).map((match) => ({
    id: match.id,
    status: match.status,
    matchday: match.matchday,
    stage: match.stage ?? null,
    homeScore: match.home_score,
    awayScore: match.away_score,
    matchTime: match.match_time,
    homeTeam: match.home_team ?? null,
    awayTeam: match.away_team ?? null,
    homeTeamCode: match.home_team_code ?? null,
    awayTeamCode: match.away_team_code ?? null,
    groupLabel: match.group_label ?? null,
    penaltiesHomeScore: match.penalties_home_score ?? null,
    penaltiesAwayScore: match.penalties_away_score ?? null,
    extraTimeHomeScore: match.extra_time_home_score ?? null,
    extraTimeAwayScore: match.extra_time_away_score ?? null,
  }));
  const matchIds = matches.map((match) => match.id);

  let predictions: StandingPrediction[] = [];
  if (matchIds.length > 0) {
    const { data: predRows } = await fetchStandingPredictions(
      supabase as SupabaseClient<Database>,
      leagueId,
      matchIds,
    );
    predictions = predRows;
  }

  const members = ((memberRows ?? []) as unknown as MemberRow[]).map(
    (member): StandingMember => ({
      userId: member.user_id,
      displayName: member.profiles?.display_name ?? "Jugador Anónimo",
      avatarUrl: member.profiles?.avatar_url ?? "/assets/avatars/default-player.svg",
      paymentStatus: member.payment_status,
      joinedAt: member.joined_at,
      duelPoints: duelPointsByUser.get(member.user_id) ?? 0,
      awardPoints: awardPointsByUser.get(member.user_id) ?? 0,
    }),
  );

  return (
    <LiveStandingsBoard
      leagueId={leagueId}
      currentUserId={userId}
      members={members}
      initialMatches={matches}
      initialPredictions={predictions}
      specialPredictions={(specialPreds ?? []) as unknown as Array<{
        user_id: string;
        category: string;
        candidate_id: string;
        predicted_at: string;
        award_candidates: { name: string } | null;
      }>}
      isAwardsLocked={!!isAwardsLocked}
      phases={(dbPhases ?? []) as Array<{
        phase_code: string;
        reward_points: number;
        starts_at: string | null;
        ends_at: string | null;
        label: string;
      }>}
    />
  );
}

function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-md border border-border bg-card"
        />
      ))}
    </div>
  );
}

export default function LivePage() {
  return (
    <>
      <AppTopNav />
      <main className="min-h-svh bg-background px-4 py-6 pb-24 text-foreground lg:px-8 lg:pb-10">
        <div className="mx-auto flex w-full max-w-md flex-col gap-4 lg:max-w-5xl lg:gap-6">
          <header className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 flex flex-col">
              <BrandEyebrow />
              <div className="flex items-center gap-2 mt-0.5">
                <h1 className="font-display text-xl font-bold tracking-tight sm:text-2xl lg:text-4xl truncate">
                  Clasificación
                </h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-[10px] font-bold uppercase tracking-wider text-destructive px-2 py-0.5 border border-destructive/20 shrink-0">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-destructive"></span>
                  </span>
                  En vivo
                </span>
              </div>
            </div>
            <Link
              href="/standings"
              className="inline-flex h-9 items-center justify-center rounded-full border border-border bg-card px-4 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              Volver
            </Link>
          </header>

          <Suspense fallback={<BoardSkeleton />}>
            <LiveBoard />
          </Suspense>
        </div>

        <BottomNavbar />
      </main>
    </>
  );
}

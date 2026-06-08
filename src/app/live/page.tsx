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
import type { PaymentStatus } from "@/types";
import type { StandingMember, StandingPrediction } from "@/utils/standings";

type MemberRow = {
  user_id: string;
  payment_status: PaymentStatus;
  joined_at: string;
  wager_balance: number;
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

  const [{ data: memberRows }, { data: matchRows }] = await Promise.all([
    supabase
      .from("league_members")
      .select("user_id, payment_status, joined_at, wager_balance, profiles(display_name, avatar_url)")
      .eq("league_id", leagueId),
    supabase
      .from("matches")
      .select(
        "id, status, matchday, home_team, away_team, home_team_code, away_team_code, home_score, away_score, match_time",
      )
      .in("status", ["finished", "live"])
      .order("match_time", { ascending: true }),
  ]);

  const matches: LiveMatch[] = (matchRows ?? []).map((match) => ({
    id: match.id,
    status: match.status,
    matchday: match.matchday,
    homeScore: match.home_score,
    awayScore: match.away_score,
    homeTeam: match.home_team ?? null,
    awayTeam: match.away_team ?? null,
  }));
  const matchIds = matches.map((match) => match.id);

  let predictions: StandingPrediction[] = [];
  if (matchIds.length > 0) {
    const { data: predRows } = await supabase
      .from("predictions")
      .select("user_id, match_id, home_score_pred, away_score_pred, multiplier")
      .eq("league_id", leagueId)
      .in("match_id", matchIds);

    predictions = (predRows ?? []).map((prediction) => ({
      userId: prediction.user_id,
      matchId: prediction.match_id,
      homeScorePred: prediction.home_score_pred,
      awayScorePred: prediction.away_score_pred,
      multiplier: prediction.multiplier,
    }));
  }

  const members = ((memberRows ?? []) as unknown as MemberRow[]).map(
    (member): StandingMember => ({
      userId: member.user_id,
      displayName: member.profiles?.display_name ?? "Jugador Anónimo",
      avatarUrl: member.profiles?.avatar_url ?? "/assets/avatars/default-player.svg",
      paymentStatus: member.payment_status,
      joinedAt: member.joined_at,
      duelPoints: Number(member.wager_balance ?? 0),
    }),
  );

  return (
    <LiveStandingsBoard
      leagueId={leagueId}
      currentUserId={userId}
      members={members}
      initialMatches={matches}
      initialPredictions={predictions}
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
          <header className="flex items-center justify-between">
            <div className="space-y-1">
              <BrandEyebrow />
              <h1 className="font-display text-2xl font-bold lg:text-4xl">Tabla en Vivo</h1>
            </div>
            <Link
              href="/standings"
              className="inline-flex h-9 items-center justify-center rounded-full border border-border bg-card px-4 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
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

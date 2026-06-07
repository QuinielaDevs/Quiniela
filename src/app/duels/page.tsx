import { Suspense } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/utils/supabase/server";
import { DuelsDashboard, type Challenge } from "@/components/duels/DuelsDashboard";
import { BottomNavbar } from "@/components/layout/BottomNavbar";
import { TopNav } from "@/components/layout/TopNav";
import { NoLeagueState } from "@/components/join/NoLeagueState";

export async function DuelsBoard() {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/auth/login");

  // Obtener la membresía de liga más reciente del usuario
  const { data: memberships } = await supabase
    .from("league_members")
    .select("league_id, joined_at, wager_balance")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false })
    .limit(1);

  const membership = memberships?.[0];
  const leagueId = membership?.league_id;

  if (!leagueId) {
    return (
      <NoLeagueState body="Únete con un código de invitación o crea tu propia quiniela para empezar a retar a otros." />
    );
  }

  // Carga paralela de: partidos, miembros de la liga, y retos activos/pendientes
  const [
    { data: matches },
    { data: leagueMembers },
    { data: challenges },
  ] = await Promise.all([
    supabase
      .from("matches")
      .select("id, home_team, away_team, match_time, status")
      .eq("status", "scheduled")
      .order("match_time", { ascending: true }),
    supabase
      .from("league_members")
      .select("user_id, profiles(display_name, avatar_url)")
      .eq("league_id", leagueId),
    supabase
      .from("challenges")
      .select(`
        id,
        points_bet,
        type,
        status,
        creator_id,
        challenged_id,
        winner_ids,
        created_at,
        match:matches(id, home_team, away_team, match_time, status, home_score, away_score),
        challenge_participants(user_id, prediction_home, prediction_away)
      `)
      .eq("league_id", leagueId)
      .in("status", ["pending", "active"])
      .order("created_at", { ascending: false }),
  ]);

  const cleanMembers = (leagueMembers ?? [])
    .map((lm) => {
      // El embebido `profiles(...)` de PostgREST puede tiparse como objeto o array
      // según infiera supabase-js la cardinalidad; normalizamos a objeto.
      const prof = lm.profiles as unknown as
        | { display_name: string | null }
        | { display_name: string | null }[]
        | null;
      const profile = Array.isArray(prof) ? prof[0] : prof;
      return {
        user_id: lm.user_id,
        display_name: profile?.display_name ?? "Usuario Quiniela",
      };
    })
    .filter((m) => m.user_id !== userId);

  return (
    <DuelsDashboard
      leagueId={leagueId}
      wagerBalance={Number(membership.wager_balance)}
      initialActiveChallenges={(challenges ?? []) as unknown as Challenge[]}
      matches={matches ?? []}
      members={cleanMembers}
      currentUserId={userId}
    />
  );
}

function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-40 animate-pulse rounded-md border border-border bg-card" />
      <div className="h-28 animate-pulse rounded-md border border-border bg-card" />
      <div className="h-28 animate-pulse rounded-md border border-border bg-card" />
    </div>
  );
}

export default function DuelsPage() {
  return (
    <>
      <TopNav />
      <main className="min-h-svh bg-background px-4 py-6 pb-24 text-foreground lg:px-8 lg:pb-10">
        <div className="mx-auto flex w-full max-w-md flex-col gap-4 lg:max-w-6xl lg:gap-6">
          <header className="space-y-1">
            <p className="font-display text-xs font-semibold uppercase tracking-wide text-accent lg:hidden">
              PIJA Quiniela
            </p>
            <h1 className="font-display text-2xl font-bold lg:text-4xl">Duelos y Apuestas</h1>
          </header>

          <Suspense fallback={<BoardSkeleton />}>
            <DuelsBoard />
          </Suspense>
        </div>

        <BottomNavbar />
      </main>
    </>
  );
}

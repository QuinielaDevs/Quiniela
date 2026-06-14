import { Suspense } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/utils/supabase/server";
import { DuelsDashboard, type Challenge } from "@/components/duels/DuelsDashboard";
import { BottomNavbar } from "@/components/layout/BottomNavbar";
import { AppTopNav } from "@/components/layout/AppTopNav";
import { BrandEyebrow } from "@/components/layout/BrandEyebrow";
import { NoLeagueState } from "@/components/join/NoLeagueState";
import { getActiveLeagueMembership } from "@/utils/active-league";

export async function DuelsBoard() {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/auth/login");

  const membership = await getActiveLeagueMembership({ supabase, userId });
  const leagueId = membership?.leagueId;

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
      wagerBalance={membership.wagerBalance}
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
  const isEnabled = process.env.NEXT_PUBLIC_ENABLE_DUELS === "true";

  return (
    <>
      <AppTopNav />
      <main className="min-h-svh bg-background px-4 py-6 pb-24 text-foreground lg:px-8 lg:pb-10">
        <div className="mx-auto flex w-full max-w-md flex-col gap-4 lg:max-w-6xl lg:gap-6">
          <header className="space-y-1">
            <BrandEyebrow />
            <h1 className="font-display text-2xl font-bold lg:text-4xl">Duelos y Apuestas</h1>
          </header>

          {isEnabled ? (
            <Suspense fallback={<BoardSkeleton />}>
              <DuelsBoard />
            </Suspense>
          ) : (
            <div className="rounded-lg border border-border bg-card/50 backdrop-blur-sm p-8 text-center shadow-lg">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent/10 text-accent mb-4">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="size-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636"
                  />
                </svg>
              </div>
              <h2 className="font-display text-lg font-bold text-white mb-2">Duelos Inactivos</h2>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                La funcionalidad de duelos de puntos no está activa en esta liga. Pronostica partidos para sumar puntos en la tabla de posiciones.
              </p>
            </div>
          )}
        </div>

        <BottomNavbar />
      </main>
    </>
  );
}

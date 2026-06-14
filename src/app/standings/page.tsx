import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Radio, Settings } from "lucide-react";

import { createClient } from "@/utils/supabase/server";
import { StandingsTable } from "@/components/standings/StandingsTable";
import { PaymentBanner } from "@/components/standings/PaymentBanner";
import { BottomNavbar } from "@/components/layout/BottomNavbar";
import { AppTopNav } from "@/components/layout/AppTopNav";
import { BrandEyebrow } from "@/components/layout/BrandEyebrow";
import { NoLeagueState } from "@/components/join/NoLeagueState";
import { getActiveLeagueMembership } from "@/utils/active-league";
import {
  type StandingMatch,
  type StandingMember,
  type StandingPrediction,
} from "@/utils/standings";
import type { LeagueRole, PaymentStatus } from "@/types";

// Fila de league_members embebiendo el perfil (FK user_id → profiles.id).
type MemberRow = {
  user_id: string;
  role: LeagueRole;
  payment_status: PaymentStatus;
  joined_at: string;
  wager_balance?: number;
  profiles: { display_name: string; avatar_url: string } | null;
};

// Pestaña de Posiciones: resuelve sesión + liga, carga miembros + partidos
// finished + predicciones, y calcula la clasificación on-the-fly (scoring.ts).
// Accesos dinámicos a cookies (getClaims) → dentro de <Suspense> (cacheComponents).
export async function StandingsBoard() {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/auth/login");

  const membership = await getActiveLeagueMembership({ supabase, userId });
  const leagueId = membership?.leagueId;
  if (!leagueId) {
    return (
      <NoLeagueState body="Únete con un código de invitación o crea tu propia quiniela para ver la tabla de posiciones." />
    );
  }

  // La RLS ya autoriza estas lecturas a un miembro: league_members/profiles de
  // su liga, los matches (catálogo común) y las predicciones de rivales para
  // partidos desbloqueados (finished → siempre visibles). NO usar service_role.
  // Los puntos de premios especiales llegan agregados por el RPC (BUG-004):
  // la RLS oculta los picks rivales, el RPC expone SOLO el total por usuario.
  const [{ data: memberRows }, { data: finished }, { data: league }, { data: awardRows }, { data: duelRows }] =
    await Promise.all([
      supabase
        .from("league_members")
        .select("user_id, role, payment_status, joined_at, profiles(display_name, avatar_url)")
        .eq("league_id", leagueId),
      supabase
        .from("matches")
        .select("id, status, matchday, stage, home_score, away_score")
        .eq("status", "finished"),
      supabase
        .from("leagues")
        .select("name, requires_payment, payment_amount, payment_instructions")
        .eq("id", leagueId)
        .single(),
      supabase.rpc("fn_get_league_award_points", { p_league_id: leagueId }),
      supabase.rpc("fn_get_league_duel_points", { p_league_id: leagueId }),
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

  const finishedMatches: StandingMatch[] = (finished ?? []).map((m) => ({
    id: m.id,
    status: m.status,
    matchday: m.matchday,
    stage: m.stage,
    homeScore: m.home_score,
    awayScore: m.away_score,
  }));
  const finishedIds = finishedMatches.map((m) => m.id);

  // Predicciones de la liga acotadas a partidos finished (las que alimentan la
  // tabla). Si no hay finished, no hace falta consultar predicciones.
  let predictions: StandingPrediction[] = [];
  if (finishedIds.length > 0) {
    const { data: predRows } = await supabase
      .from("predictions")
      .select("user_id, match_id, home_score_pred, away_score_pred, multiplier")
      .eq("league_id", leagueId)
      .in("match_id", finishedIds);
    predictions = (predRows ?? []).map((p) => ({
      userId: p.user_id,
      matchId: p.match_id,
      homeScorePred: p.home_score_pred,
      awayScorePred: p.away_score_pred,
      multiplier: p.multiplier,
    }));
  }

  const rows = (memberRows ?? []) as unknown as MemberRow[];
  const members: StandingMember[] = rows.map((m) => ({
    userId: m.user_id,
    displayName: m.profiles?.display_name ?? "Jugador Anónimo",
    avatarUrl: m.profiles?.avatar_url ?? "/assets/avatars/default-player.svg",
    paymentStatus: m.payment_status,
    joinedAt: m.joined_at,
    duelPoints: duelPointsByUser.get(m.user_id) ?? 0,
    awardPoints: awardPointsByUser.get(m.user_id) ?? 0,
  }));

  const currentMember = rows.find((m) => m.user_id === userId);
  const showPaymentBanner =
    !!league?.requires_payment && currentMember?.payment_status === "pending";
  const isAdmin = currentMember?.role === "admin";

  return (
    <>
      {showPaymentBanner && league && (
        <PaymentBanner
          leagueId={leagueId}
          leagueName={league.name}
          amount={league.payment_amount}
          instructions={league.payment_instructions}
        />
      )}

      <div className="flex justify-end gap-2">
        <Link
          href="/live"
          aria-label="Ver tabla en vivo"
          className="inline-flex h-12 items-center gap-2 rounded-full border border-accent bg-accent/15 px-4 text-sm font-semibold text-accent"
        >
          <Radio className="size-5" aria-hidden="true" />
          En vivo
        </Link>

        {isAdmin && (
          <Link
            href="/standings/manage"
            aria-label="Gestionar liga"
            className="inline-flex h-12 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold text-muted-foreground"
          >
            <Settings className="size-5" aria-hidden="true" />
            Gestionar
          </Link>
        )}
      </div>

      <StandingsTable
        members={members}
        matches={finishedMatches}
        predictions={predictions}
      />
    </>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-2" data-testid="standings-skeleton">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-md border border-border bg-card"
        />
      ))}
    </div>
  );
}

export default function StandingsPage() {
  return (
    <>
      <AppTopNav />
      <main className="min-h-svh bg-background px-4 py-6 pb-24 text-foreground lg:px-8 lg:pb-10">
        <div className="mx-auto flex w-full max-w-md flex-col gap-4 lg:max-w-5xl lg:gap-6">
          <header className="space-y-1">
            <BrandEyebrow />
            <h1 className="font-display text-2xl font-bold lg:text-4xl">Posiciones</h1>
          </header>

          <Suspense fallback={<BoardSkeleton />}>
            <StandingsBoard />
          </Suspense>
        </div>

        <BottomNavbar />
      </main>
    </>
  );
}

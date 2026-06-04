import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Settings } from "lucide-react";

import { createClient } from "@/utils/supabase/server";
import { StandingsTable } from "@/components/standings/StandingsTable";
import { PaymentBanner } from "@/components/standings/PaymentBanner";
import { BottomNavbar } from "@/components/layout/BottomNavbar";
import {
  finishedMatchdays,
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

  // Liga del usuario: la más reciente (selector multi-liga es trabajo futuro).
  const { data: memberships } = await supabase
    .from("league_members")
    .select("league_id, joined_at")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false })
    .limit(1);

  const leagueId = memberships?.[0]?.league_id;
  if (!leagueId) {
    return (
      <EmptyState
        title="Aún no perteneces a una liga"
        body="Crea tu propia quiniela o únete a una con un enlace de invitación para ver la tabla de posiciones."
        cta={{ href: "/leagues/new", label: "Crear una liga" }}
      />
    );
  }

  // La RLS ya autoriza estas lecturas a un miembro: league_members/profiles de
  // su liga, los matches (catálogo común) y las predicciones de rivales para
  // partidos desbloqueados (finished → siempre visibles). NO usar service_role.
  const [{ data: memberRows }, { data: finished }, { data: league }] =
    await Promise.all([
      supabase
        .from("league_members")
        .select("user_id, role, payment_status, joined_at, profiles(display_name, avatar_url)")
        .eq("league_id", leagueId),
      supabase
        .from("matches")
        .select("id, status, matchday, home_score, away_score")
        .eq("status", "finished"),
      supabase
        .from("leagues")
        .select("name, requires_payment, payment_amount, payment_instructions")
        .eq("id", leagueId)
        .single(),
    ]);

  const finishedMatches: StandingMatch[] = (finished ?? []).map((m) => ({
    id: m.id,
    status: m.status,
    matchday: m.matchday,
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
  }));

  const matchdays = finishedMatchdays(finishedMatches);

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

      {isAdmin && (
        <div className="flex justify-end">
          <Link
            href="/standings/manage"
            aria-label="Gestionar liga"
            className="inline-flex h-12 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold text-muted-foreground"
          >
            <Settings className="size-5" aria-hidden="true" />
            Gestionar
          </Link>
        </div>
      )}

      <StandingsTable
        members={members}
        matches={finishedMatches}
        predictions={predictions}
        matchdays={matchdays}
      />
    </>
  );
}

function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="rounded-md border border-border bg-card p-6 text-center text-card-foreground">
      <h2 className="font-display text-lg font-bold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      {cta && (
        <Link
          href={cta.href}
          className="mt-4 inline-flex h-12 items-center justify-center rounded-sm bg-primary px-6 font-semibold text-primary-foreground"
        >
          {cta.label}
        </Link>
      )}
    </div>
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

export default function StandingsPage() {
  return (
    <main className="min-h-svh bg-background px-4 py-6 pb-24 text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <header className="space-y-1">
          <p className="font-display text-xs font-semibold uppercase tracking-wide text-accent">
            PIJA Quiniela
          </p>
          <h1 className="font-display text-2xl font-bold">Posiciones</h1>
        </header>

        <Suspense fallback={<BoardSkeleton />}>
          <StandingsBoard />
        </Suspense>
      </div>

      <BottomNavbar />
    </main>
  );
}

import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/utils/supabase/server";
import { BottomNavbar } from "@/components/layout/BottomNavbar";
import { AppTopNav } from "@/components/layout/AppTopNav";
import { BrandEyebrow } from "@/components/layout/BrandEyebrow";
import { NoLeagueState } from "@/components/join/NoLeagueState";
import {
  MemberAdminList,
  type AdminMemberView,
} from "@/components/standings/MemberAdminList";
import {
  MatchAdminList,
  type AdminMatchView,
} from "@/components/standings/MatchAdminList";
import { AwardWinnerAdminList } from "@/components/standings/AwardWinnerAdminList";
import { getActiveLeagueMembership } from "@/utils/active-league";
import type { LeagueRole, MatchStatus, PaymentStatus, AwardCandidate, AwardCategory } from "@/types";

// Fila de league_members embebiendo el perfil (FK user_id → profiles.id).
type ManageMemberRow = {
  user_id: string;
  role: LeagueRole;
  payment_status: PaymentStatus;
  joined_at: string;
  profiles: { display_name: string; avatar_url: string } | null;
};

// Fila de matches relevante para la gestión de resultados (Story 7.2).
type ManageMatchRow = {
  id: string;
  home_team: string;
  away_team: string;
  home_team_code: string | null;
  away_team_code: string | null;
  match_time: string;
  status: MatchStatus;
  stage: string | null;
  home_score: number | null;
  away_score: number | null;
  group_label: string | null;
  matchday: number | null;
  bracket_slot: number | null;
  penalties_home_score: number | null;
  penalties_away_score: number | null;
  extra_time_home_score: number | null;
  extra_time_away_score: number | null;
};

// Panel rápido de administración (Story 3.3). Resuelve sesión + liga activa,
// EXIGE rol admin (defensa server-side), carga los miembros y delega la gestión
// interactiva (toggle de pago / expulsión) a MemberAdminList.
// Accesos dinámicos a cookies (getClaims) → dentro de <Suspense> (cacheComponents).
export async function ManageBoard() {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/auth/login");

  const membership = await getActiveLeagueMembership({ supabase, userId });
  const leagueId = membership?.leagueId;
  if (!leagueId) {
    return (
      <NoLeagueState body="Únete con un código de invitación o crea tu propia quiniela para administrarla." />
    );
  }

  // Cargar miembros con rol + perfil embebido (RLS ya autoriza a un miembro).
  const { data: memberRows } = await supabase
    .from("league_members")
    .select(
      "user_id, role, payment_status, joined_at, profiles(display_name, avatar_url)",
    )
    .eq("league_id", leagueId)
    .order("joined_at", { ascending: true });

  const rows = (memberRows ?? []) as unknown as ManageMemberRow[];

  // Defensa server-side (AC #1/#2): solo el admin entra al panel.
  const currentMember = rows.find((m) => m.user_id === userId);
  if (currentMember?.role !== "admin") redirect("/standings");

  const members: AdminMemberView[] = rows.map((m) => ({
    userId: m.user_id,
    displayName: m.profiles?.display_name ?? "Jugador Anónimo",
    avatarUrl: m.profiles?.avatar_url ?? "/assets/avatars/default-player.svg",
    role: m.role,
    paymentStatus: m.payment_status,
  }));

  // Cargar los candidatos de premios y determinar los ganadores actuales
  const { data: candidates } = await supabase
    .from("award_candidates")
    .select("*")
    .order("category, display_order", { ascending: true });

  const typedCandidates = (candidates ?? []) as AwardCandidate[];

  const initialWinners: Record<AwardCategory, AwardCandidate | null> = {
    champion: typedCandidates.find((c) => c.category === "champion" && c.is_winner) || null,
    top_scorer: typedCandidates.find((c) => c.category === "top_scorer" && c.is_winner) || null,
    mvp: typedCandidates.find((c) => c.category === "mvp" && c.is_winner) || null,
  };

  // Story 7.2 — partidos gestionables: catálogo GLOBAL del torneo (no por-liga).
  // Cargamos los de fase de grupos con equipos reales (los knockout TBD se omiten
  // hasta que Story 7.3 resuelva el bracket). RLS matches_select_authenticated ya
  // autoriza esta lectura a cualquier miembro autenticado.
  const { data: matchRows } = await supabase
    .from("matches")
    .select(
      "id, home_team, away_team, home_team_code, away_team_code, match_time, status, stage, home_score, away_score, group_label, matchday, bracket_slot, penalties_home_score, penalties_away_score, extra_time_home_score, extra_time_away_score",
    )
    .not("home_team_code", "is", null)
    .not("away_team_code", "is", null)
    .order("match_time", { ascending: true })
    .order("id", { ascending: true });

  const matches: AdminMatchView[] = ((matchRows ?? []) as ManageMatchRow[]).map(
    (m) => ({
      id: m.id,
      homeTeam: m.home_team,
      awayTeam: m.away_team,
      homeTeamCode: m.home_team_code,
      awayTeamCode: m.away_team_code,
      matchTime: m.match_time,
      status: m.status,
      stage: m.stage,
      homeScore: m.home_score,
      awayScore: m.away_score,
      groupLabel: m.group_label,
      matchday: m.matchday,
      bracketSlot: m.bracket_slot,
      penaltiesHomeScore: m.penalties_home_score,
      penaltiesAwayScore: m.penalties_away_score,
      extraTimeHomeScore: m.extra_time_home_score,
      extraTimeAwayScore: m.extra_time_away_score,
    }),
  );

  const now = Date.now();
  const sortedMatches = [...matches].sort((a, b) => {
    const diffA = Math.abs(new Date(a.matchTime).getTime() - now);
    const diffB = Math.abs(new Date(b.matchTime).getTime() - now);
    if (diffA !== diffB) {
      return diffA - diffB;
    }
    return new Date(a.matchTime).getTime() - new Date(b.matchTime).getTime();
  });

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Miembros
        </h2>
        <MemberAdminList
          members={members}
          currentUserId={userId}
          leagueId={leagueId}
        />
      </section>

      <section className="flex flex-col gap-3" data-testid="admin-awards-section">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Resolución de Premios Especiales
        </h2>
        <AwardWinnerAdminList
          candidates={typedCandidates}
          initialWinners={initialWinners}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Resultados de partidos
        </h2>
        <MatchAdminList matches={sortedMatches} />
      </section>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-md border border-border bg-card"
        />
      ))}
    </div>
  );
}

export default function ManageLeaguePage() {
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
                  Gestión de liga
                </h1>
                <span className="rounded-sm border border-primary bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary shrink-0">
                  Admin
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
            <ManageBoard />
          </Suspense>
        </div>

        <BottomNavbar />
      </main>
    </>
  );
}

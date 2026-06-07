import { Suspense } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/utils/supabase/server";
import { BottomNavbar } from "@/components/layout/BottomNavbar";
import { TopNav } from "@/components/layout/TopNav";
import { NoLeagueState } from "@/components/join/NoLeagueState";
import {
  MemberAdminList,
  type AdminMemberView,
} from "@/components/standings/MemberAdminList";
import {
  MatchAdminList,
  type AdminMatchView,
} from "@/components/standings/MatchAdminList";
import type { LeagueRole, MatchStatus, PaymentStatus } from "@/types";

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
  home_score: number | null;
  away_score: number | null;
  group_label: string | null;
  matchday: number | null;
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

  // Liga del usuario: la más reciente (igual que /standings).
  const { data: memberships } = await supabase
    .from("league_members")
    .select("league_id, joined_at")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false })
    .limit(1);

  const leagueId = memberships?.[0]?.league_id;
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

  // Story 7.2 — partidos gestionables: catálogo GLOBAL del torneo (no por-liga).
  // Cargamos los de fase de grupos con equipos reales (los knockout TBD se omiten
  // hasta que Story 7.3 resuelva el bracket). RLS matches_select_authenticated ya
  // autoriza esta lectura a cualquier miembro autenticado.
  const { data: matchRows } = await supabase
    .from("matches")
    .select(
      "id, home_team, away_team, home_team_code, away_team_code, match_time, status, home_score, away_score, group_label, matchday",
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
      homeScore: m.home_score,
      awayScore: m.away_score,
      groupLabel: m.group_label,
      matchday: m.matchday,
    }),
  );

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

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Resultados de partidos
        </h2>
        <MatchAdminList matches={matches} />
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
      <TopNav />
      <main className="min-h-svh bg-background px-4 py-6 pb-24 text-foreground lg:px-8 lg:pb-10">
        <div className="mx-auto flex w-full max-w-md flex-col gap-4 lg:max-w-5xl lg:gap-6">
          <header className="flex items-start justify-between gap-2">
            <div className="space-y-1">
              <p className="font-display text-xs font-semibold uppercase tracking-wide text-accent lg:hidden">
                PIJA Quiniela
              </p>
              <h1 className="font-display text-2xl font-bold lg:text-4xl">Gestión de liga</h1>
            </div>
            <span className="mt-1 rounded-sm border border-primary bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
              Admin
            </span>
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

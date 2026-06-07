import { Suspense } from "react";
import { redirect } from "next/navigation";

import { BottomNavbar } from "@/components/layout/BottomNavbar";
import { TopNav } from "@/components/layout/TopNav";
import { NoLeagueState } from "@/components/join/NoLeagueState";
import { LogoutButton } from "@/components/logout-button";
import {
  AccountLeaguesPanel,
  type AccountLeagueMembershipView,
} from "@/components/account/AccountLeaguesPanel";
import {
  ProfileSummaryCard,
  type AccountGameProfileView,
} from "@/components/account/ProfileSummaryCard";
import {
  BadgeHistory,
  type AccountBadgeView,
} from "@/components/account/BadgeHistory";
import { materializeCurrentMemberAwards } from "@/app/account/account-awards";
import { createClient } from "@/utils/supabase/server";
import type { LeagueRole, PaymentStatus } from "@/types";

type AccountProfile = {
  display_name: string;
  avatar_url: string;
};

type AccountLeague = {
  name: string;
};

type AccountMembershipRow = {
  league_id: string;
  role: LeagueRole;
  payment_status: PaymentStatus;
  joined_at: string;
  wager_balance: number;
  leagues: {
    name: string;
    requires_payment: boolean;
  } | null;
};

export async function AccountBoard() {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/auth/login");

  const { data: memberships, error: membershipError } = await supabase
    .from("league_members")
    .select("league_id, role, payment_status, joined_at, wager_balance, leagues(name, requires_payment)")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false });

  if (membershipError) {
    console.warn("No se pudo cargar la membresía de cuenta", {
      userId,
      error: membershipError.message,
    });
    return (
      <>
        <PageHeader />
        <ErrorState />
      </>
    );
  }

  const membershipRows = (memberships ?? []) as unknown as AccountMembershipRow[];
  const leagueId = membershipRows[0]?.league_id;
  if (!leagueId) {
    return (
      <>
        <PageHeader />
        <NoLeagueState body="Únete con un código de invitación o crea tu propia quiniela para desbloquear tu perfil." />
      </>
    );
  }

  const accountLeagues: AccountLeagueMembershipView[] = membershipRows.map(
    (membership) => ({
      leagueId: membership.league_id,
      leagueName: membership.leagues?.name ?? "Liga sin nombre",
      role: membership.role,
      paymentStatus: membership.payment_status,
      joinedAt: membership.joined_at,
      wagerBalance: Number(membership.wager_balance),
      requiresPayment: membership.leagues?.requires_payment ?? false,
      isCurrent: membership.league_id === leagueId,
    }),
  );

  const materialized = await materializeCurrentMemberAwards({
    supabase,
    leagueId,
    userId,
  });
  if (materialized.errors.length > 0) {
    console.warn("No se pudieron materializar premios de cuenta", {
      leagueId,
      userId,
      errors: materialized.errors,
    });
  }

  const [
    { data: profile, error: profileError },
    { data: league, error: leagueError },
    { data: badges, error: badgesError },
    { data: profiles, error: profilesError },
  ] = await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", userId)
        .single(),
      supabase.from("leagues").select("name").eq("id", leagueId).single(),
      supabase
        .from("member_badges")
        .select("badge_type, badge_label, matchday, reason, points")
        .eq("league_id", leagueId)
        .eq("user_id", userId)
        .order("matchday", { ascending: false }),
      supabase
        .from("member_game_profiles")
        .select("profile_type, profile_label, matchday, summary")
        .eq("league_id", leagueId)
        .eq("user_id", userId)
        .order("matchday", { ascending: false }),
    ]);

  const loadErrors = [
    profileError?.message,
    leagueError?.message,
    badgesError?.message,
    profilesError?.message,
  ].filter(Boolean);
  if (loadErrors.length > 0) {
    console.warn("No se pudieron cargar datos de cuenta", {
      leagueId,
      userId,
      errors: loadErrors,
    });
    return (
      <>
        <PageHeader />
        <ErrorState />
      </>
    );
  }

  const accountProfile = profile as AccountProfile | null;
  const accountLeague = league as AccountLeague | null;
  const closedSet = new Set(materialized.closedMatchdays);
  const profileRow = ((profiles ?? []).find((profile) =>
    closedSet.has(profile.matchday),
  ) ?? null) as {
    profile_type: string;
    profile_label: string;
    matchday: number;
    summary: string;
  } | null;
  const latestGameProfile: AccountGameProfileView | null = profileRow
    ? {
        profileType: profileRow.profile_type,
        profileLabel: profileRow.profile_label,
        matchday: profileRow.matchday,
        summary: profileRow.summary,
      }
    : null;
  const badgeRows: AccountBadgeView[] = (badges ?? [])
    .filter((badge) => closedSet.has(badge.matchday))
    .map((badge) => ({
      badgeType: badge.badge_type,
      badgeLabel: badge.badge_label,
      matchday: badge.matchday,
      reason: badge.reason,
      points: Number(badge.points),
    }));
  const displayName = accountProfile?.display_name ?? "Jugador Anónimo";
  const avatarUrl =
    accountProfile?.avatar_url ?? "/assets/avatars/default-player.svg";
  const leagueName = accountLeague?.name ?? "Liga activa";
  const emptyProfileMessage =
    materialized.closedMatchdays.length > 0 &&
    materialized.predictedClosedMatchdays.length === 0
      ? "Hay jornadas cerradas, pero todavía no tienes predicciones evaluables para perfilar tu juego."
      : "Todavía no hay jornadas cerradas para perfilar tu juego.";

  return (
    <>
      <PageHeader />
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[360px_1fr] lg:items-start lg:gap-6">
        <div className="lg:sticky lg:top-20">
          <ProfileSummaryCard
            displayName={displayName}
            avatarUrl={avatarUrl}
            leagueName={leagueName}
            latestProfile={latestGameProfile}
            emptyProfileMessage={emptyProfileMessage}
            badges={badgeRows}
          />
        </div>
        <div className="flex flex-col gap-4">
          <AccountLeaguesPanel leagues={accountLeagues} />
          <BadgeHistory badges={badgeRows} />
        </div>
      </div>
    </>
  );
}

function PageHeader() {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <p className="font-display text-xs font-semibold uppercase tracking-wide text-accent lg:hidden">
          PIJA Quiniela
        </p>
        <h1 className="font-display text-2xl font-bold lg:text-4xl">
          Mi Cuenta
        </h1>
      </div>
      <LogoutButton />
    </header>
  );
}

function ErrorState() {
  return (
    <div className="rounded-md border border-destructive/40 bg-card p-6 text-center text-card-foreground">
      <h2 className="font-display text-lg font-bold">No pudimos cargar tu cuenta</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Intenta de nuevo en unos segundos.
      </p>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-8 w-36 animate-pulse rounded-sm bg-card" />
      <div className="h-40 animate-pulse rounded-md border border-border bg-card" />
      <div className="h-32 animate-pulse rounded-md border border-border bg-card" />
    </div>
  );
}

export default function AccountPage() {
  return (
    <>
      <TopNav />
      <main className="min-h-svh bg-background px-4 py-6 pb-24 text-foreground lg:px-8 lg:pb-10">
        <div className="mx-auto flex w-full max-w-md flex-col gap-4 lg:max-w-6xl lg:gap-6">
          <Suspense fallback={<BoardSkeleton />}>
            <AccountBoard />
          </Suspense>
        </div>

        <BottomNavbar />
      </main>
    </>
  );
}

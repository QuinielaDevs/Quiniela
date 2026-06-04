import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BottomNavbar } from "@/components/layout/BottomNavbar";
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

type AccountProfile = {
  display_name: string;
  avatar_url: string;
};

type AccountLeague = {
  name: string;
};

export async function AccountBoard() {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/auth/login");

  const { data: memberships, error: membershipError } = await supabase
    .from("league_members")
    .select("league_id, joined_at")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false })
    .limit(1);

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

  const leagueId = memberships?.[0]?.league_id;
  if (!leagueId) {
    return (
      <>
        <PageHeader />
        <EmptyState
          title="Aún no perteneces a una liga"
          body="Crea tu propia quiniela o únete con un enlace de invitación para desbloquear tu perfil."
          cta={{ href: "/leagues/new", label: "Crear una liga" }}
        />
      </>
    );
  }

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
      <ProfileSummaryCard
        displayName={displayName}
        avatarUrl={avatarUrl}
        leagueName={leagueName}
        latestProfile={latestGameProfile}
        emptyProfileMessage={emptyProfileMessage}
        badges={badgeRows}
      />
      <BadgeHistory badges={badgeRows} />
    </>
  );
}

function PageHeader() {
  return (
    <header className="space-y-1">
      <p className="font-display text-xs font-semibold uppercase tracking-wide text-accent">
        PIJA Quiniela
      </p>
      <h1 className="font-display text-2xl font-bold">Mi Cuenta</h1>
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
    <div className="flex flex-col gap-3">
      <div className="h-8 w-36 animate-pulse rounded-sm bg-card" />
      <div className="h-40 animate-pulse rounded-md border border-border bg-card" />
      <div className="h-32 animate-pulse rounded-md border border-border bg-card" />
    </div>
  );
}

export default function AccountPage() {
  return (
    <main className="min-h-svh bg-background px-4 py-6 pb-24 text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <Suspense fallback={<BoardSkeleton />}>
          <AccountBoard />
        </Suspense>
      </div>

      <BottomNavbar />
    </main>
  );
}

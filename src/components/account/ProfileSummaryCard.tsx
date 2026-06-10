import { ShareProfileButton } from "@/components/account/ShareProfileButton";
import type { AccountBadgeView } from "@/components/account/BadgeHistory";

export type AccountGameProfileView = {
  profileType: string;
  profileLabel: string;
  matchday: number;
  summary: string;
};

type ProfileSummaryCardProps = {
  displayName: string;
  avatarUrl: string;
  leagueName: string;
  latestProfile: AccountGameProfileView | null;
  emptyProfileMessage?: string;
  badges: AccountBadgeView[];
};

export function ProfileSummaryCard({
  displayName,
  avatarUrl,
  leagueName,
  latestProfile,
  emptyProfileMessage = "Todavía no hay jornadas cerradas para perfilar tu juego.",
  badges,
}: ProfileSummaryCardProps) {
  return (
    <section
      className="rounded-md border border-border bg-card p-4 text-card-foreground shadow-none"
      data-testid="profile-summary"
    >
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl || "/assets/avatars/default-player.svg"}
          alt={`Avatar de ${displayName}`}
          className="size-14 rounded-full border border-border object-cover"
        />
        <div className="min-w-0">
          <h2 className="truncate font-display text-xl font-bold">{displayName}</h2>
          <p className="truncate text-sm text-muted-foreground">{leagueName}</p>
        </div>
      </div>

      <div className="mt-4 rounded-sm border border-border bg-background p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Perfil psicológico
        </p>
        {latestProfile ? (
          <>
            <p className="mt-1 font-display text-2xl font-bold text-accent">
              {latestProfile.profileLabel}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Jornada {latestProfile.matchday} · {latestProfile.summary}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            {emptyProfileMessage}
          </p>
        )}
      </div>

      <ShareProfileButton
        displayName={displayName}
        leagueName={leagueName}
        profileLabel={latestProfile?.profileLabel ?? null}
        badges={badges.map((badge) => ({
          badgeLabel: badge.badgeLabel,
          matchday: badge.matchday,
        }))}
      />
    </section>
  );
}

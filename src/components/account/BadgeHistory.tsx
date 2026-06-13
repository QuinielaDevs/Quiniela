export type AccountBadgeView = {
  badgeType: string;
  badgeLabel: string;
  matchday: number;
  reason: string;
  points: number;
};

export function BadgeHistory({ badges }: { badges: AccountBadgeView[] }) {
  return (
    <section className="rounded-md border border-border bg-card p-4 text-card-foreground shadow-none">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold">Medallas</h2>
        <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground">
          {badges.length}
        </span>
      </div>

      {badges.length > 0 ? (
        <ol className="mt-3 flex flex-col gap-2">
          {badges.map((badge) => (
            <li
              key={`${badge.matchday}-${badge.badgeType}`}
              data-testid="badge-item"
              data-badge={badge.badgeType}
              className="rounded-sm border border-border bg-background p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-base font-bold text-accent">
                    {badge.badgeLabel}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Jornada {badge.matchday}
                  </p>
                </div>
                <span className="font-display text-sm font-bold text-accent">
                  {Number(badge.points).toFixed(1)} pts
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{badge.reason}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          Aún no cae una medalla, pero el torneo es largo.
        </p>
      )}
    </section>
  );
}

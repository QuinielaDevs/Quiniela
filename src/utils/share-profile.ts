export type ShareProfileBadge = {
  badgeLabel: string;
  matchday: number;
};

export function buildProfileShareText({
  displayName,
  leagueName,
  profileLabel,
  badges,
}: {
  displayName: string;
  leagueName: string;
  profileLabel: string | null;
  badges: ShareProfileBadge[];
}): string {
  const badgeText =
    badges.length > 0
      ? badges
          .slice(0, 3)
          .map((badge) => `${badge.badgeLabel} J${badge.matchday}`)
          .join(", ")
      : "sin medallas todavía";

  return `Mi perfil en La Pija Quiniela: ${displayName} en ${leagueName}. Perfil: ${
    profileLabel ?? "por descubrir"
  }. Medallas: ${badgeText}. ¿Quién me baja de ahí?`;
}

export function buildWhatsAppShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

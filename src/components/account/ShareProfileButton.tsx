"use client";

import { Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  buildProfileShareText,
  buildWhatsAppShareUrl,
  type ShareProfileBadge,
} from "@/utils/share-profile";

type ShareProfileButtonProps = {
  displayName: string;
  leagueName: string;
  profileLabel: string | null;
  badges: ShareProfileBadge[];
};

export function ShareProfileButton({
  displayName,
  leagueName,
  profileLabel,
  badges,
}: ShareProfileButtonProps) {
  async function handleShare() {
    const text = buildProfileShareText({
      displayName,
      leagueName,
      profileLabel,
      badges,
    });
    const url = window.location.href;
    const title = "Mi perfil en La Pija Quiniela";

    try {
      if (
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function"
      ) {
        const file = await createProfileCardFile({
          displayName,
          leagueName,
          profileLabel,
          badges,
        }).catch(() => null);

        if (file && navigator.canShare({ files: [file] })) {
          await navigator.share({ title, text, files: [file] });
          return;
        }
      }

      if (typeof navigator.share === "function") {
        await navigator.share({ title, text, url });
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }

    window.open(buildWhatsAppShareUrl(text), "_blank", "noopener,noreferrer");
  }

  return (
    <Button
      type="button"
      size="xl"
      className="mt-4 w-full"
      onClick={handleShare}
      aria-label="Compartir perfil"
    >
      <Share2 aria-hidden="true" />
      Compartir Perfil
    </Button>
  );
}

async function createProfileCardFile({
  displayName,
  leagueName,
  profileLabel,
  badges,
}: ShareProfileButtonProps): Promise<File | null> {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#0D1B2A";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1B263B";
  ctx.fillRect(72, 72, 936, 936);

  ctx.fillStyle = "#E9C46A";
  ctx.font = "700 64px sans-serif";
  drawSingleLine(ctx, "La Pija Quiniela", 120, 180, 840);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "700 86px sans-serif";
  drawSingleLine(ctx, displayName, 120, 340, 840);

  ctx.fillStyle = "#8D99AE";
  ctx.font = "400 42px sans-serif";
  drawSingleLine(ctx, leagueName, 120, 410, 840);

  ctx.fillStyle = "#E9C46A";
  ctx.font = "700 72px sans-serif";
  drawSingleLine(ctx, profileLabel ?? "Perfil por descubrir", 120, 570, 840);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "400 38px sans-serif";
  const badgeText =
    badges.length > 0
      ? badges
          .slice(0, 3)
          .map((badge) => `${badge.badgeLabel} · J${badge.matchday}`)
          .join("  ")
      : "Sin medallas todavía";
  drawSingleLine(ctx, badgeText, 120, 700, 840);

  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        resolve(
          new File([blob], "perfil-pija-quiniela.png", { type: "image/png" }),
        );
      }, "image/png");
    } catch {
      resolve(null);
    }
  });
}

function drawSingleLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  if (ctx.measureText(text).width <= maxWidth) {
    ctx.fillText(text, x, y, maxWidth);
    return;
  }

  let clipped = text;
  while (clipped.length > 0 && ctx.measureText(`${clipped}...`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }

  ctx.fillText(clipped ? `${clipped}...` : text, x, y, maxWidth);
}

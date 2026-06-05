import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { createClient } from "@/utils/supabase/server";
import { DesafioClient } from "./DesafioClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Genera metadatos dinámicos OpenGraph (Smart Preview) para el crawlers / clientes de mensajería.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();

  const { data: challengeData } = await supabase
    .rpc("fn_get_challenge_landing", { p_challenge_id: id })
    .maybeSingle();

  const challenge = challengeData as any;

  if (!challenge) {
    return {
      title: "Desafío no encontrado - PIJA Quiniela",
      description: "Este desafío no existe o ha sido eliminado.",
    };
  }

  const isDirect = challenge.type === "direct";
  const points = challenge.points_bet;
  const matchDesc = `${challenge.home_team} vs ${challenge.away_team}`;

  const title = isDirect
    ? `Desafío 1v1: ${challenge.creator_display_name} vs ${challenge.challenged_display_name || "Rival"}`
    : `¡Pozo Abierto de ${points} pts para el partido ${matchDesc}!`;

  const description = `Apuesta tus puntos en el partido ${matchDesc} del Mundial 2026. ¿Quién tiene la mejor predicción? Creado por ${challenge.creator_display_name}.`;

  const defaultUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  return {
    metadataBase: new URL(defaultUrl),
    title: `${title} - PIJA Quiniela`,
    description,
    openGraph: {
      title,
      description,
      url: `/desafio/${id}`,
      type: "website",
      images: [
        {
          url: "/assets/images/og-challenge.png",
          width: 1200,
          height: 630,
          alt: "Desafío PIJA Quiniela",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/assets/images/og-challenge.png"],
    },
  };
}

async function DesafioLoader({ id }: { id: string }) {
  const supabase = await createClient();

  // 1) Consultar sesión de usuario
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id ?? null;

  // 2) Consultar datos del desafío vía RPC seguro con gate
  const { data: challengeData, error } = await supabase
    .rpc("fn_get_challenge_landing", { p_challenge_id: id })
    .maybeSingle();

  const challenge = challengeData as any;

  if (error || !challenge) {
    notFound();
  }

  // 3) Comprobar membresía de liga y saldo si está autenticado
  let isMember = false;
  let wagerBalance = 0;

  if (userId) {
    const { data: membership } = await supabase
      .from("league_members")
      .select("wager_balance")
      .eq("league_id", challenge.league_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (membership) {
      isMember = true;
      wagerBalance = Number(membership.wager_balance);
    }
  }

  return (
    <DesafioClient
      challenge={challenge as any}
      currentUserId={userId}
      isMember={isMember}
      wagerBalance={wagerBalance}
    />
  );
}

export default async function DesafioPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <Suspense
      fallback={
        <div className="w-full max-w-md mx-auto min-h-svh bg-[#0D1B2A] text-white flex flex-col items-center justify-center font-sans">
          <div className="animate-pulse space-y-4 w-5/6">
            <div className="h-6 bg-gray-700 rounded w-1/3 mx-auto"></div>
            <div className="h-44 bg-[#1B263B] rounded-lg"></div>
            <div className="h-12 bg-gray-700 rounded"></div>
          </div>
        </div>
      }
    >
      <DesafioLoader id={id} />
    </Suspense>
  );
}

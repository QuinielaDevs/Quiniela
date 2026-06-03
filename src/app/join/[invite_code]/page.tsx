import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  JoinLeagueCard,
  type InviteLandingData,
} from "@/components/join/JoinLeagueCard";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/utils/supabase/server";
import { getJoinLeagueErrorMessage } from "@/utils/join-league-errors";

type JoinPageProps = {
  params: Promise<{ invite_code: string }>;
};

export async function generateMetadata({
  params,
}: JoinPageProps): Promise<Metadata> {
  const { invite_code: inviteCode } = await params;
  const normalizedInviteCode = inviteCode.trim().toUpperCase();
  const supabase = await createClient();

  const { data: invite, error } = await supabase
    .rpc("fn_get_invite_landing", {
      p_invite_code: normalizedInviteCode,
    })
    .single();

  if (error || !invite) {
    return {
      title: "Únete a PIJA Quiniela",
      description:
        "Recibe tu invitación y entra a una quiniela privada del Mundial.",
      openGraph: {
        title: "Únete a PIJA Quiniela",
        description:
          "Recibe tu invitación y entra a una quiniela privada del Mundial.",
        url: `/join/${normalizedInviteCode}`,
      },
    };
  }

  const inviteData = invite as InviteLandingData;
  const title = `Únete a ${inviteData.league_name}`;
  const description = `${inviteData.creator_display_name} te invita a jugar la quiniela del Mundial.`;

  return {
    title: `${title} | PIJA Quiniela`,
    description,
    openGraph: {
      title,
      description,
      url: `/join/${normalizedInviteCode}`,
    },
  };
}

function InvalidInviteCard() {
  return (
    <Card className="border-border bg-card text-card-foreground">
      <CardHeader>
        <CardTitle className="font-display text-3xl">
          Invitación no disponible
        </CardTitle>
        <CardDescription className="text-base text-muted-foreground">
          Revisa el enlace o pídele al administrador que te comparta uno nuevo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild size="xl" className="w-full">
          <Link href="/">Volver al inicio</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function JoinPageFallback() {
  return (
    <main className="min-h-svh bg-background px-4 py-6 text-foreground">
      <div className="mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-md flex-col justify-center gap-4">
        <div className="space-y-2">
          <p className="font-display text-sm font-semibold uppercase text-accent">
            PIJA Quiniela
          </p>
          <h1 className="font-display text-4xl font-bold leading-tight">
            Tu Mundial empieza aquí
          </h1>
        </div>
      </div>
    </main>
  );
}

export async function JoinPageContent({ params }: JoinPageProps) {
  const { invite_code: inviteCode } = await params;
  const normalizedInviteCode = inviteCode.trim().toUpperCase();
  const supabase = await createClient();

  const [{ data: invite, error: inviteError }, { data: claims }] =
    await Promise.all([
      supabase
        .rpc("fn_get_invite_landing", {
          p_invite_code: normalizedInviteCode,
        })
        .single(),
      supabase.auth.getClaims(),
    ]);
  const isAuthenticated = Boolean(claims?.claims?.sub);
  let joinError: string | null = null;

  if (!inviteError && invite && isAuthenticated) {
    const { data: membership, error } = await supabase.rpc(
      "fn_join_league_by_invite",
      {
        p_invite_code: normalizedInviteCode,
      },
    );

    if (!error && membership?.league_id) {
      redirect(`/predictions?joined=1&league=${membership.league_id}`);
    }

    joinError = getJoinLeagueErrorMessage(error);
  }

  return (
    <main className="min-h-svh bg-background px-4 py-6 text-foreground">
      <div className="mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-md flex-col justify-center gap-4">
        <div className="space-y-2">
          <p className="font-display text-sm font-semibold uppercase text-accent">
            PIJA Quiniela
          </p>
          <h1 className="font-display text-4xl font-bold leading-tight">
            Tu Mundial empieza aquí
          </h1>
        </div>

        {inviteError || !invite ? (
          <InvalidInviteCard />
        ) : (
          <JoinLeagueCard
            invite={invite as InviteLandingData}
            isAuthenticated={isAuthenticated}
            nextPath={`/join/${normalizedInviteCode}`}
            initialError={joinError}
          />
        )}
      </div>
    </main>
  );
}

export default function JoinPage(props: JoinPageProps) {
  return (
    <Suspense fallback={<JoinPageFallback />}>
      <JoinPageContent {...props} />
    </Suspense>
  );
}

"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { useTransition, useState } from "react";

import { joinLeagueByInvite } from "@/app/actions/leagues.actions";
import { GoogleSignInButton } from "@/components/google-signin-button";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type InviteLandingData = {
  league_name: string;
  creator_display_name: string;
  creator_avatar_url: string;
  requires_payment: boolean;
  payment_amount: number | null;
  payment_instructions: string | null;
  invite_code: string;
};

type JoinLeagueCardProps = {
  invite: InviteLandingData;
  isAuthenticated: boolean;
  nextPath: string;
  initialError?: string | null;
};

function formatPaymentAmount(amount: number | null): string {
  if (amount === null) return "Monto por confirmar";

  return new Intl.NumberFormat("es-VE", {
    maximumFractionDigits: 2,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export function JoinLeagueCard({
  invite,
  isAuthenticated,
  nextPath,
  initialError = null,
}: JoinLeagueCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(initialError);

  const handleJoin = () => {
    setError(null);
    startTransition(async () => {
      const result = await joinLeagueByInvite(invite.invite_code);

      if (!result.success || !result.data) {
        setError(result.error ?? "No pudimos unirte a la liga.");
        return;
      }

      router.push(`/protected?joined=1&league=${result.data.league_id}`);
    });
  };

  return (
    <Card className="border-border bg-card text-card-foreground">
      <CardHeader className="gap-3">
        <div className="flex items-center gap-3">
          <Image
            src={invite.creator_avatar_url}
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 rounded-full border border-border bg-background object-cover"
          />
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Invitación de</p>
            <p className="truncate font-display text-lg font-semibold">
              {invite.creator_display_name}
            </p>
          </div>
        </div>
        <div className="space-y-2">
          <CardTitle className="font-display text-3xl leading-tight">
            Únete a {invite.league_name}
          </CardTitle>
          <CardDescription className="text-base text-muted-foreground">
            Regístrate con Google para entrar directo a la quiniela.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {invite.requires_payment ? (
          <div className="rounded-sm border border-destructive/70 bg-destructive/10 p-4">
            <p className="font-display text-lg font-semibold text-foreground">
              Tarifa de inscripción: {formatPaymentAmount(invite.payment_amount)}
            </p>
            {invite.payment_instructions ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {invite.payment_instructions}
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                El administrador compartirá las instrucciones de cobro.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-sm border border-success/60 bg-success/10 p-4">
            <p className="font-display text-lg font-semibold text-foreground">
              Liga sin pago requerido
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Entra y empieza a preparar tus pronósticos.
            </p>
          </div>
        )}

        {isAuthenticated ? (
          <Button
            type="button"
            size="xl"
            className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
            onClick={handleJoin}
            disabled={isPending}
            aria-label={`Unirme a la liga ${invite.league_name}`}
          >
            {isPending ? "Uniéndote..." : "Unirme a la liga"}
          </Button>
        ) : (
          <GoogleSignInButton next={nextPath} />
        )}

        {error && (
          <p className="rounded-sm border border-destructive/70 bg-destructive/10 p-3 text-sm text-destructive-foreground">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

import { CircleDollarSign, Crown, ListChecks, Plus, Shield } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LeagueRole, PaymentStatus } from "@/types";

export type AccountLeagueMembershipView = {
  leagueId: string;
  leagueName: string;
  role: LeagueRole;
  paymentStatus: PaymentStatus;
  joinedAt: string;
  wagerBalance: number;
  requiresPayment: boolean;
  isCurrent: boolean;
};

type AccountLeaguesPanelProps = {
  leagues: AccountLeagueMembershipView[];
};

const roleLabels: Record<LeagueRole, string> = {
  admin: "Admin",
  member: "Miembro",
};

const paymentLabels: Record<PaymentStatus, string> = {
  paid: "Pago al día",
  pending: "Pago pendiente",
};

const dateFormatter = new Intl.DateTimeFormat("es-VE", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatJoinedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha no disponible";

  return dateFormatter.format(date);
}

export function AccountLeaguesPanel({ leagues }: AccountLeaguesPanelProps) {
  const currentLeague = leagues.find((league) => league.isCurrent);

  return (
    <section className="rounded-md border border-border bg-card p-4 text-card-foreground">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Mis ligas
          </p>
          <h2 className="mt-1 font-display text-xl font-bold">
            {currentLeague?.leagueName ?? "Sin liga actual"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {leagues.length === 1
              ? "Estás jugando en 1 liga."
              : `Estás jugando en ${leagues.length} ligas.`}
          </p>
        </div>

        <Button type="button" variant="outline" size="sm" disabled>
          <Plus aria-hidden="true" />
          Crear liga
        </Button>
      </div>

      <div className="mt-4 divide-y divide-border border-t border-border">
        {leagues.map((league) => (
          <article
            key={league.leagueId}
            className="py-3 first:pt-4 last:pb-0"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate font-display text-lg font-bold">
                    {league.leagueName}
                  </h3>
                  {league.isCurrent && <Badge>Liga actual</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Desde {formatJoinedAt(league.joinedAt)}
                </p>
              </div>

              <div className="flex items-center gap-2 text-sm font-semibold text-accent">
                <CircleDollarSign className="size-4" aria-hidden="true" />
                {league.wagerBalance.toFixed(1)} pts
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1">
                {league.role === "admin" ? (
                  <Crown className="size-3.5" aria-hidden="true" />
                ) : (
                  <Shield className="size-3.5" aria-hidden="true" />
                )}
                {roleLabels[league.role]}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1">
                <ListChecks className="size-3.5" aria-hidden="true" />
                {league.requiresPayment
                  ? paymentLabels[league.paymentStatus]
                  : "Sin pago requerido"}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

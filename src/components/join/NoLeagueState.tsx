import Link from "next/link";

import { JoinByCodeForm } from "@/components/join/JoinByCodeForm";

const DEFAULT_BODY =
  "¿Tienes un código de invitación? Únete al instante. Si no, crea tu propia quiniela.";

// Estado compartido para usuario logueado sin liga: puede unirse al instante con
// un código (entrada manual) o crear su propia liga. Cada sección puede pasar su
// propio `body` contextual. El formulario es un client component.
export function NoLeagueState({ body = DEFAULT_BODY }: { body?: string }) {
  return (
    <div
      className="rounded-md border border-border bg-card p-6 text-card-foreground"
      data-testid="no-league-state"
    >
      <h2 className="font-display text-lg font-bold">
        Aún no perteneces a una liga
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>

      <div className="mt-5">
        <JoinByCodeForm />
      </div>

      <div className="relative my-5 text-center text-sm">
        <span className="relative z-10 bg-card px-2 text-muted-foreground">o</span>
        <div className="absolute inset-0 top-1/2 -z-0 border-t border-border" />
      </div>

      <Link
        href="/leagues/new"
        className="inline-flex h-12 w-full items-center justify-center rounded-sm border border-border bg-background px-6 font-semibold text-foreground transition-colors hover:bg-card"
      >
        Crear una liga
      </Link>
    </div>
  );
}

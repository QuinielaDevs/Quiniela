"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PartyPopper } from "lucide-react";

// Modal de bienvenida + recordatorio de pago para miembros con pago pendiente.
// Se muestra en cada visita al tablero mientras el pago siga pendiente (decisión
// de producto), es cerrable para usar la app, y enlaza a Reglas para pagar.
// Sigue el patrón de overlay accesible del proyecto (sin Radix): role="dialog",
// aria-modal, cierre con Escape y foco inicial en el CTA.
type WelcomePaymentModalProps = {
  leagueName: string;
  amount: number | null;
  instructions: string | null;
};

function formatPaymentAmount(amount: number | null): string {
  if (amount === null) return "Monto por confirmar";

  return new Intl.NumberFormat("es-VE", {
    maximumFractionDigits: 2,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export function WelcomePaymentModal({
  leagueName,
  amount,
  instructions,
}: WelcomePaymentModalProps) {
  const [open, setOpen] = useState(true);
  const ctaRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    if (!open) return;
    ctaRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-6 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-pay-title"
        aria-describedby="welcome-pay-desc"
        className="w-full max-w-sm rounded-md border border-border bg-card p-6 text-card-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="welcome-pay-title"
          className="flex items-center gap-2 font-display text-xl font-bold"
        >
          <PartyPopper className="size-6 text-accent" aria-hidden="true" />
          ¡Bienvenido a {leagueName}!
        </h2>

        <div id="welcome-pay-desc" className="mt-3 space-y-3 text-sm">
          <p className="text-muted-foreground">
            Ya eres parte de la liga. Para confirmar tu participación y entrar a
            la quiniela, necesitas completar el pago de inscripción.
          </p>

          <div className="rounded-sm border border-destructive/60 bg-destructive/10 p-3">
            <p className="font-display text-base font-semibold text-foreground">
              Tarifa de inscripción: {formatPaymentAmount(amount)}
            </p>
            {instructions ? (
              <p className="mt-2 leading-6 text-muted-foreground">
                {instructions}
              </p>
            ) : (
              <p className="mt-2 text-muted-foreground">
                Encuentra las instrucciones de pago en las reglas de la liga.
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-12 flex-1 rounded-sm border border-border text-sm font-semibold text-muted-foreground"
          >
            Ahora no
          </button>
          <Link
            ref={ctaRef}
            href="/rules"
            className="flex h-12 flex-1 items-center justify-center rounded-sm bg-primary text-sm font-semibold text-primary-foreground"
          >
            Ver cómo pagar
          </Link>
        </div>
      </div>
    </div>
  );
}

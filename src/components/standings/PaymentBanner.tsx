"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { formatUsd } from "@/utils/format-currency";

// Banner superior persistente para deudores (UX-DR-6 / EXPERIENCE payment-banner).
// Visible solo al usuario con payment_status='pending' en una liga que requires_payment.
// La decisión de visibilidad la toma la página (server); este componente solo
// renderiza + permite descartar, recordando el descarte durante la sesión.
type PaymentBannerProps = {
  leagueId: string;
  leagueName: string;
  amount: number | null;
  instructions: string | null;
};

function dismissKey(leagueId: string): string {
  return `pq:payBannerDismissed:${leagueId}`;
}

export function PaymentBanner({
  leagueId,
  leagueName,
  amount,
  instructions,
}: PaymentBannerProps) {
  // Arranca oculto para evitar flash en SSR/hidratación; el efecto decide.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const dismissed =
        window.sessionStorage.getItem(dismissKey(leagueId)) === "1";
      setVisible(!dismissed);
    } catch {
      // sessionStorage no disponible (modo privado / SSR) → mostrar igual.
      setVisible(true);
    }
  }, [leagueId]);

  if (!visible) return null;

  function dismiss() {
    try {
      window.sessionStorage.setItem(dismissKey(leagueId), "1");
    } catch {
      // Ignorar: si no se puede persistir, al menos se oculta en esta vista.
    }
    setVisible(false);
  }

  return (
    <div
      role="status"
      data-testid="payment-banner"
      className="sticky top-0 z-10 flex items-start gap-3 rounded-md border border-destructive bg-destructive/15 p-3 px-4 text-sm text-foreground"
    >
      <div className="flex-1 space-y-1">
        <p className="font-display font-bold text-destructive">
          Tienes el pago pendiente
        </p>
        <p className="text-muted-foreground">
          Para participar al 100% en <span className="font-semibold">{leagueName}</span>
          {amount != null ? (
            <>
              {" "}
              abona la inscripción de{" "}
              <span className="font-semibold text-foreground">
                {formatUsd(amount)}
              </span>
              .
            </>
          ) : (
            "."
          )}
        </p>
        {instructions && (
          <p className="whitespace-pre-line text-muted-foreground">
            {instructions}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Descartar aviso de pago"
        className="flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

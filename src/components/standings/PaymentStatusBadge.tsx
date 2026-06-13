import { cn } from "@/utils/utils";
import type { PaymentStatus } from "@/types";

// Badge de pago PÚBLICO en la clasificación (FR-5, presión social).
// Solo display en Story 3.1: el toggle por el admin es Story 3.3.
// Verde turf 'Pagado' (success) / carmesí 'Pendiente' (destructive), rounded-full.
type PaymentStatusBadgeProps = {
  status: PaymentStatus;
  className?: string;
};

export function PaymentStatusBadge({
  status,
  className,
}: PaymentStatusBadgeProps) {
  const isPaid = status === "paid";
  return (
    <span
      data-testid="payment-status-badge"
      data-status={status}
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        isPaid
          ? "bg-success text-success-foreground"
          : "bg-destructive text-destructive-foreground",
        className,
      )}
      aria-label={isPaid ? "Pago confirmado" : "Pago pendiente"}
    >
      {isPaid ? "Pagado" : "Pendiente"}
    </span>
  );
}

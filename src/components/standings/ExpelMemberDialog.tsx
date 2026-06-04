"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

import { cn } from "@/utils/utils";

// Modal de confirmación de expulsión (Story 3.3 — AC #4). Implementado como un
// overlay controlado y accesible (role="dialog", aria-modal, Escape, foco en el
// botón de confirmar) en lugar de añadir una dependencia de Radix Dialog: el
// proyecto NO tiene @radix-ui/react-dialog instalado y la story prohíbe agregar
// librerías nuevas.
type ExpelMemberDialogProps = {
  open: boolean;
  memberName: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ExpelMemberDialog({
  open,
  memberName,
  pending,
  onConfirm,
  onCancel,
}: ExpelMemberDialogProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, pending, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-6 backdrop-blur-sm"
      onClick={() => {
        if (!pending) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="expel-dialog-title"
        aria-describedby="expel-dialog-desc"
        className="w-full max-w-xs rounded-md border border-border bg-card p-5 text-card-foreground shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="expel-dialog-title"
          className="flex items-center gap-2 font-display text-lg font-bold text-destructive"
        >
          <AlertTriangle className="size-5" aria-hidden="true" />
          ¿Expulsar miembro?
        </h2>
        <div id="expel-dialog-desc" className="mt-3 space-y-2 text-sm">
          <p>
            ¿Seguro que deseas dar de baja a{" "}
            <strong className="font-semibold">{memberName}</strong> de tu liga?
          </p>
          <p className="text-xs text-muted-foreground">
            Se anularán de forma permanente todos sus pronósticos y duelos
            activos. Esta acción no se puede deshacer.
          </p>
        </div>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="h-12 flex-1 rounded-sm border border-border text-sm font-semibold text-muted-foreground disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={cn(
              "h-12 flex-1 rounded-sm bg-destructive text-sm font-semibold text-destructive-foreground disabled:opacity-50",
            )}
          >
            {pending ? "Dando de baja…" : "Dar de baja"}
          </button>
        </div>
      </div>
    </div>
  );
}

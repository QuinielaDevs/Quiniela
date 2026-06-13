"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

// Modal de doble verificación para ABANDONAR una liga. Verificación 1: abrir el
// modal desde el botón. Verificación 2: marcar la casilla de consentimiento que
// habilita el botón destructivo. Sigue el patrón de overlay accesible del
// proyecto (role="dialog", aria-modal, Escape, foco inicial).
type LeaveLeagueDialogProps = {
  open: boolean;
  leagueName: string;
  pending: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function LeaveLeagueDialog({
  open,
  leagueName,
  pending,
  error = null,
  onConfirm,
  onCancel,
}: LeaveLeagueDialogProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  // Reinicia el consentimiento cada vez que se abre el modal.
  useEffect(() => {
    if (open) setAcknowledged(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
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
        aria-labelledby="leave-dialog-title"
        aria-describedby="leave-dialog-desc"
        data-testid="leave-league-dialog"
        className="w-full max-w-sm rounded-md border border-border bg-card p-5 text-card-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="leave-dialog-title"
          className="flex items-center gap-2 font-display text-lg font-bold text-destructive"
        >
          <AlertTriangle className="size-5" aria-hidden="true" />
          ¿Abandonar {leagueName}?
        </h2>

        <div id="leave-dialog-desc" className="mt-3 space-y-2 text-sm">
          <p>
            Vas a salir de la liga{" "}
            <strong className="font-semibold">{leagueName}</strong>.
          </p>
          <p className="text-xs text-muted-foreground">
            Se eliminarán de forma permanente tus pronósticos, puntos, medallas y
            duelos en esta liga. Esta acción no se puede deshacer; para volver
            necesitarás un nuevo código de invitación.
          </p>
        </div>

        <label className="mt-4 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            disabled={pending}
            className="mt-0.5 size-4 shrink-0"
          />
          <span>
            Entiendo que perderé todo mi progreso en esta liga de forma
            permanente.
          </span>
        </label>

        {error && (
          <p
            className="mt-3 rounded-sm border border-destructive/70 bg-destructive/10 p-2 text-xs text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="h-12 flex-1 rounded-sm border border-border text-sm font-semibold text-muted-foreground disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending || !acknowledged}
            data-testid="leave-league-confirm"
            className="h-12 flex-1 rounded-sm bg-destructive text-sm font-semibold text-destructive-foreground disabled:opacity-50"
          >
            {pending ? "Saliendo…" : "Abandonar liga"}
          </button>
        </div>
      </div>
    </div>
  );
}

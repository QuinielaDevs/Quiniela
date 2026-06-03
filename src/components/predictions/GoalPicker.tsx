"use client";

import { Minus, Plus } from "lucide-react";

import { cn } from "@/utils/utils";

interface GoalPickerProps {
  /** Marcador actual. El componente es CONTROLADO: no guarda estado propio. */
  value: number;
  /** Se invoca con el nuevo marcador ya clampado a [min, max]. */
  onChange: (next: number) => void;
  /** Nombre del equipo; alimenta los aria-label de los botones. */
  label: string;
  /** Inhabilita ambos botones (Story 2.4 lo activa con el bloqueo de kickoff). */
  disabled?: boolean;
  /** Mínimo permitido. Default 0 (la DB exige `home/away_score_pred >= 0`). */
  min?: number;
  /** Máximo opcional. Sin tope por defecto; clamp solo en `min`. */
  max?: number;
}

// Control táctil +/- de un marcador (UX-DR-4). El número se muestra en un <span>
// NO editable y el ajuste es 100% por botones: así NUNCA se dispara el teclado
// nativo del móvil (FR-7 / AC #2). Reutilizable dos veces por MatchCard (2.3).
//
// Tamaño táctil 48x48px (h-12 w-12) por UX-DR-4/UX-DR-10 — supera los 32px del
// mockup, que no es autoritativo en medidas (EXPERIENCE.md › Conflict Resolution).
const STEPPER_BUTTON_CLASSES =
  "flex h-12 w-12 items-center justify-center rounded-sm border border-border bg-background text-accent transition-transform touch-manipulation select-none [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-90 active:bg-border disabled:pointer-events-none disabled:opacity-30";

export function GoalPicker({
  value,
  onChange,
  label,
  disabled = false,
  min = 0,
  max,
}: GoalPickerProps) {
  const canDecrement = !disabled && value > min;
  const canIncrement = !disabled && (max === undefined || value < max);

  function decrement() {
    if (!canDecrement) return;
    onChange(value - 1);
  }

  function increment() {
    if (!canIncrement) return;
    onChange(value + 1);
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={decrement}
        disabled={!canDecrement}
        aria-label={`Disminuir goles de ${label}`}
        className={cn(STEPPER_BUTTON_CLASSES)}
      >
        <Minus className="size-5" aria-hidden="true" />
      </button>

      <span
        className="min-w-6 text-center font-display text-2xl font-extrabold tabular-nums text-foreground"
        aria-live="polite"
      >
        {value}
      </span>

      <button
        type="button"
        onClick={increment}
        disabled={!canIncrement}
        aria-label={`Incrementar goles de ${label}`}
        className={cn(STEPPER_BUTTON_CLASSES)}
      >
        <Plus className="size-5" aria-hidden="true" />
      </button>
    </div>
  );
}

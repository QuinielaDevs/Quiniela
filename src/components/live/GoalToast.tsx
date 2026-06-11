"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";

import { cn } from "@/utils/utils";

export type GoalToastModel = {
  id: string;
  message: string;
};

/** Toasts simultáneos máximos en pantalla; el exceso descarta los más viejos. */
export const MAX_VISIBLE_TOASTS = 3;
const AUTO_DISMISS_MS = 5500;
const SWIPE_DISMISS_THRESHOLD_PX = 64;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type GoalToastProps = {
  toast: GoalToastModel;
  onDismiss: (id: string) => void;
};

function GoalToast({ toast, onDismiss }: GoalToastProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const isScrollingRef = useRef<boolean>(false);
  const activePointerRef = useRef<number | null>(null);
  const reduceMotion = prefersReducedMotion();

  useEffect(() => {
    const timeout = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timeout);
  }, [toast.id, onDismiss]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // BUG-005: si el gesto empieza sobre el botón de descarte, no iniciar el
    // swipe ni capturar el puntero — la captura redirige el pointerup al
    // contenedor y el navegador nunca dispara el click del botón.
    if ((event.target as HTMLElement).closest("button")) return;
    // Multi-touch: si ya hay un swipe en curso, ignorar punteros adicionales
    // para no sobreescribir el origen del gesto.
    if (startXRef.current !== null) return;
    startXRef.current = event.clientX;
    startYRef.current = event.clientY;
    isScrollingRef.current = false;
    activePointerRef.current = event.pointerId;
    setDragging(true);
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // jsdom y algunos navegadores antiguos no implementan pointer capture.
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (startXRef.current === null || event.pointerId !== activePointerRef.current) {
      return;
    }
    if (isScrollingRef.current) return;

    const dx = event.clientX - startXRef.current;
    const dy = event.clientY - (startYRef.current ?? event.clientY);

    // Si hay movimiento suficiente, resolvemos el eje dominante
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > 5) {
      if (Math.abs(dy) > Math.abs(dx)) {
        isScrollingRef.current = true;
        setOffsetX(0);
        setDragging(false);
        return;
      }
    }

    setOffsetX(dx);
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (startXRef.current === null || event.pointerId !== activePointerRef.current) {
      return;
    }
    const delta = event.clientX - startXRef.current;
    const isScroll = isScrollingRef.current;

    startXRef.current = null;
    startYRef.current = null;
    isScrollingRef.current = false;
    activePointerRef.current = null;
    setDragging(false);

    if (!isScroll && Math.abs(delta) >= SWIPE_DISMISS_THRESHOLD_PX) {
      onDismiss(toast.id);
      return;
    }
    setOffsetX(0);
  };

  return (
    <div
      data-testid="goal-toast"
      className={cn(
        "pointer-events-auto flex touch-pan-y select-none items-center gap-3 rounded-md border border-accent bg-card px-4 py-3 text-sm text-foreground shadow-lg",
        !dragging && !reduceMotion && "transition-transform duration-200",
      )}
      style={reduceMotion ? undefined : { transform: `translateX(${offsetX}px)` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <span className="flex-1 leading-snug">{toast.message}</span>
      <button
        type="button"
        aria-label="Descartar notificación"
        onClick={() => onDismiss(toast.id)}
        className="grid size-12 shrink-0 place-items-center rounded-full text-lg text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

type GoalToastStackProps = {
  toasts: GoalToastModel[];
  onDismiss: (id: string) => void;
};

/**
 * Contenedor flotante superior de los toasts "Impacto de Gol". Región
 * `aria-live` para que los lectores de pantalla anuncien cada gol sin robar
 * foco. `pointer-events-none` en el contenedor para no bloquear la tabla; cada
 * toast reactiva sus propios eventos.
 */
export function GoalToastStack({ toasts, onDismiss }: GoalToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      data-testid="goal-toast-stack"
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 top-2 z-50 mx-auto flex w-full max-w-md flex-col gap-2 px-4"
    >
      {toasts.map((toast) => (
        <GoalToast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

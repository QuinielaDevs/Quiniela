import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GoalToastStack, type GoalToastModel } from "@/components/live/GoalToast";

const toasts: GoalToastModel[] = [
  { id: "t1", message: "¡Gol de Argentina! Ana sube al 1er puesto proyectado 🎉" },
];

describe("GoalToastStack", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("no renderiza nada sin toasts", () => {
    render(<GoalToastStack toasts={[]} onDismiss={() => {}} />);
    expect(screen.queryByTestId("goal-toast-stack")).not.toBeInTheDocument();
  });

  it("muestra el mensaje en una región aria-live", () => {
    render(<GoalToastStack toasts={toasts} onDismiss={() => {}} />);
    const stack = screen.getByTestId("goal-toast-stack");
    expect(stack).toHaveAttribute("aria-live", "polite");
    expect(
      screen.getByText("¡Gol de Argentina! Ana sube al 1er puesto proyectado 🎉"),
    ).toBeInTheDocument();
  });

  it("descarta con el botón cerrar", () => {
    const onDismiss = vi.fn();
    render(<GoalToastStack toasts={toasts} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText("Descartar notificación"));
    expect(onDismiss).toHaveBeenCalledWith("t1");
  });

  it("descarta por swipe horizontal sobre el umbral", () => {
    const onDismiss = vi.fn();
    render(<GoalToastStack toasts={toasts} onDismiss={onDismiss} />);
    const toast = screen.getByTestId("goal-toast");
    fireEvent.pointerDown(toast, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(toast, { clientX: 120, pointerId: 1 });
    fireEvent.pointerUp(toast, { clientX: 120, pointerId: 1 });
    expect(onDismiss).toHaveBeenCalledWith("t1");
  });

  it("ignora un segundo puntero (multi-touch) durante el swipe", () => {
    const onDismiss = vi.fn();
    render(<GoalToastStack toasts={toasts} onDismiss={onDismiss} />);
    const toast = screen.getByTestId("goal-toast");
    fireEvent.pointerDown(toast, { clientX: 0, pointerId: 1 });
    // Segundo dedo: debe ignorarse por completo (no sobreescribe el origen).
    fireEvent.pointerDown(toast, { clientX: 200, pointerId: 2 });
    fireEvent.pointerMove(toast, { clientX: 200, pointerId: 2 });
    fireEvent.pointerUp(toast, { clientX: 200, pointerId: 2 });
    expect(onDismiss).not.toHaveBeenCalled();
    // El puntero original con poco desplazamiento tampoco descarta.
    fireEvent.pointerUp(toast, { clientX: 10, pointerId: 1 });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("no descarta si el swipe no alcanza el umbral", () => {
    const onDismiss = vi.fn();
    render(<GoalToastStack toasts={toasts} onDismiss={onDismiss} />);
    const toast = screen.getByTestId("goal-toast");
    fireEvent.pointerDown(toast, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(toast, { clientX: 20, pointerId: 1 });
    fireEvent.pointerUp(toast, { clientX: 20, pointerId: 1 });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("auto-cierra tras el timeout", () => {
    const onDismiss = vi.fn();
    render(<GoalToastStack toasts={toasts} onDismiss={onDismiss} />);
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(onDismiss).toHaveBeenCalledWith("t1");
  });
});

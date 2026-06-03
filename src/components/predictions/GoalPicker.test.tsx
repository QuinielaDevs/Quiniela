import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GoalPicker } from "@/components/predictions/GoalPicker";

// Arnés controlado: el GoalPicker no guarda el marcador, lo hace el padre.
// Reproduce cómo lo usará MatchCard (Story 2.3) y permite testear clicks
// encadenados (incremento doble) además de espiar el onChange.
function ControlledHarness({
  initial = 0,
  label = "Argentina",
  disabled = false,
  min,
  max,
  onChangeSpy,
}: {
  initial?: number;
  label?: string;
  disabled?: boolean;
  min?: number;
  max?: number;
  onChangeSpy?: (next: number) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <GoalPicker
      value={value}
      onChange={(next) => {
        onChangeSpy?.(next);
        setValue(next);
      }}
      label={label}
      disabled={disabled}
      min={min}
      max={max}
    />
  );
}

describe("GoalPicker", () => {
  beforeEach(() => {
    cleanup();
  });

  it("incrementa el marcador de 1 en 1 al pulsar +", async () => {
    const onChange = vi.fn();
    render(<ControlledHarness initial={1} onChangeSpy={onChange} />);

    await userEvent.click(
      screen.getByLabelText("Incrementar goles de Argentina"),
    );

    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it("decrementa el marcador de 1 en 1 al pulsar −", async () => {
    const onChange = vi.fn();
    render(<ControlledHarness initial={2} onChangeSpy={onChange} />);

    await userEvent.click(
      screen.getByLabelText("Disminuir goles de Argentina"),
    );

    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("refleja el valor controlado en pantalla tras dos incrementos", async () => {
    render(<ControlledHarness initial={0} />);
    const plus = screen.getByLabelText("Incrementar goles de Argentina");

    await userEvent.click(plus);
    await userEvent.click(plus);

    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("hace clamp en 0: estando en 0 el botón − no dispara cambios", async () => {
    const onChange = vi.fn();
    render(<ControlledHarness initial={0} onChangeSpy={onChange} />);

    const minus = screen.getByLabelText("Disminuir goles de Argentina");
    expect(minus).toBeDisabled();

    await userEvent.click(minus);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("respeta el máximo opcional: en el tope el botón + se inhabilita", async () => {
    const onChange = vi.fn();
    render(<ControlledHarness initial={9} max={9} onChangeSpy={onChange} />);

    const plus = screen.getByLabelText("Incrementar goles de Argentina");
    expect(plus).toBeDisabled();

    await userEvent.click(plus);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("cuando disabled, ningún botón dispara cambios", async () => {
    const onChange = vi.fn();
    render(<ControlledHarness initial={1} disabled onChangeSpy={onChange} />);

    await userEvent.click(
      screen.getByLabelText("Incrementar goles de Argentina"),
    );
    await userEvent.click(
      screen.getByLabelText("Disminuir goles de Argentina"),
    );

    expect(onChange).not.toHaveBeenCalled();
  });

  it("no expone ningún campo editable (anti-teclado nativo): solo botones", () => {
    render(<ControlledHarness initial={0} />);

    // El contrato clave de la AC #2: el marcador NO es un input/textbox/spinbutton,
    // así nunca se abre el teclado táctil. Los controles son <button>.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(document.querySelector("input")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("expone aria-labels descriptivos por equipo", () => {
    render(<ControlledHarness initial={0} label="Francia" />);

    expect(
      screen.getByLabelText("Incrementar goles de Francia"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Disminuir goles de Francia"),
    ).toBeInTheDocument();
  });

  it("los botones tienen el tamaño táctil de 48px (h-12 w-12)", () => {
    render(<ControlledHarness initial={0} />);

    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toContain("h-12");
      expect(button.className).toContain("w-12");
    }
  });

  it("respeta un min distinto de 0: en el mínimo el botón − se inhabilita", async () => {
    const onChange = vi.fn();
    render(<ControlledHarness initial={3} min={3} onChangeSpy={onChange} />);

    const minus = screen.getByLabelText("Disminuir goles de Argentina");
    expect(minus).toBeDisabled();

    await userEvent.click(minus);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renderiza marcadores de varios dígitos sin recortar (ancho flexible)", () => {
    render(<ControlledHarness initial={10} />);

    const score = screen.getByText("10");
    expect(score).toBeInTheDocument();
    // El ancho es mínimo-flexible (min-w), no fijo, para no recortar 2+ dígitos.
    expect(score.className).toContain("min-w-6");
    expect(score.className).not.toContain(" w-6");
  });
});

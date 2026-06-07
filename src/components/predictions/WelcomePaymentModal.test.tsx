import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { WelcomePaymentModal } from "@/components/predictions/WelcomePaymentModal";

afterEach(() => cleanup());

describe("WelcomePaymentModal", () => {
  it("da la bienvenida, muestra tarifa e instrucciones y enlaza a reglas", () => {
    render(
      <WelcomePaymentModal
        leagueName="Liga Mundialista"
        amount={5}
        instructions="Pago móvil al 0414-1234567"
      />,
    );

    expect(
      screen.getByRole("dialog", { name: /Bienvenido a Liga Mundialista/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Tarifa de inscripción:/)).toBeInTheDocument();
    expect(
      screen.getByText("Pago móvil al 0414-1234567"),
    ).toBeInTheDocument();

    const cta = screen.getByRole("link", { name: "Reglas" });
    expect(cta).toHaveAttribute("href", "/rules");
  });

  it("muestra un texto de respaldo cuando no hay instrucciones", () => {
    render(
      <WelcomePaymentModal
        leagueName="Liga Sin Datos"
        amount={null}
        instructions={null}
      />,
    );

    expect(screen.getByText(/Monto por confirmar/)).toBeInTheDocument();
    expect(
      screen.getByText(/Encuentra las instrucciones de pago/),
    ).toBeInTheDocument();
  });

  it("se puede cerrar con 'Ahora no'", async () => {
    render(
      <WelcomePaymentModal
        leagueName="Liga Mundialista"
        amount={5}
        instructions={null}
      />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ahora no" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

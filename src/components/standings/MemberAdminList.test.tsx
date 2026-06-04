import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemberAdminList, type AdminMemberView } from "./MemberAdminList";

const setMemberPaymentStatus = vi.fn();
const removeMember = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/actions/leagues.actions", () => ({
  setMemberPaymentStatus: (args: unknown) => setMemberPaymentStatus(args),
  removeMember: (args: unknown) => removeMember(args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const MEMBERS: AdminMemberView[] = [
  {
    userId: "admin-1",
    displayName: "Cris",
    avatarUrl: "/a.svg",
    role: "admin",
    paymentStatus: "pending",
  },
  {
    userId: "user-2",
    displayName: "Diego",
    avatarUrl: "/d.svg",
    role: "member",
    paymentStatus: "pending",
  },
  {
    userId: "user-3",
    displayName: "Laura",
    avatarUrl: "/l.svg",
    role: "member",
    paymentStatus: "paid",
  },
];

function renderList() {
  return render(
    <MemberAdminList members={MEMBERS} currentUserId="admin-1" leagueId="L1" />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setMemberPaymentStatus.mockResolvedValue({
    success: true,
    data: {},
    error: null,
  });
  removeMember.mockResolvedValue({ success: true, data: null, error: null });
});

afterEach(() => {
  cleanup();
});

describe("MemberAdminList", () => {
  it("renderiza una fila por miembro", () => {
    renderList();
    expect(screen.getByText("Cris")).toBeInTheDocument();
    expect(screen.getByText("Diego")).toBeInTheDocument();
    expect(screen.getByText("Laura")).toBeInTheDocument();
  });

  it("al tocar el badge de pago dispara setMemberPaymentStatus con el estado alternado", async () => {
    renderList();
    // Diego está 'pending' → al tocar debe pedir 'paid'.
    fireEvent.click(
      screen.getByLabelText(/Pago de Diego: Pendiente/i),
    );
    await waitFor(() =>
      expect(setMemberPaymentStatus).toHaveBeenCalledWith({
        leagueId: "L1",
        userId: "user-2",
        status: "paid",
      }),
    );
  });

  it("no muestra el botón de baja para la fila del propio admin", () => {
    renderList();
    expect(
      screen.queryByLabelText("Dar de baja a Cris"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Dar de baja a Diego")).toBeInTheDocument();
  });

  it("el flujo de baja abre el diálogo y al confirmar llama removeMember", async () => {
    renderList();
    fireEvent.click(screen.getByLabelText("Dar de baja a Diego"));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Se anularán de forma permanente/i),
    ).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Dar de baja" }),
    );

    await waitFor(() =>
      expect(removeMember).toHaveBeenCalledWith({
        leagueId: "L1",
        userId: "user-2",
      }),
    );
    // Tras la baja, la fila desaparece.
    await waitFor(() =>
      expect(screen.queryByText("Diego")).not.toBeInTheDocument(),
    );
  });

  it("muestra el mensaje de error administrativo si la acción falla y revierte el toggle", async () => {
    setMemberPaymentStatus.mockResolvedValue({
      success: false,
      data: null,
      error: "No tienes permisos para realizar esta acción.",
    });
    renderList();

    fireEvent.click(screen.getByLabelText(/Pago de Diego: Pendiente/i));

    await waitFor(() =>
      expect(
        screen.getByText("No tienes permisos para realizar esta acción."),
      ).toBeInTheDocument(),
    );
    // Revertido: Diego sigue mostrando 'Pendiente'.
    expect(screen.getByLabelText(/Pago de Diego: Pendiente/i)).toBeInTheDocument();
  });
});

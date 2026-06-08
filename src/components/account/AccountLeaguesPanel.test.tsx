import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountLeaguesPanel } from "@/components/account/AccountLeaguesPanel";
import { leaveLeague, setActiveLeague } from "@/app/actions/leagues.actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));
vi.mock("@/app/actions/leagues.actions", () => ({
  leaveLeague: vi.fn(),
  setActiveLeague: vi.fn(),
}));

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
  writeText.mockReset();
  refresh.mockReset();
  vi.mocked(leaveLeague).mockReset();
  vi.mocked(setActiveLeague).mockReset();
});

const SINGLE_LEAGUE = [
  {
    leagueId: "league-1",
    leagueName: "Liga Principal",
    inviteCode: "ABCDN234",
    role: "member" as const,
    paymentStatus: "paid" as const,
    joinedAt: "2026-06-05T12:00:00.000Z",
    wagerBalance: 12.5,
    requiresPayment: true,
    isCurrent: true,
  },
];

describe("AccountLeaguesPanel", () => {
  it("muestra liga actual y ligas donde participa", async () => {
    render(
      <AccountLeaguesPanel
        leagues={[
          {
            leagueId: "league-1",
            leagueName: "Liga Principal",
            inviteCode: "ABCDN234",
            role: "admin",
            paymentStatus: "paid",
            joinedAt: "2026-06-05T12:00:00.000Z",
            wagerBalance: 12.5,
            requiresPayment: true,
            isCurrent: true,
          },
          {
            leagueId: "league-2",
            leagueName: "Liga Amigos",
            inviteCode: "WXYZ9876",
            role: "member",
            paymentStatus: "pending",
            joinedAt: "2026-06-01T12:00:00.000Z",
            wagerBalance: 4,
            requiresPayment: false,
            isCurrent: false,
          },
        ]}
      />,
    );

    expect(screen.getAllByRole("heading", { name: "Liga Principal" })).toHaveLength(2);
    expect(screen.getByText("Estás jugando en 2 ligas.")).toBeInTheDocument();
    expect(screen.getByText("Liga actual")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Miembro")).toBeInTheDocument();
    expect(screen.getByText("Pago al día")).toBeInTheDocument();
    expect(screen.getByText("Sin pago requerido")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /crear liga/i })).toBeNull();
    expect(screen.getByText("ABCDN234")).toBeInTheDocument();
    expect(screen.getByText("WXYZ9876")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Usar Liga Amigos como liga actual",
      }),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", {
        name: "Copiar código de invitación de Liga Principal",
      }),
    );

    expect(writeText).toHaveBeenCalledWith("ABCDN234");
    expect(
      screen.getByRole("button", {
        name: "Código de invitación de Liga Principal copiado",
      }),
    ).toBeInTheDocument();
  });

  it("permite cambiar la liga activa desde la lista", async () => {
    vi.mocked(setActiveLeague).mockResolvedValue({
      success: true,
      data: null,
      error: null,
    });

    render(
      <AccountLeaguesPanel
        leagues={[
          {
            leagueId: "league-1",
            leagueName: "Liga Principal",
            inviteCode: "ABCDN234",
            role: "admin",
            paymentStatus: "paid",
            joinedAt: "2026-06-05T12:00:00.000Z",
            wagerBalance: 12.5,
            requiresPayment: true,
            isCurrent: true,
          },
          {
            leagueId: "league-2",
            leagueName: "Liga Amigos",
            inviteCode: "WXYZ9876",
            role: "member",
            paymentStatus: "pending",
            joinedAt: "2026-06-01T12:00:00.000Z",
            wagerBalance: 4,
            requiresPayment: false,
            isCurrent: false,
          },
        ]}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: "Usar Liga Amigos como liga actual",
      }),
    );

    expect(setActiveLeague).toHaveBeenCalledWith({ leagueId: "league-2" });
    expect(refresh).toHaveBeenCalled();
  });

  it("copia el enlace de invitación de la liga", async () => {
    render(
      <AccountLeaguesPanel
        leagues={[
          {
            leagueId: "league-1",
            leagueName: "Liga Principal",
            inviteCode: "ABCDN234",
            role: "admin",
            paymentStatus: "paid",
            joinedAt: "2026-06-05T12:00:00.000Z",
            wagerBalance: 12.5,
            requiresPayment: true,
            isCurrent: true,
          },
        ]}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: "Copiar enlace de invitación de Liga Principal",
      }),
    );

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/join/ABCDN234`,
    );
    expect(
      screen.getByRole("button", {
        name: "Enlace de invitación de Liga Principal copiado",
      }),
    ).toBeInTheDocument();
  });

  it("abandona la liga solo tras doble verificación (abrir + consentir)", async () => {
    vi.mocked(leaveLeague).mockResolvedValue({
      success: true,
      data: null,
      error: null,
    });
    render(<AccountLeaguesPanel leagues={SINGLE_LEAGUE} />);

    // Verificación 1: abrir el modal.
    await userEvent.click(
      screen.getByRole("button", { name: "Abandonar la liga Liga Principal" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();

    // El botón destructivo está deshabilitado hasta consentir.
    const confirm = screen.getByRole("button", { name: "Abandonar liga" });
    expect(confirm).toBeDisabled();
    expect(leaveLeague).not.toHaveBeenCalled();

    // Verificación 2: marcar la casilla de consentimiento.
    await userEvent.click(screen.getByRole("checkbox"));
    expect(confirm).toBeEnabled();

    await userEvent.click(confirm);

    expect(leaveLeague).toHaveBeenCalledWith({ leagueId: "league-1" });
    expect(refresh).toHaveBeenCalled();
  });

  it("muestra el error y no cierra el modal si falla la salida", async () => {
    vi.mocked(leaveLeague).mockResolvedValue({
      success: false,
      data: null,
      error: "Eres el único admin de la liga: transfiere la administración antes de salir",
    });
    render(<AccountLeaguesPanel leagues={SINGLE_LEAGUE} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Abandonar la liga Liga Principal" }),
    );
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(
      screen.getByRole("button", { name: "Abandonar liga" }),
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText(/Eres el único admin de la liga/),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

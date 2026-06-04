import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShareProfileButton } from "@/components/account/ShareProfileButton";

const BADGES = [
  { badgeLabel: "Nostradamus", matchday: 1 },
  { badgeLabel: "El Tibio", matchday: 2 },
];

function renderButton() {
  render(
    <ShareProfileButton
      displayName="Ana"
      leagueName="Liga de Ana"
      profileLabel="Optimista"
      badges={BADGES}
    />,
  );
}

describe("ShareProfileButton", () => {
  const originalShare = navigator.share;
  const originalCanShare = navigator.canShare;
  const originalOpen = window.open;

  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "location", {
      value: { href: "https://pijaquiniela.test/account" },
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(navigator, "share", {
      value: originalShare,
      configurable: true,
    });
    Object.defineProperty(navigator, "canShare", {
      value: originalCanShare,
      configurable: true,
    });
    window.open = originalOpen;
  });

  it("comparte archivo PNG si el navegador soporta archivos", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    Object.defineProperty(navigator, "canShare", {
      value: canShare,
      configurable: true,
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: vi.fn(),
      fillText: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      measureText: vi.fn((text: string) => ({ width: text.length * 12 })),
      font: "",
      fillStyle: "",
      textAlign: "",
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["png"], { type: "image/png" }));
    });

    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /compartir perfil/i }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(canShare).toHaveBeenCalledWith({
      files: [expect.any(File)],
    });
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [expect.any(File)],
        text: expect.stringContaining("Optimista"),
      }),
    );
  });

  it("comparte texto si Web Share existe pero no soporta archivos", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    Object.defineProperty(navigator, "canShare", {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
    });

    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /compartir perfil/i }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Nostradamus"),
        url: "https://pijaquiniela.test/account",
      }),
    );
  });

  it("usa Web Share de texto si falla la generación del PNG", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    Object.defineProperty(navigator, "canShare", {
      value: vi.fn().mockReturnValue(true),
      configurable: true,
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      throw new Error("canvas unavailable");
    });

    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /compartir perfil/i }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Optimista"),
        url: "https://pijaquiniela.test/account",
      }),
    );
  });

  it("abre WhatsApp si no hay Web Share disponible", async () => {
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(navigator, "canShare", {
      value: undefined,
      configurable: true,
    });
    const open = vi.fn();
    window.open = open;

    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /compartir perfil/i }));

    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(open.mock.calls[0]?.[0]).toContain("https://wa.me/?text=");
  });

  it("ignora AbortError cuando el usuario cancela compartir", async () => {
    const share = vi.fn().mockRejectedValue(
      new DOMException("Cancelado", "AbortError"),
    );
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    const open = vi.fn();
    window.open = open;

    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /compartir perfil/i }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(open).not.toHaveBeenCalled();
  });
});

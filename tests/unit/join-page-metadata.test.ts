import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const single = vi.fn();

vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc,
    auth: { getClaims: vi.fn() },
  })),
}));

describe("join page metadata", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    rpc.mockReturnValue({ single });
  });

  it("usa datos públicos de la liga para OpenGraph", async () => {
    single.mockResolvedValue({
      data: {
        league_name: "La Pija Quiniela",
        creator_display_name: "Cris",
        invite_code: "ABCDN234",
      },
      error: null,
    });

    const { generateMetadata } = await import(
      "@/app/join/[invite_code]/page"
    );

    const metadata = await generateMetadata({
      params: Promise.resolve({ invite_code: "abcdn234" }),
    });

    expect(metadata.title).toBe("Únete a La Pija Quiniela | PIJA Quiniela");
    expect(metadata.description).toContain("Cris te invita");
    expect(metadata.openGraph).toMatchObject({
      title: "Únete a La Pija Quiniela",
      description: expect.stringContaining("Cris te invita"),
      url: "/join/ABCDN234",
    });
  });

  it("usa metadata genérica para invitación inválida", async () => {
    single.mockResolvedValue({
      data: null,
      error: { message: "Invitación inválida" },
    });

    const { generateMetadata } = await import(
      "@/app/join/[invite_code]/page"
    );

    const metadata = await generateMetadata({
      params: Promise.resolve({ invite_code: "nope9999" }),
    });

    expect(metadata.title).toBe("Únete a PIJA Quiniela");
    expect(metadata.description).toBe(
      "Recibe tu invitación y entra a una quiniela privada del Mundial.",
    );
    expect(metadata.openGraph).toMatchObject({
      title: "Únete a PIJA Quiniela",
      url: "/join/NOPE9999",
    });
  });
});

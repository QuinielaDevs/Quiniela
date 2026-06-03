import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(),
}));

describe("joinLeagueByInvite", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("rechaza códigos vacíos sin llamar a Supabase", async () => {
    const { createClient } = await import("@/utils/supabase/server");
    const { joinLeagueByInvite } = await import(
      "@/app/actions/leagues.actions"
    );

    const result = await joinLeagueByInvite("   ");

    expect(result).toEqual({
      success: false,
      data: null,
      error: "Código de invitación inválido.",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("normaliza el código y llama la RPC de unión", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        id: "member-1",
        league_id: "league-1",
        user_id: "user-1",
        role: "member",
        payment_status: "pending",
        joined_at: "2026-06-02T00:00:00.000Z",
      },
      error: null,
    });
    const { createClient } = await import("@/utils/supabase/server");
    vi.mocked(createClient).mockResolvedValue({ rpc } as never);

    const { joinLeagueByInvite } = await import(
      "@/app/actions/leagues.actions"
    );

    const result = await joinLeagueByInvite(" abcdn234 ");

    expect(rpc).toHaveBeenCalledWith("fn_join_league_by_invite", {
      p_invite_code: "ABCDN234",
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      league_id: "league-1",
      role: "member",
      payment_status: "pending",
    });
    expect(result.error).toBeNull();
  });

  it("mapea errores conocidos de RPC a mensajes seguros", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Invitación inválida", code: "22023" },
    });
    const { createClient } = await import("@/utils/supabase/server");
    vi.mocked(createClient).mockResolvedValue({ rpc } as never);

    const { joinLeagueByInvite } = await import(
      "@/app/actions/leagues.actions"
    );

    const result = await joinLeagueByInvite("ABCDN234");

    expect(result).toEqual({
      success: false,
      data: null,
      error: "Invitación inválida.",
    });
  });

  it("no expone errores internos de RPC al cliente", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        message: "permission denied for table league_members",
        code: "PGRST999",
      },
    });
    const { createClient } = await import("@/utils/supabase/server");
    vi.mocked(createClient).mockResolvedValue({ rpc } as never);

    const { joinLeagueByInvite } = await import(
      "@/app/actions/leagues.actions"
    );

    const result = await joinLeagueByInvite("ABCDN234");

    expect(result).toEqual({
      success: false,
      data: null,
      error: "No pudimos unirte a la liga. Intenta de nuevo.",
    });
  });
});

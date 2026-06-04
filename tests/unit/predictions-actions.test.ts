import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(),
}));

const VALID_INPUT = {
  leagueId: "11111111-1111-4111-8111-111111111111",
  matchId: "22222222-2222-4222-8222-222222222222",
  homeScorePred: 2,
  awayScorePred: 1,
};

const USER_ID = "33333333-3333-4333-8333-333333333333";

const SAVED_PREDICTION = {
  id: "44444444-4444-4444-8444-444444444444",
  league_id: VALID_INPUT.leagueId,
  match_id: VALID_INPUT.matchId,
  user_id: USER_ID,
  home_score_pred: VALID_INPUT.homeScorePred,
  away_score_pred: VALID_INPUT.awayScorePred,
  multiplier: 1.6,
  points_earned: null,
  created_at: "2026-06-03T18:00:00.000Z",
  updated_at: "2026-06-03T18:00:00.000Z",
};

// Mockea supabase.rpc("fn_save_prediction", ...).single() → { data, error }.
function mockRpc(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result);
  const rpc = vi.fn(() => ({ single }));
  return { rpc, single };
}

describe("savePrediction (RPC fn_save_prediction)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("rechaza payload invalido sin llamar a Supabase", async () => {
    const { createClient } = await import("@/utils/supabase/server");
    const { savePrediction } = await import(
      "@/app/actions/predictions.actions"
    );

    const result = await savePrediction({ ...VALID_INPUT, homeScorePred: -1 });

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("guarda via RPC y retorna la fila (con multiplier calculado por el backend)", async () => {
    const { rpc } = mockRpc({ data: SAVED_PREDICTION, error: null });
    const { createClient } = await import("@/utils/supabase/server");
    vi.mocked(createClient).mockResolvedValue({ rpc } as never);
    const { savePrediction } = await import(
      "@/app/actions/predictions.actions"
    );

    const result = await savePrediction(VALID_INPUT);

    expect(rpc).toHaveBeenCalledWith("fn_save_prediction", {
      p_league_id: VALID_INPUT.leagueId,
      p_match_id: VALID_INPUT.matchId,
      p_home_score_pred: 2,
      p_away_score_pred: 1,
    });
    expect(result).toEqual({
      success: true,
      data: SAVED_PREDICTION,
      error: null,
    });
  });

  it("mapea el bloqueo de kickoff (P0001) a un error definitivo no reintentable", async () => {
    const { rpc } = mockRpc({
      data: null,
      error: { code: "P0001", message: "Pronostico cerrado" },
    });
    const { createClient } = await import("@/utils/supabase/server");
    vi.mocked(createClient).mockResolvedValue({ rpc } as never);
    const { savePrediction } = await import(
      "@/app/actions/predictions.actions"
    );
    const { PREDICTION_LOCKED_ERROR } = await import(
      "@/app/actions/predictions.constants"
    );

    const result = await savePrediction(VALID_INPUT);

    expect(result.success).toBe(false);
    expect(result.error).toBe(PREDICTION_LOCKED_ERROR);
  });

  it("normaliza errores de permiso/RLS sin filtrar SQL", async () => {
    const { rpc } = mockRpc({
      data: null,
      error: { code: "42501", message: "permission denied for table predictions" },
    });
    const { createClient } = await import("@/utils/supabase/server");
    vi.mocked(createClient).mockResolvedValue({ rpc } as never);
    const { savePrediction } = await import(
      "@/app/actions/predictions.actions"
    );

    const result = await savePrediction(VALID_INPUT);

    expect(result).toEqual({
      success: false,
      data: null,
      error: "No pudimos guardar tu prediccion. Intenta de nuevo.",
    });
  });

  it("marca errores transitorios de Supabase como reintentables", async () => {
    const { rpc } = mockRpc({
      data: null,
      error: { message: "fetch failed", status: 503 },
    });
    const { createClient } = await import("@/utils/supabase/server");
    vi.mocked(createClient).mockResolvedValue({ rpc } as never);
    const { savePrediction } = await import(
      "@/app/actions/predictions.actions"
    );

    const result = await savePrediction(VALID_INPUT);

    expect(result).toEqual({
      success: false,
      data: null,
      error: "Error al guardar. Reintentando...",
    });
  });

  it("marca excepciones de red como reintentables sin propagarlas", async () => {
    const { createClient } = await import("@/utils/supabase/server");
    vi.mocked(createClient).mockRejectedValue(new TypeError("fetch failed"));
    const { savePrediction } = await import(
      "@/app/actions/predictions.actions"
    );

    const result = await savePrediction(VALID_INPUT);

    expect(result).toEqual({
      success: false,
      data: null,
      error: "Error al guardar. Reintentando...",
    });
  });
});

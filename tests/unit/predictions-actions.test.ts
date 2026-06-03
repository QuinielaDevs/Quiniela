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
  multiplier: 1,
  points_earned: null,
  created_at: "2026-06-03T18:00:00.000Z",
  updated_at: "2026-06-03T18:00:00.000Z",
};

function makeUpdateQuery(result: unknown) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ maybeSingle }));
  const eq = vi.fn(() => ({ eq, select }));
  return {
    update: vi.fn(() => ({ eq })),
    eq,
    select,
    maybeSingle,
  };
}

function makeInsertQuery(result: unknown) {
  const single = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ single }));
  return {
    insert: vi.fn(() => ({ select })),
    select,
    single,
  };
}

describe("savePrediction", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("rechaza payload invalido sin llamar a Supabase", async () => {
    const { createClient } = await import("@/utils/supabase/server");
    const { savePrediction } = await import(
      "@/app/actions/predictions.actions"
    );

    const result = await savePrediction({
      ...VALID_INPUT,
      homeScorePred: -1,
    });

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("retorna error seguro cuando no hay usuario autenticado", async () => {
    const { createClient } = await import("@/utils/supabase/server");
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    } as never);
    const { savePrediction } = await import(
      "@/app/actions/predictions.actions"
    );

    const result = await savePrediction(VALID_INPUT);

    expect(result).toEqual({
      success: false,
      data: null,
      error: "Debes iniciar sesion para guardar tu prediccion.",
    });
  });

  it("actualiza una prediccion existente y retorna la fila guardada", async () => {
    const updateQuery = makeUpdateQuery({
      data: SAVED_PREDICTION,
      error: null,
    });
    const from = vi.fn(() => updateQuery);
    const { createClient } = await import("@/utils/supabase/server");
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        }),
      },
      from,
    } as never);
    const { savePrediction } = await import(
      "@/app/actions/predictions.actions"
    );

    const result = await savePrediction(VALID_INPUT);

    expect(from).toHaveBeenCalledWith("predictions");
    expect(updateQuery.update).toHaveBeenCalledWith({
      home_score_pred: 2,
      away_score_pred: 1,
    });
    expect(updateQuery.eq).toHaveBeenCalledWith("league_id", VALID_INPUT.leagueId);
    expect(updateQuery.eq).toHaveBeenCalledWith("match_id", VALID_INPUT.matchId);
    expect(updateQuery.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(result).toEqual({
      success: true,
      data: SAVED_PREDICTION,
      error: null,
    });
  });

  it("inserta una prediccion si no existe fila previa", async () => {
    const updateQuery = makeUpdateQuery({ data: null, error: null });
    const insertQuery = makeInsertQuery({
      data: SAVED_PREDICTION,
      error: null,
    });
    const from = vi.fn().mockReturnValueOnce(updateQuery).mockReturnValueOnce(insertQuery);
    const { createClient } = await import("@/utils/supabase/server");
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        }),
      },
      from,
    } as never);
    const { savePrediction } = await import(
      "@/app/actions/predictions.actions"
    );

    const result = await savePrediction(VALID_INPUT);

    expect(insertQuery.insert).toHaveBeenCalledWith({
      league_id: VALID_INPUT.leagueId,
      match_id: VALID_INPUT.matchId,
      user_id: USER_ID,
      home_score_pred: 2,
      away_score_pred: 1,
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual(SAVED_PREDICTION);
  });

  it("si el insert choca por unique violation, reintenta update una vez", async () => {
    const firstUpdateQuery = makeUpdateQuery({ data: null, error: null });
    const insertQuery = makeInsertQuery({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    const retryUpdateQuery = makeUpdateQuery({
      data: SAVED_PREDICTION,
      error: null,
    });
    const from = vi
      .fn()
      .mockReturnValueOnce(firstUpdateQuery)
      .mockReturnValueOnce(insertQuery)
      .mockReturnValueOnce(retryUpdateQuery);
    const { createClient } = await import("@/utils/supabase/server");
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        }),
      },
      from,
    } as never);
    const { savePrediction } = await import(
      "@/app/actions/predictions.actions"
    );

    const result = await savePrediction(VALID_INPUT);

    expect(from).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(SAVED_PREDICTION);
  });

  it("normaliza errores internos sin exponer SQL/RLS", async () => {
    const updateQuery = makeUpdateQuery({
      data: null,
      error: { message: "permission denied for table predictions", code: "42501" },
    });
    const from = vi.fn(() => updateQuery);
    const { createClient } = await import("@/utils/supabase/server");
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        }),
      },
      from,
    } as never);
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
    const updateQuery = makeUpdateQuery({
      data: null,
      error: { message: "fetch failed", status: 503 },
    });
    const from = vi.fn(() => updateQuery);
    const { createClient } = await import("@/utils/supabase/server");
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        }),
      },
      from,
    } as never);
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

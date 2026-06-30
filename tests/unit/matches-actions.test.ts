import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/utils/supabase/server", () => ({ createClient }));
vi.mock("next/cache", () => ({ revalidatePath }));

const MATCH_ID = "11111111-1111-4111-8111-111111111111";

function rpcSingle(data: unknown, error: unknown = null) {
  return {
    single: () => Promise.resolve({ data, error }),
  };
}

function matchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ko-73",
    external_ref: "wc2026:ko:73",
    home_team: "Por definir",
    away_team: "Por definir",
    home_team_code: null,
    away_team_code: null,
    home_score: null,
    away_score: null,
    match_time: "2026-06-28T19:00:00.000Z",
    status: "scheduled",
    matchday: null,
    stage: "round-32",
    group_label: null,
    bracket_slot: 73,
    home_source: "2A",
    away_source: "2B",
    venue: "Los Angeles",
    ...overrides,
  };
}

function queryBuilder(data: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "like", "order"]) {
    builder[method] = () => builder;
  }
  builder.then = (
    resolve: (value: { data: unknown; error: unknown }) => unknown,
  ) => resolve({ data, error });
  return builder;
}

describe("matches.actions (Story 7.3 integration)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("setMatchResult recalcula el bracket y revalida superficies dependientes", async () => {
    const rpc = vi.fn((name: string) => {
      if (name === "fn_admin_set_match_result") {
        return rpcSingle(matchRow({ id: MATCH_ID, status: "finished" }));
      }
      if (name === "fn_admin_apply_knockout_advancement") {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: null, error: { code: "PGRST202" } });
    });
    const from = vi.fn(() => queryBuilder([matchRow()]));
    createClient.mockResolvedValue({ rpc, from });

    const { setMatchResult } = await import("@/app/actions/matches.actions");
    const result = await setMatchResult({
      matchId: MATCH_ID,
      homeScore: 2,
      awayScore: 1,
      status: "finished",
    });

    expect(result.success).toBe(true);
    expect(rpc).toHaveBeenCalledWith("fn_admin_set_match_result", {
      p_match_id: MATCH_ID,
      p_home_score: 2,
      p_away_score: 1,
      p_status: "finished",
      p_penalties_home_score: null,
      p_penalties_away_score: null,
      p_extra_time_home_score: null,
      p_extra_time_away_score: null,
    });
    expect(rpc).toHaveBeenCalledWith(
      "fn_admin_apply_knockout_advancement",
      expect.objectContaining({ p_slots: expect.any(Array) }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/standings");
    expect(revalidatePath).toHaveBeenCalledWith("/standings/manage");
    expect(revalidatePath).toHaveBeenCalledWith("/predictions");
    expect(revalidatePath).toHaveBeenCalledWith("/live");
  });

  it("setMatchResult conserva éxito del guardado si falla el recálculo de avance", async () => {
    const rpc = vi.fn((name: string) => {
      if (name === "fn_admin_set_match_result") {
        return rpcSingle(matchRow({ id: MATCH_ID, status: "finished" }));
      }
      if (name === "fn_admin_apply_knockout_advancement") {
        return Promise.resolve({ data: null, error: { code: "XX000" } });
      }
      return Promise.resolve({ data: null, error: { code: "PGRST202" } });
    });
    const from = vi.fn(() => queryBuilder([matchRow()]));
    createClient.mockResolvedValue({ rpc, from });

    const { setMatchResult } = await import("@/app/actions/matches.actions");
    const result = await setMatchResult({
      matchId: MATCH_ID,
      homeScore: 2,
      awayScore: 1,
      status: "finished",
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(result.warning).toContain("Resultado guardado");
    expect(revalidatePath).toHaveBeenCalledWith("/standings");
    expect(revalidatePath).toHaveBeenCalledWith("/standings/manage");
    expect(revalidatePath).toHaveBeenCalledWith("/predictions");
    expect(revalidatePath).toHaveBeenCalledWith("/live");
  });
});

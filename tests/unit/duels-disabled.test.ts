import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// Mock Supabase client so server actions imports do not throw errors
vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(),
}));

describe("Duelos Deshabilitados (Feature Flag)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("bloquea las server actions de duelos cuando el feature flag es false", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DUELS", "false");
    const { createChallenge, acceptChallenge, rejectChallenge, cancelChallenge } = await import(
      "@/app/actions/duels.actions"
    );

    // Inputs dummy para pasar Zod schema parse
    const dummyCreateInput = {
      leagueId: "00000000-0000-0000-0000-000000000000",
      matchId: "00000000-0000-0000-0000-000000000000",
      pointsBet: 10,
      type: "direct" as const,
      challengedId: "11111111-1111-1111-1111-111111111111",
      predictionHome: 2,
      predictionAway: 1,
    };

    const dummyAcceptInput = {
      challengeId: "00000000-0000-0000-0000-000000000000",
      predictionHome: 0,
      predictionAway: 0,
    };

    const dummyIdInput = {
      challengeId: "00000000-0000-0000-0000-000000000000",
    };

    const expectedError = "La funcionalidad de duelos está desactivada temporalmente.";

    const resCreate = await createChallenge(dummyCreateInput);
    expect(resCreate).toEqual({
      success: false,
      data: null,
      error: expectedError,
    });

    const resAccept = await acceptChallenge(dummyAcceptInput);
    expect(resAccept).toEqual({
      success: false,
      data: null,
      error: expectedError,
    });

    const resReject = await rejectChallenge(dummyIdInput);
    expect(resReject).toEqual({
      success: false,
      data: null,
      error: expectedError,
    });

    const resCancel = await cancelChallenge(dummyIdInput);
    expect(resCancel).toEqual({
      success: false,
      data: null,
      error: expectedError,
    });
  });
});

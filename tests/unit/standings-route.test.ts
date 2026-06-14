import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GET } from "../../src/app/api/standings/route";
import { NextRequest } from "next/server";

// Mock buildStandings
vi.mock("@/utils/standings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/standings")>();
  return {
    ...actual,
    buildStandings: vi.fn(() => [
      {
        rank: 1,
        userId: "user-uuid-1",
        displayName: "Test User 1",
        avatarUrl: "/assets/avatars/default-player.svg",
        paymentStatus: "paid",
        totalPoints: 10,
        exactCount: 2,
        resultCount: 0,
        duelPoints: 0,
      },
    ]),
  };
});

// Mock @supabase/supabase-js
const mockEqMembers = vi.fn();
const mockFromMembers = {
  select: vi.fn(() => ({
    eq: mockEqMembers,
  })),
};

const mockEqMatches = vi.fn();
const mockFromMatches = {
  select: vi.fn(() => ({
    eq: mockEqMatches,
  })),
};

const mockInPreds = vi.fn();
const mockEqPreds = vi.fn(() => ({
  in: mockInPreds,
}));
const mockFromPreds = {
  select: vi.fn(() => ({
    eq: mockEqPreds,
  })),
};

const mockRpc = vi.fn();

const mockSupabase = {
  from: vi.fn((table) => {
    if (table === "league_members") return mockFromMembers;
    if (table === "matches") return mockFromMatches;
    if (table === "predictions") return mockFromPreds;
    throw new Error(`Unexpected table: ${table}`);
  }),
  rpc: mockRpc,
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => mockSupabase),
}));

describe("API /api/standings GET handler", () => {
  const originalEnv = process.env;
  const validLeagueId = "e5bc7d0e-5612-42da-9fca-c2d159a60e0a";

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.BOT_SECRET = "bot-secret-token";
    process.env.SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

    mockEqMembers.mockReset();
    mockEqMatches.mockReset();
    mockInPreds.mockReset();
    mockEqPreds.mockClear();
    mockSupabase.from.mockClear();
    mockRpc.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return 500 if BOT_SECRET is not configured", async () => {
    delete process.env.BOT_SECRET;
    const req = new NextRequest(`http://localhost/api/standings?leagueId=${validLeagueId}`, {
      method: "GET",
      headers: { authorization: "Bearer bot-secret-token" },
    });

    const res = await GET(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Internal Server Error");
  });

  it("should return 401 if Authorization header is missing or incorrect", async () => {
    // Missing
    let req = new NextRequest(`http://localhost/api/standings?leagueId=${validLeagueId}`, {
      method: "GET",
    });
    let res = await GET(req);
    expect(res.status).toBe(401);

    // Incorrect
    req = new NextRequest(`http://localhost/api/standings?leagueId=${validLeagueId}`, {
      method: "GET",
      headers: { authorization: "Bearer wrong-token" },
    });
    res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("should return 400 if leagueId parameter is missing", async () => {
    const req = new NextRequest("http://localhost/api/standings", {
      method: "GET",
      headers: { authorization: "Bearer bot-secret-token" },
    });

    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("obligatorio");
  });

  it("should return 400 if leagueId format is not a valid UUID", async () => {
    const req = new NextRequest("http://localhost/api/standings?leagueId=not-a-uuid", {
      method: "GET",
      headers: { authorization: "Bearer bot-secret-token" },
    });

    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("inválido");
  });

  it("should return 404 if league has no members (or does not exist)", async () => {
    mockEqMembers.mockResolvedValue({
      data: [],
      error: null,
    });
    mockEqMatches.mockResolvedValue({
      data: [],
      error: null,
    });
    mockRpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const req = new NextRequest(`http://localhost/api/standings?leagueId=${validLeagueId}`, {
      method: "GET",
      headers: { authorization: "Bearer bot-secret-token" },
    });

    const res = await GET(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("no encontrada");
  });

  it("should return 200 with standings successfully", async () => {
    mockEqMembers.mockResolvedValue({
      data: [
        {
          user_id: "user-uuid-1",
          role: "member",
          payment_status: "paid",
          joined_at: "2026-06-01T00:00:00Z",
          wager_balance: 0.00,
          profiles: {
            display_name: "Test User 1",
            avatar_url: "/assets/avatars/default-player.svg",
          },
        },
      ],
      error: null,
    });

    mockEqMatches.mockResolvedValue({
      data: [
        {
          id: "match-uuid-1",
          status: "finished",
          matchday: 1,
          stage: "group",
          home_score: 2,
          away_score: 1,
        },
      ],
      error: null,
    });

    mockInPreds.mockResolvedValue({
      data: [
        {
          user_id: "user-uuid-1",
          match_id: "match-uuid-1",
          home_score_pred: 2,
          away_score_pred: 1,
          multiplier: 1.00,
        },
      ],
      error: null,
    });

    mockRpc.mockResolvedValue({
      data: [
        {
          user_id: "user-uuid-1",
          duel_points: 0.00,
        },
      ],
      error: null,
    });

    const req = new NextRequest(`http://localhost/api/standings?leagueId=${validLeagueId}`, {
      method: "GET",
      headers: { authorization: "Bearer bot-secret-token" },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=300, stale-while-revalidate=60");
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.standings).toBeInstanceOf(Array);
    expect(body.standings[0].displayName).toBe("Test User 1");
    expect(body.standings[0].rank).toBe(1);

    expect(mockSupabase.from).toHaveBeenCalledWith("league_members");
    expect(mockSupabase.from).toHaveBeenCalledWith("matches");
    expect(mockSupabase.from).toHaveBeenCalledWith("predictions");
    expect(mockSupabase.rpc).toHaveBeenCalledWith("fn_get_league_duel_points", { p_league_id: validLeagueId });
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { POST } from "../../src/app/api/sync/route";
import { NextRequest } from "next/server";

// Mock @supabase/supabase-js
const mockSelect = vi.fn();
const mockUpsert = vi.fn(() => ({
  select: mockSelect,
}));
const mockFrom = vi.fn(() => ({
  upsert: mockUpsert,
}));
const mockSupabase = {
  from: mockFrom,
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => mockSupabase),
}));

describe("API /api/sync POST handler", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.CRON_SECRET = "supersecret";
    process.env.SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "servicekey";
    
    mockUpsert.mockClear();
    mockSelect.mockReset();
    mockFrom.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return 500 if CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const req = new NextRequest("http://localhost/api/sync", {
      method: "POST",
      headers: { authorization: "Bearer supersecret" },
      body: JSON.stringify([]),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("CRON_SECRET");
  });

  it("should return 401 if Authorization header is missing or incorrect", async () => {
    // Missing
    let req = new NextRequest("http://localhost/api/sync", {
      method: "POST",
      body: JSON.stringify([]),
    });
    let res = await POST(req);
    expect(res.status).toBe(401);

    // Incorrect
    req = new NextRequest("http://localhost/api/sync", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
      body: JSON.stringify([]),
    });
    res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("should return 400 if JSON body is invalid", async () => {
    const req = new NextRequest("http://localhost/api/sync", {
      method: "POST",
      headers: { authorization: "Bearer supersecret" },
      body: "not-a-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should return 400 if validation fails (empty or wrong structure)", async () => {
    // Missing match_id and external_ref
    const req = new NextRequest("http://localhost/api/sync", {
      method: "POST",
      headers: { authorization: "Bearer supersecret" },
      body: JSON.stringify([{ status: "scheduled" }]),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Validation failed");
  });

  it("should return 200 and sync matches successfully", async () => {
    mockSelect.mockResolvedValue({ data: [{ id: "uuid-1" }], error: null });

    const payload = [
      {
        match_id: "a3fa80ec-2016-4359-bb99-317139d67568",
        status: "finished",
        home_score: 2,
        away_score: 1,
      },
    ];

    const req = new NextRequest("http://localhost/api/sync", {
      method: "POST",
      headers: { authorization: "Bearer supersecret" },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.updated).toBe(1);

    expect(mockFrom).toHaveBeenCalledWith("matches");
    expect(mockUpsert).toHaveBeenCalled();
  });
});

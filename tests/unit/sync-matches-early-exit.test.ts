import { describe, expect, it, vi, beforeEach } from "vitest";
import { shouldRunSync } from "../../scripts/sync-matches";
import type { SupabaseClient } from "@supabase/supabase-js";

// Mock Supabase client
const mockIn = vi.fn();
const mockSelect = vi.fn(() => ({
  in: mockIn,
}));
const mockFrom = vi.fn(() => ({
  select: mockSelect,
}));
const mockSupabase = {
  from: mockFrom,
} as unknown as SupabaseClient;

describe("shouldRunSync early exit logic", () => {
  beforeEach(() => {
    mockIn.mockReset();
    mockSelect.mockClear();
    mockFrom.mockClear();
  });

  it("should return true during daily full sync window (3:00 AM - 3:10 AM UTC)", async () => {
    // 3:05 AM UTC
    const now = new Date("2026-06-12T03:05:00.000Z");
    const result = await shouldRunSync(mockSupabase, now);
    expect(result).toBe(true);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("should return false when no matches are returned from database", async () => {
    const now = new Date("2026-06-12T12:00:00.000Z");
    mockIn.mockResolvedValue({ data: [], error: null });

    const result = await shouldRunSync(mockSupabase, now);
    expect(result).toBe(false);
    expect(mockFrom).toHaveBeenCalledWith("matches");
    expect(mockSelect).toHaveBeenCalledWith("status, match_time");
    expect(mockIn).toHaveBeenCalledWith("status", ["scheduled", "live"]);
  });

  it("should return true when a match starts in 1 minute (within 2m window)", async () => {
    // Current time: 12:00 UTC, match kickoff: 12:01 UTC
    const now = new Date("2026-06-12T12:00:00.000Z");
    mockIn.mockResolvedValue({
      data: [
        {
          status: "scheduled",
          match_time: "2026-06-12T12:01:00.000Z",
        },
      ],
      error: null,
    });

    const result = await shouldRunSync(mockSupabase, now);
    expect(result).toBe(true);
  });

  it("should return false when a match starts in 5 minutes (outside 2m window)", async () => {
    // Current time: 12:00 UTC, match kickoff: 12:05 UTC
    const now = new Date("2026-06-12T12:00:00.000Z");
    mockIn.mockResolvedValue({
      data: [
        {
          status: "scheduled",
          match_time: "2026-06-12T12:05:00.000Z",
        },
      ],
      error: null,
    });

    const result = await shouldRunSync(mockSupabase, now);
    expect(result).toBe(false);
  });

  it("should return false when a match is live but only started 30 minutes ago (during silence window)", async () => {
    // Current time: 12:30 UTC, match kickoff: 12:00 UTC
    const now = new Date("2026-06-12T12:30:00.000Z");
    mockIn.mockResolvedValue({
      data: [
        {
          status: "live",
          match_time: "2026-06-12T12:00:00.000Z",
        },
      ],
      error: null,
    });

    const result = await shouldRunSync(mockSupabase, now);
    expect(result).toBe(false);
  });

  it("should return false when a match is live but started 100 minutes ago (outside T+120m to T+210m window)", async () => {
    // Current time: 13:40 UTC, match kickoff: 12:00 UTC (100 minutes ago)
    const now = new Date("2026-06-12T13:40:00.000Z");
    mockIn.mockResolvedValue({
      data: [
        {
          status: "live",
          match_time: "2026-06-12T12:00:00.000Z",
        },
      ],
      error: null,
    });

    const result = await shouldRunSync(mockSupabase, now);
    expect(result).toBe(false);
  });

  it("should return true when a match is live and started 120 minutes ago (within T+120m to T+210m window)", async () => {
    // Current time: 14:00 UTC, match kickoff: 12:00 UTC (120 minutes ago)
    const now = new Date("2026-06-12T14:00:00.000Z");
    mockIn.mockResolvedValue({
      data: [
        {
          status: "live",
          match_time: "2026-06-12T12:00:00.000Z",
        },
      ],
      error: null,
    });

    const result = await shouldRunSync(mockSupabase, now);
    expect(result).toBe(true);
  });

  it("should return false when a match started 220 minutes ago (exceeds 210m safety limit)", async () => {
    // Current time: 15:40 UTC, match kickoff: 12:00 UTC (220 minutes ago)
    const now = new Date("2026-06-12T15:40:00.000Z");
    mockIn.mockResolvedValue({
      data: [
        {
          status: "live",
          match_time: "2026-06-12T12:00:00.000Z",
        },
      ],
      error: null,
    });

    const result = await shouldRunSync(mockSupabase, now);
    expect(result).toBe(false);
  });

  it("should return true fallback on database query error", async () => {
    const now = new Date("2026-06-12T12:00:00.000Z");
    mockIn.mockResolvedValue({
      data: null,
      error: { message: "Database failure" },
    });

    const result = await shouldRunSync(mockSupabase, now);
    expect(result).toBe(true);
  });
});

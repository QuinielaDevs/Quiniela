import { describe, expect, it } from "vitest";
import { buildStandings } from "@/utils/standings";
import type { StandingMember } from "@/utils/standings";

describe("buildStandings con special awards", () => {
  const members: StandingMember[] = [
    {
      userId: "u1",
      displayName: "User One",
      avatarUrl: "/img.png",
      paymentStatus: "paid",
      joinedAt: "2026-06-01T12:00:00Z",
      awardPoints: 50,
      duelPoints: 0,
    },
    {
      userId: "u2",
      displayName: "User Two",
      avatarUrl: "/img.png",
      paymentStatus: "paid",
      joinedAt: "2026-06-01T12:00:00Z",
      awardPoints: 25,
      duelPoints: 0,
    },
  ];

  it("suma los awardPoints al totalPoints en la pestaña General", () => {
    const result = buildStandings(members, [], [], "general");
    
    expect(result).toHaveLength(2);
    expect(result[0]!.userId).toBe("u1");
    expect(result[0]!.totalPoints).toBe(50);
    expect(result[0]!.awardPoints).toBe(50);

    expect(result[1]!.userId).toBe("u2");
    expect(result[1]!.totalPoints).toBe(25);
    expect(result[1]!.awardPoints).toBe(25);
  });

  it("no suma los awardPoints en las pestañas de jornadas/fases", () => {
    const result = buildStandings(members, [], [], "jornada-1");
    
    expect(result).toHaveLength(2);
    expect(result[0]!.totalPoints).toBe(0);
    expect(result[0]!.awardPoints).toBe(0);

    expect(result[1]!.totalPoints).toBe(0);
    expect(result[1]!.awardPoints).toBe(0);
  });

  it("usa awardPoints como criterio de desempate", () => {
    const membersWithSameBase: StandingMember[] = [
      {
        userId: "u_low_award",
        displayName: "Low Award",
        avatarUrl: "/img.png",
        paymentStatus: "paid",
        joinedAt: "2026-06-01T12:00:00Z",
        awardPoints: 10,
        duelPoints: 0,
      },
      {
        userId: "u_high_award",
        displayName: "High Award",
        avatarUrl: "/img.png",
        paymentStatus: "paid",
        joinedAt: "2026-06-01T12:00:00Z",
        awardPoints: 25,
        duelPoints: 0,
      },
    ];

    const matches = [
      {
        id: "m1",
        status: "finished",
        matchday: 1,
        homeScore: 1,
        awayScore: 0,
      }
    ];

    const predictions = [
      {
        userId: "u_low_award",
        matchId: "m1",
        homeScorePred: 1,
        awayScorePred: 0,
        multiplier: 1.0,
      },
      {
        userId: "u_high_award",
        matchId: "m1",
        homeScorePred: 1,
        awayScorePred: 0,
        multiplier: 1.0,
      }
    ];

    const generalResult = buildStandings(membersWithSameBase, matches, predictions, "general");
    expect(generalResult[0]!.userId).toBe("u_high_award");
    expect(generalResult[0]!.totalPoints).toBe(30);
    expect(generalResult[1]!.userId).toBe("u_low_award");
    expect(generalResult[1]!.totalPoints).toBe(15);

    const jornadaResult = buildStandings(membersWithSameBase, matches, predictions, "jornada-1");
    expect(jornadaResult[0]!.userId).toBe("u_high_award");
    expect(jornadaResult[1]!.userId).toBe("u_low_award");
  });
});

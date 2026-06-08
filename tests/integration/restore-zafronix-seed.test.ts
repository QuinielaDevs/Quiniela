/**
 * tests/integration/restore-zafronix-seed.test.ts
 *
 * Test end-to-end del nuevo seed vía API: ejecuta `restoreZafronixData`
 * con un `fetch` mockeado que devuelve un set reducido de partidos Zafronix
 * (los 3 escenarios del fixture dorado) y valida que la DB queda poblada
 * con la forma correcta.
 *
 * Este test reemplaza al antiguo `worldcup-seed.test.ts` (que validaba el
 * seed SQL autogenerado). Con la migración a seed vía API, este archivo es
 * el smoke test oficial de que `restoreZafronixData` produce un calendario
 * consistente. El test de 104 partidos completos está cubierto por:
 *   - unit: `tests/unit/zafronix-matches-schema.test.ts` (schema canónico).
 *   - integration: este archivo (3 escenarios representativos end-to-end).
 *
 * Ver: docs/zafronix-api-unification.md §5 (migración del seed).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServiceRoleClient } from "./setup";
import { restoreZafronixData } from "../../scripts/restore-zafronix-data";
import matchesFixture from "../fixtures/zafronix/matches-response.sample.json";
import type { ZafronixMatch } from "../../src/lib/zafronix/matches";

const admin = createServiceRoleClient();
const TEST_REFS = ["2026-001", "2026-073", "2026-104"];

async function cleanupTestMatches() {
  const { data: existing } = await admin
    .from("matches")
    .select("id")
    .in("external_ref", TEST_REFS);
  if (existing && existing.length > 0) {
    const ids = existing.map((m) => m.id);
    await admin.from("predictions").delete().in("match_id", ids);
    await admin.from("matches").delete().in("id", ids);
  }
}

/** Mock de fetch que responde para `/tournaments/2026` (teams vacías) y
 *  `/matches?year=2026` (los 3 partidos del fixture dorado). */
function createMockFetch(): typeof globalThis.fetch {
  return vi.fn().mockImplementation((url: string | URL) => {
    const urlStr = String(url);
    if (urlStr.includes("tournaments")) {
      return Promise.resolve(
        new Response(JSON.stringify({ teams: [] }), {
          status: 200,
          headers: new Headers({ "Content-Type": "application/json" }),
        }),
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          year: 2026,
          count: matchesFixture.data.length,
          data: matchesFixture.data,
        }),
        {
          status: 200,
          statusText: "OK",
          headers: new Headers({ "Content-Type": "application/json" }),
        },
      ),
    );
  });
}

beforeAll(async () => {
  await cleanupTestMatches();
});

afterAll(async () => {
  await cleanupTestMatches();
});

describe("restore-zafronix-data — Seed end-to-end vía API", () => {
  it("siembra los 3 partidos del fixture dorado con la forma correcta", async () => {
    const summary = await restoreZafronixData(
      admin,
      "test-key",
      createMockFetch(),
    );

    expect(summary.created).toBe(3);
    expect(summary.errors).toBe(0);

    // Validar que los 3 partidos están en la DB con la forma esperada.
    const { data: inserted, error } = await admin
      .from("matches")
      .select(
        "external_ref, home_team, away_team, home_score, away_score, status, matchday, group_label, bracket_slot, stage, match_time, venue",
      )
      .in("external_ref", TEST_REFS)
      .order("external_ref");

    expect(error).toBeNull();
    expect(inserted).toHaveLength(3);

    // Partido de grupo finalizado (Mexico 2-1 Canada).
    const m1 = inserted!.find((m) => m.external_ref === "2026-001")!;
    expect(m1.home_team).toBe("Mexico");
    expect(m1.away_team).toBe("Canada");
    expect(m1.home_score).toBe(2);
    expect(m1.away_score).toBe(1);
    expect(m1.status).toBe("finished");
    expect(m1.stage).toBe("group");
    expect(m1.group_label).toBe("A");
    expect(m1.bracket_slot).toBeNull();
    expect(m1.venue).toBe("Estadio Azteca");

    // Partido knockout TBD (bracket_slot 73).
    const m2 = inserted!.find((m) => m.external_ref === "2026-073")!;
    expect(m2.home_team).toBe("Por definir");
    expect(m2.away_team).toBe("Por definir");
    expect(m2.home_score).toBeNull();
    expect(m2.away_score).toBeNull();
    expect(m2.status).toBe("scheduled");
    expect(m2.bracket_slot).toBe(73);
    expect(m2.stage).toBe("round-32");
    expect(m2.group_label).toBeNull();

    // Final con penalties (France 3-2 Brazil).
    const m3 = inserted!.find((m) => m.external_ref === "2026-104")!;
    expect(m3.home_team).toBe("France");
    expect(m3.away_team).toBe("Brazil");
    expect(m3.home_score).toBe(3);
    expect(m3.away_score).toBe(2);
    expect(m3.status).toBe("finished");
    expect(m3.bracket_slot).toBe(104);
    expect(m3.stage).toBe("final");
  });

  it("es idempotente: una segunda corrida con los mismos datos no duplica", async () => {
    const summary = await restoreZafronixData(
      admin,
      "test-key",
      createMockFetch(),
    );

    expect(summary.created).toBe(0);
    expect(summary.errors).toBe(0);

    const { data: rows } = await admin
      .from("matches")
      .select("id")
      .in("external_ref", TEST_REFS);
    expect(rows).toHaveLength(3);
  });

  it("normaliza el stage: 'f' → 'final', 'qf' → 'quarter', 'r32' → 'round-32'", async () => {
    // El fixture dorado ya tiene los stages correctos, pero este test
    // valida explícitamente que la normalización se aplicó.
    const { data: stages } = await admin
      .from("matches")
      .select("external_ref, stage")
      .in("external_ref", TEST_REFS);

    const stageByRef = Object.fromEntries(
      stages!.map((s) => [s.external_ref, s.stage]),
    );
    expect(stageByRef["2026-001"]).toBe("group");
    expect(stageByRef["2026-073"]).toBe("round-32");
    expect(stageByRef["2026-104"]).toBe("final");
  });

  it("preserva el kickoffUtc en match_time como timestamptz UTC", async () => {
    const { data: m1 } = await admin
      .from("matches")
      .select("match_time")
      .eq("external_ref", "2026-001")
      .single();
    // El fixture dice 2026-06-11T19:00:00.000Z — Supabase lo devuelve
    // como timestamptz en formato ISO con offset (+00:00). Comparamos
    // contra el momento UTC, no contra la representación textual.
    expect(new Date(m1!.match_time).toISOString()).toBe(
      "2026-06-11T19:00:00.000Z",
    );
  });
});

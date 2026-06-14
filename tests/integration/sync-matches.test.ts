/**
 * tests/integration/sync-matches.test.ts
 *
 * Pruebas de integración para el script de sincronización periódica de
 * respaldo con ETags (Story 8.2).
 *
 * Cubre:
 *   - Escenario 304 Not Modified: sin cambios ni consumo (AC #5, #6)
 *   - Escenario 200 OK: actualización de partidos y ETag (AC #7, #8)
 *   - Cabeceras correctas: X-API-Key e If-None-Match (AC #2, #3, #4)
 *   - Validación de escenarios de error (4xx, 5xx)
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { createServiceRoleClient } from "./setup";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  syncMatches,
  getStoredETag,
  saveETag,
} from "../../scripts/sync-matches";

// ── Constantes de prueba ────────────────────────────────────────────

const ETAG_CONFIG_KEY = "zafronix_matches_etag";
const TEST_API_KEY = "zwc_test_key_for_integration_tests";
const TEST_ETAG_OLD = '"abc123def456"';
const TEST_ETAG_NEW = '"xyz789uvw012"';

// ── External refs para partidos de prueba de sincronización ─────────

const SYNC_GROUP_REF = "test-sync-2026-grp-A1";
const SYNC_KNOCKOUT_REF = "test-sync-2026-ko-73";
const SYNC_UNCHANGED_REF = "test-sync-2026-grp-A2";

// ── Fixtures ────────────────────────────────────────────────────────

let supabase: SupabaseClient;
let originalETag: string | null = null;

let groupMatchId: string;
let knockoutMatchId: string;
let unchangedMatchId: string;

beforeAll(async () => {
  supabase = createServiceRoleClient();

  // Guardar ETag original para no afectar base de datos de desarrollo
  try {
    const { data } = await supabase
      .from("system_config")
      .select("value")
      .eq("key", ETAG_CONFIG_KEY)
      .maybeSingle();
    originalETag = data?.value ?? null;
  } catch (err) {
    console.warn("No se pudo respaldar el ETag original:", err);
  }

  // Limpiar partidos y ETag de pruebas anteriores
  const testRefs = [SYNC_GROUP_REF, SYNC_KNOCKOUT_REF, SYNC_UNCHANGED_REF];
  const { data: existingMatches } = await supabase
    .from("matches")
    .select("id")
    .in("external_ref", testRefs);
  if (existingMatches && existingMatches.length > 0) {
    const ids = existingMatches.map((m) => m.id);
    await supabase.from("predictions").delete().in("match_id", ids);
  }
  await supabase.from("matches").delete().in("external_ref", testRefs);
  await supabase.from("system_config").delete().eq("key", ETAG_CONFIG_KEY);

  // Crear partidos de prueba
  const { data: groupMatch, error: e1 } = await supabase
    .from("matches")
    .insert({
      external_ref: SYNC_GROUP_REF,
      home_team: "España",
      away_team: "Portugal",
      match_time: "2026-06-11T19:00:00.000Z",
      status: "live",
      home_score: 1,
      away_score: 0,
      matchday: 1,
      stage: "group",
      group_label: "A",
    })
    .select("id")
    .single();
  if (e1) throw e1;
  groupMatchId = groupMatch!.id;

  const { data: knockoutMatch, error: e2 } = await supabase
    .from("matches")
    .insert({
      external_ref: SYNC_KNOCKOUT_REF,
      home_team: "Por definir",
      away_team: "Por definir",
      match_time: "2026-07-10T20:00:00.000Z",
      status: "scheduled",
      home_score: null,
      away_score: null,
      stage: "round-16",
      bracket_slot: 998,
    })
    .select("id")
    .single();
  if (e2) throw e2;
  knockoutMatchId = knockoutMatch!.id;

  const { data: unchangedMatch, error: e3 } = await supabase
    .from("matches")
    .insert({
      external_ref: SYNC_UNCHANGED_REF,
      home_team: "Francia",
      away_team: "Alemania",
      match_time: "2026-06-12T19:00:00.000Z",
      status: "scheduled",
      home_score: null,
      away_score: null,
      matchday: 2,
      stage: "group",
      group_label: "A",
    })
    .select("id")
    .single();
  if (e3) throw e3;
  unchangedMatchId = unchangedMatch!.id;
});

afterAll(async () => {
  if (supabase) {
    const testRefs = [SYNC_GROUP_REF, SYNC_KNOCKOUT_REF, SYNC_UNCHANGED_REF];
    const { data: existingMatches } = await supabase
      .from("matches")
      .select("id")
      .in("external_ref", testRefs);
    if (existingMatches && existingMatches.length > 0) {
      const ids = existingMatches.map((m) => m.id);
      await supabase.from("predictions").delete().in("match_id", ids);
    }
    await supabase.from("matches").delete().in("external_ref", testRefs);

    // Restaurar ETag original
    if (originalETag !== null) {
      await supabase.from("system_config").upsert({
        key: ETAG_CONFIG_KEY,
        value: originalETag,
        description: "ETag de la última respuesta 200 de Zafronix matches API",
      });
    } else {
      await supabase.from("system_config").delete().eq("key", ETAG_CONFIG_KEY);
    }
  }
});

// ── Helpers de mocking ──────────────────────────────────────────────

/**
 * Crea un mock de fetch que responde con 304 Not Modified.
 */
function createMock304(): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue(
    new Response(null, {
      status: 304,
      statusText: "Not Modified",
    }),
  );
}

/**
 * Crea un mock de fetch que responde con 200 OK y un objeto envoltorio con el array de partidos.
 */
function createMock200(
  matches: object[],
  etag: string = TEST_ETAG_NEW,
): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ year: 2026, count: matches.length, data: matches }), {
      status: 200,
      statusText: "OK",
      headers: new Headers({
        "Content-Type": "application/json",
        etag: etag,
      }),
    }),
  );
}

/**
 * Crea un mock de fetch que responde con un error HTTP.
 */
function createMockError(
  status: number,
  statusText: string,
  body: string = "",
): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue(
    new Response(body, { status, statusText }),
  );
}

// ── Tests ───────────────────────────────────────────────────────────

describe("sync-matches — Sincronización de Respaldo con ETags", () => {
  // ── ETag helpers ────────────────────────────────────────────────

  describe("getStoredETag / saveETag", () => {
    beforeEach(async () => {
      await supabase.from("system_config").delete().eq("key", ETAG_CONFIG_KEY);
    });

    it("retorna null cuando no existe ETag almacenado", async () => {
      const etag = await getStoredETag(supabase);
      expect(etag).toBeNull();
    });

    it("guarda y recupera un ETag correctamente", async () => {
      await saveETag(supabase, TEST_ETAG_OLD);
      const etag = await getStoredETag(supabase);
      expect(etag).toBe(TEST_ETAG_OLD);
    });

    it("actualiza un ETag existente con upsert", async () => {
      await saveETag(supabase, TEST_ETAG_OLD);
      await saveETag(supabase, TEST_ETAG_NEW);
      const etag = await getStoredETag(supabase);
      expect(etag).toBe(TEST_ETAG_NEW);
    });
  });

  // ── Escenario 304 Not Modified (AC #5, #6) ─────────────────────

  describe("304 Not Modified (AC #5, #6)", () => {
    beforeEach(async () => {
      // Insertar un ETag previo en la base de datos
      await supabase.from("system_config").delete().eq("key", ETAG_CONFIG_KEY);
      await saveETag(supabase, TEST_ETAG_OLD);

      // Resetear partido de grupo a estado live
      await supabase
        .from("matches")
        .update({ status: "live", home_score: 1, away_score: 0 })
        .eq("id", groupMatchId);
    });

    it("no realiza actualizaciones cuando la API responde 304", async () => {
      const mockFetch = createMock304();

      const result = await syncMatches(supabase, TEST_API_KEY, mockFetch);

      expect(result).toEqual({ status: "not_modified", changes: [] });

      // Verificar que no se modificaron los partidos
      const { data: match } = await supabase
        .from("matches")
        .select("home_score, away_score, status")
        .eq("id", groupMatchId)
        .single();
      expect(match!.home_score).toBe(1);
      expect(match!.away_score).toBe(0);
      expect(match!.status).toBe("live");
    });

    it("no modifica el ETag almacenado cuando responde 304", async () => {
      const mockFetch = createMock304();
      await syncMatches(supabase, TEST_API_KEY, mockFetch);

      const etag = await getStoredETag(supabase);
      expect(etag).toBe(TEST_ETAG_OLD);
    });

    it("envía las cabeceras X-API-Key e If-None-Match correctamente", async () => {
      const mockFetch = createMock304();
      await syncMatches(supabase, TEST_API_KEY, mockFetch);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        { headers: Record<string, string> },
      ];

      expect(url).toBe(
        "https://api.zafronix.com/fifa/worldcup/v1/matches?year=2026",
      );
      expect(opts.headers["X-API-Key"]).toBe(TEST_API_KEY);
      expect(opts.headers["If-None-Match"]).toBe(TEST_ETAG_OLD);
    });
  });

  // ── Escenario 200 OK (AC #7, #8) ──────────────────────────────

  describe("200 OK — Actualización de partidos (AC #7, #8)", () => {
    beforeEach(async () => {
      // Resetear ETag
      await supabase.from("system_config").delete().eq("key", ETAG_CONFIG_KEY);
      await saveETag(supabase, TEST_ETAG_OLD);

      // Resetear partidos a estado original
      await supabase
        .from("matches")
        .update({
          status: "live",
          home_score: 1,
          away_score: 0,
        })
        .eq("id", groupMatchId);

      await supabase
        .from("matches")
        .update({
          status: "scheduled",
          home_score: null,
          away_score: null,
          home_team: "Por definir",
          away_team: "Por definir",
        })
        .eq("id", knockoutMatchId);

      await supabase
        .from("matches")
        .update({
          status: "scheduled",
          home_score: null,
          away_score: null,
        })
        .eq("id", unchangedMatchId);
    });

    it("actualiza marcadores y status de partidos que cambiaron", async () => {
      const apiMatches = [
        {
          id: SYNC_GROUP_REF,
          homeTeam: "España",
          awayTeam: "Portugal",
          homeScore: 2,
          awayScore: 1,
          result: "2-1",
          matchNo: 1,
          kickoffUtc: "2026-06-11T19:00:00.000Z",
        },
        {
          id: SYNC_UNCHANGED_REF,
          homeTeam: "Francia",
          awayTeam: "Alemania",
          homeScore: null,
          awayScore: null,
          result: null,
          matchNo: 2,
          kickoffUtc: "2026-06-12T19:00:00.000Z",
        },
      ];
      const mockFetch = createMock200(apiMatches);

      const result = await syncMatches(supabase, TEST_API_KEY, mockFetch);

      expect(result).toEqual({
        status: "updated",
        updated: 1,
        changes: [
          {
            id: groupMatchId,
            home_team: "España",
            away_team: "Portugal",
            changes: {
              home_score: { from: 1, to: 2 },
              away_score: { from: 0, to: 1 },
              status: { from: "live", to: "finished" },
            },
          },
        ],
      });

      // Verificar que el partido de grupo se actualizó
      const { data: updatedMatch } = await supabase
        .from("matches")
        .select("home_score, away_score, status")
        .eq("id", groupMatchId)
        .single();
      expect(updatedMatch!.home_score).toBe(2);
      expect(updatedMatch!.away_score).toBe(1);
      expect(updatedMatch!.status).toBe("finished");

      // Verificar que el partido sin cambios NO fue modificado
      const { data: unchangedMatch } = await supabase
        .from("matches")
        .select("home_score, away_score, status")
        .eq("id", unchangedMatchId)
        .single();
      expect(unchangedMatch!.home_score).toBeNull();
      expect(unchangedMatch!.away_score).toBeNull();
      expect(unchangedMatch!.status).toBe("scheduled");
    });

    it("acepta partidos sin status y equipos null para eliminatorias TBD", async () => {
      const apiMatches = [
        {
          id: SYNC_GROUP_REF,
          homeTeam: "España",
          awayTeam: "Portugal",
          homeScore: 2,
          awayScore: 1,
          // La API real puede omitir status; sin result explícito se deriva live.
        },
        {
          id: SYNC_KNOCKOUT_REF,
          homeTeam: null,
          awayTeam: null,
          homeScore: null,
          awayScore: null,
          bracketSlot: 998,
          // Bracket TBD: no debe fallar validación ni sobreescribir equipos.
        },
      ];
      const mockFetch = createMock200(apiMatches);

      const result = await syncMatches(supabase, TEST_API_KEY, mockFetch);

      expect(result).toEqual({
        status: "updated",
        updated: 1,
        changes: [
          {
            id: groupMatchId,
            home_team: "España",
            away_team: "Portugal",
            changes: {
              home_score: { from: 1, to: 2 },
              away_score: { from: 0, to: 1 },
            },
          },
        ],
      });

      const { data: groupMatch } = await supabase
        .from("matches")
        .select("home_score, away_score, status")
        .eq("id", groupMatchId)
        .single();
      expect(groupMatch!.home_score).toBe(2);
      expect(groupMatch!.away_score).toBe(1);
      expect(groupMatch!.status).toBe("live");

      const { data: knockoutMatch } = await supabase
        .from("matches")
        .select("home_team, away_team, home_score, away_score, status")
        .eq("id", knockoutMatchId)
        .single();
      expect(knockoutMatch!.home_team).toBe("Por definir");
      expect(knockoutMatch!.away_team).toBe("Por definir");
      expect(knockoutMatch!.home_score).toBeNull();
      expect(knockoutMatch!.away_score).toBeNull();
      expect(knockoutMatch!.status).toBe("scheduled");
    });

    it("actualiza equipos en partidos de eliminatoria (bracket_slot != null)", async () => {
      const apiMatches = [
        {
          id: SYNC_KNOCKOUT_REF,
          homeTeam: "Brasil",
          awayTeam: "Argentina",
          homeScore: 2,
          awayScore: 3,
          result: "2-3",
          matchNo: 998,
          kickoffUtc: "2026-07-10T20:00:00.000Z",
        },
      ];
      const mockFetch = createMock200(apiMatches);

      const result = await syncMatches(supabase, TEST_API_KEY, mockFetch);

      expect(result).toEqual({
        status: "updated",
        updated: 1,
        changes: [
          {
            id: knockoutMatchId,
            home_team: "Brasil",
            away_team: "Argentina",
            changes: {
              home_team: { from: "Por definir", to: "Brasil" },
              away_team: { from: "Por definir", to: "Argentina" },
              home_score: { from: null, to: 2 },
              away_score: { from: null, to: 3 },
              status: { from: "scheduled", to: "finished" },
            },
          },
        ],
      });

      const { data: match } = await supabase
        .from("matches")
        .select("home_team, away_team, home_score, away_score, status")
        .eq("id", knockoutMatchId)
        .single();
      expect(match!.home_team).toBe("Brasil");
      expect(match!.away_team).toBe("Argentina");
      expect(match!.home_score).toBe(2);
      expect(match!.away_score).toBe(3);
      expect(match!.status).toBe("finished");
    });

    it("actualiza el ETag en system_config al recibir 200 OK", async () => {
      const apiMatches = [
        {
          id: SYNC_GROUP_REF,
          homeTeam: "España",
          awayTeam: "Portugal",
          homeScore: 2,
          awayScore: 1,
          result: "2-1",
          matchNo: 1,
          kickoffUtc: "2026-06-11T19:00:00.000Z",
        },
      ];
      const mockFetch = createMock200(apiMatches, TEST_ETAG_NEW);

      await syncMatches(supabase, TEST_API_KEY, mockFetch);

      const etag = await getStoredETag(supabase);
      expect(etag).toBe(TEST_ETAG_NEW);
    });

    it("no actualiza partidos cuando los datos son idénticos", async () => {
      // Los datos de la API coinciden exactamente con la DB local.
      // Con scores presentes y sin result, deriveMatchStatus devuelve "live"
      const apiMatches = [
        {
          id: SYNC_GROUP_REF,
          homeTeam: "España",
          awayTeam: "Portugal",
          homeScore: 1,
          awayScore: 0,
          result: null,
          matchNo: 1,
          kickoffUtc: "2026-06-11T19:00:00.000Z",
        },
      ];
      const mockFetch = createMock200(apiMatches);

      const result = await syncMatches(supabase, TEST_API_KEY, mockFetch);

      // Ningún partido debería haberse actualizado
      expect(result).toEqual({ status: "updated", updated: 0, changes: [] });
    });

    it("ignora partidos de la API que no existen en la DB local", async () => {
      const apiMatches = [
        {
          id: "non-existent-match-id",
          homeTeam: "TeamA",
          awayTeam: "TeamB",
          homeScore: 1,
          awayScore: 0,
          result: "1-0",
          matchNo: 999,
          kickoffUtc: "2026-06-99T19:00:00.000Z",
        },
      ];
      const mockFetch = createMock200(apiMatches);

      const result = await syncMatches(supabase, TEST_API_KEY, mockFetch);

      expect(result).toEqual({ status: "updated", updated: 0, changes: [] });
    });
  });

  // ── Cabeceras correctas (AC #2, #4) ────────────────────────────

  describe("Cabeceras HTTP (AC #2, #4)", () => {
    beforeEach(async () => {
      await supabase.from("system_config").delete().eq("key", ETAG_CONFIG_KEY);
    });

    it("no envía If-None-Match cuando no hay ETag almacenado", async () => {
      const mockFetch = createMock304();
      await syncMatches(supabase, TEST_API_KEY, mockFetch);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as any[];
      const [, opts] = callArgs;

      expect(opts.headers["X-API-Key"]).toBe(TEST_API_KEY);
      expect(opts.headers).not.toHaveProperty("If-None-Match");
    });

    it("envía If-None-Match cuando hay ETag almacenado", async () => {
      await saveETag(supabase, TEST_ETAG_OLD);
      const mockFetch = createMock304();
      await syncMatches(supabase, TEST_API_KEY, mockFetch);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as any[];
      const [, opts] = callArgs;

      expect(opts.headers["If-None-Match"]).toBe(TEST_ETAG_OLD);
    });
  });

  // ── Manejo de errores ──────────────────────────────────────────

  describe("Manejo de errores HTTP", () => {
    it("lanza error cuando la API responde con 500", async () => {
      const mockFetch = createMockError(500, "Internal Server Error", "oops");

      await expect(
        syncMatches(supabase, TEST_API_KEY, mockFetch),
      ).rejects.toThrow(/HTTP 500/);
    });

    it("lanza error cuando la API responde con 403", async () => {
      const mockFetch = createMockError(403, "Forbidden", "bad key");

      await expect(
        syncMatches(supabase, TEST_API_KEY, mockFetch),
      ).rejects.toThrow(/HTTP 403/);
    });

    it("lanza error cuando el body de la API no es un array válido", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "invalid" }), {
          status: 200,
          statusText: "OK",
          headers: new Headers({ "Content-Type": "application/json" }),
        }),
      );

      await expect(
        syncMatches(supabase, TEST_API_KEY, mockFetch),
      ).rejects.toThrow(/validación/i);
    });
  });
});

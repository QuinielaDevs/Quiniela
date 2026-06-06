/**
 * tests/integration/zafronix-webhook.test.ts
 *
 * Pruebas de integración para el endpoint de webhook de Zafronix
 * POST /api/webhooks/zafronix
 *
 * Cubre:
 *   - Validación de firma HMAC-SHA256 (AC #1)
 *   - Protección contra replay attacks (AC #2)
 *   - Procesamiento de match.finalized y match.patched (AC #3, #4)
 *   - Procesamiento de match.postponed (AC #5)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServiceRoleClient } from "./setup";
import {
  TEST_WEBHOOK_SECRET as WEBHOOK_SECRET,
  signWebhookHeaders as signPayload,
  signWebhookBody,
} from "./helpers/hmac";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/webhooks/zafronix/route";

// ── Helpers ─────────────────────────────────────────────────────────
//
// El esquema HMAC-SHA256 está centralizado en ./helpers/hmac.ts y se
// reutiliza aquí (`signPayload`) y en zafronix-sandbox-e2e.test.ts.

const WEBHOOK_URL = "http://localhost:3000/api/webhooks/zafronix";

/**
 * Envía un POST al webhook con payload y cabeceras firmadas.
 * Devuelve la Response nativa de fetch.
 */
async function postWebhook(
  payload: object,
  overrides?: Partial<Record<string, string>>,
  secret?: string,
  timestampMs?: number,
): Promise<Response> {
  const body = JSON.stringify(payload);
  const headers = new Headers(signPayload(body, secret, timestampMs));
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) headers.set(key, value);
    }
  }
  const req = new NextRequest(WEBHOOK_URL, {
    method: "POST",
    headers,
    body,
  });
  return POST(req);
}

// ── Fixtures ────────────────────────────────────────────────────────

let supabase: SupabaseClient;

/** IDs de partidos de prueba creados en beforeAll. */
let groupMatchId: string;
let knockoutMatchId: string;
let postponeMatchId: string;

const GROUP_EXTERNAL_REF = "test-wh-2026-001";
const KNOCKOUT_EXTERNAL_REF = "test-wh-2026-073";
const POSTPONE_EXTERNAL_REF = "test-wh-2026-005";

beforeAll(async () => {
  supabase = createServiceRoleClient();

  // Limpiar predicciones y luego partidos de pruebas anteriores (evita violación de FK)
  const { data: existingMatches, error: selectError } = await supabase
    .from("matches")
    .select("id")
    .in("external_ref", [
      GROUP_EXTERNAL_REF,
      KNOCKOUT_EXTERNAL_REF,
      POSTPONE_EXTERNAL_REF,
    ]);
  if (selectError) throw selectError;

  if (existingMatches && existingMatches.length > 0) {
    const ids = existingMatches.map((m) => m.id);
    const { error: deletePredictionsError } = await supabase
      .from("predictions")
      .delete()
      .in("match_id", ids);
    if (deletePredictionsError) throw deletePredictionsError;
  }
  const { error: deleteMatchesError } = await supabase
    .from("matches")
    .delete()
    .in("external_ref", [
      GROUP_EXTERNAL_REF,
      KNOCKOUT_EXTERNAL_REF,
      POSTPONE_EXTERNAL_REF,
    ]);
  if (deleteMatchesError) throw deleteMatchesError;

  // Crear partidos de prueba
  const { data: groupMatch, error: e1 } = await supabase
    .from("matches")
    .insert({
      external_ref: GROUP_EXTERNAL_REF,
      home_team: "Mexico",
      away_team: "USA",
      match_time: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3h ago (ya empezó)
      status: "live",
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
      external_ref: KNOCKOUT_EXTERNAL_REF,
      home_team: "TBD",
      away_team: "TBD",
      match_time: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      status: "live",
      stage: "round-16",
      bracket_slot: 999,
    })
    .select("id")
    .single();
  if (e2) throw e2;
  knockoutMatchId = knockoutMatch!.id;

  const { data: postponeMatch, error: e3 } = await supabase
    .from("matches")
    .insert({
      external_ref: POSTPONE_EXTERNAL_REF,
      home_team: "Brazil",
      away_team: "Argentina",
      match_time: new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(), // 1h en el futuro
      status: "scheduled",
      matchday: 2,
      stage: "group",
      group_label: "B",
    })
    .select("id")
    .single();
  if (e3) throw e3;
  postponeMatchId = postponeMatch!.id;
});

afterAll(async () => {
  // Limpiar predicciones y partidos de prueba
  if (supabase) {
    const ids = [groupMatchId, knockoutMatchId, postponeMatchId].filter(Boolean);
    if (ids.length > 0) {
      const { error: deletePredictionsError } = await supabase
        .from("predictions")
        .delete()
        .in("match_id", ids);
      if (deletePredictionsError) throw deletePredictionsError;
    }
    const { error: deleteMatchesError } = await supabase
      .from("matches")
      .delete()
      .in("external_ref", [
        GROUP_EXTERNAL_REF,
        KNOCKOUT_EXTERNAL_REF,
        POSTPONE_EXTERNAL_REF,
      ]);
    if (deleteMatchesError) throw deleteMatchesError;
  }
});

// ── Tests ───────────────────────────────────────────────────────────

describe("POST /api/webhooks/zafronix", () => {
  // ── AC #1: Validación de firma HMAC-SHA256 ──────────────────────

  describe("Validación de firma HMAC-SHA256 (AC #1)", () => {
    it("rechaza solicitudes sin cabecera X-Zafronix-Signature-256", async () => {
      const body = JSON.stringify({ type: "match.finalized", matchId: "test" });
      const ts = String(Date.now());
      const res = await POST(new NextRequest(WEBHOOK_URL, {
        method: "POST",
        headers: new Headers({
          "Content-Type": "application/json",
          "X-Zafronix-Timestamp": ts,
        }),
        body,
      }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data).toHaveProperty("error");
    });

    it("rechaza solicitudes sin cabecera X-Zafronix-Timestamp", async () => {
      const body = JSON.stringify({ type: "match.finalized", matchId: "test" });
      const sig = signWebhookBody(body, WEBHOOK_SECRET);
      const res = await POST(new NextRequest(WEBHOOK_URL, {
        method: "POST",
        headers: new Headers({
          "Content-Type": "application/json",
          "X-Zafronix-Signature-256": sig,
        }),
        body,
      }));
      expect(res.status).toBe(400);
    });

    it("rechaza solicitudes con firma HMAC incorrecta", async () => {
      const payload = {
        type: "match.finalized",
        id: "abc123",
        matchId: GROUP_EXTERNAL_REF,
        year: 2026,
        ts: new Date().toISOString(),
        payload: { homeTeam: "Mexico", awayTeam: "USA", homeScore: 2, awayScore: 1 },
      };
      const res = await postWebhook(payload, {
        "X-Zafronix-Signature-256": "sha256=0000000000000000000000000000000000000000000000000000000000000000",
      });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data).toHaveProperty("error");
    });

    it("acepta solicitudes con firma HMAC correcta", async () => {
      const payload = {
        type: "match.finalized",
        id: "valid-sig-test",
        matchId: GROUP_EXTERNAL_REF,
        year: 2026,
        ts: new Date().toISOString(),
        payload: {
          homeTeam: "Mexico",
          awayTeam: "USA",
          homeScore: 2,
          awayScore: 1,
          result: "2-1",
          extraTime: false,
          penalties: null,
          stage: "group_a",
          actor: "actor:test",
        },
      };
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
    });
  });

  // ── AC #2: Protección contra replay attacks ─────────────────────

  describe("Protección contra replay attacks (AC #2)", () => {
    it("rechaza solicitudes con timestamp más de 5 minutos en el pasado", async () => {
      const oldTimestamp = Date.now() - 6 * 60 * 1000; // 6 minutos atrás
      const payload = {
        type: "match.finalized",
        id: "replay-test",
        matchId: GROUP_EXTERNAL_REF,
        year: 2026,
        ts: new Date().toISOString(),
        payload: { homeTeam: "Mexico", awayTeam: "USA", homeScore: 1, awayScore: 0 },
      };
      const res = await postWebhook(payload, undefined, undefined, oldTimestamp);
      expect([400, 401]).toContain(res.status);
      const data = await res.json();
      expect(data).toHaveProperty("error");
    });

    it("rechaza solicitudes con timestamp más de 5 minutos en el futuro", async () => {
      const futureTimestamp = Date.now() + 6 * 60 * 1000; // 6 minutos adelante
      const payload = {
        type: "match.finalized",
        id: "replay-future-test",
        matchId: GROUP_EXTERNAL_REF,
        year: 2026,
        ts: new Date().toISOString(),
        payload: { homeTeam: "Mexico", awayTeam: "USA", homeScore: 1, awayScore: 0 },
      };
      const res = await postWebhook(payload, undefined, undefined, futureTimestamp);
      expect([400, 401]).toContain(res.status);
    });

    it("acepta solicitudes dentro de la ventana de 5 minutos", async () => {
      const validTimestamp = Date.now() - 2 * 60 * 1000; // 2 minutos atrás
      const payload = {
        type: "match.finalized",
        id: "valid-window-test",
        matchId: GROUP_EXTERNAL_REF,
        year: 2026,
        ts: new Date().toISOString(),
        payload: {
          homeTeam: "Mexico",
          awayTeam: "USA",
          homeScore: 2,
          awayScore: 1,
          result: "2-1",
          extraTime: false,
          penalties: null,
          stage: "group_a",
          actor: "actor:test",
        },
      };
      const res = await postWebhook(payload, undefined, undefined, validTimestamp);
      expect(res.status).toBe(200);
    });
  });

  // ── AC #3: match.finalized — Actualización de marcadores ────────

  describe("match.finalized — Actualización de marcadores (AC #3)", () => {
    beforeEach(async () => {
      // Resetear el partido de grupo a estado live
      const { error } = await supabase
        .from("matches")
        .update({ status: "live", home_score: null, away_score: null })
        .eq("id", groupMatchId);
      if (error) throw error;
    });

    it("actualiza home_score, away_score y status a finished", async () => {
      const payload = {
        type: "match.finalized",
        id: "finalized-score-test",
        matchId: GROUP_EXTERNAL_REF,
        year: 2026,
        ts: new Date().toISOString(),
        payload: {
          homeTeam: "Mexico",
          awayTeam: "USA",
          homeScore: 2,
          awayScore: 1,
          result: "2-1",
          extraTime: false,
          penalties: null,
          stage: "group_a",
          actor: "actor:test",
        },
      };
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);

      // Verificar que el partido se actualizó en la base de datos
      const { data: match } = await supabase
        .from("matches")
        .select("home_score, away_score, status")
        .eq("id", groupMatchId)
        .single();

      expect(match).toBeDefined();
      expect(match!.home_score).toBe(2);
      expect(match!.away_score).toBe(1);
      expect(match!.status).toBe("finished");
    });

    it("retorna 404 si el external_ref del partido no existe", async () => {
      const payload = {
        type: "match.finalized",
        id: "not-found-test",
        matchId: "nonexistent-ref-999",
        year: 2026,
        ts: new Date().toISOString(),
        payload: {
          homeTeam: "X", awayTeam: "Y",
          homeScore: 1, awayScore: 0,
          result: "1-0",
          extraTime: false,
          penalties: null,
          stage: "group_a",
          actor: "actor:test",
        },
      };
      const res = await postWebhook(payload);
      expect(res.status).toBe(404);
    });
  });

  // ── AC #4: Actualización de equipos en eliminatorias ────────────

  describe("match.finalized/patched — Knockout team resolution (AC #4)", () => {
    beforeEach(async () => {
      // Resetear el partido eliminatorio
      const { error } = await supabase
        .from("matches")
        .update({
          status: "live",
          home_score: null,
          away_score: null,
          home_team: "TBD",
          away_team: "TBD",
        })
        .eq("id", knockoutMatchId);
      if (error) throw error;
    });

    it("actualiza home_team y away_team en partido eliminatorio con bracket_slot", async () => {
      const payload = {
        type: "match.finalized",
        id: "knockout-teams-test",
        matchId: KNOCKOUT_EXTERNAL_REF,
        year: 2026,
        ts: new Date().toISOString(),
        payload: {
          homeTeam: "Germany",
          awayTeam: "Japan",
          homeScore: 3,
          awayScore: 1,
          result: "3-1",
          extraTime: false,
          penalties: null,
          stage: "r16",
          actor: "actor:test",
        },
      };
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);

      const { data: match } = await supabase
        .from("matches")
        .select("home_team, away_team, home_score, away_score, status, bracket_slot")
        .eq("id", knockoutMatchId)
        .single();

      expect(match).toBeDefined();
      expect(match!.home_team).toBe("Germany");
      expect(match!.away_team).toBe("Japan");
      expect(match!.home_score).toBe(3);
      expect(match!.away_score).toBe(1);
      expect(match!.status).toBe("finished");
    });

    it("match.patched actualiza marcador corregido en knockout", async () => {
      // Primero finalizar el partido
      const { error } = await supabase
        .from("matches")
        .update({
          status: "finished",
          home_score: 2,
          away_score: 1,
          home_team: "Germany",
          away_team: "Japan",
        })
        .eq("id", knockoutMatchId);
      if (error) throw error;

      const payload = {
        type: "match.patched",
        id: "patch-test",
        matchId: KNOCKOUT_EXTERNAL_REF,
        year: 2026,
        ts: new Date().toISOString(),
        payload: {
          homeTeam: "Germany",
          awayTeam: "Japan",
          changes: {
            homeScore: { from: 2, to: 3 },
            result: { from: "2-1", to: "3-1" },
          },
          actor: "actor:test",
        },
      };
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);

      const { data: match } = await supabase
        .from("matches")
        .select("home_score, away_score, status")
        .eq("id", knockoutMatchId)
        .single();

      expect(match).toBeDefined();
      expect(match!.home_score).toBe(3);
      expect(match!.away_score).toBe(1);
      expect(match!.status).toBe("finished");
    });
  });

  // ── AC #5: match.postponed — Anulación de predicciones ──────────

  describe("match.postponed — Anulación de predicciones (AC #5)", () => {
    let testLeagueId: string;
    let testUserId: string;
    let testPredictionId: string;

    beforeAll(async () => {
      // Crear un usuario y liga de prueba para las predicciones
      const { data: user, error: userErr } = await supabase.auth.admin.createUser({
        email: `webhook-test-${Date.now()}@test.local`,
        password: "test1234!",
        email_confirm: true,
      });
      if (userErr) throw userErr;
      testUserId = user.user!.id;

      // Esperar a que el trigger de profiles se ejecute de forma robusta
      let profileExists = false;
      for (let i = 0; i < 20; i++) {
        const { data } = await supabase
          .from("profiles")
          .select("id")
          .eq("id", user.user!.id)
          .maybeSingle();
        if (data) {
          profileExists = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      if (!profileExists) throw new Error("Profile trigger did not execute in time");

      const { data: league, error: leagueErr } = await supabase
        .from("leagues")
        .insert({
          name: "Webhook Test League",
          created_by: testUserId,
          invite_code: `wh-test-${Date.now()}`,
        })
        .select("id")
        .single();
      if (leagueErr) throw leagueErr;
      testLeagueId = league!.id;

      // Hacer miembro al usuario
      const { error: memberErr } = await supabase.from("league_members").insert({
        league_id: testLeagueId,
        user_id: testUserId,
        role: "admin",
      });
      if (memberErr) throw memberErr;
    });

    beforeEach(async () => {
      // Resetear el partido de postpone
      const { error: updateError } = await supabase
        .from("matches")
        .update({ status: "scheduled", home_score: null, away_score: null })
        .eq("id", postponeMatchId);
      if (updateError) throw updateError;

      // Limpiar predicciones existentes
      const { error: deleteError } = await supabase
        .from("predictions")
        .delete()
        .eq("match_id", postponeMatchId);
      if (deleteError) throw deleteError;

      // Crear una predicción de prueba
      const { data: pred, error: predErr } = await supabase
        .from("predictions")
        .insert({
          league_id: testLeagueId,
          match_id: postponeMatchId,
          user_id: testUserId,
          home_score_pred: 2,
          away_score_pred: 1,
          multiplier: 1.5,
        })
        .select("id")
        .single();
      if (predErr) throw predErr;
      testPredictionId = pred!.id;
    });

    afterAll(async () => {
      // Limpiar fixtures de prueba
      if (supabase && testLeagueId) {
        const { error: deletePredictionsError } = await supabase.from("predictions").delete().eq("league_id", testLeagueId);
        if (deletePredictionsError) throw deletePredictionsError;
        const { error: deleteMembersError } = await supabase.from("league_members").delete().eq("league_id", testLeagueId);
        if (deleteMembersError) throw deleteMembersError;
        const { error: deleteLeaguesError } = await supabase.from("leagues").delete().eq("id", testLeagueId);
        if (deleteLeaguesError) throw deleteLeaguesError;
      }
      if (supabase && testUserId) {
        const { error: deleteUserError } = await supabase.auth.admin.deleteUser(testUserId);
        if (deleteUserError) throw deleteUserError;
      }
    });

    it("actualiza status a suspended y anula predicciones", async () => {
      const payload = {
        type: "match.postponed",
        id: "postpone-test",
        matchId: POSTPONE_EXTERNAL_REF,
        year: 2026,
        ts: new Date().toISOString(),
        payload: {
          homeTeam: "Brazil",
          awayTeam: "Argentina",
          status: "postponed",
          rescheduledTo: "2026-06-13T17:00:00Z",
          reason: "Stadium roof damage",
          actor: "actor:test",
        },
      };
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);

      // Verificar que el partido se actualizó
      const { data: match } = await supabase
        .from("matches")
        .select("status")
        .eq("id", postponeMatchId)
        .single();
      expect(match!.status).toBe("suspended");

      // Verificar que las predicciones se anularon
      const { data: pred } = await supabase
        .from("predictions")
        .select("points_earned, evaluated_at")
        .eq("id", testPredictionId)
        .single();
      expect(pred).toBeDefined();
      expect(Number(pred!.points_earned)).toBe(0);
      expect(pred!.evaluated_at).not.toBeNull();
    });

    it("mapea status cancelled a canceled en la DB", async () => {
      const payload = {
        type: "match.postponed",
        id: "cancelled-test",
        matchId: POSTPONE_EXTERNAL_REF,
        year: 2026,
        ts: new Date().toISOString(),
        payload: {
          homeTeam: "Brazil",
          awayTeam: "Argentina",
          status: "cancelled",
          reason: "Security concerns",
          actor: "actor:test",
        },
      };
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);

      const { data: match } = await supabase
        .from("matches")
        .select("status")
        .eq("id", postponeMatchId)
        .single();
      expect(match!.status).toBe("canceled");
    });
  });

  // ── Edge Cases ────────────────────────────────────────────────────

  describe("Edge cases", () => {
    it("rechaza payloads con tipo de evento desconocido gracefully", async () => {
      const payload = {
        type: "match.unknown_event",
        id: "unknown-test",
        matchId: GROUP_EXTERNAL_REF,
        year: 2026,
        ts: new Date().toISOString(),
        payload: {},
      };
      const res = await postWebhook(payload);
      // El endpoint debe aceptar pero no procesar tipos desconocidos (200 OK)
      expect(res.status).toBe(200);
    });

    it("rechaza payloads con JSON inválido", async () => {
      const body = "this is not json {{{";
      const headers = signPayload(body);
      const res = await POST(new NextRequest(WEBHOOK_URL, {
        method: "POST",
        headers: new Headers(headers),
        body,
      }));
      expect(res.status).toBe(400);
    });
  });
});

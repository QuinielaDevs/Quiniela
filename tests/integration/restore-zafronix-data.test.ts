/**
 * tests/integration/restore-zafronix-data.test.ts
 *
 * Pruebas de integración para el script administrativo de restauración completa
 * (Story 8.3, AC #7).
 *
 * Cubre:
 *   - GET directo sin cabecera condicional If-None-Match (AC #3).
 *   - Restauración sobre base limpia: inserta los partidos ausentes (AC #4).
 *   - Reconciliación con cambio de marcador/estado de un partido finalizado:
 *     recalcula las predicciones YA evaluadas, ajusta wager_balance con el delta
 *     exacto y registra la transacción de corrección, sin duplicar ni corromper
 *     el ledger (AC #5, #7).
 *   - Manejo de errores HTTP / body inválido.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
} from "vitest";
import {
  createServiceRoleClient,
  createAnonClient,
} from "./setup";
import type { SupabaseClient } from "@supabase/supabase-js";
import { restoreZafronixData } from "../../scripts/restore-zafronix-data";

// ── Constantes de prueba ────────────────────────────────────────────

const TEST_API_KEY = "zwc_test_key_for_integration_tests";

// external_refs aislados para no colisionar con el seed del Mundial.
const UPDATE_REF = "test-restore-2026-upd-A1";
const INSERT_REF_1 = "test-restore-ins-001";
const INSERT_REF_2 = "test-restore-ins-002";
const ALL_TEST_REFS = [UPDATE_REF, INSERT_REF_1, INSERT_REF_2];

// ── Fixtures ────────────────────────────────────────────────────────

const admin: SupabaseClient = createServiceRoleClient();
const createdUserIds: string[] = [];
let leagueId: string;
let userA: { id: string };
let updateMatchId: string;
let predictionId: string;

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

function uniqueInvite(): string {
  return `INV-83-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createUser(): Promise<{ id: string }> {
  const email = uniqueEmail("restore");
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "Password123!",
    email_confirm: true,
  });
  expect(error).toBeNull();
  const id = data.user!.id;
  createdUserIds.push(id);
  return { id };
}

/** Limpia partidos de prueba y sus predicciones asociadas. */
async function cleanupTestMatches() {
  const { data: existing } = await admin
    .from("matches")
    .select("id")
    .in("external_ref", ALL_TEST_REFS);
  if (existing && existing.length > 0) {
    const ids = existing.map((m) => m.id);
    await admin.from("predictions").delete().in("match_id", ids);
    await admin.from("matches").delete().in("id", ids);
  }
}

beforeAll(async () => {
  // Confirmar que tenemos un cliente válido contra el Supabase local.
  createAnonClient();

  await cleanupTestMatches();

  userA = await createUser();

  // Liga + membresía de userA.
  const { data: league, error: lErr } = await admin
    .from("leagues")
    .insert({
      name: "Liga Restore 8.3",
      created_by: userA.id,
      invite_code: uniqueInvite(),
    })
    .select("id")
    .single();
  expect(lErr).toBeNull();
  leagueId = league!.id;

  const { error: mErr } = await admin
    .from("league_members")
    .insert({ league_id: leagueId, user_id: userA.id, role: "admin" });
  expect(mErr).toBeNull();
});

afterAll(async () => {
  await cleanupTestMatches();
  if (leagueId) {
    await admin.from("point_transactions").delete().eq("league_id", leagueId);
    await admin.from("leagues").delete().eq("id", leagueId);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await admin.auth.admin.deleteUser(id);
  }
});

// ── Helpers de mocking ──────────────────────────────────────────────

/** Mock de fetch que responde 200 OK con el envoltorio { year, count, data }. */
function createMock200(matches: object[]): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ year: 2026, count: matches.length, data: matches }),
      {
        status: 200,
        statusText: "OK",
        headers: new Headers({ "Content-Type": "application/json" }),
      },
    ),
  );
}

function createMockError(status: number, statusText: string): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue(new Response("oops", { status, statusText }));
}

// ── Tests ───────────────────────────────────────────────────────────

describe("restore-zafronix-data — Restauración completa (Story 8.3)", () => {
  // ── AC #3: GET directo sin If-None-Match ───────────────────────────

  describe("Solicitud HTTP (AC #3)", () => {
    it("hace GET al endpoint de Zafronix con X-API-Key y SIN cabecera If-None-Match", async () => {
      const mockFetch = createMock200([]);
      await restoreZafronixData(admin, TEST_API_KEY, mockFetch);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        { headers: Record<string, string> },
      ];
      expect(url).toBe(
        "https://api.zafronix.com/fifa/worldcup/v1/matches?year=2026",
      );
      expect(opts.headers["X-API-Key"]).toBe(TEST_API_KEY);
      expect(opts.headers).not.toHaveProperty("If-None-Match");
    });

    it("rechaza una API Key vacía", async () => {
      const mockFetch = createMock200([]);
      await expect(restoreZafronixData(admin, "", mockFetch)).rejects.toThrow(
        /API-Key/i,
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── AC #4: Inserción sobre base limpia ─────────────────────────────

  describe("Inserción de partidos ausentes (AC #4)", () => {
    it("inserta en public.matches los partidos que no existen localmente", async () => {
      await cleanupTestMatches();

      const apiMatches = [
        {
          id: INSERT_REF_1,
          homeTeam: "Testlandia",
          awayTeam: "Mockovia",
          homeScore: null,
          awayScore: null,
          status: "scheduled",
          stage: "group",
          groupLabel: "A",
          matchday: 1,
          matchTime: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
          venue: "Estadio de Pruebas",
        },
        {
          id: INSERT_REF_2,
          homeTeam: "Vitestia",
          awayTeam: "Zafronixia",
          homeScore: 3,
          awayScore: 1,
          status: "finished",
          stage: "group",
          groupLabel: "B",
          matchday: 2,
          matchTime: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ];

      const result = await restoreZafronixData(
        admin,
        TEST_API_KEY,
        createMock200(apiMatches),
      );

      expect(result.created).toBe(2);
      expect(result.errors).toBe(0);

      const { data: inserted } = await admin
        .from("matches")
        .select(
          "external_ref, home_team, away_team, home_score, away_score, status, matchday, group_label, venue",
        )
        .in("external_ref", [INSERT_REF_1, INSERT_REF_2])
        .order("external_ref");

      expect(inserted).toHaveLength(2);

      const m1 = inserted!.find((m) => m.external_ref === INSERT_REF_1)!;
      expect(m1.home_team).toBe("Testlandia");
      expect(m1.away_team).toBe("Mockovia");
      expect(m1.status).toBe("scheduled");
      expect(m1.matchday).toBe(1);
      expect(m1.group_label).toBe("A");
      expect(m1.venue).toBe("Estadio de Pruebas");

      const m2 = inserted!.find((m) => m.external_ref === INSERT_REF_2)!;
      expect(m2.home_score).toBe(3);
      expect(m2.away_score).toBe(1);
      expect(m2.status).toBe("finished");
    });

    it("no duplica partidos: una segunda corrida no vuelve a insertarlos", async () => {
      const apiMatches = [
        {
          id: INSERT_REF_1,
          homeTeam: "Testlandia",
          awayTeam: "Mockovia",
          homeScore: null,
          awayScore: null,
          status: "scheduled",
          matchTime: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ];

      const result = await restoreZafronixData(
        admin,
        TEST_API_KEY,
        createMock200(apiMatches),
      );

      expect(result.created).toBe(0);

      const { data: rows } = await admin
        .from("matches")
        .select("id")
        .eq("external_ref", INSERT_REF_1);
      expect(rows).toHaveLength(1);
    });
  });

  // ── AC #5 / #7: Corrección de marcador y recálculo del ledger ──────

  describe("Reconciliación y recálculo de predicciones evaluadas (AC #5, #7)", () => {
    beforeAll(async () => {
      // Partido FINALIZADO con marcador 1-0 y external_ref aislado.
      const { data: match, error: e1 } = await admin
        .from("matches")
        .insert({
          external_ref: UPDATE_REF,
          home_team: "España",
          away_team: "Portugal",
          match_time: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          status: "finished",
          home_score: 1,
          away_score: 0,
          matchday: 1,
          stage: "group",
          group_label: "A",
        })
        .select("id")
        .single();
      expect(e1).toBeNull();
      updateMatchId = match!.id;

      // Predicción YA EVALUADA de userA: pronosticó 1-0 (marcador exacto → 5.00).
      const { data: pred, error: e2 } = await admin
        .from("predictions")
        .insert({
          league_id: leagueId,
          match_id: updateMatchId,
          user_id: userA.id,
          home_score_pred: 1,
          away_score_pred: 0,
          multiplier: 1.0,
          points_earned: 5.0,
          evaluated_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      expect(e2).toBeNull();
      predictionId = pred!.id;

      // Ledger consistente: el accrual de 5.00 ya está reflejado en el saldo.
      await admin
        .from("point_transactions")
        .delete()
        .eq("league_id", leagueId)
        .eq("user_id", userA.id);
      const { error: e3 } = await admin.from("point_transactions").insert({
        user_id: userA.id,
        league_id: leagueId,
        amount: 5.0,
        description: "match_accrual",
        reference_id: updateMatchId,
      });
      expect(e3).toBeNull();
      const { error: e4 } = await admin
        .from("league_members")
        .update({ wager_balance: 5.0 })
        .eq("league_id", leagueId)
        .eq("user_id", userA.id);
      expect(e4).toBeNull();
    });

    it("corrige marcador, recalcula la predicción y ajusta el saldo con el delta exacto", async () => {
      // La API ahora reporta 2-0 (corrección). Predicción 1-0 pasa de exacto (5)
      // a sólo resultado acertado (2). Delta = 2 - 5 = -3.
      const apiMatches = [
        {
          id: UPDATE_REF,
          homeTeam: "España",
          awayTeam: "Portugal",
          homeScore: 2,
          awayScore: 0,
          status: "finished",
        },
      ];

      const result = await restoreZafronixData(
        admin,
        TEST_API_KEY,
        createMock200(apiMatches),
      );

      expect(result.updated).toBe(1);
      expect(result.corrections).toBe(1);
      expect(result.errors).toBe(0);

      // 1. El partido refleja el nuevo marcador.
      const { data: match } = await admin
        .from("matches")
        .select("home_score, away_score, status")
        .eq("id", updateMatchId)
        .single();
      expect(match!.home_score).toBe(2);
      expect(match!.away_score).toBe(0);
      expect(match!.status).toBe("finished");

      // 2. La predicción se recalculó a 2.00 (resultado acertado, ya no exacto).
      const { data: pred } = await admin
        .from("predictions")
        .select("points_earned")
        .eq("id", predictionId)
        .single();
      expect(Number(pred!.points_earned)).toBe(2.0);

      // 3. El saldo bajó exactamente el delta: 5.00 + (-3.00) = 2.00.
      const { data: member } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", userA.id)
        .single();
      expect(Number(member!.wager_balance)).toBe(2.0);

      // 4. Se registró la transacción de corrección por -3.00.
      const { data: txs } = await admin
        .from("point_transactions")
        .select("amount, description, reference_id")
        .eq("league_id", leagueId)
        .eq("user_id", userA.id)
        .eq("description", "match_accrual_correction");
      expect(txs).toHaveLength(1);
      expect(Number(txs![0]!.amount)).toBe(-3.0);
      expect(txs![0]!.reference_id).toBe(updateMatchId);

      // 5. Invariante de conservación: wager_balance == SUM(amount).
      const { data: isConserved, error: invErr } = await admin.rpc(
        "check_conservation_invariant",
        { p_league_id: leagueId, p_user_id: userA.id },
      );
      expect(invErr).toBeNull();
      expect(isConserved).toBe(true);
    });

    it("es idempotente: una segunda corrida con el mismo marcador no genera más correcciones", async () => {
      const apiMatches = [
        {
          id: UPDATE_REF,
          homeTeam: "España",
          awayTeam: "Portugal",
          homeScore: 2,
          awayScore: 0,
          status: "finished",
        },
      ];

      const result = await restoreZafronixData(
        admin,
        TEST_API_KEY,
        createMock200(apiMatches),
      );

      // Sin cambios → ni actualización ni corrección.
      expect(result.updated).toBe(0);
      expect(result.corrections).toBe(0);

      const { data: txs } = await admin
        .from("point_transactions")
        .select("id")
        .eq("league_id", leagueId)
        .eq("user_id", userA.id)
        .eq("description", "match_accrual_correction");
      expect(txs).toHaveLength(1); // sigue habiendo sólo una corrección
    });

    it("revierte un partido finalizado a scheduled, reseteando evaluated_at a NULL y devolviendo los puntos", async () => {
      const apiMatches = [
        {
          id: UPDATE_REF,
          homeTeam: "España",
          awayTeam: "Portugal",
          homeScore: null,
          awayScore: null,
          status: "scheduled",
        },
      ];

      const result = await restoreZafronixData(
        admin,
        TEST_API_KEY,
        createMock200(apiMatches),
      );

      expect(result.updated).toBe(1);
      expect(result.corrections).toBe(1);

      // 1. El partido es scheduled y con marcador null
      const { data: match } = await admin
        .from("matches")
        .select("home_score, away_score, status")
        .eq("id", updateMatchId)
        .single();
      expect(match!.home_score).toBeNull();
      expect(match!.status).toBe("scheduled");

      // 2. La predicción se reseteó a NULL en points_earned y evaluated_at
      const { data: pred } = await admin
        .from("predictions")
        .select("points_earned, evaluated_at")
        .eq("id", predictionId)
        .single();
      expect(pred!.points_earned).toBeNull();
      expect(pred!.evaluated_at).toBeNull();

      // 3. El saldo bajó de nuevo a 0.00 (reversión total)
      const { data: member } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", userA.id)
        .single();
      expect(Number(member!.wager_balance)).toBe(0.0);
    });

    it("reconvierte y recalcula desafíos completados si cambia el marcador", async () => {
      // 1. Crear un partido de prueba para el desafío
      const CHALLENGE_MATCH_REF = "test-restore-chal-match";
      const { data: match } = await admin
        .from("matches")
        .insert({
          external_ref: CHALLENGE_MATCH_REF,
          home_team: "Argentina",
          away_team: "Brasil",
          match_time: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          status: "finished",
          home_score: 1,
          away_score: 0,
          matchday: 1,
          stage: "group",
        })
        .select("id")
        .single();
      const chalMatchId = match!.id;

      // 2. Crear segundo usuario
      const userB = await createUser();
      await admin
        .from("league_members")
        .insert({ league_id: leagueId, user_id: userB.id, role: "member", wager_balance: 100.0 });
      await admin
        .from("league_members")
        .update({ wager_balance: 100.0 })
        .eq("league_id", leagueId)
        .eq("user_id", userA.id);

      // 3. Crear desafío completado: apuesta 20 puntos.
      // Creador: userA (pronóstico 1-0). Rival: userB (pronóstico 2-0).
      // Marcador inicial: 1-0. Ganador: userA.
      const { data: challenge } = await admin
        .from("challenges")
        .insert({
          league_id: leagueId,
          match_id: chalMatchId,
          creator_id: userA.id,
          challenged_id: userB.id,
          points_bet: 20,
          type: "direct",
          status: "completed",
          winner_ids: [userA.id],
        })
        .select("id")
        .single();
      const challengeId = challenge!.id;

      await admin
        .from("challenge_participants")
        .insert([
          { challenge_id: challengeId, user_id: userA.id, prediction_home: 1, prediction_away: 0 },
          { challenge_id: challengeId, user_id: userB.id, prediction_home: 2, prediction_away: 0 }
        ]);

      // Registrar transacciones de escrow inicial y del payout
      await admin.from("point_transactions").insert([
        { user_id: userA.id, league_id: leagueId, amount: -20.0, description: "escrow_hold", reference_id: challengeId },
        { user_id: userB.id, league_id: leagueId, amount: -20.0, description: "escrow_hold", reference_id: challengeId },
        // Payout: userA gana todo el pozo (40.0)
        { user_id: userA.id, league_id: leagueId, amount: 40.0, description: "challenge_payout", reference_id: challengeId }
      ]);

      // Saldos iniciales ajustados:
      // userA: 100 (original) - 20 (apuesta) + 40 (payout) = 120.0
      // userB: 100 (original) - 20 (apuesta) = 80.0
      await admin.from("league_members").update({ wager_balance: 120.0 }).eq("league_id", leagueId).eq("user_id", userA.id);
      await admin.from("league_members").update({ wager_balance: 80.0 }).eq("league_id", leagueId).eq("user_id", userB.id);

      // 4. Ejecutar restauración con marcador cambiado: 2-0.
      // Con marcador 2-0, el ganador del desafío debe ser userB.
      const apiMatches = [
        {
          id: CHALLENGE_MATCH_REF,
          homeTeam: "Argentina",
          awayTeam: "Brasil",
          homeScore: 2,
          awayScore: 0,
          status: "finished",
        },
      ];

      const result = await restoreZafronixData(
        admin,
        TEST_API_KEY,
        createMock200(apiMatches),
      );

      // El partido se actualiza
      expect(result.updated).toBe(1);

      // Verificar que el desafío ahora muestra como ganador a userB
      const { data: updatedChallenge } = await admin
        .from("challenges")
        .select("status, winner_ids")
        .eq("id", challengeId)
        .single();
      expect(updatedChallenge!.status).toBe("completed");
      expect(updatedChallenge!.winner_ids).toEqual([userB.id]);

      // Verificar transacciones:
      // userA debe tener una reversión de -40.0. Saldo final de userA: 120 - 40 = 80.0.
      // userB debe tener un pago de challenge_payout de 40.0. Saldo final de userB: 80 + 40 = 120.0.
      const { data: memberA } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", userA.id)
        .single();
      expect(Number(memberA!.wager_balance)).toBe(80.0);

      const { data: memberB } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", userB.id)
        .single();
      expect(Number(memberB!.wager_balance)).toBe(120.0);

      // Limpieza específica del partido y desafío
      await admin.from("point_transactions").delete().eq("reference_id", challengeId);
      await admin.from("challenge_participants").delete().eq("challenge_id", challengeId);
      await admin.from("challenges").delete().eq("id", challengeId);
      await admin.from("matches").delete().eq("id", chalMatchId);
    });
  });

  // ── Manejo de errores ──────────────────────────────────────────────

  describe("Manejo de errores HTTP", () => {
    it("lanza error cuando la API responde 500", async () => {
      await expect(
        restoreZafronixData(admin, TEST_API_KEY, createMockError(500, "Server Error")),
      ).rejects.toThrow(/HTTP 500/);
    });

    it("lanza error cuando el body no respeta el esquema esperado", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ unexpected: true }), {
          status: 200,
          statusText: "OK",
          headers: new Headers({ "Content-Type": "application/json" }),
        }),
      );
      await expect(
        restoreZafronixData(admin, TEST_API_KEY, mockFetch),
      ).rejects.toThrow(/validación/i);
    });
  });
});

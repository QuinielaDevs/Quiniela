/**
 * tests/e2e/webhooks.spec.ts — Fase 8: Webhooks Zafronix E2E
 *
 * Cubre los casos de prueba WHK-01 a WHK-12 según el plan de pruebas.
 */

import { test, expect } from "@playwright/test";

import { createAdminClient } from "./helpers/admin";
import { createCleanupStack } from "./helpers/cleanup";
import {
  deleteMatches,
  seedMatches,
  liveMatch,
  editableMatch,
} from "./helpers/seed/matches";
import { seedPrediction } from "./helpers/seed/predictions";
import { seedChallenge, acceptChallengeAs } from "./helpers/seed/challenges";
import { createLeagueWithUsers, type LeagueWithUsers } from "./helpers/users";
import { sendZafronixEvent, ZAFRONIX_WEBHOOK_PATH } from "./helpers/webhook";
import {
  assertLedgerInvariant,
  getWagerBalance,
  getPrediction,
  getChallenge,
  getMatch,
} from "./helpers/db-assert";
import { signWebhookBody, TEST_WEBHOOK_SECRET } from "../integration/helpers/hmac";

// ────────────────────────────────────────────────────────────────────
// Suite
// ────────────────────────────────────────────────────────────────────

test.describe("Webhooks Zafronix E2E (e2e)", () => {
  const admin = createAdminClient();
  const stack = createCleanupStack();

  let fixture: LeagueWithUsers;
  let matchId = "";
  let externalRef = "";
  let homeTeam = "";
  let awayTeam = "";
  let challengeId = "";

  // Timestamp e ID del primer evento de finalización para la prueba de replay/idempotencia
  let firstEventTs = "";
  let firstEventId = "";

  test.beforeAll(async ({ browser }) => {
    // 1) Crear liga de 3 usuarios con balances iniciales de 100 ptos para duelos
    fixture = await createLeagueWithUsers(browser, {
      members: 3,
      admins: 1,
      eagerLogins: 1,
      leagueOpts: {
        name: "Liga Webhooks E2E",
        paymentStatus: "paid",
        wagerBalance: 100,
      },
    });
    stack.add(() => fixture.cleanup());

    // 2) Sembrar un partido scheduled 0-0
    const runId = fixture.runId;
    externalRef = `test-wh-e2e-${runId}`;
    const [m] = await seedMatches([
      editableMatch({ matchday: 1, externalRef }),
    ]);
    if (!m) throw new Error("seedMatches no devolvió fila");
    matchId = m.id;
    homeTeam = m.home_team;
    awayTeam = m.away_team;
    stack.add(() => deleteMatches([matchId]));

    // 3) Sembrar predicciones para los miembros de la liga
    // User 0 (viewer): predice 2-1 (exacto en WHK-01)
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId,
      home: 2,
      away: 1,
      multiplier: 1.0,
    });
    // User 1: predice 1-0 (resultado correcto en WHK-01)
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[1]!.userId,
      matchId,
      home: 1,
      away: 0,
      multiplier: 1.0,
    });
    // User 2: predice 0-2 (incorrecto en WHK-01)
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[2]!.userId,
      matchId,
      home: 0,
      away: 2,
      multiplier: 1.0,
    });

    // 4) Sembrar un duelo activo de 10 puntos entre User 0 (creador) y User 1 (aceptador)
    challengeId = await seedChallenge({
      leagueId: fixture.league.id,
      matchId,
      creator: { email: fixture.users[0]!.email },
      pointsBet: 10,
      type: "direct",
      challengedId: fixture.users[1]!.userId,
      creatorPred: { home: 2, away: 1 },
    });
    await acceptChallengeAs(
      { email: fixture.users[1]!.email },
      challengeId,
      { home: 1, away: 0 },
    );

    // 5) Cambiar el estado del partido a live en la base de datos (con kickoff en el pasado)
    // Esto activa el duelo mediante el trigger tr_cancel_pending_challenges_on_match_start
    const { error: liveError } = await admin
      .from("matches")
      .update({
        status: "live",
        match_time: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        home_score: 0,
        away_score: 0,
      })
      .eq("id", matchId);
    if (liveError) throw liveError;
  });

  test.afterAll(async () => {
    await stack.run();
  });

  // ── WHK-12 & WHK-01 ──────────────────────────────────────────────────

  test("WHK-12 & WHK-01: finalized firmado cierra el circuito Realtime y actualiza producto", async () => {
    const page = fixture.users[0]!.page!;

    // Navegar viewer a /live y esperar a que la suscripción esté activa
    await page.goto("/standings");
    const liveLink = page.getByLabel("Ver tabla en vivo").first();
    await expect(liveLink).toBeVisible({ timeout: 10_000 });
    await liveLink.click();
    await page.waitForURL(/\/live/);
    await expect(page.getByText("En vivo").first()).toBeVisible({ timeout: 15_000 });

    // Dar tiempo para que el websocket se asiente en el backend
    await page.waitForTimeout(3000);

    // Guardar ID y timestamp para simular replay/idempotencia en WHK-02
    firstEventTs = new Date().toISOString();
    firstEventId = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join("");

    // Enviar match.finalized vía webhook (marcador 2-1)
    const result = await sendZafronixEvent(page.request, {
      type: "match.finalized",
      matchExternalRef: externalRef,
      ts: firstEventTs,
      eventId: firstEventId,
      payload: {
        homeTeam,
        awayTeam,
        homeScore: 2,
        awayScore: 1,
        result: "2-1",
        extraTime: false,
        penalties: null,
        stage: "group_a",
        actor: "actor:test",
      },
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual(
      expect.objectContaining({ ok: true, event: "match.finalized" })
    );

    // [WHK-12 Verification] El board reacciona en tiempo real.
    // Como el partido finalizó, ya no hay partidos live -> se muestra el fallback en el board
    await expect(
      page.getByText("No hay partidos en juego en este momento.").first()
    ).toBeVisible({ timeout: 15_000 });

    // [WHK-01 Verification]
    // 1. Base de datos: marcador y estado actualizado
    const match = await getMatch(matchId);
    expect(match).toBeDefined();
    expect(match!.status).toBe("finished");
    expect(match!.home_score).toBe(2);
    expect(match!.away_score).toBe(1);

    // 2. UI: Ir a /standings y verificar los puntos oficiales actualizados
    // User 0 (predijo 2-1): exacto -> 5.0 pts
    // User 1 (predijo 1-0): resultado -> 2.0 pts
    // User 2 (predijo 0-2): miss -> 0.0 pts
    await page.goto("/standings");
    await expect(page.getByTestId("standings-row")).toHaveCount(3);
    const row0 = page.locator(`[data-testid="standings-row"][data-user-id="${fixture.users[0]!.userId}"]`).first();
    const row1 = page.locator(`[data-testid="standings-row"][data-user-id="${fixture.users[1]!.userId}"]`).first();
    const row2 = page.locator(`[data-testid="standings-row"][data-user-id="${fixture.users[2]!.userId}"]`).first();
    await expect(row0.getByTestId("standings-points")).toHaveText("5.0");
    await expect(row1.getByTestId("standings-points")).toHaveText("2.0");
    await expect(row2.getByTestId("standings-points")).toHaveText("0.0");

    // 3. UI: Ir a /predictions y verificar la card del partido
    await page.goto("/predictions");
    const card = page
      .locator("article", { hasText: homeTeam })
      .filter({ hasText: awayTeam })
      .first();
    await expect(card.getByText("Finalizado")).toBeVisible();
    await expect(card.getByTestId("actual-home-score")).toHaveText("2");
    await expect(card.getByTestId("actual-away-score")).toHaveText("1");
    await expect(card.getByTestId("your-prediction")).toContainText(
      "Tu pronóstico: 2 - 1"
    );
    const badge = card.getByTestId("points-badge");
    await expect(badge).toHaveAttribute("data-variant", "exact");
    await expect(badge).toContainText("¡Exacto!");
    await expect(badge).toContainText("+5.00 pts");
  });

  // ── WHK-02 ──────────────────────────────────────────────────────────

  test("WHK-02: finalized → accrual idempotente (reenvío del mismo evento)", async () => {
    const page = fixture.users[0]!.page!;

    // Guardar saldos de wager_balance previos
    const prevBal0 = await getWagerBalance(fixture.league.id, fixture.users[0]!.userId);
    const prevBal1 = await getWagerBalance(fixture.league.id, fixture.users[1]!.userId);
    const prevBal2 = await getWagerBalance(fixture.league.id, fixture.users[2]!.userId);

    // Reenviar exactamente el mismo evento (mismo ts e ID)
    const result = await sendZafronixEvent(page.request, {
      type: "match.finalized",
      matchExternalRef: externalRef,
      ts: firstEventTs,
      eventId: firstEventId,
      payload: {
        homeTeam,
        awayTeam,
        homeScore: 2,
        awayScore: 1,
        result: "2-1",
        extraTime: false,
        penalties: null,
        stage: "group_a",
        actor: "actor:test",
      },
    });

    // Debería responder 200 ok (procesado de forma atómica/idempotente)
    expect(result.status).toBe(200);

    // Saldo en base de datos no debe duplicarse ni alterarse
    const bal0 = await getWagerBalance(fixture.league.id, fixture.users[0]!.userId);
    const bal1 = await getWagerBalance(fixture.league.id, fixture.users[1]!.userId);
    const bal2 = await getWagerBalance(fixture.league.id, fixture.users[2]!.userId);

    expect(bal0).toBe(prevBal0);
    expect(bal1).toBe(prevBal1);
    expect(bal2).toBe(prevBal2);

    // Validar ledger invariant
    await assertLedgerInvariant(fixture.league.id);
  });

  // ── WHK-03 ──────────────────────────────────────────────────────────

  test("WHK-03: finalized → duelos liquidados y visibles en UI", async () => {
    const page = fixture.users[0]!.page!;

    // 1. BD Check: El duelo debe figurar completado y con ganador User 0
    const challenge = await getChallenge(challengeId);
    expect(challenge).toBeDefined();
    expect(challenge!.status).toBe("completed");
    expect(challenge!.winner_ids).toEqual([fixture.users[0]!.userId]);

    // 2. BD Check: Los balances de puntos deben reflejar la liquidación del pot
    // User 0 (creador): 100 inicial - 10 bet + 20 pot = 110
    // User 1 (aceptador): 100 inicial - 10 bet = 90
    const bal0 = await getWagerBalance(fixture.league.id, fixture.users[0]!.userId);
    const bal1 = await getWagerBalance(fixture.league.id, fixture.users[1]!.userId);
    // User 0: 100 inicial - 10 bet + 20 pot + 5.0 exact prediction = 115
    // User 1: 100 inicial - 10 bet + 2.0 result prediction = 92
    expect(bal0).toBe(115);
    expect(bal1).toBe(92);

    // 3. UI Check: Ir a /duels y verificar el saldo de la cartera de duelos
    await page.goto("/duels");
    // Debe mostrar la billetera de duelos con saldo 115.0 (o similar)
    const wallet = page.getByTestId("duel-balance").first();
    await expect(wallet).toContainText("115.00");

    // Y el reto debe aparecer en la pestaña historial
    const completedTab = page.getByRole("button", { name: /historial/i }).first();
    await completedTab.click();
    const duelCard = page.locator(`[data-testid="duel-card"][data-challenge-id="${challengeId}"]`).first();
    await expect(duelCard).toBeVisible();
    await expect(duelCard).toContainText("Ganado");
  });

  // ── WHK-04 ──────────────────────────────────────────────────────────

  test("WHK-04: match.patched corrige marcador, predicciones y ledger", async () => {
    const page = fixture.users[0]!.page!;

    // Enviar corrección match.patched: el marcador pasa de 2-1 a 1-1
    const result = await sendZafronixEvent(page.request, {
      type: "match.patched",
      matchExternalRef: externalRef,
      payload: {
        homeTeam,
        awayTeam,
        changes: {
          homeScore: { from: 2, to: 1 },
          awayScore: { from: 1, to: 1 },
        },
        actor: "actor:test",
      },
    });

    expect(result.status).toBe(200);

    // 1. BD Check: Marcador actualizado a 1-1
    const match = await getMatch(matchId);
    expect(match!.home_score).toBe(1);
    expect(match!.away_score).toBe(1);

    // 2. BD Check: Puntos ganados corregidos para predicciones
    // User 0 (predijo 2-1): miss -> 0 pts
    // User 1 (predijo 1-0): miss -> 0 pts
    // User 2 (predijo 0-2): miss -> 0 pts
    const p0 = await getPrediction(fixture.league.id, fixture.users[0]!.userId, matchId);
    const p1 = await getPrediction(fixture.league.id, fixture.users[1]!.userId, matchId);
    expect(p0!.points_earned).toBe(0);
    expect(p1!.points_earned).toBe(0);

    // 3. BD Check: El duelo debe ser re-liquidado
    // Ambos participantes predijeron 2-1 (error = |2-1| + |1-1| = 1) y 1-0 (error = |1-0| + |1-1| = 1)
    // Es un empate exacto -> El pozo se divide 50/50.
    // User 0: 100 inicial - 10 bet + 10 reembolso = 100
    // User 1: 100 inicial - 10 bet + 10 reembolso = 100
    const bal0 = await getWagerBalance(fixture.league.id, fixture.users[0]!.userId);
    const bal1 = await getWagerBalance(fixture.league.id, fixture.users[1]!.userId);
    expect(bal0).toBe(100);
    expect(bal1).toBe(100);

    // 4. Validar ledger invariant
    await assertLedgerInvariant(fixture.league.id);

    // 5. UI Check: Standings actualizados
    await page.goto("/standings");
    await expect(page.getByTestId("standings-row")).toHaveCount(3);
    const rowUser0 = page.locator(`[data-testid="standings-row"][data-user-id="${fixture.users[0]!.userId}"]`).first();
    const rowUser1 = page.locator(`[data-testid="standings-row"][data-user-id="${fixture.users[1]!.userId}"]`).first();
    await expect(rowUser0.getByTestId("standings-points")).toHaveText("0.0");
    await expect(rowUser1.getByTestId("standings-points")).toHaveText("0.0");
  });

  // ── WHK-05 ──────────────────────────────────────────────────────────

  test("WHK-05: match.postponed anula predicciones y reembolsa escrow", async () => {
    const page = fixture.users[0]!.page!;

    // 1) Crear un partido scheduled para postponed
    const runId = fixture.runId;
    const postExternalRef = `test-wh-postponed-${runId}`;
    const [mPost] = await seedMatches([
      editableMatch({ home: "brazil", away: "argentina", externalRef: postExternalRef }),
    ]);
    if (!mPost) throw new Error("seedMatches no devolvió fila");
    const postMatchId = mPost.id;
    const postHomeTeam = mPost.home_team;
    const postAwayTeam = mPost.away_team;
    stack.add(() => deleteMatches([postMatchId]));

    // 2) Sembrar predicción para User 0
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId: postMatchId,
      home: 2,
      away: 0,
      multiplier: 1.0,
    });

    // 3) Sembrar reto directo en scheduled (pasa a pending)
    const postChallengeId = await seedChallenge({
      leagueId: fixture.league.id,
      matchId: postMatchId,
      creator: { email: fixture.users[0]!.email },
      pointsBet: 20,
      type: "direct",
      challengedId: fixture.users[1]!.userId,
      creatorPred: { home: 2, away: 0 },
    });

    // Escrow retenido: User 0 balance = 100 - 20 = 80
    const initBal0 = await getWagerBalance(fixture.league.id, fixture.users[0]!.userId);
    expect(initBal0).toBe(80);

    // 4) Enviar evento match.postponed vía webhook
    const result = await sendZafronixEvent(page.request, {
      type: "match.postponed",
      matchExternalRef: postExternalRef,
      payload: {
        homeTeam: postHomeTeam,
        awayTeam: postAwayTeam,
        status: "postponed",
        reason: "Stadium issues",
        actor: "actor:test",
      },
    });

    expect(result.status).toBe(200);

    // 5. BD Check: Estado suspendido, predicción a 0 evaluada, duelo cancelado, escrow devuelto
    const match = await getMatch(postMatchId);
    expect(match!.status).toBe("suspended");

    const pred = await getPrediction(fixture.league.id, fixture.users[0]!.userId, postMatchId);
    expect(pred!.points_earned).toBe(0);
    expect(pred!.evaluated_at).not.toBeNull();

    const challenge = await getChallenge(postChallengeId);
    expect(challenge!.status).toBe("canceled");

    const finalBal0 = await getWagerBalance(fixture.league.id, fixture.users[0]!.userId);
    expect(finalBal0).toBe(100); // Reembolsado

    await assertLedgerInvariant(fixture.league.id);

    // 6. UI Check: Card de predicción muestra Suspendido
    await page.goto("/predictions");
    const card = page
      .locator("article", { hasText: postHomeTeam })
      .filter({ hasText: postAwayTeam })
      .first();
    await expect(card.getByText("Suspendido")).toBeVisible();
  });

  // ── WHK-06 ──────────────────────────────────────────────────────────

  test("WHK-06: webhook con firma inválida es rechazado con 401", async () => {
    const page = fixture.users[0]!.page!;

    const result = await sendZafronixEvent(page.request, {
      type: "match.finalized",
      matchExternalRef: externalRef,
      badSignature: true,
      payload: {
        homeTeam,
        awayTeam,
        homeScore: 3,
        awayScore: 0,
        result: "3-0",
      },
    });

    expect(result.status).toBe(401);
    expect(result.body).toEqual(
      expect.objectContaining({
        error: "signature_mismatch",
      })
    );

    // Verificar que el marcador sigue intacto en BD (1-1)
    const match = await getMatch(matchId);
    expect(match!.home_score).toBe(1);
    expect(match!.away_score).toBe(1);
  });

  // ── WHK-07 ──────────────────────────────────────────────────────────

  test("WHK-07: webhook con replay antiguo es rechazado con 401", async () => {
    const page = fixture.users[0]!.page!;
    const oldTimestamp = Date.now() - 6 * 60 * 1000; // 6 minutos atrás

    const result = await sendZafronixEvent(page.request, {
      type: "match.finalized",
      matchExternalRef: externalRef,
      timestampOverride: oldTimestamp,
      payload: {
        homeTeam,
        awayTeam,
        homeScore: 3,
        awayScore: 0,
        result: "3-0",
      },
    });

    expect(result.status).toBe(401);
    expect(result.body).toEqual(
      expect.objectContaining({
        error: "replay_rejected",
      })
    );
  });

  // ── WHK-08 ──────────────────────────────────────────────────────────

  test("WHK-08: evento fuera de orden (ts anterior) es ignorado", async () => {
    const page = fixture.users[0]!.page!;

    // 1) Crear un partido para out-of-order
    const runId = fixture.runId;
    const oooRef = `test-wh-ooo-${runId}`;
    const [mOoo] = await seedMatches([
      liveMatch({ home: 0, away: 0 }, { matchday: 1, externalRef: oooRef }),
    ]);
    if (!mOoo) throw new Error("seedMatches no devolvió fila");
    const oooMatchId = mOoo.id;
    stack.add(() => deleteMatches([oooMatchId]));

    const timeLater = new Date(Date.now() + 10_000).toISOString();
    const timeEarlier = new Date(Date.now() - 10_000).toISOString();

    // Enviar evento de finalización con fecha LATER
    const r1 = await sendZafronixEvent(page.request, {
      type: "match.finalized",
      matchExternalRef: oooRef,
      ts: timeLater,
      payload: {
        homeTeam: mOoo.home_team,
        awayTeam: mOoo.away_team,
        homeScore: 2,
        awayScore: 0,
        result: "2-0",
      },
    });
    expect(r1.status).toBe(200);

    // Enviar evento de finalización con fecha EARLIER
    const r2 = await sendZafronixEvent(page.request, {
      type: "match.patched",
      matchExternalRef: oooRef,
      ts: timeEarlier,
      payload: {
        homeTeam: mOoo.home_team,
        awayTeam: mOoo.away_team,
        changes: {
          homeScore: { from: 2, to: 3 },
        },
      },
    });

    expect(r2.status).toBe(200);
    expect(r2.body).toEqual(
      expect.objectContaining({
        ok: true,
        ignored: true,
        reason: "out_of_order",
      })
    );

    // BD Check: El marcador debe seguir siendo 2-0 (no cambió a 3-0)
    const match = await getMatch(oooMatchId);
    expect(match!.home_score).toBe(2);
  });

  // ── WHK-09 ──────────────────────────────────────────────────────────

  test("WHK-09: payload malformado es rechazado con 400", async () => {
    const page = fixture.users[0]!.page!;

    const malformedBody = "{ malformed json: true }";
    const timestampMs = Date.now();
    const signature = signWebhookBody(malformedBody, TEST_WEBHOOK_SECRET, timestampMs);

    const result = await page.request.post(ZAFRONIX_WEBHOOK_PATH, {
      headers: {
        "Content-Type": "application/json",
        "X-Zafronix-Timestamp": String(timestampMs),
        "X-Zafronix-Signature-256": signature,
      },
      data: Buffer.from(malformedBody, "utf-8"),
    });

    expect(result.status()).toBe(400);
    const body = await result.json();
    expect(body).toEqual(
      expect.objectContaining({
        error: "invalid_json",
      })
    );
  });

  // ── WHK-10 ──────────────────────────────────────────────────────────

  test("WHK-10: matching de partido eliminatorio por bracket_slot", async () => {
    const page = fixture.users[0]!.page!;

    // 1) Crear un partido scheduled knockout con bracket_slot 999
    const runId = fixture.runId;
    const [koMatch] = await seedMatches([
      {
        home: "TBD",
        away: "TBD",
        status: "scheduled",
        stage: "r16",
        bracketSlot: 999,
        externalRef: `test-wh-ko-${runId}`,
        rawTeamNames: true,
      },
    ]);
    if (!koMatch) throw new Error("seedMatches no devolvió fila");
    const koMatchId = koMatch.id;
    stack.add(() => deleteMatches([koMatchId]));

    // 2) Enviar match.finalized usando bracketSlot en lugar de external_ref
    const result = await sendZafronixEvent(page.request, {
      type: "match.finalized",
      bracketSlot: 999,
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
    });

    expect(result.status).toBe(200);

    // BD Check: El partido debe haberse finalizado, con los equipos resueltos y el marcador asignado
    const match = await admin
      .from("matches")
      .select("status, home_team, away_team, home_score, away_score")
      .eq("id", koMatchId)
      .single();

    expect(match.error).toBeNull();
    expect(match.data!.status).toBe("finished");
    expect(match.data!.home_team).toBe("Germany");
    expect(match.data!.away_team).toBe("Japan");
    expect(match.data!.home_score).toBe(3);
    expect(match.data!.away_score).toBe(1);
  });

  // ── WHK-11 ──────────────────────────────────────────────────────────

  test("WHK-11: webhook con external_ref inexistente retorna 404", async () => {
    const page = fixture.users[0]!.page!;

    const result = await sendZafronixEvent(page.request, {
      type: "match.finalized",
      matchExternalRef: "test-wh-nonexistent-ref",
      payload: {
        homeTeam: "Mexico",
        awayTeam: "Colombia",
        homeScore: 1,
        awayScore: 0,
        result: "1-0",
      },
    });

    expect(result.status).toBe(404);
    expect(result.body).toEqual(
      expect.objectContaining({
        error: "not_found",
      })
    );
  });
});

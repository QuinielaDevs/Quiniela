/**
 * tests/e2e/live.spec.ts — Fase 8: Tabla en Vivo (Realtime)
 *
 * Prerequisito: `matches` tiene REPLICA IDENTITY FULL (migración
 * 20260610200000_matches_replica_identity_full.sql) para que Supabase
 * Realtime entregue eventos postgres_changes de tipo UPDATE.
 *
 * Predicciones diseñadas para que CADA incremento de marcador
 * reordene los puestos proyectados (forzar movers y toasts):
 *   user0 (viewer): predice 2-0  → exacto al 2do gol local
 *   user1:          predice 1-0  → exacto al 1er gol local
 *   user2:          predice 2-1  → exacto al 1er gol visitante
 *
 * Progresión de marcadores por test:
 *   LIVE-02: 0-0 → 1-0  (user1 exacto → rank3→rank1; viewer no sube)
 *   LIVE-04: 1-0 → 2-0  (user0 exacto → rank2→rank1; viewer ES el mover)
 *            2-0 → 2-1  (user2 exacto → rank3→rank1)
 *   LIVE-05: 2-1 → 3-1  (fresh toast para probar dismiss)
 *   LIVE-06: status → finished
 */

import { test, expect, type Page } from "@playwright/test";

import { createAdminClient } from "./helpers/admin";
import { createCleanupStack } from "./helpers/cleanup";
import { deleteMatches, liveMatch, seedMatches } from "./helpers/seed/matches";
import { seedPrediction } from "./helpers/seed/predictions";
import { createLeagueWithUsers, type LeagueWithUsers } from "./helpers/users";

// ────────────────────────────────────────────────────────────────────
// Helper de navegación
// ────────────────────────────────────────────────────────────────────

async function navigateToLivePage(page: Page): Promise<void> {
  // El login vía formulario ya pone las cookies de sesión en el contexto de
  // Playwright. createBrowserClient las lee automáticamente al montar el
  // componente, por lo que NO es necesario inyectar el JWT manualmente.
  await page.goto("/standings");
  const liveLink = page.getByLabel("Ver tabla en vivo").first();
  await expect(liveLink).toBeVisible({ timeout: 10_000 });
  await liveLink.click();
  await page.waitForURL(/\/live/);
}

// ────────────────────────────────────────────────────────────────────
// Suite
// ────────────────────────────────────────────────────────────────────

test.describe("Tabla en vivo (Realtime) (e2e)", () => {
  const admin = createAdminClient();
  const stack = createCleanupStack();

  let fixture: LeagueWithUsers;
  let matchId = "";
  let homeTeamName = "";

  test.beforeAll(async ({ browser }) => {
    // Liga de 3 usuarios; solo el primero (viewer) lleva contexto abierto.
    fixture = await createLeagueWithUsers(browser, {
      members: 3,
      admins: 1,
      eagerLogins: 1,
      leagueOpts: {
        name: "Liga Live E2E",
        paymentStatus: "paid",
        wagerBalance: 0,
      },
    });
    stack.add(() => fixture.cleanup());

    // Partido live 0-0
    const [m] = await seedMatches([liveMatch({ home: 0, away: 0 }, { matchday: 1 })]);
    if (!m) throw new Error("seedMatches no devolvió fila");
    matchId = m.id;
    homeTeamName = m.home_team;
    stack.add(() => deleteMatches([matchId]));

    // Predicciones diseñadas para reordenar con cada gol
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId,
      home: 2,
      away: 0,
      multiplier: 1.0,
    });
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[1]!.userId,
      matchId,
      home: 1,
      away: 0,
      multiplier: 1.0,
    });
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[2]!.userId,
      matchId,
      home: 2,
      away: 1,
      multiplier: 1.0,
    });

    // Sembrar ganancias de duelos en point_transactions para asegurar un orden de desempate determinista
    await admin.from("point_transactions").insert([
      {
        user_id: fixture.users[0]!.userId,
        league_id: fixture.league.id,
        amount: 30.0,
        description: "challenge_payout",
      },
      {
        user_id: fixture.users[1]!.userId,
        league_id: fixture.league.id,
        amount: 20.0,
        description: "challenge_payout",
      },
      {
        user_id: fixture.users[2]!.userId,
        league_id: fixture.league.id,
        amount: 10.0,
        description: "challenge_payout",
      },
    ]);

    // Navegar el viewer a /live y esperar suscripción Realtime activa
    const page = fixture.users[0]!.page!;
    await navigateToLivePage(page);
    await expect(page.getByText("En vivo").first()).toBeVisible({ timeout: 15_000 });
  });

  test.afterAll(async () => {
    await admin
      .from("point_transactions")
      .delete()
      .eq("league_id", fixture.league.id);
    await stack.run();
  });

  // ── LIVE-01 ────────────────────────────────────────────────────────

  test("LIVE-01: el board carga con el partido en vivo", async () => {
    const page = fixture.users[0]!.page!;

    const board = page.getByTestId("live-board").first();
    await expect(board).toBeVisible();

    // Una fila por miembro de la liga
    const rows = page.getByTestId("live-row");
    await expect(rows).toHaveCount(3);
  });

  // ── LIVE-02 ────────────────────────────────────────────────────────

  test("LIVE-02: Gol → toast @realtime", async () => {
    const page = fixture.users[0]!.page!;

    // Esperar a que la suscripción de Realtime esté completamente asentada
    await page.waitForTimeout(3000);

    // Marcador 0-0 → 1-0 vía service role
    const { error } = await admin
      .from("matches")
      .update({ home_score: 1, away_score: 0 })
      .eq("id", matchId);
    expect(error).toBeNull();

    // Toast debe aparecer:
    //   user1 (predijo 1-0) gana el exacto → sube al 1er puesto.
    //   viewer (user0) no sube → se anuncia el nuevo líder (user1).
    const toast = page.getByTestId("goal-toast").first();
    await expect(toast).toBeVisible({ timeout: 15_000 });

    // Texto del componente: "¡Gol de {equipo}! {nombre} sube al 1er puesto proyectado 🎉"
    await expect(toast).toContainText(`¡Gol de ${homeTeamName}!`);
    await expect(toast).toContainText("sube al 1er puesto proyectado 🎉");
  });

  // ── LIVE-03 ────────────────────────────────────────────────────────

  test("LIVE-03: Gol → reorden de filas @realtime", async () => {
    const page = fixture.users[0]!.page!;

    // Tras 0-0 → 1-0 (disparado en LIVE-02):
    //   user1: 5 pts (exacto) → rank 1
    //   user0: 2 pts (resultado correcto) → rank 2
    //   user2: 0 pts → rank 3
    //
    // Esperar a que la UI refleje el reorden (puede tardar el ciclo de render).
    const rows = page.getByTestId("live-row");
    await expect(rows).toHaveCount(3);

    // Primer live-row debe mostrar al jugador que subió al #1
    await expect(rows.nth(0)).toContainText("E2E Jugador 1", { timeout: 10_000 });
    await expect(rows.nth(1)).toContainText("E2E Jugador 0");
    await expect(rows.nth(2)).toContainText("E2E Jugador 2");
  });

  // ── LIVE-04 ────────────────────────────────────────────────────────

  test("LIVE-04: Goles consecutivos apilan toasts @realtime", async () => {
    const page = fixture.users[0]!.page!;

    // Gol 2 (local): 1-0 → 2-0 → user0 exacto (2-0) → sube al rank 1 (viewer!)
    const { error: e1 } = await admin
      .from("matches")
      .update({ home_score: 2, away_score: 0 })
      .eq("id", matchId);
    expect(e1).toBeNull();

    // Esperar que aparezca el goal-toast-stack con el primer toast nuevo
    const stack = page.getByTestId("goal-toast-stack");
    await expect(stack).toBeVisible({ timeout: 15_000 });

    // Gol 3 (visitante) ~2 s después: 2-0 → 2-1 → user2 exacto → rank 1
    await page.waitForTimeout(2000);
    const { error: e2 } = await admin
      .from("matches")
      .update({ home_score: 2, away_score: 1 })
      .eq("id", matchId);
    expect(e2).toBeNull();

    // Debe haber al menos 2 toasts visibles en el stack
    const toasts = page.getByTestId("goal-toast");
    await expect(toasts.nth(1)).toBeVisible({ timeout: 15_000 });
  });

  // ── LIVE-05 ────────────────────────────────────────────────────────

  test("LIVE-05: Dismiss del toast", async () => {
    // BUG-005 corregido: el pointerdown sobre el botón de descarte ya no inicia
    // el swipe ni captura el puntero, así que el click del botón llega.
    const page = fixture.users[0]!.page!;

    // Gol 4: 2-1 → 3-1 (genera toast fresco en caso de que los anteriores
    // se hayan auto-descartado tras los 5.5 s de AUTO_DISMISS_MS).
    //   A 3-1: user0(2pts), user1(2pts), user2(2pts) — los 3 empatados.
    //   En empate absoluto se ordenan físicamente por userId fallback.
    //   user0 (viewer) mejora su posición física (estaba rank2 tras 2-1) → mover anunciado: viewer.
    const { error } = await admin
      .from("matches")
      .update({ home_score: 3, away_score: 1 })
      .eq("id", matchId);
    expect(error).toBeNull();

    const firstToast = page.getByTestId("goal-toast").first();
    await expect(firstToast).toBeVisible({ timeout: 15_000 });

    // Contar toasts antes de descartar
    const countBefore = await page.getByTestId("goal-toast").count();

    // Click en el botón de dismiss (aria-label copiado de GoalToast.tsx)
    await firstToast.getByRole("button", { name: "Descartar notificación" }).click();

    // Un toast menos
    await expect(page.getByTestId("goal-toast")).toHaveCount(countBefore - 1, {
      timeout: 5_000,
    });
  });

  // ── LIVE-06 ────────────────────────────────────────────────────────

  test("LIVE-06: Partido pasa a finished @realtime", async () => {
    const page = fixture.users[0]!.page!;

    // Pasar partido a finished (sin cambiar el marcador, 3-1).
    const { error } = await admin
      .from("matches")
      .update({ status: "finished" })
      .eq("id", matchId);
    expect(error).toBeNull();

    // El board debe consolidar: ya no hay partidos live →
    // el texto cambia a "No hay partidos en vivo ahora." (copiado de LiveStandingsBoard.tsx)
    await expect(
      page.getByText("No hay partidos en vivo ahora.").first(),
    ).toBeVisible({ timeout: 15_000 });

    // Las filas siguen presentes (el partido finished está en el cálculo)
    await expect(page.getByTestId("live-row")).toHaveCount(3);
  });

  // ── LIVE-07 ────────────────────────────────────────────────────────

  test("LIVE-07: Puntos proyectados correctos", async () => {
    const page = fixture.users[0]!.page!;

    // Asegurar marcador 3-1 en caso de que LIVE-05 haya sido marcado fixme / saltado
    const { error } = await admin
      .from("matches")
      .update({ home_score: 3, away_score: 1 })
      .eq("id", matchId);
    expect(error).toBeNull();

    // Estado final: partido finished con marcador 3-1.
    //   user0 (2-0): resultado correcto (local gana) → base 2 pts × 1.0 = 2.0 pts
    //   user1 (1-0): resultado correcto (local gana) → base 2 pts × 1.0 = 2.0 pts
    //   user2 (2-1): resultado correcto (local gana) → base 2 pts × 1.0 = 2.0 pts
    // Los tres empatan a 2.0; el orden es por joined_at ascendente.
    //
    // El componente muestra totalPoints.toFixed(1) y un aria-label
    // "${totalPoints} puntos proyectados" (copiado de LiveStandingsBoard.tsx).
    const expectedPoints = 2; // 2 pts × 1.0x (multiplier sembrado)

    const rows = page.getByTestId("live-row");
    await expect(rows).toHaveCount(3);

    // Verificar que cada fila muestra el texto de puntos correcto
    for (let i = 0; i < 3; i++) {
      await expect(rows.nth(i)).toContainText(expectedPoints.toFixed(1), { timeout: 10_000 });
    }

    // Verificar aria-label de puntos (accesibilidad)
    const pointSpans = page.locator(`[aria-label="${expectedPoints} puntos proyectados"]`);
    await expect(pointSpans).toHaveCount(3);
  });

  // ── LIVE-08 ────────────────────────────────────────────────────────

  test("LIVE-08: Tendencia proyectada vs oficial @realtime", async () => {
    const page = fixture.users[0]!.page!;

    // Volver a poner el partido en live
    const { error: eLive } = await admin
      .from("matches")
      .update({ status: "live", home_score: 0, away_score: 0 })
      .eq("id", matchId);
    expect(eLive).toBeNull();

    // Navegar y esperar carga
    await page.goto("/live");
    await expect(page.getByText("En vivo").first()).toBeVisible({ timeout: 15_000 });

    const rows = page.getByTestId("live-row");
    await expect(rows).toHaveCount(3);

    // En 0-0, todos tienen 0 pts en la proyectada y 0 pts en la oficial -> sin cambios (0)
    for (let i = 0; i < 3; i++) {
      const trend = rows.nth(i).getByTestId("live-trend");
      await expect(trend).toHaveAttribute("data-change", "0", { timeout: 5000 });
    }

    // Gol 1 (local): 0-0 -> 1-0 -> user1 (E2E Jugador 1) tiene exacto (5 pts projected)
    // Oficial sigue vacío (todos rango oficial 1)
    // Proyectada: user1 es #1 (5 pts), user0 es #2 (2 pts), user2 es #3 (0 pts)
    // Tendencias proyectadas vs oficiales esperadas:
    //   user1: oRank 1, pRank 1 -> trend = 0
    //   user0: oRank 1, pRank 2 -> trend = -1
    //   user2: oRank 1, pRank 3 -> trend = -2
    const { error: eGoal } = await admin
      .from("matches")
      .update({ home_score: 1, away_score: 0 })
      .eq("id", matchId);
    expect(eGoal).toBeNull();

    const rowUser1 = rows.filter({ hasText: "E2E Jugador 1" });
    const rowUser0 = rows.filter({ hasText: "E2E Jugador 0" });
    const rowUser2 = rows.filter({ hasText: "E2E Jugador 2" });

    // Ranks oficiales (antes del partido live):
    //   user0 (30 pts duelos) -> rank 1
    //   user1 (20 pts duelos) -> rank 2
    //   user2 (10 pts duelos) -> rank 3
    //
    // Ranks proyectados (1-0):
    //   user1 (5 pts / exacto) -> rank 1
    //   user0 (2 pts / resultado) -> rank 2
    //   user2 (2 pts / resultado) -> rank 3 (user0 gana desempate por duelos 30 > 10)
    //
    // Cambios esperados (oRank - pRank):
    //   user1: 2 - 1 = +1 ("1")
    //   user0: 1 - 2 = -1 ("-1")
    //   user2: 3 - 3 = 0  ("0")
    await expect(rowUser1.getByTestId("live-trend")).toHaveAttribute("data-change", "1", { timeout: 15000 });
    await expect(rowUser0.getByTestId("live-trend")).toHaveAttribute("data-change", "-1", { timeout: 15000 });
    await expect(rowUser2.getByTestId("live-trend")).toHaveAttribute("data-change", "0", { timeout: 15000 });
  });
});

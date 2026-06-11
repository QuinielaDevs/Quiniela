import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import {
  createAuthenticatedContext,
  deleteE2EUser,
} from "./helpers/auth";
import { seedPredictionsE2E } from "./helpers/seed";

// E2E de la página /predictions con foco en partidos finalizados y el modo
// resultado de la MatchCard. Los seeds están en helpers/seed.ts.
//
// Estructura:
//   - beforeAll: crea usuario + liga + partidos + predicciones y abre sesión
//   - tests: navegan a /predictions y verifican UI
//   - afterAll: borra toda la data creada (orden inverso de FKs)

test.describe("/predictions — partidos finalizados (e2e)", () => {
  let context: Awaited<ReturnType<typeof createAuthenticatedContext>>;
  let cleanup: () => Promise<void>;

  test.beforeAll(async ({ browser }) => {
    context = await createAuthenticatedContext(browser);
    const seed = await seedPredictionsE2E(context.userId);
    cleanup = seed.cleanup;
  });

  test.afterAll(async () => {
    await cleanup?.();
    await deleteE2EUser(context.userId);
    await context?.context.close();
  });

  // ═══════════════════════════════════════════
  // Navegación y tabs
  // ═══════════════════════════════════════════

  test("la pestaña por defecto es la fase con partidos más cercanos en tiempo", async () => {
    // El seed tiene:
    //   - J1 scheduled: test_ecuador-test_peru (mañana, +1d)
    //   - J2 scheduled: test_mexico-test_canada (pasado mañana, +2d)
    // El más cercano en el tiempo con status scheduled es J1 → debe ser el
    // tab por defecto.
    const page = context.page;
    await page.goto("/predictions");
    const activeTab = page.locator('[role="tab"][aria-selected="true"]');
    await expect(activeTab).toContainText("Jornada 1");
  });

  test("puede navegar a tabs de fases pasadas (Jornada 1)", async () => {
    const page = context.page;
    await page.goto("/predictions");
    await page.locator('[role="tab"]', { hasText: "Jornada 1" }).click();
    // Debe ver partidos finalizados + el scheduled de J1
    await expect(page.getByText("Finalizado").first()).toBeVisible();
  });

  test("puede navegar a tabs de fases futuras (Jornada 2)", async () => {
    const page = context.page;
    await page.goto("/predictions");
    await page.locator('[role="tab"]', { hasText: "Jornada 2" }).click();
    await expect(page.getByText("test_mexico")).toBeVisible();
    await expect(page.getByText("test_canada")).toBeVisible();
  });

  // ═══════════════════════════════════════════
  // Cards finalizadas
  // ═══════════════════════════════════════════

  test("Jornada 1 muestra partidos finalizados + scheduled", async () => {
    const page = context.page;
    await page.goto("/predictions");
    await page.locator('[role="tab"]', { hasText: "Jornada 1" }).click();

    // test_argentina (finished), test_brasil (finished), test_uruguay (finished), test_ecuador (scheduled)
    await expect(page.getByText("test_argentina").first()).toBeVisible();
    await expect(page.getByText("test_brasil").first()).toBeVisible();
    await expect(page.getByText("test_uruguay").first()).toBeVisible();
    await expect(page.getByText("test_ecuador").first()).toBeVisible();

    // Al menos 3 badges "Finalizado"
    await expect(page.getByText("Finalizado")).toHaveCount(3);
  });

  test("partido finalizado muestra el resultado real (3-0)", async () => {
    const page = context.page;
    await page.goto("/predictions");
    await page.locator('[role="tab"]', { hasText: "Jornada 1" }).click();

    // test_argentina 3-0 test_bolivia
    const argCard = page
      .locator("article", { hasText: "test_argentina" })
      .filter({ hasText: "test_bolivia" })
      .first();
    await expect(argCard.getByTestId("actual-home-score")).toHaveText("3");
    await expect(argCard.getByTestId("actual-away-score")).toHaveText("0");
  });

  test("partido finalizado muestra la predicción del usuario", async () => {
    const page = context.page;
    await page.goto("/predictions");
    await page.locator('[role="tab"]', { hasText: "Jornada 1" }).click();

    // test_argentina 3-0 test_bolivia, predicción 2-0
    const argCard = page
      .locator("article", { hasText: "test_argentina" })
      .filter({ hasText: "test_bolivia" })
      .first();
    await expect(argCard.getByTestId("your-prediction")).toContainText(
      "Tu pronóstico: 2 - 0",
    );
  });

  test("badge amarillo (acierto parcial) en test_argentina 3-0 (predicción 2-0)", async () => {
    const page = context.page;
    await page.goto("/predictions");
    await page.locator('[role="tab"]', { hasText: "Jornada 1" }).click();

    const argCard = page
      .locator("article", { hasText: "test_argentina" })
      .filter({ hasText: "test_bolivia" })
      .first();
    const badge = argCard.getByTestId("points-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute("data-variant", "result");
    await expect(badge).toContainText("Acierto parcial");
    // El seed usa multiplier=1.25 para este caso: 2 base × 1.25 = 2.50 pts
    await expect(badge).toContainText("+2.50 pts");
    await expect(badge).toContainText("x1.25");
  });

  test("badge verde (acierto exacto) en test_brasil 1-1 (predicción 1-1)", async () => {
    const page = context.page;
    await page.goto("/predictions");
    await page.locator('[role="tab"]', { hasText: "Jornada 1" }).click();

    const braCard = page
      .locator("article", { hasText: "test_brasil" })
      .filter({ hasText: "test_colombia" })
      .first();
    const badge = braCard.getByTestId("points-badge");
    await expect(badge).toHaveAttribute("data-variant", "exact");
    await expect(badge).toContainText("¡Exacto!");
    // 5 base × 1.25 multiplicador = 6.25 pts
    await expect(badge).toContainText("+6.25 pts");
  });

  test("badge gris (fallo) en test_uruguay 0-2 (predicción 1-0)", async () => {
    const page = context.page;
    await page.goto("/predictions");
    await page.locator('[role="tab"]', { hasText: "Jornada 1" }).click();

    const uruCard = page
      .locator("article", { hasText: "test_uruguay" })
      .filter({ hasText: "test_chile" })
      .first();
    const badge = uruCard.getByTestId("points-badge");
    await expect(badge).toHaveAttribute("data-variant", "miss");
    await expect(badge).toContainText("Sin puntos");
    await expect(badge).toContainText("+0.00 pts");
  });

  test("card finalizada NO tiene GoalPickers (no editable)", async () => {
    const page = context.page;
    await page.goto("/predictions");
    await page.locator('[role="tab"]', { hasText: "Jornada 1" }).click();

    const argCard = page
      .locator("article", { hasText: "test_argentina" })
      .filter({ hasText: "test_bolivia" })
      .first();
    await expect(
      argCard.getByLabel(/Incrementar goles de test_argentina/),
    ).toHaveCount(0);
  });

  test("card finalizada NO tiene botón de deshacer", async () => {
    const page = context.page;
    await page.goto("/predictions");
    await page.locator('[role="tab"]', { hasText: "Jornada 1" }).click();

    const argCard = page
      .locator("article", { hasText: "test_argentina" })
      .filter({ hasText: "test_bolivia" })
      .first();
    await expect(
      argCard.getByRole("button", { name: "Deshacer cambio" }),
    ).toHaveCount(0);
  });

  test("partido live muestra 'En vivo' y GoalPickers deshabilitados", async () => {
    const page = context.page;
    await page.goto("/predictions");
    await page.locator('[role="tab"]', { hasText: "Jornada 1" }).click();

    const liveCard = page
      .locator("article", { hasText: "test_espana" })
      .filter({ hasText: "test_alemania" })
      .first();
    await expect(liveCard.getByText("En vivo")).toBeVisible();
    await expect(
      liveCard.getByLabel(/Incrementar goles de test_espana/),
    ).toBeDisabled();
    // No entra en modo resultado
    await expect(liveCard.getByTestId("points-badge")).toHaveCount(0);
  });

  test("partido suspended muestra 'Suspendido' sin resultado", async () => {
    const page = context.page;
    await page.goto("/predictions");
    await page.locator('[role="tab"]', { hasText: "Jornada 2" }).click();
    const suspendedCard = page
      .locator("article", { hasText: "test_francia" })
      .filter({ hasText: "test_italia" })
      .first();
    await expect(suspendedCard.getByText("Suspendido")).toBeVisible();
    await expect(suspendedCard.getByTestId("points-badge")).toHaveCount(0);
  });

  // ═══════════════════════════════════════════
  // Cards scheduled (editables)
  // ═══════════════════════════════════════════

  test("partido scheduled muestra GoalPickers funcionales", async () => {
    const page = context.page;
    await page.goto("/predictions");
    await page.locator('[role="tab"]', { hasText: "Jornada 1" }).click();

    const ecuCard = page
      .locator("article", { hasText: "test_ecuador" })
      .filter({ hasText: "test_peru" })
      .first();
    const plusBtn = ecuCard.getByLabel(/Incrementar goles de test_ecuador/);
    await expect(plusBtn).toBeEnabled();
    await plusBtn.click();
    await expect(ecuCard.getByText("1").first()).toBeVisible();
  });

  // ═══════════════════════════════════════════
  // Orden pending-first
  // ═══════════════════════════════════════════

  test("dentro de Jornada 1, partidos scheduled aparecen antes que finished", async () => {
    const page = context.page;
    await page.goto("/predictions");
    await page.locator('[role="tab"]', { hasText: "Jornada 1" }).click();

    // El primer article del tab debe ser el de test_ecuador (scheduled, único de J1).
    // Los finished (test_argentina, test_brasil, test_uruguay) vienen después.
    const firstInTab = page
      .locator("article")
      .filter({
        hasText: /test_argentina|test_brasil|test_uruguay|test_ecuador/,
      })
      .first();
    await expect(firstInTab).toContainText("test_ecuador");
  });

  // ═══════════════════════════════════════════
  // Chip de drift del multiplicador (would-be)
  // ═══════════════════════════════════════════
  // El chip ámbar con icono TrendingDown aparece al lado del multiplicador
  // guardado cuando el servidor daría un multiplicador MENOR al que el
  // usuario obtuvo originalmente. Comunica "el multiplicador que tienes es
  // X, pero si re-editas sería Y".
  //
  // El seed setea:
  //   - test_mexico (J2): saved=2.5x → drift a 1.25x (currentOrdinal=1, J2→distance=1)
  //   - test_ecuador (J1): saved=1.0x → sin drift (J1 base, ya en floor)
  //   - test_argentina (finished): N/A (el chip no aplica en finished)

  test("muestra chip de drift en J2 con saved=2.5x (would-be menor)", async () => {
    const page = context.page;
    await page.goto("/predictions");
    await page.locator('[role="tab"]', { hasText: "Jornada 2" }).click();

    const mexCard = page
      .locator("article", { hasText: "test_mexico" })
      .filter({ hasText: "test_canada" })
      .first();
    const chip = mexCard.getByTestId("multiplier-drift-chip");
    await expect(chip).toBeVisible();
    // El chip contiene el valor would-be "X.XXx" inline (con icono ↓).
    // El valor exacto depende del current_round_ordinal del servidor (puede
    // ser 1.00x, 1.25x, 1.50x... según partidos pasados en la BD), así que
    // extraemos el número del texto y verificamos que es < 2.5 (el guardado).
    const chipText = await chip.textContent();
    // El chip incluye separador "·" + icono (no texto) + valor. Buscamos
    // el patrón de número decimal.
    const match = chipText!.match(/(\d+\.\d+)x/);
    expect(match).not.toBeNull();
    const value = parseFloat(match![1]!);
    expect(value).toBeLessThan(2.5);
  });

  test("el multiplicador guardado (2.5x) sigue visible junto al chip de drift", async () => {
    const page = context.page;
    await page.goto("/predictions");
    await page.locator('[role="tab"]', { hasText: "Jornada 2" }).click();

    const mexCard = page
      .locator("article", { hasText: "test_mexico" })
      .filter({ hasText: "test_canada" })
      .first();
    // El guardado se muestra en gold (text-accent), jerarquía más alta
    // que el chip (text-muted-foreground inline).
    await expect(mexCard.getByText("2.5x")).toBeVisible();
    // El chip muted inline con el icono TrendingDown está presente
    await expect(mexCard.getByTestId("multiplier-drift-chip")).toBeVisible();
  });

  test("el chip de drift tiene aria-label descriptivo accesible", async () => {
    const page = context.page;
    await page.goto("/predictions");
    await page.locator('[role="tab"]', { hasText: "Jornada 2" }).click();

    const mexCard = page
      .locator("article", { hasText: "test_mexico" })
      .filter({ hasText: "test_canada" })
      .first();
    const chip = mexCard.getByTestId("multiplier-drift-chip");
    // El aria-label menciona el valor would-be. Verificamos el formato
    // sin hardcodear el valor (varía según current_round_ordinal).
    const ariaLabel = await chip.getAttribute("aria-label");
    expect(ariaLabel).toMatch(/^Si editas ahora el multiplicador bajaría a \d+\.\d+x$/);
    // El aria-label debe mencionar el mismo valor que el texto visible.
    // Extraemos el valor numérico del aria-label y del texto, y comparamos.
    const ariaMatch = ariaLabel!.match(/(\d+\.\d+)x$/);
    const ariaValue = ariaMatch![1];
    const chipText = await chip.textContent();
    // El chipText incluye "· ↓ X.XXx" — verificamos que contiene el valor.
    expect(chipText).toContain(ariaValue);
  });

  test("NO muestra chip de drift en J1 con saved=1.0x (ya en floor)", async () => {
    const page = context.page;
    await page.goto("/predictions");
    await page.locator('[role="tab"]', { hasText: "Jornada 1" }).click();

    // test_ecuador está en J1 con saved=1.0x. Aunque el torneo avance,
    // J1 siempre es 1.0x (línea base). No hay drift que mostrar.
    const ecuCard = page
      .locator("article", { hasText: "test_ecuador" })
      .filter({ hasText: "test_peru" })
      .first();
    await expect(ecuCard.getByText("1.0x")).toBeVisible();
    await expect(ecuCard.getByTestId("multiplier-drift-chip")).toHaveCount(0);
  });

  test("NO muestra chip de drift en partidos finished (delegado al PointsBadge)", async () => {
    const page = context.page;
    await page.goto("/predictions");
    await page.locator('[role="tab"]', { hasText: "Jornada 1" }).click();

    // test_argentina es un partido finished (con saved=1.25x). El chip
    // ámbar no debe aparecer porque el multiplicador ya se muestra en el
    // PointsBadge de resultados.
    const argCard = page
      .locator("article", { hasText: "test_argentina" })
      .filter({ hasText: "test_bolivia" })
      .first();
    await expect(argCard.getByTestId("multiplier-drift-chip")).toHaveCount(0);
  });

  // ═══════════════════════════════════════════
  // Test de transición del multiplicador (corrección de consistencia)
  // ═══════════════════════════════════════════
  test("transición del multiplicador: J2 pre-torneo vale 1.25x y al iniciar J1 baja a 1.00x", async () => {
    const page = context.page;
    const admin = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    // Obtener las IDs de los partidos sembrados para este test
    const { data: testMatches } = await admin
      .from("matches")
      .select("id, home_team, matchday")
      .like("home_team", "test_%");

    const matchIds = testMatches!.map(m => m.id);
    const j1MatchIds = testMatches!.filter(m => m.matchday === 1).map(m => m.id);
    const j2Match = testMatches!.find(m => m.home_team === "test_mexico")!;

    // 1) Estado Pre-Torneo: Todo programado en el futuro
    const futureTime = new Date();
    futureTime.setUTCDate(futureTime.getUTCDate() + 10);
    const futureTimeStr = futureTime.toISOString();

    await admin
      .from("matches")
      .update({ match_time: futureTimeStr })
      .in("id", matchIds);

    // Eliminar la predicción existente para test_mexico para probar el estado limpio (sin predicción previa)
    await admin
      .from("predictions")
      .delete()
      .eq("match_id", j2Match.id)
      .eq("user_id", context.userId);

    // Navegar y verificar que el multiplicador mostrado para J2 (test_mexico) es 1.25x (o 1.3x redondeado en UI)
    await page.goto("/predictions");
    await page.locator('[role="tab"]', { hasText: "Jornada 2" }).click();

    const mexCard = page
      .locator("article", { hasText: "test_mexico" })
      .filter({ hasText: "test_canada" })
      .first();

    // Verificamos que el multiplicador esperado para J2 pre-torneo es 1.3x (redondeado en UI)
    await expect(mexCard.getByTestId("multiplier-badge")).toHaveText("1.3x");

    // Guardar una predicción y verificar que en BD se graba exactamente como 1.25
    await mexCard.getByLabel(/Incrementar goles de test_mexico/).first().click();
    // Esperamos a que se guarde
    await expect(mexCard.getByTestId("save-status")).toHaveAttribute("data-state", "saved", { timeout: 10000 });

    const { data: predPre } = await admin
      .from("predictions")
      .select("multiplier")
      .eq("match_id", j2Match.id)
      .eq("user_id", context.userId)
      .single();

    expect(Number(predPre!.multiplier)).toBe(1.25);

    // 2) Estado Torneo Iniciado: Pasamos un partido de la J1 al pasado (kickoff)
    const pastTime = new Date();
    pastTime.setUTCHours(pastTime.getUTCHours() - 1);
    const pastTimeStr = pastTime.toISOString();

    const j1KickoffMatch = testMatches!.find(m => m.matchday === 1 && m.home_team === "test_ecuador")!;

    await admin
      .from("matches")
      .update({ match_time: pastTimeStr, status: "live" })
      .eq("id", j1KickoffMatch.id);

    // Recargar la página para limpiar estado de cookies/sesión
    await page.reload();
    await page.locator('[role="tab"]', { hasText: "Jornada 2" }).click();

    // La tarjeta de J2 ahora debe mostrar el chip de drift (next es 1.0x, saved es 1.25x -> drift)
    const driftChip = mexCard.getByTestId("multiplier-drift-chip");
    await expect(driftChip).toBeVisible();
    await expect(driftChip).toHaveText("1.00x");

    // Modificar la predicción de J2. Debe disparar la advertencia de degradación.
    await mexCard.getByLabel(/Incrementar goles de test_mexico/).first().click();

    const dialog = mexCard.getByRole("alertdialog", {
      name: "Advertencia de multiplicador",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Tu multiplicador bajara de 1.3x a 1.0x.");

    // Continuar y verificar que el multiplicador baja a 1.00x en la BD
    await dialog.getByRole("button", { name: "Continuar" }).click();
    await expect(mexCard.getByTestId("save-status")).toHaveAttribute("data-state", "saved", { timeout: 10000 });

    const { data: predPost } = await admin
      .from("predictions")
      .select("multiplier")
      .eq("match_id", j2Match.id)
      .eq("user_id", context.userId)
      .single();

    expect(Number(predPost!.multiplier)).toBe(1.00);

    // Restaurar los estados originales de los partidos para no romper la limpieza del afterAll
    for (const m of testMatches!) {
      let status = "scheduled";
      let match_time: string;
      if (m.home_team === "test_argentina" || m.home_team === "test_brasil" || m.home_team === "test_uruguay") {
        status = "finished";
        match_time = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      } else if (m.home_team === "test_espana") {
        status = "live";
        match_time = new Date().toISOString();
      } else if (m.home_team === "test_francia") {
        status = "suspended";
        match_time = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      } else {
        const days = m.matchday === 1 ? 1 : 2;
        match_time = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      }
      await admin
        .from("matches")
        .update({ status, match_time })
        .eq("id", m.id);
    }
  });
});

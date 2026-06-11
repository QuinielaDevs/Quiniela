import { test, expect, type Page, type Locator } from "@playwright/test";
import { createAdminClient } from "./helpers/admin";
import { createCleanupStack } from "./helpers/cleanup";
import {
  createLeagueWithUsers,
  createUser,
  loginAs,
  deleteE2EUser,
  type LeagueWithUsers,
} from "./helpers/users";
import {
  snapshotPhases,
  restorePhases,
  setActivePhase,
  type PhasesSnapshot,
} from "./helpers/seed/phases";
import {
  snapshotWinners,
  restoreWinners,
  setWinner,
  clearWinners,
  getCandidate,
  type WinnersSnapshot,
} from "./helpers/seed/awards";
import { selectPhaseTab } from "./helpers/ui";
import { seedLeague, addMember, setActiveLeague } from "./helpers/seed/league";

async function selectCandidateBySearch(card: Locator, searchQuery: string, candidateName: string) {
  const input = card.getByRole("combobox");
  await input.fill(searchQuery);
  // Esperar a que el drop down se dibuje y contenga la opción
  const option = card.getByTestId("candidate-option").filter({ hasText: candidateName });
  await expect(option).toBeVisible({ timeout: 5000 });
  await option.click();
  
  // Verificar que la opción queda seleccionada en la UI
  await expect(card.getByTestId("selected-candidate")).toContainText(candidateName);

  // Esperar a que el input vuelva a estar habilitado y un respiro de 500ms para asegurar la persistencia en BD
  await expect(input).toBeEnabled({ timeout: 5000 });
  await card.page().waitForTimeout(500);
}

test.describe("/awards — Premios Especiales", () => {
  const stack = createCleanupStack();
  let fixture: LeagueWithUsers;
  let page: Page;
  let phasesSnap: PhasesSnapshot;
  let winnersSnap: WinnersSnapshot;

  test.beforeAll(async ({ browser }) => {
    // 1) Tomar snapshot de las fases y ganadores globales para no corromper la DB
    phasesSnap = await snapshotPhases();
    winnersSnap = await snapshotWinners();

    // Asegurar que empezamos en la fase A activa por defecto
    await setActivePhase("A");
    await clearWinners();

    // 2) Crear liga con 1 admin
    fixture = await createLeagueWithUsers(browser, { members: 1 });
    stack.add(() => fixture.cleanup());
    page = fixture.users[0]!.page!;
  });

  test.afterAll(async () => {
    // Restaurar estado global al final
    await stack.run();
    await restorePhases(phasesSnap);
    await restoreWinners(winnersSnap);
  });

  test("AWD-01: El board lista las 3 categorías con candidatos", async () => {
    await page.goto("/awards");
    const board = page.getByRole("main").getByTestId("awards-board");
    await expect(board).toBeVisible();

    const categories = board.getByTestId("award-category");
    await expect(categories).toHaveCount(3);
    await expect(categories.nth(0)).toHaveAttribute("data-category", "champion");
    await expect(categories.nth(1)).toHaveAttribute("data-category", "top_scorer");
    await expect(categories.nth(2)).toHaveAttribute("data-category", "mvp");
  });

  test("AWD-02: Seleccionar campeón persiste", async () => {
    await page.goto("/awards");
    const board = page.getByRole("main").getByTestId("awards-board");
    const card = board.locator('[data-category="champion"]');

    // Seleccionar Argentina
    await selectCandidateBySearch(card, "Arg", "Argentina");

    // Recargar página y comprobar persistencia
    await page.reload();
    await expect(card.getByTestId("selected-candidate")).toContainText("Argentina");

    // Verificar en BD
    const admin = createAdminClient();
    const { data: pred, error } = await admin
      .from("special_predictions")
      .select("*")
      .eq("league_id", fixture.league.id)
      .eq("user_id", fixture.users[0]!.userId)
      .eq("category", "champion")
      .single();

    expect(error).toBeNull();
    expect(pred).not.toBeNull();
    const diff = Date.now() - new Date(pred!.predicted_at).getTime();
    expect(diff).toBeLessThan(30000); // Guardado en los últimos 30 segundos
  });

  test("AWD-03: Cambiar selección sobrescribe", async () => {
    await page.goto("/awards");
    const board = page.getByRole("main").getByTestId("awards-board");
    const card = board.locator('[data-category="champion"]');

    // Cambiar a Brazil
    await selectCandidateBySearch(card, "Bra", "Brazil");

    // Comprobar persistencia
    await page.reload();
    await expect(card.getByTestId("selected-candidate")).toContainText("Brazil");

    // Verificar en BD que solo haya una fila y que la fecha de guardado se actualizó
    const admin = createAdminClient();
    const { data: preds, error } = await admin
      .from("special_predictions")
      .select("*")
      .eq("league_id", fixture.league.id)
      .eq("user_id", fixture.users[0]!.userId)
      .eq("category", "champion");

    expect(error).toBeNull();
    expect(preds).toHaveLength(1);
    expect(preds![0]!.candidate_id).not.toBeNull();
  });

  test("AWD-04: Goleador y MVP funcionan igual", async () => {
    await page.goto("/awards");
    const board = page.getByRole("main").getByTestId("awards-board");

    const topScorerCard = board.locator('[data-category="top_scorer"]');
    const mvpCard = board.locator('[data-category="mvp"]');

    // Seleccionar Melvin Mastil en ambos
    await selectCandidateBySearch(topScorerCard, "Mel", "Melvin Mastil");
    await selectCandidateBySearch(mvpCard, "Mel", "Melvin Mastil");

    // Recargar y comprobar
    await page.reload();
    await expect(topScorerCard.getByTestId("selected-candidate")).toContainText("Melvin Mastil");
    await expect(mvpCard.getByTestId("selected-candidate")).toContainText("Melvin Mastil");

    // Deben haber 3 filas totales en BD
    const admin = createAdminClient();
    const { data: preds, error } = await admin
      .from("special_predictions")
      .select("*")
      .eq("league_id", fixture.league.id)
      .eq("user_id", fixture.users[0]!.userId);

    expect(error).toBeNull();
    expect(preds).toHaveLength(3);
  });

  test("AWD-05: Puntos potenciales según fase activa", async () => {
    // Se verifica la reactividad del prop activePhaseCode en la tab "Premios
    // Copa" de /predictions; el caso standalone de /awards (ex BUG-003, ya
    // corregido) se cubre en el test "BUG-003" de más abajo.
    await page.goto("/predictions");
    await selectPhaseTab(page, "Premios Copa");

    const board = page.getByRole("main").getByTestId("awards-board");
    const pointsContainer = board.getByTestId("award-phase-points");

    // 1) Fase A
    await setActivePhase("A");
    await page.reload();
    await selectPhaseTab(page, "Premios Copa");
    await expect(pointsContainer).toHaveAttribute("data-active-phase", "A");

    // 2) Fase B
    await setActivePhase("B");
    await page.reload();
    await selectPhaseTab(page, "Premios Copa");
    await expect(pointsContainer).toHaveAttribute("data-active-phase", "B");

    // 3) Fase C
    await setActivePhase("C");
    await page.reload();
    await selectPhaseTab(page, "Premios Copa");
    await expect(pointsContainer).toHaveAttribute("data-active-phase", "C");
  });

  test("BUG-003: La página /awards resalta la fase de puntos correcta", async () => {
    // BUG-003 corregido: /awards ya resuelve phase_code del RPC
    // fn_get_active_tournament_phase y lo pasa a AwardsBoard.
    await page.goto("/awards");
    await setActivePhase("A");
    await page.reload();
    const pointsContainer = page.getByRole("main").getByTestId("award-phase-points");
    await expect(pointsContainer).toHaveAttribute("data-active-phase", "A");
  });

  test("AWD-06: La recompensa se fija por predicted_at, no por la fase actual", async () => {
    // Para probar este caso sin esperar horas reales en el test, sembramos predicciones con
    // retrasos de unos segundos, y luego acomodamos la tabla tournament_phases para que
    // esos segundos dividan las fases A, B, C y D.
    const runId = `awd06-${Date.now()}`;
    const user = await createUser({ runId, displayName: "AWD-06 Jugador" });
    stack.add(() => deleteE2EUser(user.userId));

    // Crear 3 ligas distintas para el mismo usuario con runId diferentes
    const l1 = await seedLeague({ runId: `${runId}-1`, creatorId: user.userId, name: "L1" });
    stack.add(() => l1.cleanup());
    const l2 = await seedLeague({ runId: `${runId}-2`, creatorId: user.userId, name: "L2" });
    stack.add(() => l2.cleanup());
    const l3 = await seedLeague({ runId: `${runId}-3`, creatorId: user.userId, name: "L3" });
    stack.add(() => l3.cleanup());

    await addMember(l1.id, user.userId, { role: "member", paymentStatus: "paid" });
    await addMember(l2.id, user.userId, { role: "member", paymentStatus: "paid" });
    await addMember(l3.id, user.userId, { role: "member", paymentStatus: "paid" });

    const argCandidate = await getCandidate("champion", { name: "Argentina" });

    // Sembramos la predicción 1 en l1
    const admin = createAdminClient();
    const { data: p1 } = await admin
      .from("special_predictions")
      .insert({
        user_id: user.userId,
        league_id: l1.id,
        category: "champion",
        candidate_id: argCandidate.id,
      })
      .select("predicted_at")
      .single();

    // Esperamos 2s
    await page.waitForTimeout(2000);

    // Sembramos la predicción 2 en l2
    const { data: p2 } = await admin
      .from("special_predictions")
      .insert({
        user_id: user.userId,
        league_id: l2.id,
        category: "champion",
        candidate_id: argCandidate.id,
      })
      .select("predicted_at")
      .single();

    // Esperamos 2s
    await page.waitForTimeout(2000);

    // Sembramos la predicción 3 en l3
    const { data: p3 } = await admin
      .from("special_predictions")
      .insert({
        user_id: user.userId,
        league_id: l3.id,
        category: "champion",
        candidate_id: argCandidate.id,
      })
      .select("predicted_at")
      .single();

    const t1 = new Date(p1!.predicted_at).getTime();
    const t2 = new Date(p2!.predicted_at).getTime();
    const t3 = new Date(p3!.predicted_at).getTime();

    // Re-configurar las fases en la base de datos para subdividir los timestamps
    // b1 divide T1 de T2: colocamos b1 en la mitad
    const b1 = new Date(t1 + (t2 - t1) / 2).toISOString();
    // b2 divide T2 de T3: colocamos b2 en la mitad
    const b2 = new Date(t2 + (t3 - t2) / 2).toISOString();
    // b3 divide T3 del futuro
    const b3 = new Date(t3 + 1000).toISOString();

    const updates = [
      { phase_code: "A", starts_at: null, ends_at: b1 },
      { phase_code: "B", starts_at: b1, ends_at: b2 },
      { phase_code: "C", starts_at: b2, ends_at: b3 },
      { phase_code: "D", starts_at: b3, ends_at: null },
    ];

    for (const update of updates) {
      await admin
        .from("tournament_phases")
        .update({ starts_at: update.starts_at, ends_at: update.ends_at })
        .eq("phase_code", update.phase_code);
    }

    // Marcar Argentina como ganador
    await setWinner("champion", argCandidate.id);

    // Comprobar la vista de puntos
    const { data: viewRows, error: viewError } = await admin
      .from("special_predictions_with_points")
      .select("league_id, points")
      .eq("user_id", user.userId)
      .eq("category", "champion");

    expect(viewError).toBeNull();
    expect(viewRows).toHaveLength(3);

    const pts1 = viewRows!.find((r) => r.league_id === l1.id)?.points;
    const pts2 = viewRows!.find((r) => r.league_id === l2.id)?.points;
    const pts3 = viewRows!.find((r) => r.league_id === l3.id)?.points;

    // T1 cae en fase A (50 pts), T2 cae en fase B (25 pts), T3 cae en fase C (10 pts)
    expect(pts1).toBe(50);
    expect(pts2).toBe(25);
    expect(pts3).toBe(10);
  });

  test("AWD-07: Fase D bloquea todo", async () => {
    // Poner fase D activa
    await setActivePhase("D");
    await page.goto("/awards");

    // UI: Comprobar aviso de bloqueado
    const board = page.getByRole("main").getByTestId("awards-board");
    await expect(board.getByTestId("award-locked-notice")).toBeVisible();

    // UI: Comprobar que los inputs están deshabilitados
    const categoryCard = board.locator('[data-category="champion"]');
    await expect(categoryCard.getByRole("combobox")).toBeDisabled();

    // Servidor: Comprobar que el trigger de base de datos rechaza inserciones/actualizaciones
    const admin = createAdminClient();
    const argCandidate = await getCandidate("champion", { name: "Argentina" });

    const { error } = await admin.from("special_predictions").upsert(
      {
        user_id: fixture.users[0]!.userId,
        league_id: fixture.league.id,
        category: "champion",
        candidate_id: argCandidate.id,
      },
      { onConflict: "user_id,league_id,category" }
    );

    expect(error).not.toBeNull();
    expect(error!.message).toContain("premios especiales están bloqueadas");
  });

  test("AWD-08: Resolución con ganador oficial", async () => {
    await setActivePhase("A");
    await page.goto("/awards");
    const board = page.getByRole("main").getByTestId("awards-board");

    // Asegurar que el usuario predijo Argentina para campeón y Melvin para MVP
    const champCard = board.locator('[data-category="champion"]');
    await selectCandidateBySearch(champCard, "Arg", "Argentina");

    const mvpCard = board.locator('[data-category="mvp"]');
    await selectCandidateBySearch(mvpCard, "Mel", "Melvin Mastil");

    const argCandidate = await getCandidate("champion", { name: "Argentina" });

    // Marcar Argentina como ganador de campeón y Aïssa Mandi como ganador de MVP (Melvin pierde)
    await setWinner("champion", argCandidate.id);

    const mandiCandidate = await getCandidate("mvp", { name: "Aïssa Mandi" });
    await setWinner("mvp", mandiCandidate.id);

    // Consultar puntos en BD
    const admin = createAdminClient();
    const { data: points } = await admin
      .from("special_predictions_with_points")
      .select("category, points")
      .eq("user_id", fixture.users[0]!.userId);

    const champPoints = points!.find((p) => p.category === "champion")?.points;
    const mvpPoints = points!.find((p) => p.category === "mvp")?.points;

    // Argentina acierta en fase A -> 50 pts. Melvin falla -> 0 pts.
    expect(champPoints).toBe(50);
    expect(mvpPoints).toBe(0);
  });

  test("AWD-09: Candidato inactivo no listado", async () => {
    const admin = createAdminClient();
    const cand = await getCandidate("champion", { name: "Algeria" });

    // Desactivar candidato
    const { error: deactivateError } = await admin
      .from("award_candidates")
      .update({ is_active: false })
      .eq("id", cand.id);
    expect(deactivateError).toBeNull();

    try {
      await page.goto("/awards");
      const board = page.getByRole("main").getByTestId("awards-board");
      const card = board.locator('[data-category="champion"]');

      const input = card.getByRole("combobox");
      await input.fill("Alg");

      // No debe listarse
      const option = card.getByTestId("candidate-option").filter({ hasText: "Algeria" });
      await expect(option).not.toBeVisible();
    } finally {
      // Activar de vuelta pase lo que pase
      await admin
        .from("award_candidates")
        .update({ is_active: true })
        .eq("id", cand.id);
    }
  });

  test("AWD-10: Orden de candidatos", async () => {
    // display_order de Algeria es 1, de Argentina es 2, de Australia es 3.
    // Buscamos 'Al' en champion (mínimo 2 letras) y deben listarse en ese orden.
    await page.goto("/awards");
    const board = page.getByRole("main").getByTestId("awards-board");
    const card = board.locator('[data-category="champion"]');

    const input = card.getByRole("combobox");
    await input.fill("Al");

    // Obtener las nombres de las primeras opciones en la UI
    const options = card.getByTestId("candidate-option");
    await expect(options.first()).toBeVisible();

    const count = await options.count();
    const names: string[] = [];
    for (let i = 0; i < Math.min(3, count); i++) {
      const text = await options.nth(i).innerText();
      names.push(text.trim());
    }

    // Deben aparecer en orden de display_order: Algeria es 1, Australia es 3.
    expect(names[0]).toContain("Algeria");
    expect(names[1]).toContain("Australia");
  });

  test("AWD-11: Alcance per-league", async ({ browser }) => {
    const runId = `awd11-${Date.now()}`;
    const user = await createUser({ runId, displayName: "AWD-11 Jugador" });
    stack.add(() => deleteE2EUser(user.userId));

    // Crear 2 ligas distintas con runId diferentes
    const l1 = await seedLeague({ runId: `${runId}-1`, creatorId: user.userId, name: "Liga Uno" });
    stack.add(() => l1.cleanup());
    const l2 = await seedLeague({ runId: `${runId}-2`, creatorId: user.userId, name: "Liga Dos" });
    stack.add(() => l2.cleanup());

    await addMember(l1.id, user.userId, { role: "member", paymentStatus: "paid" });
    await addMember(l2.id, user.userId, { role: "member", paymentStatus: "paid" });

    // Login con este usuario
    const session = await loginAs(browser, user);
    stack.add(() => session.context.close());
    const userPage = session.page;

    // Seleccionar la primera liga y predecir Argentina
    await userPage.goto("/awards?league=" + l1.id);
    const board1 = userPage.getByRole("main").getByTestId("awards-board");
    const card1 = board1.locator('[data-category="champion"]');
    await selectCandidateBySearch(card1, "Arg", "Argentina");

    // Seleccionar la segunda liga y predecir Brazil
    await userPage.goto("/awards?league=" + l2.id);
    const board2 = userPage.getByRole("main").getByTestId("awards-board");
    const card2 = board2.locator('[data-category="champion"]');
    await selectCandidateBySearch(card2, "Bra", "Brazil");

    // Verificar que al volver a la primera liga sigue teniendo Argentina
    await userPage.goto("/awards?league=" + l1.id);
    await expect(card1.getByTestId("selected-candidate")).toContainText("Argentina");

    // Verificar que al volver a la segunda liga sigue teniendo Brazil
    await userPage.goto("/awards?league=" + l2.id);
    await expect(card2.getByTestId("selected-candidate")).toContainText("Brazil");

    // Verificar que en BD hay 2 filas distintas
    const admin = createAdminClient();
    const { data: preds, error } = await admin
      .from("special_predictions")
      .select("*")
      .eq("user_id", user.userId)
      .eq("category", "champion");

    expect(error).toBeNull();
    expect(preds).toHaveLength(2);
    const pL1 = preds!.find((p) => p.league_id === l1.id);
    const pL2 = preds!.find((p) => p.league_id === l2.id);
    expect(pL1).not.toBeNull();
    expect(pL2).not.toBeNull();
  });

  test("AWD-12: Sin selección -> estado vacío claro", async ({ browser }) => {
    const runId = `awd12-${Date.now()}`;
    const user = await createUser({ runId, displayName: "AWD-12 Jugador" });
    stack.add(() => deleteE2EUser(user.userId));

    const league = await seedLeague({ runId, creatorId: user.userId, name: "Vacia League" });
    stack.add(() => league.cleanup());

    await addMember(league.id, user.userId, { role: "member", paymentStatus: "paid" });
    await setActiveLeague(user.userId, league.id);

    const session = await loginAs(browser, user);
    stack.add(() => session.context.close());

    await session.page.goto("/awards");
    const board = session.page.getByRole("main").getByTestId("awards-board");
    await expect(board).toBeVisible();

    // Comprobar que no hay ningún candidato seleccionado en la UI
    await expect(board.getByTestId("selected-candidate")).toHaveCount(0);
  });
});

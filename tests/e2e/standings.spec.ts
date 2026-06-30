import { test, expect } from "@playwright/test";

import { createAdminClient, createAnonClient } from "./helpers/admin";
import { createCleanupStack } from "./helpers/cleanup";
import { deleteMatches, editableMatch, finishedMatch, seedMatches, suspendedMatch } from "./helpers/seed/matches";
import { seedPrediction } from "./helpers/seed/predictions";
import { createLeagueWithUsers } from "./helpers/users";
import { selectPhaseTab } from "./helpers/ui";
import {
  snapshotWinners,
  restoreWinners,
  getCandidate,
  setWinner,
  type WinnersSnapshot,
} from "./helpers/seed/awards";

test.describe("Clasificación oficial (e2e)", () => {
  const stack = createCleanupStack();
  const localMatchIds: string[] = [];
  let fixture: Awaited<ReturnType<typeof createLeagueWithUsers>>;
  const admin = createAdminClient();
  let winnersSnap: WinnersSnapshot;

  test.beforeAll(async ({ browser }) => {
    winnersSnap = await snapshotWinners();
    // Necesitamos 4 usuarios (1 admin, 3 miembros) para los escenarios de desempate
    fixture = await createLeagueWithUsers(browser, {
      members: 4,
      admins: 1,
      eagerLogins: 2, // User 0 (admin) y User 1 (member) logueados
      leagueOpts: {
        name: "Liga Clasificación E2E",
        requiresPayment: true,
        paymentAmount: 100,
        paymentInstructions: "Pagar por Bizum",
        paymentStatus: "paid", // Todos pagados por defecto
      },
    });
    stack.add(() => fixture.cleanup());
  });

  test.afterAll(async () => {
    await restoreWinners(winnersSnap);
    await stack.run();
  });

  test.afterEach(async () => {
    if (localMatchIds.length > 0) {
      await deleteMatches([...localMatchIds]);
      localMatchIds.length = 0;
    }
  });

  test("STD-01: Orden por puntos totales", async () => {
    const page = fixture.users[0]!.page!;
    const matches = await seedMatches([
      finishedMatch({ home: 3, away: 0 }, { matchday: 1 }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    // Sembrar predicciones con puntos ganados específicos
    // User 0 -> 12.50 pts
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId: m.id,
      home: 3,
      away: 0,
      multiplier: 2.5,
      pointsEarned: 12.5,
      evaluatedAt: new Date().toISOString(),
    });

    // User 1 -> 8.00 pts
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[1]!.userId,
      matchId: m.id,
      home: 3,
      away: 0,
      multiplier: 1.6,
      pointsEarned: 8.0,
      evaluatedAt: new Date().toISOString(),
    });

    // User 2 -> 2.00 pts
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[2]!.userId,
      matchId: m.id,
      home: 2,
      away: 0,
      multiplier: 1.0,
      pointsEarned: 2.0,
      evaluatedAt: new Date().toISOString(),
    });

    // User 3 -> 0.00 pts (miss/sin puntos)
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[3]!.userId,
      matchId: m.id,
      home: 0,
      away: 3,
      multiplier: 1.0,
      pointsEarned: 0.0,
      evaluatedAt: new Date().toISOString(),
    });

    // 1. Sembrar premios especiales (Awards)
    // Buscamos un candidato de campeón
    const candidate = await getCandidate("champion", { name: "Argentina" });
    
    // User 0 y User 1 eligen al candidato ganador
    await admin.from("special_predictions").insert([
      {
        user_id: fixture.users[0]!.userId,
        league_id: fixture.league.id,
        category: "champion",
        candidate_id: candidate.id,
      },
      {
        user_id: fixture.users[1]!.userId,
        league_id: fixture.league.id,
        category: "champion",
        candidate_id: candidate.id,
      },
    ]);

    // Hacemos ganador al candidato
    await setWinner("champion", candidate.id);

    // 2. Sembrar ganancias de duelos en point_transactions
    await admin.from("point_transactions").insert([
      {
        user_id: fixture.users[0]!.userId,
        league_id: fixture.league.id,
        amount: 50.0,
        description: "challenge_payout",
      },
      {
        user_id: fixture.users[1]!.userId,
        league_id: fixture.league.id,
        amount: 10.0,
        description: "challenge_payout",
      },
      {
        user_id: fixture.users[2]!.userId,
        league_id: fixture.league.id,
        amount: 5.0,
        description: "challenge_payout",
      },
    ]);

    await page.goto("/standings");

    await expect(page.getByTestId("standings-skeleton")).toBeHidden();

    const rows = page.getByTestId("standings-row");
    await expect(rows).toHaveCount(4);

    // Obtenemos los puntos sumados de los premios para verificar con precisión el total esperado
    const { data: awardData0 } = await admin
      .from("special_predictions_with_points")
      .select("points")
      .eq("league_id", fixture.league.id)
      .eq("user_id", fixture.users[0]!.userId)
      .single();
    const user0Awards = awardData0?.points ?? 0;

    const { data: awardData1 } = await admin
      .from("special_predictions_with_points")
      .select("points")
      .eq("league_id", fixture.league.id)
      .eq("user_id", fixture.users[1]!.userId)
      .single();
    const user1Awards = awardData1?.points ?? 0;

    const expectedPoints0 = (12.5 + Number(user0Awards)).toFixed(1);
    const expectedPoints1 = (8.0 + Number(user1Awards)).toFixed(1);

    // Fila 1: User 0 (12.5 pts + user0Awards)
    await expect(rows.nth(0)).toContainText(fixture.users[0]!.displayName!);
    await expect(rows.nth(0).getByTestId("standings-points")).toHaveText(expectedPoints0);
    // Verificamos los badges en el orden exactos -> result -> premios -> duelos
    await expect(rows.nth(0).getByTestId("standings-exact")).toContainText("1 exactos");
    await expect(rows.nth(0).getByTestId("standings-awards")).toContainText(
      `${Number(user0Awards).toFixed(1)} pts premios`,
    );
    await expect(rows.nth(0).locator("text=50.0 pts duelos")).toBeVisible();

    // Fila 2: User 1 (8.0 pts + user1Awards)
    await expect(rows.nth(1)).toContainText(fixture.users[1]!.displayName!);
    await expect(rows.nth(1).getByTestId("standings-points")).toHaveText(expectedPoints1);
    await expect(rows.nth(1).getByTestId("standings-exact")).toContainText("1 exactos");
    await expect(rows.nth(1).getByTestId("standings-awards")).toContainText(
      `${Number(user1Awards).toFixed(1)} pts premios`,
    );
    await expect(rows.nth(1).locator("text=10.0 pts duelos")).toBeVisible();

    // Fila 3: User 2 (2.0 pts, 0 exactos, 5.0 duel pts)
    await expect(rows.nth(2)).toContainText(fixture.users[2]!.displayName!);
    await expect(rows.nth(2).getByTestId("standings-points")).toHaveText("2.0");
    await expect(rows.nth(2).getByTestId("standings-exact")).toContainText("0 exactos");
    await expect(rows.nth(2).locator("text=5.0 pts duelos")).toBeVisible();

    // Fila 4: User 3 (0.0 pts)
    await expect(rows.nth(3)).toContainText(fixture.users[3]!.displayName!);
    await expect(rows.nth(3).getByTestId("standings-points")).toHaveText("0.0");

    // Limpieza específica de point_transactions y special_predictions para no ensuciar otros tests
    await admin
      .from("point_transactions")
      .delete()
      .eq("league_id", fixture.league.id);
    await admin
      .from("special_predictions")
      .delete()
      .eq("league_id", fixture.league.id);
  });

  test("STD-02: Desempate por exactos", async () => {
    const page = fixture.users[0]!.page!;
    const matches = await seedMatches([
      finishedMatch({ home: 1, away: 1 }, { matchday: 1 }),
      finishedMatch({ home: 2, away: 1 }, { matchday: 1 }),
    ]);
    const m1 = matches[0]!;
    const m2 = matches[1]!;
    localMatchIds.push(m1.id, m2.id);

    // Ambos usuarios tendrán 5.0 puntos totales, pero User 0 tendrá 1 exacto y User 1 tendrá 0 exactos (2 aciertos resultado)
    // User 0: 1 exacto en m1 (5 pts, mult 1.0) + miss en m2 (0 pts) -> Total 5.0, 1 exacto
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId: m1.id,
      home: 1,
      away: 1,
      multiplier: 1.0,
      pointsEarned: 5.0,
      evaluatedAt: new Date().toISOString(),
    });
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId: m2.id,
      home: 0,
      away: 2,
      multiplier: 1.0,
      pointsEarned: 0.0,
      evaluatedAt: new Date().toISOString(),
    });

    // User 1: resultado en m1 (2 pts, mult 1.25 -> 2.5 pts) + resultado en m2 (2 pts, mult 1.25 -> 2.5 pts) -> Total 5.0, 0 exactos
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[1]!.userId,
      matchId: m1.id,
      home: 2,
      away: 2,
      multiplier: 1.25,
      pointsEarned: 2.5,
      evaluatedAt: new Date().toISOString(),
    });
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[1]!.userId,
      matchId: m2.id,
      home: 1,
      away: 0,
      multiplier: 1.25,
      pointsEarned: 2.5,
      evaluatedAt: new Date().toISOString(),
    });

    await page.goto("/standings");

    await expect(page.getByTestId("standings-skeleton")).toBeHidden();

    const rows = page.getByTestId("standings-row");
    // Fila 1 debe ser User 0 (puntos: 5.0, exactos: 1)
    await expect(rows.nth(0)).toContainText(fixture.users[0]!.displayName!);
    await expect(rows.nth(0).getByTestId("standings-exact")).toContainText("1 exactos");

    // Fila 2 debe ser User 1 (puntos: 5.0, exactos: 0)
    await expect(rows.nth(1)).toContainText(fixture.users[1]!.displayName!);
    await expect(rows.nth(1).getByTestId("standings-exact")).toContainText("0 exactos");
  });

  test("STD-03: Desempate por puntos de duelos", async () => {
    const page = fixture.users[0]!.page!;
    const matches = await seedMatches([
      finishedMatch({ home: 3, away: 0 }, { matchday: 1 }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    // Ambos usuarios con la misma predicción exacta (5 pts), pero User 0 tiene ganancias de duelos 50.0 y User 1 tiene 10.0
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId: m.id,
      home: 3,
      away: 0,
      multiplier: 1.0,
      pointsEarned: 5.0,
      evaluatedAt: new Date().toISOString(),
    });
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[1]!.userId,
      matchId: m.id,
      home: 3,
      away: 0,
      multiplier: 1.0,
      pointsEarned: 5.0,
      evaluatedAt: new Date().toISOString(),
    });

    // Insertar ganancias de duelos en point_transactions
    const { error: err0 } = await admin
      .from("point_transactions")
      .insert({
        user_id: fixture.users[0]!.userId,
        league_id: fixture.league.id,
        amount: 50.0,
        description: "challenge_payout",
      });
    expect(err0).toBeNull();

    const { error: err1 } = await admin
      .from("point_transactions")
      .insert({
        user_id: fixture.users[1]!.userId,
        league_id: fixture.league.id,
        amount: 10.0,
        description: "challenge_payout",
      });
    expect(err1).toBeNull();

    // Registrar partido para que afterEach se ejecute y limpie
    localMatchIds.push(m.id);

    await page.goto("/standings");

    await expect(page.getByTestId("standings-skeleton")).toBeHidden();
    await expect(page.getByTestId("standings-row")).toHaveCount(4);

    // Obtenemos los locators filtrados por data-user-id
    const rowUser0 = page.locator(`[data-testid="standings-row"][data-user-id="${fixture.users[0]!.userId}"]`).first();
    const rowUser1 = page.locator(`[data-testid="standings-row"][data-user-id="${fixture.users[1]!.userId}"]`).first();

    // Fila 1 debe ser User 0 (puesto 1 por desempate de duelos: 50.0 > 10.0)
    await expect(page.getByTestId("standings-row").nth(0)).toContainText(fixture.users[0]!.displayName!);
    await expect(rowUser0.getByTestId("standings-rank")).toHaveText("1");
    await expect(rowUser0.getByTestId("standings-points")).toHaveText("5.0");
    await expect(rowUser0.getByTestId("standings-exact")).toContainText("1 exactos");
    await expect(rowUser0).toContainText("0 result.");
    await expect(rowUser0).toContainText("50.0 pts duelos");

    // Fila 2 debe ser User 1 (puesto 2)
    await expect(page.getByTestId("standings-row").nth(1)).toContainText(fixture.users[1]!.displayName!);
    await expect(rowUser1.getByTestId("standings-rank")).toHaveText("2");
    await expect(rowUser1.getByTestId("standings-points")).toHaveText("5.0");
    await expect(rowUser1.getByTestId("standings-exact")).toContainText("1 exactos");
    await expect(rowUser1).toContainText("0 result.");
    await expect(rowUser1).toContainText("10.0 pts duelos");

    // Limpiar transacciones creadas en la BD
    await admin
      .from("point_transactions")
      .delete()
      .eq("league_id", fixture.league.id)
      .eq("description", "challenge_payout");
  });

  test("STD-04: Empate absoluto (comparten posición y muestran badge de empate)", async () => {
    const page = fixture.users[0]!.page!;
    const matches = await seedMatches([
      finishedMatch({ home: 3, away: 0 }, { matchday: 1 }),
      finishedMatch({ home: 1, away: 1 }, { matchday: 1 }),
    ]);
    const m1 = matches[0]!;
    const m2 = matches[1]!;
    localMatchIds.push(m1.id, m2.id);

    // Mismos puntos de predicción (5.0 exacto + 3.0 resultado = 8.0 pts)
    // exactCount = 1, resultCount = 1
    // User 0
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId: m1.id,
      home: 3,
      away: 0,
      multiplier: 1.0,
      pointsEarned: 5.0,
      evaluatedAt: new Date().toISOString(),
    });
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId: m2.id,
      home: 2,
      away: 2,
      multiplier: 1.5,
      pointsEarned: 3.0,
      evaluatedAt: new Date().toISOString(),
    });

    // User 1
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[1]!.userId,
      matchId: m1.id,
      home: 3,
      away: 0,
      multiplier: 1.0,
      pointsEarned: 5.0,
      evaluatedAt: new Date().toISOString(),
    });
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[1]!.userId,
      matchId: m2.id,
      home: 2,
      away: 2,
      multiplier: 1.5,
      pointsEarned: 3.0,
      evaluatedAt: new Date().toISOString(),
    });

    // 1. Mismos premios especiales (Awards)
    const candidate = await getCandidate("champion", { name: "Argentina" });
    await admin.from("special_predictions").insert([
      {
        user_id: fixture.users[0]!.userId,
        league_id: fixture.league.id,
        category: "champion",
        candidate_id: candidate.id,
        // Nota: la base de datos tiene un trigger tr_touch_special_prediction que sobreescribe
        // predicted_at con now() al insertar. Así que los puntos se calcularán según la fecha actual.
        // No obstante, enviamos una fecha fija para documentar el diseño.
        predicted_at: "2026-06-01T12:00:00Z",
      },
      {
        user_id: fixture.users[1]!.userId,
        league_id: fixture.league.id,
        category: "champion",
        candidate_id: candidate.id,
        predicted_at: "2026-06-01T12:00:00Z",
      },
    ]);
    await setWinner("champion", candidate.id);

    // 2. Mismos puntos de duelos
    await admin.from("point_transactions").insert([
      {
        user_id: fixture.users[0]!.userId,
        league_id: fixture.league.id,
        amount: 20.0,
        description: "challenge_payout",
      },
      {
        user_id: fixture.users[1]!.userId,
        league_id: fixture.league.id,
        amount: 20.0,
        description: "challenge_payout",
      },
    ]);

    // Consultamos los puntos reales de premios calculados por la base de datos para construir la aserción exacta
    const { data: awardData0 } = await admin
      .from("special_predictions_with_points")
      .select("points")
      .eq("league_id", fixture.league.id)
      .eq("user_id", fixture.users[0]!.userId)
      .single();
    const user0Awards = Number(awardData0?.points ?? 0);

    const { data: awardData1 } = await admin
      .from("special_predictions_with_points")
      .select("points")
      .eq("league_id", fixture.league.id)
      .eq("user_id", fixture.users[1]!.userId)
      .single();
    const user1Awards = Number(awardData1?.points ?? 0);

    const expectedPoints0 = (8.0 + user0Awards).toFixed(1);
    const expectedPoints1 = (8.0 + user1Awards).toFixed(1);

    await page.goto("/standings");

    await expect(page.getByTestId("standings-skeleton")).toBeHidden();

    await expect(page.getByTestId("standings-row")).toHaveCount(4);
    
    // Obtenemos los locators filtrados por data-user-id
    const rowUser0 = page.locator(`[data-testid="standings-row"][data-user-id="${fixture.users[0]!.userId}"]`).first();
    const rowUser1 = page.locator(`[data-testid="standings-row"][data-user-id="${fixture.users[1]!.userId}"]`).first();

    // Ambos deben compartir el rank visible "1"
    await expect(rowUser0.getByTestId("standings-rank")).toHaveText("1");
    await expect(rowUser1.getByTestId("standings-rank")).toHaveText("1");

    // Ambos deben mostrar el badge de empate
    await expect(rowUser0.getByTestId("standings-tie-badge")).toBeVisible();
    await expect(rowUser1.getByTestId("standings-tie-badge")).toBeVisible();
    await expect(rowUser0.getByTestId("standings-tie-badge")).toHaveText("Empate");
    await expect(rowUser1.getByTestId("standings-tie-badge")).toHaveText("Empate");

    // Verificar desglose completo de puntos en la UI para representar el escenario real
    // User 0
    await expect(rowUser0.getByTestId("standings-points")).toHaveText(expectedPoints0);
    await expect(rowUser0.getByTestId("standings-exact")).toContainText("1 exactos");
    await expect(rowUser0).toContainText("1 result.");
    if (user0Awards > 0) {
      await expect(rowUser0.getByTestId("standings-awards")).toContainText(`${user0Awards.toFixed(1)} pts premios`);
    }
    await expect(rowUser0).toContainText("20.0 pts duelos");

    // User 1
    await expect(rowUser1.getByTestId("standings-points")).toHaveText(expectedPoints1);
    await expect(rowUser1.getByTestId("standings-exact")).toContainText("1 exactos");
    await expect(rowUser1).toContainText("1 result.");
    if (user1Awards > 0) {
      await expect(rowUser1.getByTestId("standings-awards")).toContainText(`${user1Awards.toFixed(1)} pts premios`);
    }
    await expect(rowUser1).toContainText("20.0 pts duelos");

    // Limpieza específica para este test
    await admin
      .from("point_transactions")
      .delete()
      .eq("league_id", fixture.league.id);
    await admin
      .from("special_predictions")
      .delete()
      .eq("league_id", fixture.league.id);
  });

  test("STD-05: Totales = Σ(base × multiplicador)", async () => {
    const page = fixture.users[0]!.page!;
    const matches = await seedMatches([
      finishedMatch({ home: 3, away: 0 }, { matchday: 1 }),
      finishedMatch({ home: 1, away: 1 }, { matchday: 1 }),
    ]);
    const m1 = matches[0]!;
    const m2 = matches[1]!;
    localMatchIds.push(m1.id, m2.id);

    // Predicción de User 0:
    // m1: Exacto (5 base) con multiplicador 1.5 -> 7.5 pts
    // m2: Resultado (2 base) con multiplicador 1.25 -> 2.5 pts
    // Total esperado = 10.0 pts
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId: m1.id,
      home: 3,
      away: 0,
      multiplier: 1.5,
      pointsEarned: 7.5,
      evaluatedAt: new Date().toISOString(),
    });
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId: m2.id,
      home: 2,
      away: 2,
      multiplier: 1.25,
      pointsEarned: 2.5,
      evaluatedAt: new Date().toISOString(),
    });

    await page.goto("/standings");

    await expect(page.getByTestId("standings-skeleton")).toBeHidden();
    await expect(page.getByTestId("standings-row")).toHaveCount(4);

    const rowUser0 = page
      .locator(`[data-testid="standings-row"][data-user-id="${fixture.users[0]!.userId}"]`)
      .first();

    await expect(rowUser0.getByTestId("standings-points")).toHaveText("10.0");
    await expect(rowUser0.getByTestId("standings-exact")).toContainText("1 exactos");
    await expect(rowUser0).toContainText("1 result.");
  });

  test("STD-06: Suspendidos/cancelados excluidos", async () => {
    const page = fixture.users[0]!.page!;
    const matches = await seedMatches([
      suspendedMatch({ matchday: 1 }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    // Sembrar predicciones con puntos, pero el estado es suspended
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId: m.id,
      home: 2,
      away: 0,
      multiplier: 1.0,
      pointsEarned: 5.0, // A pesar de tener puntos sembrados, no debe contar si no es finished
      evaluatedAt: new Date().toISOString(),
    });

    await page.goto("/standings");

    await expect(page.getByTestId("standings-skeleton")).toBeHidden();
    await expect(page.getByTestId("standings-row")).toHaveCount(4);

    const rowUser0 = page
      .locator(`[data-testid="standings-row"][data-user-id="${fixture.users[0]!.userId}"]`)
      .first();

    await expect(rowUser0.getByTestId("standings-points")).toHaveText("0.0");
    await expect(rowUser0.getByTestId("standings-exact")).toContainText("0 exactos");
    await expect(rowUser0).toContainText("0 result.");
  });

  test("STD-07: Filtro por jornada/fase", async () => {
    const page = fixture.users[0]!.page!;
    const matches = await seedMatches([
      finishedMatch({ home: 3, away: 0 }, { matchday: 1 }),
      finishedMatch({ home: 2, away: 0 }, { matchday: 2 }),
    ]);
    const m1 = matches[0]!;
    const m2 = matches[1]!;
    localMatchIds.push(m1.id, m2.id);

    // m1 (Jornada 1): exacto (5 pts, mult 1.0) -> 5.0 pts
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId: m1.id,
      home: 3,
      away: 0,
      multiplier: 1.0,
      pointsEarned: 5.0,
      evaluatedAt: new Date().toISOString(),
    });

    // m2 (Jornada 2): resultado (2 pts, mult 1.5) -> 3.0 pts
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId: m2.id,
      home: 1,
      away: 0,
      multiplier: 1.5,
      pointsEarned: 3.0,
      evaluatedAt: new Date().toISOString(),
    });

    await page.goto("/standings");

    await expect(page.getByTestId("standings-skeleton")).toBeHidden();
    await expect(page.getByTestId("standings-row")).toHaveCount(4);

    // Tab General (Acumulada): debe sumar 5.0 + 3.0 = 8.0 pts
    const pointsGeneral = page
      .getByRole("main")
      .locator(`[data-testid="standings-row"][data-user-id="${fixture.users[0]!.userId}"]`)
      .first()
      .getByTestId("standings-points");
    await expect(pointsGeneral).toHaveText("8.0");

    // Filtrar por Jornada 1
    await selectPhaseTab(page, "Jornada 1");
    await expect(pointsGeneral).toHaveText("5.0");

    // Filtrar por Jornada 2
    await selectPhaseTab(page, "Jornada 2");
    await expect(pointsGeneral).toHaveText("3.0");
  });

  test("STD-08: Badge y banner de pago", async () => {
    const pagePending = fixture.users[0]!.page!; // User 0 (admin) tiene pending
    const pagePaid = fixture.users[1]!.page!; // User 1 (member) tiene paid

    // Setear User 0 a pending, User 1 a paid
    await admin
      .from("league_members")
      .update({ payment_status: "pending" })
      .eq("league_id", fixture.league.id)
      .eq("user_id", fixture.users[0]!.userId);

    await admin
      .from("league_members")
      .update({ payment_status: "paid" })
      .eq("league_id", fixture.league.id)
      .eq("user_id", fixture.users[1]!.userId);

    // Navegar con el usuario pendiente (User 0)
    await pagePending.goto("/standings");

    await expect(pagePending.getByTestId("standings-skeleton")).toBeHidden();

    // Debería ver el banner de pago
    await expect(pagePending.getByTestId("payment-banner")).toBeVisible();
    await expect(pagePending.getByTestId("payment-banner")).toContainText("Tienes el pago pendiente");
    await expect(pagePending.getByTestId("payment-banner")).toContainText("$100 USD");

    // Badges en las filas
    await expect(pagePending.getByTestId("standings-row")).toHaveCount(4);
    const rowUser0 = pagePending.locator(`[data-testid="standings-row"][data-user-id="${fixture.users[0]!.userId}"]`).first();
    await expect(rowUser0.getByTestId("payment-status-badge")).toHaveAttribute("data-status", "pending");
    await expect(rowUser0.getByTestId("payment-status-badge")).toHaveText("Pendiente");

    const rowUser1 = pagePending.locator(`[data-testid="standings-row"][data-user-id="${fixture.users[1]!.userId}"]`).first();
    await expect(rowUser1.getByTestId("payment-status-badge")).toHaveAttribute("data-status", "paid");
    await expect(rowUser1.getByTestId("payment-status-badge")).toHaveText("Pagado");

    // Navegar con el usuario pagado (User 1)
    await pagePaid.goto("/standings");

    await expect(pagePaid.getByTestId("standings-skeleton")).toBeHidden();

    // NO debería ver el banner de pago
    await expect(pagePaid.getByTestId("payment-banner")).toHaveCount(0);
  });

  test("STD-09: Predicciones ajenas visibles post-kickoff", async () => {
    const userA = fixture.users[0]!;
    const userB = fixture.users[1]!;

    const matches = await seedMatches([
      finishedMatch({ home: 3, away: 0 }, { matchday: 1 }),
      editableMatch({ matchday: 1 }), // Scheduled future match (pre-kickoff)
    ]);
    const mFinished = matches[0]!;
    const mScheduled = matches[1]!;
    localMatchIds.push(mFinished.id, mScheduled.id);

    // User B tiene predicciones para ambos partidos
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: userB.userId,
      matchId: mFinished.id,
      home: 3,
      away: 0,
      multiplier: 1.0,
      pointsEarned: 5.0,
      evaluatedAt: new Date().toISOString(),
    });
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: userB.userId,
      matchId: mScheduled.id,
      home: 2,
      away: 1,
      multiplier: 1.0,
    });

    // User A consulta la API como un cliente de Supabase autenticado
    const clientA = createAnonClient();
    const { error: signInError } = await clientA.auth.signInWithPassword({
      email: userA.email,
      password: userA.password,
    });
    expect(signInError).toBeNull();

    try {
      // 1. Como el partido mFinished está finalizado (post-kickoff), la predicción del rival debe ser visible para User A
      const { data: dataFinished, error: errorFinished } = await clientA
        .from("predictions")
        .select("home_score_pred, away_score_pred")
        .eq("match_id", mFinished.id)
        .eq("user_id", userB.userId);

      expect(errorFinished).toBeNull();
      expect(dataFinished).toHaveLength(1);
      expect(dataFinished![0]!.home_score_pred).toBe(3);
      expect(dataFinished![0]!.away_score_pred).toBe(0);

      // 2. Como el partido mScheduled no ha comenzado (pre-kickoff), la predicción del rival debe ser invisible para User A (RLS la oculta)
      const { data: dataScheduled, error: errorScheduled } = await clientA
        .from("predictions")
        .select("home_score_pred, away_score_pred")
        .eq("match_id", mScheduled.id)
        .eq("user_id", userB.userId);

      expect(errorScheduled).toBeNull();
      expect(dataScheduled).toHaveLength(0);
    } finally {
      await clientA.auth.signOut();
    }
  });

  test("STD-10: Tendencia de cambio de posición (subió/bajó)", async () => {
    const page = fixture.users[0]!.page!;
    
    // Seed 2 matches resolved at different times
    const matches = await seedMatches([
      finishedMatch({ home: 1, away: 0 }, { matchday: 1, matchTime: new Date(Date.now() - 3600000).toISOString() }), // m1 (earlier)
      finishedMatch({ home: 2, away: 1 }, { matchday: 1, matchTime: new Date().toISOString() }), // m2 (later)
    ]);
    const m1 = matches[0]!;
    const m2 = matches[1]!;
    localMatchIds.push(m1.id, m2.id);

    // Update matches updated_at to ensure proper ordering
    await admin
      .from("matches")
      .update({ updated_at: "2026-06-14T10:00:00Z" })
      .eq("id", m1.id);
    await admin
      .from("matches")
      .update({ updated_at: "2026-06-14T11:00:00Z" })
      .eq("id", m2.id);

    // Predictions:
    // User 0 (admin / viewer) -> 0 pts on m1, 10 pts on m2 (Total 10 pts)
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId: m1.id,
      home: 0,
      away: 5,
      multiplier: 1.0,
      pointsEarned: 0.0,
      evaluatedAt: new Date().toISOString(),
    });
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId: m2.id,
      home: 2,
      away: 1,
      multiplier: 2.0,
      pointsEarned: 10.0,
      evaluatedAt: new Date().toISOString(),
    });

    // User 1 (member) -> 5 pts on m1, 0 pts on m2 (Total 5 pts)
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[1]!.userId,
      matchId: m1.id,
      home: 1,
      away: 0,
      multiplier: 1.0,
      pointsEarned: 5.0,
      evaluatedAt: new Date().toISOString(),
    });
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[1]!.userId,
      matchId: m2.id,
      home: 0,
      away: 5,
      multiplier: 1.0,
      pointsEarned: 0.0,
      evaluatedAt: new Date().toISOString(),
    });

    await page.goto("/standings");
    await expect(page.getByTestId("standings-skeleton")).toBeHidden();
    await expect(page.getByTestId("standings-row")).toHaveCount(4);

    const rowUser0 = page.locator(`[data-testid="standings-row"][data-user-id="${fixture.users[0]!.userId}"]`).first();
    const rowUser1 = page.locator(`[data-testid="standings-row"][data-user-id="${fixture.users[1]!.userId}"]`).first();

    // User 0: rank 1, rankChange +1 (was rank 2, now rank 1)
    await expect(rowUser0.getByTestId("standings-rank")).toHaveText("1");
    await expect(rowUser0.getByTestId("standings-trend")).toHaveAttribute("data-change", "1");
    await expect(rowUser0.getByTestId("standings-trend")).toHaveAttribute("aria-label", "Subió 1 posición");

    // User 1: rank 2, rankChange -1 (was rank 1, now rank 2)
    await expect(rowUser1.getByTestId("standings-rank")).toHaveText("2");
    await expect(rowUser1.getByTestId("standings-trend")).toHaveAttribute("data-change", "-1");
    await expect(rowUser1.getByTestId("standings-trend")).toHaveAttribute("aria-label", "Bajó 1 posición");
  });
  test("STD-09: Acordeón de desglose de puntos (UI/UX)", async () => {
    const page = fixture.users[0]!.page!;
    const matches = await seedMatches([
      finishedMatch({ home: 2, away: 0 }, { matchday: 1, home: "Team A", away: "Team B", rawTeamNames: true, stage: "group" }),
      finishedMatch({ home: 1, away: 1 }, { matchday: 2, home: "Team C", away: "Team D", rawTeamNames: true, stage: "group" }),
      finishedMatch({ home: 0, away: 2 }, { matchday: 2, home: "Team E", away: "Team F", rawTeamNames: true, stage: "group" }),
    ]);
    localMatchIds.push(...matches.map((m) => m.id));

    // Sembrar predicciones para el User 0
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId: matches[0]!.id,
      home: 2,
      away: 0,
      multiplier: 1.0,
      pointsEarned: 5.0,
      evaluatedAt: new Date().toISOString(),
    });
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId: matches[1]!.id,
      home: 2,
      away: 2,
      multiplier: 2.0,
      pointsEarned: 4.0, // Parcial (2 pts base) * 2
      evaluatedAt: new Date().toISOString(),
    });
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId: matches[2]!.id,
      home: 1,
      away: 0,
      multiplier: 1.0,
      pointsEarned: 0.0, // Fallido (0 pts base)
      evaluatedAt: new Date().toISOString(),
    });

    await page.goto("/standings");
    await expect(page.getByTestId("standings-skeleton")).toBeHidden();
    await expect(page.getByTestId("standings-row")).toHaveCount(4);

    const rowUser0 = page.locator(`[data-testid="standings-row"][data-user-id="${fixture.users[0]!.userId}"]`).first();

    // Verificar que el acordeón no está visible inicialmente
    await expect(rowUser0.getByTestId("standings-accordion")).toBeHidden();

    // Expandir el acordeón
    await rowUser0.getByTestId("standings-row-toggle").click();
    await expect(rowUser0.getByTestId("standings-accordion")).toBeVisible();

    // Verificar los banners resumen (5 exacto + 2 parcial + 0 fallido = 7.0)
    await expect(rowUser0.getByTestId("summary-base")).toHaveText("7.0");
    await expect(rowUser0.getByTestId("summary-mults")).toHaveText("+2.0");

    // Verificar desglose por fases (orden cronológico inverso: J2 primero, luego J1)
    const phaseHeaders = rowUser0.getByTestId("standings-phase-header");
    await expect(phaseHeaders).toHaveCount(2);
    await expect(phaseHeaders.nth(0)).toHaveText("Jornada 2");
    await expect(phaseHeaders.nth(1)).toHaveText("Jornada 1");

    // Verificar contenido de partidos (nombres de equipos, exacto/parcial/fallido)
    await expect(rowUser0.getByText("Team A vs Team B")).toBeVisible();
    await expect(rowUser0.getByText("Team C vs Team D")).toBeVisible();
    await expect(rowUser0.getByText("Team E vs Team F")).toBeVisible();
    const matchDetails = rowUser0.getByTestId("standings-match-detail");
    await expect(matchDetails.getByText("Exacto")).toBeVisible();
    await expect(matchDetails.getByText("Parcial")).toBeVisible();
    await expect(matchDetails.getByText("Fallido")).toBeVisible();
    
    // Colapsar el acordeón
    await rowUser0.getByTestId("standings-row-toggle").click();
    await expect(rowUser0.getByTestId("standings-accordion")).toBeHidden();
  });

  test("STD-12: El acordeón de posiciones desglosa marcadores con prórroga y penales", async () => {
    const page = fixture.users[0]!.page!;
    const testMatch = await seedMatches([
      finishedMatch(
        { home: 1, away: 1 },
        {
          matchday: 1,
          home: "Argentina",
          away: "Bolivia",
          extraTimeHomeScore: 2,
          extraTimeAwayScore: 2,
          penaltiesHomeScore: 4,
          penaltiesAwayScore: 3,
        }
      ),
    ]);
    const m = testMatch[0]!;

    const predId = await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId: m.id,
      home: 1,
      away: 1,
      multiplier: 1.0,
      pointsEarned: 5.0, // exacto
      evaluatedAt: new Date().toISOString(),
    });

    try {
      await page.goto("/standings");
      await expect(page.getByTestId("standings-skeleton")).toBeHidden();

      const rowUser0 = page.locator(`[data-testid="standings-row"][data-user-id="${fixture.users[0]!.userId}"]`).first();
      await rowUser0.getByTestId("standings-row-toggle").click();

      const accordion = rowUser0.getByTestId("standings-accordion");
      await expect(accordion).toBeVisible();

      // Verificar que se renderizan las leyendas en la UI del acordeón
      await expect(accordion.getByText("(2-2 t.s.)")).toBeVisible();
      await expect(accordion.getByText("(4-3 pen.)")).toBeVisible();
    } finally {
      // Eliminar predicción y partido
      await admin.from("predictions").delete().eq("id", predId);
      await deleteMatches([m.id]);
    }
  });
});

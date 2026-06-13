import { test, expect } from "@playwright/test";

import { createAdminClient, createAnonClient } from "./helpers/admin";
import { createCleanupStack } from "./helpers/cleanup";
import { deleteMatches, finishedMatch, seedMatches, suspendedMatch } from "./helpers/seed/matches";
import { seedPrediction } from "./helpers/seed/predictions";
import { createLeagueWithUsers } from "./helpers/users";
import { selectPhaseTab } from "./helpers/ui";

test.describe("Clasificación oficial (e2e)", () => {
  const stack = createCleanupStack();
  const localMatchIds: string[] = [];
  let fixture: Awaited<ReturnType<typeof createLeagueWithUsers>>;
  const admin = createAdminClient();

  test.beforeAll(async ({ browser }) => {
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

    await page.goto("/standings");

    const rows = page.getByTestId("standings-row");
    await expect(rows).toHaveCount(4);

    // Fila 1: User 0 (12.5 pts)
    await expect(rows.nth(0)).toContainText(fixture.users[0]!.displayName!);
    await expect(rows.nth(0).getByTestId("standings-points")).toHaveText("12.5");

    // Fila 2: User 1 (8.0 pts)
    await expect(rows.nth(1)).toContainText(fixture.users[1]!.displayName!);
    await expect(rows.nth(1).getByTestId("standings-points")).toHaveText("8.0");

    // Fila 3: User 2 (2.0 pts)
    await expect(rows.nth(2)).toContainText(fixture.users[2]!.displayName!);
    await expect(rows.nth(2).getByTestId("standings-points")).toHaveText("2.0");

    // Fila 4: User 3 (0.0 pts)
    await expect(rows.nth(3)).toContainText(fixture.users[3]!.displayName!);
    await expect(rows.nth(3).getByTestId("standings-points")).toHaveText("0.0");
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

    const rows = page.getByTestId("standings-row");
    // Fila 1 debe ser User 0 (puntos: 5.0, exactos: 1)
    await expect(rows.nth(0)).toContainText(fixture.users[0]!.displayName!);
    await expect(rows.nth(0).getByTestId("standings-exact")).toContainText("1 exactos");

    // Fila 2 debe ser User 1 (puntos: 5.0, exactos: 0)
    await expect(rows.nth(1)).toContainText(fixture.users[1]!.displayName!);
    await expect(rows.nth(1).getByTestId("standings-exact")).toContainText("0 exactos");
  });

  test("STD-03: Desempate por wager_balance", async () => {
    const page = fixture.users[0]!.page!;
    const matches = await seedMatches([
      finishedMatch({ home: 3, away: 0 }, { matchday: 1 }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    // Ambos usuarios con la misma predicción exacta (5 pts), pero User 0 tiene balance de duelos 50.0 y User 1 tiene 10.0
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

    // Actualizar balances de duelos en base de datos
    const { error: err0 } = await admin
      .from("league_members")
      .update({ wager_balance: 50.0 })
      .eq("league_id", fixture.league.id)
      .eq("user_id", fixture.users[0]!.userId);
    expect(err0).toBeNull();

    const { error: err1 } = await admin
      .from("league_members")
      .update({ wager_balance: 10.0 })
      .eq("league_id", fixture.league.id)
      .eq("user_id", fixture.users[1]!.userId);
    expect(err1).toBeNull();

    // Restaurar balances en afterEach/cleanup para no impactar otros tests
    localMatchIds.push(m.id); // Re-registrar para que afterEach se ejecute y limpie

    await page.goto("/standings");

    const rows = page.getByTestId("standings-row");
    // Fila 1: User 0 (5.0 pts, 1 exacto, 50.0 wager)
    await expect(rows.nth(0)).toContainText(fixture.users[0]!.displayName!);
    // Fila 2: User 1 (5.0 pts, 1 exacto, 10.0 wager)
    await expect(rows.nth(1)).toContainText(fixture.users[1]!.displayName!);

    // Restaurar a 0 en la BD
    await admin
      .from("league_members")
      .update({ wager_balance: 0.0 })
      .eq("league_id", fixture.league.id);
  });

  test("STD-04: Desempate por joined_at", async () => {
    const page = fixture.users[0]!.page!;
    const matches = await seedMatches([
      finishedMatch({ home: 3, away: 0 }, { matchday: 1 }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    // Mismo puntos (5.0), exactos (1), wager balance (0.0).
    // User 0 se unió antes que User 1.
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

    const earlyDate = "2026-06-01T00:00:00Z";
    const lateDate = "2026-06-02T00:00:00Z";

    await admin
      .from("league_members")
      .update({ joined_at: earlyDate })
      .eq("league_id", fixture.league.id)
      .eq("user_id", fixture.users[0]!.userId);

    await admin
      .from("league_members")
      .update({ joined_at: lateDate })
      .eq("league_id", fixture.league.id)
      .eq("user_id", fixture.users[1]!.userId);

    await page.goto("/standings");

    const rows = page.getByTestId("standings-row");
    // Fila 1: User 0 (se unió antes)
    await expect(rows.nth(0)).toContainText(fixture.users[0]!.displayName!);
    // Fila 2: User 1 (se unió después)
    await expect(rows.nth(1)).toContainText(fixture.users[1]!.displayName!);
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
    const pointsLabel = page
      .getByTestId("standings-row")
      .filter({ hasText: fixture.users[0]!.displayName! })
      .getByTestId("standings-points");
    await expect(pointsLabel).toHaveText("10.0");
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
    const pointsLabel = page
      .getByTestId("standings-row")
      .filter({ hasText: fixture.users[0]!.displayName! })
      .getByTestId("standings-points");
    await expect(pointsLabel).toHaveText("0.0");
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

    // Tab General (Acumulada): debe sumar 5.0 + 3.0 = 8.0 pts
    const pointsGeneral = page
      .getByRole("main")
      .getByTestId("standings-row")
      .filter({ hasText: fixture.users[0]!.displayName! })
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

    // Debería ver el banner de pago
    await expect(pagePending.getByTestId("payment-banner")).toBeVisible();
    await expect(pagePending.getByTestId("payment-banner")).toContainText("Tienes el pago pendiente");
    await expect(pagePending.getByTestId("payment-banner")).toContainText("$100 USD");

    // Badges en las filas
    const rowUser0 = pagePending.getByTestId("standings-row").filter({ hasText: fixture.users[0]!.displayName! });
    await expect(rowUser0.getByTestId("payment-status-badge")).toHaveAttribute("data-status", "pending");
    await expect(rowUser0.getByTestId("payment-status-badge")).toHaveText("Pendiente");

    const rowUser1 = pagePending.getByTestId("standings-row").filter({ hasText: fixture.users[1]!.displayName! });
    await expect(rowUser1.getByTestId("payment-status-badge")).toHaveAttribute("data-status", "paid");
    await expect(rowUser1.getByTestId("payment-status-badge")).toHaveText("Pagado");

    // Navegar con el usuario pagado (User 1)
    await pagePaid.goto("/standings");

    // NO debería ver el banner de pago
    await expect(pagePaid.getByTestId("payment-banner")).toHaveCount(0);
  });

  test("STD-09: Predicciones ajenas visibles post-kickoff", async () => {
    const userA = fixture.users[0]!;
    const userB = fixture.users[1]!;

    const matches = await seedMatches([
      finishedMatch({ home: 3, away: 0 }, { matchday: 1 }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    // User B tiene una predicción de 3-0 en este partido finalizado
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: userB.userId,
      matchId: m.id,
      home: 3,
      away: 0,
      multiplier: 1.0,
      pointsEarned: 5.0,
      evaluatedAt: new Date().toISOString(),
    });

    // User A consulta la API como un cliente de Supabase autenticado
    const clientA = createAnonClient();
    const { error: signInError } = await clientA.auth.signInWithPassword({
      email: userA.email,
      password: userA.password,
    });
    expect(signInError).toBeNull();

    try {
      // Como el partido está finalizado (post-kickoff), la predicción del rival debe ser visible para User A
      const { data, error } = await clientA
        .from("predictions")
        .select("home_score_pred, away_score_pred")
        .eq("match_id", m.id)
        .eq("user_id", userB.userId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0]!.home_score_pred).toBe(3);
      expect(data![0]!.away_score_pred).toBe(0);
    } finally {
      await clientA.auth.signOut();
    }
  });
});

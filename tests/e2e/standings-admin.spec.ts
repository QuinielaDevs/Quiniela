import { test, expect } from "@playwright/test";

import { createAdminClient, createAnonClient } from "./helpers/admin";
import { createCleanupStack } from "./helpers/cleanup";
import { assertLedgerInvariant, getMatch, getPrediction, getWagerBalance } from "./helpers/db-assert";
import {
  deleteMatches,
  editableMatch,
  finishedMatch,
  liveMatch,
  seedMatches,
  tbdKnockoutMatch,
} from "./helpers/seed/matches";
import { seedPrediction } from "./helpers/seed/predictions";
import { seedChallengeRaw } from "./helpers/seed/challenges";
import { createLeagueWithUsers } from "./helpers/users";

test.describe("Panel de administración (e2e)", () => {
  const stack = createCleanupStack();
  const localMatchIds: string[] = [];
  let fixture: Awaited<ReturnType<typeof createLeagueWithUsers>>;
  const admin = createAdminClient();

  test.beforeAll(async ({ browser }) => {
    fixture = await createLeagueWithUsers(browser, {
      members: 3,
      admins: 1,
      eagerLogins: 2, // User 0 (admin) y User 1 (member) logueados
      leagueOpts: {
        name: "Liga Administración E2E",
        requiresPayment: true,
        paymentAmount: 150,
        paymentInstructions: "Pagar por Bizum",
        paymentStatus: "paid", // Todos pagados por defecto
        wagerBalance: 20.0, // Saldo inicial para duelos de apuestas
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

  test("ADM-01: Guard de admin", async () => {
    const pageAdmin = fixture.users[0]!.page!;
    const pageMember = fixture.users[1]!.page!;

    // 1) Visita del admin a /standings/manage -> permitido
    await pageAdmin.goto("/standings/manage");
    await expect(pageAdmin).toHaveURL(/\/standings\/manage/);
    await expect(pageAdmin.getByRole("heading", { name: "Gestión de liga", exact: true })).toBeVisible();

    // 2) Visita del miembro no admin a /standings/manage -> bloqueado/redirigido
    await pageMember.goto("/standings/manage");
    await expect(pageMember).toHaveURL(/\/standings/); // Redirige a standings principal
  });

  test("ADM-02: scheduled → live con marcador parcial", async () => {
    const page = fixture.users[0]!.page!;
    const matches = await seedMatches([
      editableMatch({ matchday: 1, homeTeamCode: "ARG", awayTeamCode: "BOL" }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    await page.goto("/standings/manage");
    const card = page.locator(`[data-testid="match-admin-row"][data-match-id="${m.id}"]`);

    // Cambiar estado a Live
    const select = card.getByTestId("admin-status-select");
    await select.selectOption("live");

    // Cambiar marcador (home score = 1, away score = 0)
    const homePicker = card.getByTestId("admin-home-score");
    await homePicker.getByTestId("goal-increment").click();

    // Guardar
    await card.getByTestId("admin-save-result").click();
    
    // Esperar a que el botón vuelva a su estado original (Guardar) y se deshabilite porque ya no está sucio (dirty)
    const saveBtn = card.getByTestId("admin-save-result");
    await expect(saveBtn).toHaveText("Guardar");
    await expect(saveBtn).toBeDisabled();

    // Verificar en /predictions que se muestra "En vivo" con marcador
    const pageMember = fixture.users[1]!.page!;
    await pageMember.goto("/predictions");
    const predCard = pageMember.locator(`article[data-match-id="${m.id}"]`);
    await expect(predCard.getByText("En vivo")).toBeVisible();
    
    // Verificar en BD que cambió a live con 1-0
    const dbMatch = await getMatch(m.id);
    expect(dbMatch!.status).toBe("live");
    expect(dbMatch!.home_score).toBe(1);
    expect(dbMatch!.away_score).toBe(0);
  });

  test("ADM-03: live → finished dispara scoring", async () => {
    const page = fixture.users[0]!.page!;
    const matches = await seedMatches([
      liveMatch({ home: 1, away: 0 }, { matchday: 1, homeTeamCode: "ESP", awayTeamCode: "GER" }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    // Sembrar predicciones para los dos miembros
    // User 1 predice 2-0 (acierto resultado parcial -> 2 base * 1.0 = 2.0 pts)
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[1]!.userId,
      matchId: m.id,
      home: 2,
      away: 0,
      multiplier: 1.0,
    });

    // User 2 predice 2-1 (acierto de resultado -> 2 base * 1.0 = 2.0 pts)
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[2]!.userId,
      matchId: m.id,
      home: 2,
      away: 1,
      multiplier: 1.0,
    });

    await page.goto("/standings/manage");
    const card = page.locator(`[data-testid="match-admin-row"][data-match-id="${m.id}"]`);

    // Poner marcador final 2-1 y estado finished
    const select = card.getByTestId("admin-status-select");
    await select.selectOption("finished");

    const homePicker = card.getByTestId("admin-home-score");
    await homePicker.getByTestId("goal-increment").click(); // de 1 a 2

    const awayPicker = card.getByTestId("admin-away-score");
    await awayPicker.getByTestId("goal-increment").click(); // de 0 a 1

    await card.getByTestId("admin-save-result").click();
    
    // Esperar a que el botón vuelva a su estado original (Guardar) y se deshabilite
    const saveBtn = card.getByTestId("admin-save-result");
    await expect(saveBtn).toHaveText("Guardar");
    await expect(saveBtn).toBeDisabled();

    // (a) Verificar que standings refleja los puntos nuevos (User 2: exacto 5.0 pts, User 1: resultado 2.0 pts)
    await page.goto("/standings");
    const rowUser2 = page.locator(`[data-testid="standings-row"][data-user-id="${fixture.users[2]!.userId}"]`);
    await expect(rowUser2.getByTestId("standings-points")).toHaveText("5.0");

    const rowUser1 = page.locator(`[data-testid="standings-row"][data-user-id="${fixture.users[1]!.userId}"]`);
    await expect(rowUser1.getByTestId("standings-points")).toHaveText("2.0");

    // (b) BD: predictions.points_earned y evaluated_at poblados
    const p1 = await getPrediction(fixture.league.id, fixture.users[1]!.userId, m.id);
    expect(p1!.points_earned).toBe(2.0);
    expect(p1!.evaluated_at).not.toBeNull();

    const p2 = await getPrediction(fixture.league.id, fixture.users[2]!.userId, m.id);
    expect(p2!.points_earned).toBe(5.0);
    expect(p2!.evaluated_at).not.toBeNull();

    // (c) wager_balance subió con el accrual
    // User 1: empezó con 20.0, ahora tiene 20.0 + 2.0 = 22.0
    // User 2: empezó con 20.0, ahora tiene 20.0 + 5.0 = 25.0
    const wb1 = await getWagerBalance(fixture.league.id, fixture.users[1]!.userId);
    expect(wb1).toBe(22.0);

    const wb2 = await getWagerBalance(fixture.league.id, fixture.users[2]!.userId);
    expect(wb2).toBe(25.0);

    // (d) assertLedgerInvariant pasa
    await assertLedgerInvariant(fixture.league.id);
  });

  test("ADM-04: Transiciones inválidas bloqueadas", async () => {
    const matches = await seedMatches([
      finishedMatch({ home: 1, away: 0 }, { homeTeamCode: "FRA", awayTeamCode: "ITA" }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    // Intentar directamente invocar setMatchResult con finished -> scheduled via RPC para asegurar que el backend lo bloquea
    const client = createAnonClient();
    const { error: signInError } = await client.auth.signInWithPassword({
      email: fixture.users[0]!.email,
      password: fixture.users[0]!.password,
    });
    expect(signInError).toBeNull();

    try {
      const { error } = await client.rpc("fn_admin_set_match_result", {
        p_match_id: m.id,
        p_home_score: null,
        p_away_score: null,
        p_status: "scheduled",
      });
      // El RPC fn_admin_set_match_result tiene la guarda:
      // "Transición de estado inválida" (error code 22023)
      expect(error).not.toBeNull();
      expect(error!.code).toBe("22023");
    } finally {
      await client.auth.signOut();
    }

    // Verificar en BD que sigue siendo finished
    const dbMatch = await getMatch(m.id);
    expect(dbMatch!.status).toBe("finished");
  });

  test("ADM-05: Knockout TBD no finalizable", async () => {
    const page = fixture.users[0]!.page!;
    const matches = await seedMatches([
      tbdKnockoutMatch(),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    await page.goto("/standings/manage");
    // Al ser un knockout TBD (home_team_code y away_team_code nulos), no debe aparecer en la UI de standings/manage
    const card = page.locator(`[data-testid="match-admin-row"][data-match-id="${m.id}"]`);
    await expect(card).toHaveCount(0);

    // Intentar directamente invocar setMatchResult con finished via RPC para asegurar que el backend lo bloquea
    const client = createAnonClient();
    const { error: signInError } = await client.auth.signInWithPassword({
      email: fixture.users[0]!.email,
      password: fixture.users[0]!.password,
    });
    expect(signInError).toBeNull();

    try {
      const { error } = await client.rpc("fn_admin_set_match_result", {
        p_match_id: m.id,
        p_home_score: 2,
        p_away_score: 1,
        p_status: "finished",
      });
      // El RPC fn_admin_set_match_result tiene la guarda:
      // "No se puede capturar el resultado de un partido sin equipos definidos" (error code 22023)
      expect(error).not.toBeNull();
      expect(error!.code).toBe("22023");
    } finally {
      await client.auth.signOut();
    }
  });

  test("ADM-06: Marcador inválido", async () => {
    const page = fixture.users[0]!.page!;
    const matches = await seedMatches([
      editableMatch({ matchday: 1, homeTeamCode: "URU", awayTeamCode: "CHI" }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    await page.goto("/standings/manage");
    const card = page.locator(`[data-testid="match-admin-row"][data-match-id="${m.id}"]`);

    const select = card.getByTestId("admin-status-select");
    await select.selectOption("finished");

    // Al poner finished, el marcador por defecto es 0-0. Intentamos bajar con decrement (pero el decrement está bloqueado en 0 por el GoalPicker)
    const homePicker = card.getByTestId("admin-home-score");
    await expect(homePicker.getByTestId("goal-decrement")).toBeDisabled();

    // Intentar directamente invocar setMatchResult con marcadores negativos via RPC para asegurar que el backend lo bloquea
    const client = createAnonClient();
    const { error: signInError } = await client.auth.signInWithPassword({
      email: fixture.users[0]!.email,
      password: fixture.users[0]!.password,
    });
    expect(signInError).toBeNull();

    try {
      const { error } = await client.rpc("fn_admin_set_match_result", {
        p_match_id: m.id,
        p_home_score: -1,
        p_away_score: 0,
        p_status: "finished",
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("22023"); // Marcador negativo no permitido
    } finally {
      await client.auth.signOut();
    }
  });

  test("ADM-07: Toggle de pago", async () => {
    const page = fixture.users[0]!.page!;
    const memberId = fixture.users[1]!.userId;

    await page.goto("/standings/manage");
    const row = page.locator(`[data-testid="member-admin-row"][data-user-id="${memberId}"]`);
    const toggle = row.getByTestId("payment-toggle");

    // 1) Asegurar estado actual Paid
    await expect(toggle).toHaveText("Pagado");

    // 2) Cambiar a Pendiente
    await toggle.click();
    await expect(toggle).toHaveText("Pendiente");

    // Recargar página para asegurar persistencia
    await page.reload();
    await expect(row.getByTestId("payment-toggle")).toHaveText("Pendiente");

    // 3) Revertir a Pagado
    await row.getByTestId("payment-toggle").click();
    await expect(row.getByTestId("payment-toggle")).toHaveText("Pagado");
  });

  test("ADM-08: Expulsión con cascada de duelos", async () => {
    // BUG-002 corregido (migración 20260611120000_member_removal_duel_cascade.sql):
    // tr_cleanup_on_member_removed cancela los duelos pending/active del expulsado
    // y reembolsa el escrow vía refund_challenge_escrow.
    const page = fixture.users[0]!.page!;
    const duelMatch = await seedMatches([editableMatch({ matchday: 1, homeTeamCode: "ECU", awayTeamCode: "PER" })]);
    const dm = duelMatch[0]!;
    localMatchIds.push(dm.id);

    // Sembrar un duelo directo activo entre User 1 y User 2
    const challengeId = await seedChallengeRaw({
      leagueId: fixture.league.id,
      matchId: dm.id,
      creatorId: fixture.users[1]!.userId,
      challengedId: fixture.users[2]!.userId,
      pointsBet: 10,
      type: "direct",
      status: "active",
      participants: [
        { userId: fixture.users[1]!.userId, home: 2, away: 1 },
        { userId: fixture.users[2]!.userId, home: 1, away: 1 },
      ],
    });

    // Saldos REALES previos al escrow (tests anteriores pueden haber acumulado
    // accruals — p. ej. ADM-03 — así que NO se hardcodean: invariante del ledger).
    const wbBefore1 = await getWagerBalance(fixture.league.id, fixture.users[1]!.userId);
    const wbBefore2 = await getWagerBalance(fixture.league.id, fixture.users[2]!.userId);

    // Registrar transacciones de retención de escrow (-10) en point_transactions
    await admin.from("point_transactions").insert([
      {
        user_id: fixture.users[1]!.userId,
        league_id: fixture.league.id,
        amount: -10.0,
        description: "challenge_escrow",
        reference_id: challengeId,
      },
      {
        user_id: fixture.users[2]!.userId,
        league_id: fixture.league.id,
        amount: -10.0,
        description: "challenge_escrow",
        reference_id: challengeId,
      },
    ]);

    // Descontar el escrow del saldo real (manteniendo balance == SUM(ledger))
    await admin
      .from("league_members")
      .update({ wager_balance: wbBefore1 - 10.0 })
      .eq("league_id", fixture.league.id)
      .eq("user_id", fixture.users[1]!.userId);

    await admin
      .from("league_members")
      .update({ wager_balance: wbBefore2 - 10.0 })
      .eq("league_id", fixture.league.id)
      .eq("user_id", fixture.users[2]!.userId);

    await page.goto("/standings/manage");
    const rowUser2 = page.locator(`[data-testid="member-admin-row"][data-user-id="${fixture.users[2]!.userId}"]`);
    
    // Hacer click en expulsar User 2
    await rowUser2.getByTestId("expel-button").click();
    await page.getByTestId("expel-confirm").click();

    // User 2 debería desaparecer de la UI
    await expect(rowUser2).toHaveCount(0);

    // Verificar en BD que el duelo fue cancelado
    const dbChallenge = await admin
      .from("challenges")
      .select("status")
      .eq("id", challengeId)
      .single();
    expect(dbChallenge.data!.status).toBe("canceled");

    // Escrow devuelto a User 1 (contraparte): recupera su saldo previo al duelo.
    const wb1 = await getWagerBalance(fixture.league.id, fixture.users[1]!.userId);
    expect(wb1).toBe(wbBefore1);

    // assertLedgerInvariant pasa para los miembros restantes
    await assertLedgerInvariant(fixture.league.id);
  });

  test("ADM-09: Último admin intocable", async () => {
    const page = fixture.users[0]!.page!;
    const adminId = fixture.users[0]!.userId;

    await page.goto("/standings/manage");
    
    // El admin no debería ver su propio botón de expulsión
    const rowAdmin = page.locator(`[data-testid="member-admin-row"][data-user-id="${adminId}"]`);
    await expect(rowAdmin.getByTestId("expel-button")).toHaveCount(0);

    // Intentar expulsar al admin por RPC directo desde el cliente autenticado del propio admin
    const client = createAnonClient();
    const { error: signInError } = await client.auth.signInWithPassword({
      email: fixture.users[0]!.email,
      password: fixture.users[0]!.password,
    });
    expect(signInError).toBeNull();

    try {
      const { error } = await client.rpc("fn_remove_member", {
        p_league_id: fixture.league.id,
        p_user_id: adminId,
      });
      // Debe fallar con error 42501 (privilegio insuficiente / autoexpulsión)
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    } finally {
      await client.auth.signOut();
    }
  });

  test("ADM-10: Promoción a admin", async () => {
    const pageAdmin = fixture.users[0]!.page!;
    const memberUser = fixture.users[1]!;

    await pageAdmin.goto("/standings/manage");
    const rowMember = pageAdmin.locator(`[data-testid="member-admin-row"][data-user-id="${memberUser.userId}"]`);
    
    // Promover a admin
    await rowMember.getByRole("button", { name: `Hacer admin a ${memberUser.displayName}` }).click();
    await expect(rowMember).toContainText("Admin");

    // Verificar que el nuevo admin ahora puede ingresar a /standings/manage
    const pageNewAdmin = memberUser.page!;
    await pageNewAdmin.goto("/standings/manage");
    await expect(pageNewAdmin).toHaveURL(/\/standings\/manage/);
    await expect(pageNewAdmin.getByRole("heading", { name: "Gestión de liga", exact: true })).toBeVisible();
  });

  test("ADM-11: El no-admin no puede mutar por UI", async () => {
    const { page: pageMember } = await fixture.users[2]!.login(); // User 2 sigue siendo member

    // 1) En standings, no ve botón Gestionar
    await pageMember.goto("/standings");
    await expect(pageMember.getByRole("link", { name: "Gestionar" })).toHaveCount(0);

    // 2) En predictions, no ve controles de edición de resultados (MatchAdminList)
    await pageMember.goto("/predictions");
    await expect(pageMember.getByTestId("admin-status-select")).toHaveCount(0);
    await expect(pageMember.getByTestId("admin-save-result")).toHaveCount(0);
  });
});

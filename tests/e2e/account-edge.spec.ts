import { test, expect, type Page } from "@playwright/test";

import { createAdminClient, createAnonClient } from "./helpers/admin";
import { createCleanupStack } from "./helpers/cleanup";
import { getPrediction, getWagerBalance } from "./helpers/db-assert";
import {
  deleteMatches,
  editableMatch,
  seedMatches,
} from "./helpers/seed/matches";
import { seedPrediction } from "./helpers/seed/predictions";
import { seedChallenge } from "./helpers/seed/challenges";
import { seedLeague, addMember, setActiveLeague } from "./helpers/seed/league";
import {
  createLeagueWithUsers,
  createUser,
  deleteE2EUser,
  loginAs,
  newRunId,
  TEST_PASSWORD,
  type LeagueWithUsers,
} from "./helpers/users";

// Fase 9 — Cuenta, salir de liga, multi-liga y casos extremos transversales
// (EDG-01..12). Textos/testids copiados de los componentes de cuenta, duelos y
// navegación.
//
// SEMÁNTICA REAL DE leave_league / cleanup (copiada de la migración
// 20260607140000_leave_league.sql y del trigger tr_cleanup_on_member_removed en
// 20260608120000_active_league_selection.sql):
//   - fn_leave_league: el usuario actual abandona; si es el ÚNICO admin → 42501
//     "Eres el único admin de la liga: transfiere la administración antes de salir".
//   - El AFTER DELETE trigger fn_cleanup_on_member_removed borra, SOLO en esa
//     liga: predictions, member_badges, member_game_profiles del usuario, y
//     reasigna profiles.active_league_id a la membresía restante más reciente
//     (o null). Desde la migración 20260611120000_member_removal_duel_cascade
//     (fix BUG-002) además cancela los duelos pending/active del saliente y
//     reembolsa el escrow a los participantes (refund_challenge_escrow).

test.describe("Cuenta y casos extremos transversales (e2e)", () => {
  const admin = createAdminClient();
  const stack = createCleanupStack();
  const localMatchIds: string[] = [];
  let fixture: LeagueWithUsers;

  test.beforeAll(async ({ browser }) => {
    fixture = await createLeagueWithUsers(browser, {
      members: 2,
      admins: 1,
      eagerLogins: 2,
      leagueOpts: {
        name: `EDG Liga ${newRunId()}`,
        paymentStatus: "paid",
        wagerBalance: 50,
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

  test("EDG-01: /account muestra perfil y ligas", async () => {
    const page = fixture.users[0]!.page!;
    await page.goto("/account");

    await expect(page.getByRole("heading", { name: "Mi Cuenta" })).toBeVisible();
    await expect(
      page.getByRole("main").getByText(fixture.users[0]!.displayName!),
    ).toBeVisible();

    const items = page
      .getByRole("main")
      .getByTestId("account-league-item")
      .filter({ visible: true });
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText(fixture.league.name);
  });

  test("EDG-02: insignias tras jornada finalizada (materialización al visitar /account)", async () => {
    const page = fixture.users[0]!.page!;
    const userId = fixture.users[0]!.userId;

    // closedMatchdays exige que TODOS los partidos de la jornada sean terminales
    // y al menos uno finished → usamos una jornada ALTA y única (sin partidos del
    // calendario real). kickoff FUTURO para no alterar la "jornada en curso"
    // (currentRoundOrdinal mira match_time <= now; trampa §7.2).
    const matchday = 900 + (Date.now() % 90);
    const [m] = await seedMatches([
      {
        home: `edg02_h_${newRunId()}`,
        away: `edg02_a_${newRunId()}`,
        kickoffOffsetMs: 3 * 24 * 60 * 60 * 1000,
        status: "finished",
        matchday,
        stage: "group",
        groupLabel: "A",
        homeScore: 3,
        awayScore: 0,
      },
    ]);
    localMatchIds.push(m!.id);

    // Predicción exacta 3-0 (marcador difícil: max>=3) → insignia "nostradamus"
    // (deriveAwardsForMatchday en src/utils/member-awards.ts).
    await seedPrediction({
      leagueId: fixture.league.id,
      userId,
      matchId: m!.id,
      home: 3,
      away: 0,
      multiplier: 1.0,
    });

    try {
      // La materialización corre en el render server-side de /account.
      await page.goto("/account");
      const badge = page
        .getByRole("main")
        .getByTestId("badge-item")
        .filter({ has: page.locator('[data-badge="nostradamus"]') });
      await expect(
        page.getByRole("main").locator('[data-testid="badge-item"][data-badge="nostradamus"]'),
      ).toBeVisible();
      void badge;

      // BD: la medalla se materializó (idempotente; ver integration test).
      const { data: badges } = await admin
        .from("member_badges")
        .select("badge_type")
        .eq("league_id", fixture.league.id)
        .eq("user_id", userId)
        .eq("matchday", matchday);
      expect((badges ?? []).map((b) => b.badge_type)).toContain("nostradamus");
    } finally {
      // Limpiar la medalla materializada para no contaminar EDG-01 en reruns.
      await admin
        .from("member_badges")
        .delete()
        .eq("league_id", fixture.league.id)
        .eq("user_id", userId)
        .eq("matchday", matchday);
      await admin
        .from("member_game_profiles")
        .delete()
        .eq("league_id", fixture.league.id)
        .eq("user_id", userId)
        .eq("matchday", matchday);
    }
  });

  test("EDG-03: salir de liga borra predicciones/medallas/perfil (semántica del trigger)", async ({
    browser,
  }) => {
    const runId = newRunId();
    const leaver = await createUser({ runId, tag: "leaver", displayName: "EDG Leaver" });
    stack.add(() => deleteE2EUser(leaver.userId));
    const other = await createUser({ runId, tag: "other", displayName: "EDG Other" });
    stack.add(() => deleteE2EUser(other.userId));

    const league = await seedLeague({ runId, creatorId: other.userId, name: `EDG Salir ${runId}` });
    stack.add(() => league.cleanup());
    // `other` admin para que la liga no se quede sin admin cuando salga `leaver`.
    await addMember(league.id, other.userId, { role: "admin", paymentStatus: "paid" });
    await addMember(league.id, leaver.userId, { role: "member", paymentStatus: "paid", wagerBalance: 50 });
    await setActiveLeague(leaver.userId, league.id);

    // Datos del leaver: una predicción finished (jornada única) + un duelo activo.
    const matchday = 800 + (Date.now() % 90);
    const [mFinished] = await seedMatches([
      {
        home: `edg03_h_${runId}`,
        away: `edg03_a_${runId}`,
        kickoffOffsetMs: 3 * 24 * 60 * 60 * 1000,
        status: "finished",
        matchday,
        stage: "group",
        homeScore: 3,
        awayScore: 0,
      },
    ]);
    stack.add(() => deleteMatches([mFinished!.id]));
    await seedPrediction({
      leagueId: league.id,
      userId: leaver.userId,
      matchId: mFinished!.id,
      home: 3,
      away: 0,
      multiplier: 1.0,
    });

    const [mDuel] = await seedMatches([editableMatch()]);
    stack.add(() => deleteMatches([mDuel!.id]));
    await addMember(league.id, other.userId, {}).catch(() => {}); // idempotente: ya existe
    // other tiene saldo para crear el duelo.
    await admin
      .from("league_members")
      .update({ wager_balance: 50 })
      .eq("league_id", league.id)
      .eq("user_id", other.userId);
    await admin.from("point_transactions").insert({
      user_id: other.userId,
      league_id: league.id,
      amount: 50,
      description: "seed_initial_balance",
    });
    const challengeId = await seedChallenge({
      leagueId: league.id,
      matchId: mDuel!.id,
      creator: other,
      pointsBet: 10,
      type: "direct",
      challengedId: leaver.userId,
      creatorPred: { home: 2, away: 1 },
    });

    // Visitar /account materializa la medalla del leaver (jornada cerrada).
    const session = await loginAs(browser, leaver);
    stack.add(() => session.context.close());
    const page = session.page;
    await page.goto("/account");
    await expect(
      page.getByRole("main").getByTestId("badge-item").first(),
    ).toBeVisible();

    // Confirmar precondición en BD: predicción, medalla y perfil presentes.
    const before = async (table: "predictions" | "member_badges" | "member_game_profiles") => {
      const { count } = await admin
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("league_id", league.id)
        .eq("user_id", leaver.userId);
      return count ?? 0;
    };
    expect(await before("predictions")).toBeGreaterThan(0);
    expect(await before("member_badges")).toBeGreaterThan(0);
    expect(await before("member_game_profiles")).toBeGreaterThan(0);

    // Salir por la UI (doble verificación: checkbox + botón destructivo).
    const item = page
      .getByRole("main")
      .getByTestId("account-league-item")
      .filter({ hasText: league.name })
      .filter({ visible: true });
    await item.getByTestId("leave-league-button").click();
    const dialog = page.getByTestId("leave-league-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("checkbox").check();
    await dialog.getByTestId("leave-league-confirm").click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });

    // El trigger borra predicciones, medallas y perfil de juego del leaver.
    expect(await before("predictions")).toBe(0);
    expect(await before("member_badges")).toBe(0);
    expect(await before("member_game_profiles")).toBe(0);

    // Fix BUG-002 (20260611120000_member_removal_duel_cascade): al salir, el
    // duelo pendiente donde el leaver era el retado se cancela y el escrow del
    // creador (10 pts retenidos por create_challenge) se reembolsa.
    const { data: chal } = await admin
      .from("challenges")
      .select("status")
      .eq("id", challengeId)
      .single();
    expect(chal!.status).toBe("canceled");

    // `other` recupera su saldo inicial: 50 (seed) − 10 (escrow) + 10 (refund).
    expect(await getWagerBalance(league.id, other.userId)).toBe(50);
  });

  test("EDG-04: el único admin no puede salir (mensaje claro; sigue siendo miembro)", async () => {
    // fixture.users[0] es el único admin de la liga del fixture.
    const page = fixture.users[0]!.page!;
    const adminId = fixture.users[0]!.userId;

    await page.goto("/account");
    const item = page
      .getByRole("main")
      .getByTestId("account-league-item")
      .filter({ hasText: fixture.league.name })
      .filter({ visible: true });
    await item.getByTestId("leave-league-button").click();
    const dialog = page.getByTestId("leave-league-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("checkbox").check();
    await dialog.getByTestId("leave-league-confirm").click();

    await expect(dialog.getByRole("alert")).toContainText(
      "Eres el único admin de la liga",
    );

    const { data: member } = await admin
      .from("league_members")
      .select("role")
      .eq("league_id", fixture.league.id)
      .eq("user_id", adminId)
      .single();
    expect(member!.role).toBe("admin");
  });

  test("EDG-05: re-unirse tras salir entra limpio (sin restos, sin error)", async ({
    browser,
  }) => {
    const runId = newRunId();
    const rejoiner = await createUser({ runId, tag: "rejoin", displayName: "EDG Rejoin" });
    stack.add(() => deleteE2EUser(rejoiner.userId));
    const host = await createUser({ runId, tag: "host", displayName: "EDG Host" });
    stack.add(() => deleteE2EUser(host.userId));

    const league = await seedLeague({ runId, creatorId: host.userId, name: `EDG Rejoin ${runId}` });
    stack.add(() => league.cleanup());
    await addMember(league.id, host.userId, { role: "admin", paymentStatus: "paid" });
    await addMember(league.id, rejoiner.userId, { role: "member", paymentStatus: "paid" });
    await setActiveLeague(rejoiner.userId, league.id);

    // Una predicción previa para comprobar que el cleanup la borra al salir.
    const [m] = await seedMatches([editableMatch()]);
    stack.add(() => deleteMatches([m!.id]));
    await seedPrediction({
      leagueId: league.id,
      userId: rejoiner.userId,
      matchId: m!.id,
      home: 1,
      away: 1,
      multiplier: 1.0,
    });

    const session = await loginAs(browser, rejoiner);
    stack.add(() => session.context.close());
    const page = session.page;

    // Salir.
    await page.goto("/account");
    const item = page
      .getByRole("main")
      .getByTestId("account-league-item")
      .filter({ hasText: league.name })
      .filter({ visible: true });
    await item.getByTestId("leave-league-button").click();
    const dialog = page.getByTestId("leave-league-dialog");
    await dialog.getByRole("checkbox").check();
    await dialog.getByTestId("leave-league-confirm").click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });

    const { count: afterLeave } = await admin
      .from("league_members")
      .select("*", { count: "exact", head: true })
      .eq("league_id", league.id)
      .eq("user_id", rejoiner.userId);
    expect(afterLeave).toBe(0);

    // Re-unirse por la landing → auto-join, sin error.
    await page.goto(`/join/${league.inviteCode}`);
    await page.waitForURL(/\/predictions\?joined=1/, { timeout: 15_000 });

    const { data: member } = await admin
      .from("league_members")
      .select("role, wager_balance")
      .eq("league_id", league.id)
      .eq("user_id", rejoiner.userId)
      .single();
    expect(member!.role).toBe("member");
    // Entra limpio: saldo 0 (default).
    expect(Number(member!.wager_balance)).toBe(0);
    // La predicción previa (1-1) fue borrada por el trigger al salir. Al volver,
    // /predictions regenera defaults 0-0 para los editables; lo que importa es
    // que NO sobrevive el valor anterior: la fila de `m` es default (0-0) o nula.
    const row = await getPrediction(league.id, rejoiner.userId, m!.id);
    expect(row === null || (row.home_score_pred === 0 && row.away_score_pred === 0)).toBe(true);
  });

  test("EDG-06: expulsado en caliente pierde acceso al recargar", async ({ browser }) => {
    const runId = newRunId();
    const adminUser = await createUser({ runId, tag: "adm", displayName: "EDG Admin" });
    stack.add(() => deleteE2EUser(adminUser.userId));
    const member = await createUser({ runId, tag: "mem", displayName: "EDG Member" });
    stack.add(() => deleteE2EUser(member.userId));

    const league = await seedLeague({ runId, creatorId: adminUser.userId, name: `EDG Expel ${runId}` });
    stack.add(() => league.cleanup());
    await addMember(league.id, adminUser.userId, { role: "admin", paymentStatus: "paid" });
    await addMember(league.id, member.userId, { role: "member", paymentStatus: "paid" });
    await setActiveLeague(member.userId, league.id);

    const session = await loginAs(browser, member);
    stack.add(() => session.context.close());
    const page = session.page;

    // El miembro está navegando /predictions (es miembro válido).
    await page.goto("/predictions");
    await expect(page.getByRole("main")).toBeVisible();

    // El admin lo expulsa desde otro contexto (RPC real, admin-gated).
    const adminClient = createAnonClient();
    const { error: signInError } = await adminClient.auth.signInWithPassword({
      email: adminUser.email,
      password: TEST_PASSWORD,
    });
    expect(signInError).toBeNull();
    try {
      const { error } = await adminClient.rpc("fn_remove_member", {
        p_league_id: league.id,
        p_user_id: member.userId,
      });
      expect(error).toBeNull();
    } finally {
      await adminClient.auth.signOut();
    }

    // Al recargar, el miembro (sin otra liga) pierde acceso: no-league-state.
    await page.reload();
    await expect(
      page.getByRole("main").getByTestId("no-league-state").filter({ visible: true }),
    ).toHaveCount(1);
  });

  test("EDG-07: multi-liga sin fugas (standings, duelos y premios aislados)", async ({
    browser,
  }) => {
    const runId = newRunId();
    const dual = await createUser({ runId, tag: "dual", displayName: "EDG Dual" });
    stack.add(() => deleteE2EUser(dual.userId));
    const rivalA = await createUser({ runId, tag: "rA", displayName: "EDG Rival Alfa" });
    stack.add(() => deleteE2EUser(rivalA.userId));
    const rivalB = await createUser({ runId, tag: "rB", displayName: "EDG Rival Beta" });
    stack.add(() => deleteE2EUser(rivalB.userId));

    const leagueA = await seedLeague({ runId: `${runId}A`, creatorId: dual.userId, name: `EDG Alfa ${runId}` });
    stack.add(() => leagueA.cleanup());
    const leagueB = await seedLeague({ runId: `${runId}B`, creatorId: dual.userId, name: `EDG Beta ${runId}` });
    stack.add(() => leagueB.cleanup());

    await addMember(leagueA.id, dual.userId, { role: "admin", paymentStatus: "paid", wagerBalance: 50 });
    await addMember(leagueA.id, rivalA.userId, { paymentStatus: "paid" });
    await addMember(leagueB.id, dual.userId, { role: "admin", paymentStatus: "paid", wagerBalance: 50 });
    await addMember(leagueB.id, rivalB.userId, { paymentStatus: "paid" });

    // Duelo SOLO en leagueA (dual reta a rivalA).
    const [mDuel] = await seedMatches([editableMatch()]);
    stack.add(() => deleteMatches([mDuel!.id]));
    const challengeId = await seedChallenge({
      leagueId: leagueA.id,
      matchId: mDuel!.id,
      creator: dual,
      pointsBet: 10,
      type: "direct",
      challengedId: rivalA.userId,
      creatorPred: { home: 2, away: 1 },
    });

    const session = await loginAs(browser, dual);
    stack.add(() => session.context.close());
    const page = session.page;

    // Premio SOLO en leagueA (champion Argentina) vía ?league=.
    await page.goto(`/awards?league=${leagueA.id}`);
    const cardA = page.getByRole("main").getByTestId("awards-board").locator('[data-category="champion"]');
    const inputA = cardA.getByRole("combobox");
    await inputA.fill("Arg");
    const optionA = cardA.getByTestId("candidate-option").filter({ hasText: "Argentina" });
    await expect(optionA).toBeVisible({ timeout: 5_000 });
    await optionA.click();
    await expect(cardA.getByTestId("selected-candidate")).toContainText("Argentina");
    await page.waitForTimeout(500);

    // Activar leagueB: NO debe verse nada de leagueA.
    await setActiveLeague(dual.userId, leagueB.id);
    await page.goto("/standings");
    await expect(page.getByRole("main").getByText("EDG Rival Beta")).toBeVisible();
    await expect(page.getByRole("main").getByText("EDG Rival Alfa")).toHaveCount(0);

    await page.goto("/duels");
    await expect(
      page.getByRole("main").locator(`[data-testid="duel-card"][data-challenge-id="${challengeId}"]`),
    ).toHaveCount(0);

    await page.goto(`/awards?league=${leagueB.id}`);
    const cardB = page.getByRole("main").getByTestId("awards-board").locator('[data-category="champion"]');
    await expect(cardB.getByTestId("selected-candidate")).toHaveCount(0);

    // Activar leagueA: ahora SÍ se ven sus datos.
    await setActiveLeague(dual.userId, leagueA.id);
    await page.goto("/standings");
    await expect(page.getByRole("main").getByText("EDG Rival Alfa")).toBeVisible();
    await expect(page.getByRole("main").getByText("EDG Rival Beta")).toHaveCount(0);

    await page.goto("/duels");
    await expect(
      page.getByRole("main").locator(`[data-testid="duel-card"][data-challenge-id="${challengeId}"]`),
    ).toBeVisible();
  });

  test("EDG-08: la BottomNavbar lleva a cada destino", async () => {
    const page = fixture.users[0]!.page!;
    const routes = ["/standings", "/duels", "/rules", "/account", "/predictions"];

    await page.goto("/predictions");
    for (const route of routes) {
      // .first(): el takeover de `next dev` puede duplicar la barra unos ms
      // (ambos <a> apuntan al mismo href). Activamos vía dispatchEvent('click')
      // porque el indicador de dev de Next (<nextjs-portal>, artefacto solo de
      // `next dev`, inexistente en producción) solapa el ítem más a la izquierda
      // y bloquea el hit-test del click físico; dispatchEvent dispara el handler
      // del Link (router cliente) sin depender del hit-test.
      const link = page
        .getByTestId("bottom-nav")
        .locator(`[data-testid="nav-item"][data-route="${route}"]`)
        .first();
      await expect(link).toHaveAttribute("href", route);
      await link.dispatchEvent("click");
      await page.waitForURL(new RegExp(route.replace("/", "\\/")), { timeout: 15_000 });
      await expect(page.getByRole("main")).toBeVisible();
    }
  });

  test("EDG-09: doble submit al crear duelo produce un solo challenge", async () => {
    const page = fixture.users[0]!.page!;
    const rival = fixture.users[1]!;
    const [m] = await seedMatches([editableMatch({ homeTeamCode: "USA", awayTeamCode: "MEX" })]);
    localMatchIds.push(m!.id);

    await page.goto("/duels");
    await page.getByRole("main").getByTestId("create-duel-button").click();
    await page.getByRole("main").getByTestId("duel-match-select").selectOption(m!.id);
    await page.getByRole("main").getByTestId("duel-type-direct").click();
    await page.getByRole("main").getByTestId("duel-rival-select").selectOption(rival.userId);
    await page.getByRole("main").getByTestId("duel-bet-input").fill("10");

    // Doble click inmediato: el submit se deshabilita con isPending (useTransition).
    await page.getByRole("main").getByTestId("create-duel-submit").dblclick();
    await expect(page.getByRole("main").getByTestId("create-duel-success")).toBeVisible();

    const { count } = await admin
      .from("challenges")
      .select("*", { count: "exact", head: true })
      .eq("league_id", fixture.league.id)
      .eq("match_id", m!.id);
    expect(count).toBe(1);

    // Limpiar el challenge + transacción de escrow y restaurar saldo del creador.
    await admin.from("point_transactions").delete().eq("league_id", fixture.league.id).eq("user_id", fixture.users[0]!.userId).neq("description", "seed_initial_balance");
    await admin.from("challenges").delete().eq("league_id", fixture.league.id).eq("match_id", m!.id);
    await admin.from("league_members").update({ wager_balance: 50 }).eq("league_id", fixture.league.id).eq("user_id", fixture.users[0]!.userId);
  });

  test("EDG-10: inputs extremos (límite del nombre, apuesta > saldo, sin tope de goles)", async ({
    browser,
  }) => {
    // (a) Nombre exactamente en el límite del schema (80 chars) → la liga se crea.
    const runId = newRunId();
    const namer = await createUser({ runId, tag: "namer", displayName: "EDG Namer" });
    stack.add(() => deleteE2EUser(namer.userId));
    const session = await loginAs(browser, namer);
    stack.add(() => session.context.close());
    const namePage = session.page;

    const longName = `EDG80-${runId}-`.padEnd(80, "x").slice(0, 80);
    expect(longName.length).toBe(80);
    stack.add(async () => {
      const { data } = await admin.from("leagues").select("id").eq("name", longName);
      const ids = (data ?? []).map((l) => l.id as string);
      if (ids.length > 0) {
        await admin.from("league_members").delete().in("league_id", ids);
        await admin.from("profiles").update({ active_league_id: null }).in("active_league_id", ids);
        await admin.from("leagues").delete().in("id", ids);
      }
    });

    await namePage.goto("/leagues/new");
    await namePage.getByTestId("league-name-input").fill(longName);
    await namePage.getByTestId("create-league-submit").click();
    await namePage.waitForURL(/\/predictions/, { timeout: 15_000 });
    const { data: created } = await admin.from("leagues").select("id, name").eq("name", longName);
    expect(created).toHaveLength(1);

    // (b) Apuesta > saldo: la UI bloquea (Saldo insuficiente + submit deshabilitado).
    const page = fixture.users[0]!.page!;
    const rival = fixture.users[1]!;
    const [m] = await seedMatches([editableMatch({ homeTeamCode: "ARG", awayTeamCode: "BOL" })]);
    localMatchIds.push(m!.id);

    await page.goto("/duels");
    await page.getByRole("main").getByTestId("create-duel-button").click();
    await page.getByRole("main").getByTestId("duel-match-select").selectOption(m!.id);
    await page.getByRole("main").getByTestId("duel-type-direct").click();
    await page.getByRole("main").getByTestId("duel-rival-select").selectOption(rival.userId);
    const balance = await getWagerBalance(fixture.league.id, fixture.users[0]!.userId);
    await page.getByRole("main").getByTestId("duel-bet-input").fill(String(balance + 1000));
    await expect(page.getByRole("main").getByText("Saldo insuficiente")).toBeVisible();
    await expect(page.getByRole("main").getByTestId("create-duel-submit")).toBeDisabled();

    // (c) GoalPicker SIN tope superior (max indefinido): el producto permite
    // marcadores altos por diseño (la BD solo exige >= 0). No es bug.
    const [mEdit] = await seedMatches([editableMatch({ matchday: 2 })]);
    localMatchIds.push(mEdit!.id);
    await page.goto("/predictions");
    const tab = page.getByRole("tab", { name: "Jornada 2", exact: true });
    await expect(tab).toHaveCount(1);
    await tab.click();
    const card = page.getByRole("main").locator(`article[data-match-id="${mEdit!.id}"]`);
    const inc = card.locator('[data-testid="goal-picker"][data-side="home"]').getByTestId("goal-increment");
    for (let i = 0; i < 12; i++) await inc.click();
    await expect(
      card.locator('[data-testid="goal-picker"][data-side="home"]').getByTestId("goal-value"),
    ).toHaveText("12");
    await expect(inc).toBeEnabled();
  });

  test("EDG-12: refrescar cada ruta conserva sesión y datos", async () => {
    const page = fixture.users[0]!.page!;
    const routes = ["/predictions", "/standings", "/duels", "/account"];
    for (const route of routes) {
      await page.goto(route);
      await page.reload();
      await expect(page).not.toHaveURL(/\/auth\/login/);
      await expect(page).toHaveURL(new RegExp(route.replace("/", "\\/")));
      await expect(page.getByRole("main")).toBeVisible();
    }
  });
});

// EDG-11 corre SOLO en el proyecto desktop-chromium (@desktop). Describe propio
// con fixture mínima para que el proyecto móvil no levante este setup.
test.describe("Smoke desktop (e2e)", () => {
  const stack = createCleanupStack();
  const admin = createAdminClient();
  let fixture: LeagueWithUsers;
  let liveMatchId = "";

  test.beforeAll(async ({ browser }) => {
    fixture = await createLeagueWithUsers(browser, {
      members: 1,
      leagueOpts: { name: `EDG Desktop ${newRunId()}`, paymentStatus: "paid", wagerBalance: 0 },
    });
    stack.add(() => fixture.cleanup());

    const [m] = await seedMatches([
      {
        home: `edg11_h_${newRunId()}`,
        away: `edg11_a_${newRunId()}`,
        kickoffOffsetMs: -30 * 60 * 1000,
        status: "live",
        matchday: 1,
        stage: "group",
        homeScore: 0,
        awayScore: 0,
      },
    ]);
    liveMatchId = m!.id;
    stack.add(() => deleteMatches([liveMatchId]));
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId: liveMatchId,
      home: 1,
      away: 0,
      multiplier: 1.0,
    });
    void admin;
  });

  test.afterAll(async () => {
    await stack.run();
  });

  test("EDG-11: rutas clave renderizan sin layout roto en 1280×800 @desktop", async () => {
    const page = fixture.users[0]!.page!;

    const assertNoCatastrophicOverflow = async (p: Page) => {
      const viewport = p.viewportSize();
      const scrollWidth = await p.evaluate(() => document.documentElement.scrollWidth);
      // Tolerancia pequeña: nada de scroll horizontal catastrófico.
      expect(scrollWidth).toBeLessThanOrEqual((viewport?.width ?? 1280) + 20);
    };

    await page.goto("/predictions");
    await expect(page.getByRole("main")).toBeVisible();
    await assertNoCatastrophicOverflow(page);

    await page.goto("/standings");
    await expect(page.getByTestId("standings-row").first()).toBeVisible();
    await assertNoCatastrophicOverflow(page);

    await page.goto("/duels");
    await expect(page.getByRole("main").getByTestId("duels-dashboard")).toBeVisible();
    await assertNoCatastrophicOverflow(page);

    await page.goto("/live");
    await expect(page.getByTestId("live-board").first()).toBeVisible();
    await assertNoCatastrophicOverflow(page);
  });
});

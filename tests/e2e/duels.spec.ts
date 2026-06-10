import { test, expect } from "@playwright/test";

import { createAdminClient, createAnonClient } from "./helpers/admin";
import { createCleanupStack } from "./helpers/cleanup";
import {
  assertLedgerInvariant,
  getChallenge,
  getTransactions,
  getWagerBalance,
} from "./helpers/db-assert";
import {
  deleteMatches,
  editableMatch,
  lockedMatch,
  seedMatches,
} from "./helpers/seed/matches";
import {
  acceptChallengeAs,
  seedChallenge,
} from "./helpers/seed/challenges";
import { createLeagueWithUsers, TEST_PASSWORD } from "./helpers/users";
import { sendZafronixEvent } from "./helpers/webhook";

// RPC helper inside Playwright runner to invoke DB functions securely as specific user
async function runRpcAsUser(
  user: { email: string; password?: string },
  fnName: string,
  params: Record<string, unknown>
) {
  const client = createAnonClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password ?? TEST_PASSWORD,
  });
  if (signInError) throw signInError;

  try {
    const { data, error } = await client.rpc(fnName, params);
    return { data, error };
  } finally {
    await client.auth.signOut();
  }
}

test.describe("Duelos y Apuestas (e2e)", () => {
  const stack = createCleanupStack();
  const localMatchIds: string[] = [];
  let fixture: Awaited<ReturnType<typeof createLeagueWithUsers>>;
  const admin = createAdminClient();

  test.beforeAll(async ({ browser }) => {
    fixture = await createLeagueWithUsers(browser, {
      members: 3,
      admins: 1,
      eagerLogins: 3, // Log in User 0 (admin), User 1 (member), and User 2 (member)
      leagueOpts: {
        name: "Liga Duelos E2E",
        paymentStatus: "paid",
        wagerBalance: 50.0, // Initial balance
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

    // Reset challenges, transactions and balances for the league to avoid test contamination
    await admin.from("point_transactions").delete().eq("league_id", fixture.league.id);
    await admin.from("challenges").delete().eq("league_id", fixture.league.id);
    
    // Set everyone's balance back to 50.0
    await admin.from("league_members").update({ wager_balance: 50.0 }).eq("league_id", fixture.league.id);
    
    // Seed the initial balance transactions back
    for (const u of fixture.users) {
      await admin.from("point_transactions").insert({
        user_id: u.userId,
        league_id: fixture.league.id,
        amount: 50.0,
        description: "seed_initial_balance"
      });
    }

    // Check ledger conservation invariant after each test (DoD)
    await assertLedgerInvariant(fixture.league.id);
  });

  // ──────────────────────────────────────────────────────────────────────
  // CREACIÓN
  // ──────────────────────────────────────────────────────────────────────

  test("DUE-01: Crear duelo directo (happy)", async () => {
    const pageA = fixture.users[0]!.page!;
    const userB = fixture.users[1]!;

    const matches = await seedMatches([
      editableMatch({ homeTeamCode: "USA", awayTeamCode: "MEX" }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    await pageA.goto("/duels");
    await pageA.getByRole("main").getByTestId("create-duel-button").click();

    await pageA.getByRole("main").getByTestId("duel-match-select").selectOption(m.id);
    await pageA.getByRole("main").getByTestId("duel-type-direct").click();
    await pageA.getByRole("main").getByTestId("duel-rival-select").selectOption(userB.userId);
    await pageA.getByRole("main").getByTestId("duel-bet-input").fill("10");

    const homePicker = pageA.getByRole("main").getByTestId("duel-home-pred");
    await homePicker.getByTestId("goal-increment").click();
    await homePicker.getByTestId("goal-increment").click(); // 2

    const awayPicker = pageA.getByRole("main").getByTestId("duel-away-pred");
    await awayPicker.getByTestId("goal-increment").click(); // 1

    await pageA.getByRole("main").getByTestId("create-duel-submit").click();

    await expect(pageA.getByRole("main").getByTestId("create-duel-success")).toBeVisible();
    await pageA.getByRole("main").getByRole("button", { name: "Volver a Duelos" }).click();

    // Check UI balance decreased
    await expect(pageA.getByRole("main").getByTestId("duel-balance")).toHaveText("40.00");

    // Check DB balance and escrow transaction
    const balanceA = await getWagerBalance(fixture.league.id, fixture.users[0]!.userId);
    expect(balanceA).toBe(40.00);

    const txs = await getTransactions(fixture.league.id, fixture.users[0]!.userId);
    const escrowTx = txs.find(tx => tx.description.includes("escrow"));
    expect(escrowTx).toBeTruthy();
    expect(escrowTx!.amount).toBe(-10.00);
  });

  test("DUE-02: Saldo insuficiente", async () => {
    const pageA = fixture.users[0]!.page!;
    const userB = fixture.users[1]!;

    const matches = await seedMatches([
      editableMatch({ homeTeamCode: "USA", awayTeamCode: "MEX" }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    await pageA.goto("/duels");
    await pageA.getByRole("main").getByTestId("create-duel-button").click();

    await pageA.getByRole("main").getByTestId("duel-match-select").selectOption(m.id);
    await pageA.getByRole("main").getByTestId("duel-rival-select").selectOption(userB.userId);
    
    // Check current balance and input value greater than it
    const currentBalance = await getWagerBalance(fixture.league.id, fixture.users[0]!.userId);
    await pageA.getByRole("main").getByTestId("duel-bet-input").fill(String(currentBalance + 10));

    await expect(pageA.getByRole("main").getByText("Saldo insuficiente")).toBeVisible();
    await expect(pageA.getByRole("main").getByTestId("create-duel-submit")).toBeDisabled();

    // Direct RPC call to verify backend enforcement (P0003)
    const client = createAnonClient();
    const { error: signInError } = await client.auth.signInWithPassword({
      email: fixture.users[0]!.email,
      password: fixture.users[0]!.password,
    });
    expect(signInError).toBeNull();

    try {
      const { error } = await client.rpc("create_challenge", {
        p_league_id: fixture.league.id,
        p_match_id: m.id,
        p_points_bet: Math.floor(currentBalance + 10),
        p_type: "direct",
        p_challenged_id: userB.userId,
        p_prediction_home: 0,
        p_prediction_away: 0,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("P0003");
    } finally {
      await client.auth.signOut();
    }
  });

  test("DUE-03: No auto-reto", async () => {
    const pageA = fixture.users[0]!.page!;

    const matches = await seedMatches([
      editableMatch({ homeTeamCode: "USA", awayTeamCode: "MEX" }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    await pageA.goto("/duels");
    await pageA.getByRole("main").getByTestId("create-duel-button").click();
    await pageA.getByRole("main").getByTestId("duel-match-select").selectOption(m.id);

    // Verify creator B is not selectable in the rivals dropdown
    const options = await pageA.getByRole("main").locator('[data-testid="duel-rival-select"] option').allTextContents();
    expect(options).not.toContain(fixture.users[0]!.displayName);

    // RPC auto-challenge error P0002
    const { error } = await runRpcAsUser(fixture.users[0]!, "create_challenge", {
      p_league_id: fixture.league.id,
      p_match_id: m.id,
      p_points_bet: 10,
      p_type: "direct",
      p_challenged_id: fixture.users[0]!.userId,
      p_prediction_home: 0,
      p_prediction_away: 0,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("P0002");
  });

  test("DUE-04: Apuesta inválida", async () => {
    const matches = await seedMatches([
      editableMatch({ homeTeamCode: "USA", awayTeamCode: "MEX" }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    // 0 bet fails with P0001
    const { error: errZero } = await runRpcAsUser(fixture.users[0]!, "create_challenge", {
      p_league_id: fixture.league.id,
      p_match_id: m.id,
      p_points_bet: 0,
      p_type: "direct",
      p_challenged_id: fixture.users[1]!.userId,
      p_prediction_home: 0,
      p_prediction_away: 0,
    });
    expect(errZero).not.toBeNull();
    expect(errZero!.code).toBe("P0001");

    // Negative bet fails with P0001
    const { error: errNegative } = await runRpcAsUser(fixture.users[0]!, "create_challenge", {
      p_league_id: fixture.league.id,
      p_match_id: m.id,
      p_points_bet: -5,
      p_type: "direct",
      p_challenged_id: fixture.users[1]!.userId,
      p_prediction_home: 0,
      p_prediction_away: 0,
    });
    expect(errNegative).not.toBeNull();
    expect(errNegative!.code).toBe("P0001");
  });

  test("DUE-05: Partido ya iniciado", async () => {
    const pageA = fixture.users[0]!.page!;
    const userB = fixture.users[1]!;

    // Seed a locked match (kickoff in the past)
    const matches = await seedMatches([
      lockedMatch({ homeTeamCode: "FRA", awayTeamCode: "ITA" }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    await pageA.goto("/duels");
    await pageA.getByRole("main").getByTestId("create-duel-button").click();

    await pageA.getByRole("main").getByTestId("duel-match-select").selectOption(m.id);
    await pageA.getByRole("main").getByTestId("duel-rival-select").selectOption(userB.userId);
    await pageA.getByRole("main").getByTestId("duel-bet-input").fill("10");
    await pageA.getByRole("main").getByTestId("create-duel-submit").click();

    // Verify correct error text from server action mapping
    await expect(pageA.getByRole("main").getByTestId("create-duel-error")).toHaveText(
      "El partido ya comenzó; este desafío ya no admite aceptaciones."
    );
  });

  test("DUE-06: Crear duelo abierto", async () => {
    const pageA = fixture.users[0]!.page!;
    const pageB = fixture.users[1]!.page!;

    const matches = await seedMatches([
      editableMatch({ homeTeamCode: "USA", awayTeamCode: "MEX" }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    await pageA.goto("/duels");
    await pageA.getByRole("main").getByTestId("create-duel-button").click();
    await pageA.getByRole("main").getByTestId("duel-match-select").selectOption(m.id);
    await pageA.getByRole("main").getByTestId("duel-type-open").click();
    await pageA.getByRole("main").getByTestId("duel-bet-input").fill("10");
    await pageA.getByRole("main").getByTestId("create-duel-submit").click();

    await expect(pageA.getByRole("main").getByTestId("create-duel-success")).toBeVisible();
    await pageA.getByRole("main").getByRole("button", { name: "Volver a Duelos" }).click();

    // Verify B sees it as an open pool
    await pageB.goto("/duels");
    const poolCard = pageB.getByRole("main").locator(`[data-testid="duel-card"]`).filter({ hasText: "Abierto" });
    await expect(poolCard).toBeVisible();
    await expect(poolCard.getByTestId("join-pool-button")).toBeVisible();
  });

  // ──────────────────────────────────────────────────────────────────────
  // ACEPTACIÓN / RECHAZO / EXPIRACIÓN
  // ──────────────────────────────────────────────────────────────────────

  test("DUE-07: Aceptar directo", async () => {
    const pageB = fixture.users[1]!.page!;
    const matches = await seedMatches([
      editableMatch({ homeTeamCode: "USA", awayTeamCode: "MEX" }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    // Create challenge A -> B via RPC helper
    const challengeId = await seedChallenge({
      leagueId: fixture.league.id,
      matchId: m.id,
      creator: fixture.users[0]!,
      pointsBet: 10,
      type: "direct",
      challengedId: fixture.users[1]!.userId,
      creatorPred: { home: 2, away: 1 },
    });

    await pageB.goto("/duels");
    const card = pageB.getByRole("main").locator(`[data-testid="duel-card"][data-challenge-id="${challengeId}"]`);
    await expect(card).toBeVisible();

    await card.getByTestId("accept-duel-button").click();

    const dialog = pageB.locator("form");
    const homePicker = dialog.getByTestId("accept-home-pred");
    await homePicker.getByTestId("goal-increment").click(); // 1
    const awayPicker = dialog.getByTestId("accept-away-pred");
    await awayPicker.getByTestId("goal-increment").click(); // 1

    await dialog.getByTestId("accept-duel-submit").click();

    // Card should transition to En Juego
    await expect(card.getByText("En Juego")).toBeVisible();
    
    // Check UI balance of B
    await expect(pageB.getByRole("main").getByTestId("duel-balance")).toHaveText("40.00");

    // Check DB challenge status
    const chal = await getChallenge(challengeId);
    expect(chal!.status).toBe("active");
    expect(chal!.participants.length).toBe(2);
  });

  test("DUE-08: Doble aceptación", async () => {
    const matches = await seedMatches([
      editableMatch({ homeTeamCode: "USA", awayTeamCode: "MEX" }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    const challengeId = await seedChallenge({
      leagueId: fixture.league.id,
      matchId: m.id,
      creator: fixture.users[0]!,
      pointsBet: 10,
      type: "direct",
      challengedId: fixture.users[1]!.userId,
      creatorPred: { home: 2, away: 1 },
    });

    await acceptChallengeAs(fixture.users[1]!, challengeId, { home: 1, away: 1 });

    // Try to accept again -> fails with P0005
    const { error } = await runRpcAsUser(fixture.users[1]!, "accept_challenge", {
      p_challenge_id: challengeId,
      p_prediction_home: 0,
      p_prediction_away: 0,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("P0005");
  });

  test("DUE-09: Reto dirigido a otro", async () => {
    const pageC = fixture.users[2]!.page!;
    const matches = await seedMatches([
      editableMatch({ homeTeamCode: "USA", awayTeamCode: "MEX" }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    const challengeId = await seedChallenge({
      leagueId: fixture.league.id,
      matchId: m.id,
      creator: fixture.users[0]!,
      pointsBet: 10,
      type: "direct",
      challengedId: fixture.users[1]!.userId,
      creatorPred: { home: 2, away: 1 },
    });

    // C goes to /duels -> should not see the card
    await pageC.goto("/duels");
    const card = pageC.getByRole("main").locator(`[data-testid="duel-card"][data-challenge-id="${challengeId}"]`);
    await expect(card).toHaveCount(0);

    // C tries to accept via RPC -> fails with 42501
    const { error } = await runRpcAsUser(fixture.users[2]!, "accept_challenge", {
      p_challenge_id: challengeId,
      p_prediction_home: 0,
      p_prediction_away: 0,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
  });

  test("DUE-10: Aceptar sin saldo", async () => {
    const pageB = fixture.users[1]!.page!;
    const matches = await seedMatches([
      editableMatch({ homeTeamCode: "USA", awayTeamCode: "MEX" }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    // Set B balance to 5.0 to simulate insufficient balance
    await admin.from("league_members").update({ wager_balance: 5.0 }).eq("league_id", fixture.league.id).eq("user_id", fixture.users[1]!.userId);
    // Delete existing ledger transactions for user B in this league and add the seed transaction
    await admin.from("point_transactions").delete().eq("league_id", fixture.league.id).eq("user_id", fixture.users[1]!.userId);
    await admin.from("point_transactions").insert({
      user_id: fixture.users[1]!.userId,
      league_id: fixture.league.id,
      amount: 5.0,
      description: "seed_initial_balance",
    });

    const challengeId = await seedChallenge({
      leagueId: fixture.league.id,
      matchId: m.id,
      creator: fixture.users[0]!,
      pointsBet: 10,
      type: "direct",
      challengedId: fixture.users[1]!.userId,
      creatorPred: { home: 2, away: 1 },
    });

    await pageB.goto("/duels");
    const card = pageB.getByRole("main").locator(`[data-testid="duel-card"][data-challenge-id="${challengeId}"]`);
    await card.getByTestId("accept-duel-button").click();

    await expect(pageB.getByRole("main").getByText("Saldo insuficiente")).toBeVisible();
    await expect(pageB.getByRole("main").getByTestId("accept-duel-submit")).toBeDisabled();

    // RPC rejects with P0003
    const { error } = await runRpcAsUser(fixture.users[1]!, "accept_challenge", {
      p_challenge_id: challengeId,
      p_prediction_home: 1,
      p_prediction_away: 1,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("P0003");
  });

  test("DUE-11: Rechazar", async () => {
    const pageB = fixture.users[1]!.page!;
    const matches = await seedMatches([
      editableMatch({ homeTeamCode: "USA", awayTeamCode: "MEX" }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    const challengeId = await seedChallenge({
      leagueId: fixture.league.id,
      matchId: m.id,
      creator: fixture.users[0]!,
      pointsBet: 10,
      type: "direct",
      challengedId: fixture.users[1]!.userId,
      creatorPred: { home: 2, away: 1 },
    });

    await pageB.goto("/duels");
    const card = pageB.getByRole("main").locator(`[data-testid="duel-card"][data-challenge-id="${challengeId}"]`);
    await card.getByTestId("reject-duel-button").click();
    
    // Wait for card to disappear from UI to ensure the action is complete
    await expect(card).toBeHidden();

    const chal = await getChallenge(challengeId);
    expect(chal!.status).toBe("canceled");

    // A balance is refunded to 50
    const wbA = await getWagerBalance(fixture.league.id, fixture.users[0]!.userId);
    expect(wbA).toBe(50.0);
  });

  test("DUE-12: Expiración al kickoff", async () => {
    const pageA = fixture.users[0]!.page!;
    const matches = await seedMatches([
      editableMatch({ homeTeamCode: "USA", awayTeamCode: "MEX" }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    const challengeId = await seedChallenge({
      leagueId: fixture.league.id,
      matchId: m.id,
      creator: fixture.users[0]!,
      pointsBet: 10,
      type: "direct",
      challengedId: fixture.users[1]!.userId,
      creatorPred: { home: 2, away: 1 },
    });

    // Transition match to live to trigger auto-expiration on kickoff
    await runRpcAsUser(fixture.users[0]!, "fn_admin_set_match_result", {
      p_match_id: m.id,
      p_home_score: 1,
      p_away_score: 0,
      p_status: "live",
    });

    const chal = await getChallenge(challengeId);
    expect(chal!.status).toBe("canceled");

    const wbA = await getWagerBalance(fixture.league.id, fixture.users[0]!.userId);
    expect(wbA).toBe(50.0);

    // Verify UI displays Canceled under history tab
    await pageA.goto("/duels");
    await pageA.getByRole("main").getByRole("button", { name: "Historial" }).click();
    const card = pageA.getByRole("main").locator(`[data-testid="duel-card"][data-challenge-id="${challengeId}"]`);
    await expect(card.getByText("Cancelado")).toBeVisible();
  });

  test("DUE-13: Abierto con 3 participantes", async () => {
    const matches = await seedMatches([
      editableMatch({ homeTeamCode: "USA", awayTeamCode: "MEX" }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    const challengeId = await seedChallenge({
      leagueId: fixture.league.id,
      matchId: m.id,
      creator: fixture.users[0]!,
      pointsBet: 10,
      type: "open",
      creatorPred: { home: 2, away: 1 },
    });

    await acceptChallengeAs(fixture.users[1]!, challengeId, { home: 1, away: 1 });
    await acceptChallengeAs(fixture.users[2]!, challengeId, { home: 0, away: 2 });

    const chal = await getChallenge(challengeId);
    expect(chal!.status).toBe("pending"); // Open pools stay pending until kickoff
    expect(chal!.participants.length).toBe(3);

    // Total pot in ledger transactions should sum up to -30
    const { data: txs } = await admin.from("point_transactions").select("amount").eq("reference_id", challengeId);
    const sum = txs!.reduce((acc, tx) => acc + Number(tx.amount), 0);
    expect(sum).toBe(-30.00);
  });

  // ──────────────────────────────────────────────────────────────────────
  // RESOLUCIÓN AUTOMÁTICA
  // ──────────────────────────────────────────────────────────────────────

  test("DUE-14: Ganador único", async ({ request }) => {
    const externalRef = `ref-due14-${Date.now()}`;
    const matches = await seedMatches([
      editableMatch({ homeTeamCode: "ARG", awayTeamCode: "BOL", externalRef }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    const challengeId = await seedChallenge({
      leagueId: fixture.league.id,
      matchId: m.id,
      creator: fixture.users[0]!,
      pointsBet: 10,
      type: "direct",
      challengedId: fixture.users[1]!.userId,
      creatorPred: { home: 3, away: 0 },
    });

    await acceptChallengeAs(fixture.users[1]!, challengeId, { home: 1, away: 1 });

    // Finalize match via webhook: ARG 3, BOL 0
    const result = await sendZafronixEvent(request, {
      type: "match.finalized",
      matchExternalRef: externalRef,
      teams: { home: m.home_team, away: m.away_team },
      payload: {
        homeScore: 3,
        awayScore: 0,
      },
    });
    console.log("DUE-14 webhook response status:", result.status);
    console.log("DUE-14 webhook response body:", result.body);

    const chal = await getChallenge(challengeId);
    expect(chal!.status).toBe("completed");
    expect(chal!.winner_ids).toEqual([fixture.users[0]!.userId]);

    const wbA = await getWagerBalance(fixture.league.id, fixture.users[0]!.userId);
    expect(wbA).toBe(60.0); // 50 - 10 + 20 = 60

    const wbB = await getWagerBalance(fixture.league.id, fixture.users[1]!.userId);
    expect(wbB).toBe(40.0); // 50 - 10 = 40
  });

  test("DUE-15: Empate en el máximo -> split", async ({ request }) => {
    const externalRef = `ref-due15-${Date.now()}`;
    const matches = await seedMatches([
      editableMatch({ homeTeamCode: "ARG", awayTeamCode: "BOL", externalRef }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    const challengeId = await seedChallenge({
      leagueId: fixture.league.id,
      matchId: m.id,
      creator: fixture.users[0]!,
      pointsBet: 10,
      type: "direct",
      challengedId: fixture.users[1]!.userId,
      creatorPred: { home: 2, away: 1 },
    });

    await acceptChallengeAs(fixture.users[1]!, challengeId, { home: 1, away: 0 });

    // Finalize match: ARG 2, BOL 0 (both win prediction base outcomes -> tie)
    await sendZafronixEvent(request, {
      type: "match.finalized",
      matchExternalRef: externalRef,
      teams: { home: m.home_team, away: m.away_team },
      payload: {
        homeScore: 2,
        awayScore: 0,
      },
    });

    const chal = await getChallenge(challengeId);
    expect(chal!.status).toBe("completed");
    expect(chal!.winner_ids!.sort()).toEqual([fixture.users[0]!.userId, fixture.users[1]!.userId].sort());

    const wbA = await getWagerBalance(fixture.league.id, fixture.users[0]!.userId);
    expect(wbA).toBe(50.0); // Split pot of 20 = 10 each -> net zero change

    const wbB = await getWagerBalance(fixture.league.id, fixture.users[1]!.userId);
    expect(wbB).toBe(50.0);
  });

  test("DUE-16: Sin ganador -> reembolso", async ({ request }) => {
    const externalRef = `ref-due16-${Date.now()}`;
    const matches = await seedMatches([
      editableMatch({ homeTeamCode: "ARG", awayTeamCode: "BOL", externalRef }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    const challengeId = await seedChallenge({
      leagueId: fixture.league.id,
      matchId: m.id,
      creator: fixture.users[0]!,
      pointsBet: 10,
      type: "direct",
      challengedId: fixture.users[1]!.userId,
      creatorPred: { home: 3, away: 0 },
    });

    await acceptChallengeAs(fixture.users[1]!, challengeId, { home: 0, away: 3 });

    // Finalize match: ARG 1, BOL 1 (both lose outcome -> refund)
    await sendZafronixEvent(request, {
      type: "match.finalized",
      matchExternalRef: externalRef,
      teams: { home: m.home_team, away: m.away_team },
      payload: {
        homeScore: 1,
        awayScore: 1,
      },
    });

    const chal = await getChallenge(challengeId);
    expect(chal!.status).toBe("completed");
    expect(chal!.winner_ids).toEqual([]);

    const wbA = await getWagerBalance(fixture.league.id, fixture.users[0]!.userId);
    expect(wbA).toBe(50.0);

    const wbB = await getWagerBalance(fixture.league.id, fixture.users[1]!.userId);
    expect(wbB).toBe(50.0);
  });

  test("DUE-17: Suspensión -> reembolso", async ({ request }) => {
    const externalRef = `ref-due17-${Date.now()}`;
    const matches = await seedMatches([
      editableMatch({ homeTeamCode: "ARG", awayTeamCode: "BOL", externalRef }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    const challengeId = await seedChallenge({
      leagueId: fixture.league.id,
      matchId: m.id,
      creator: fixture.users[0]!,
      pointsBet: 10,
      type: "direct",
      challengedId: fixture.users[1]!.userId,
      creatorPred: { home: 2, away: 1 },
    });

    await acceptChallengeAs(fixture.users[1]!, challengeId, { home: 1, away: 1 });

    // Webhook postponed cancels active challenges and refunds
    await sendZafronixEvent(request, {
      type: "match.postponed",
      matchExternalRef: externalRef,
      teams: { home: m.home_team, away: m.away_team },
      payload: {
        status: "postponed",
      },
    });

    const chal = await getChallenge(challengeId);
    expect(chal!.status).toBe("canceled");

    const wbA = await getWagerBalance(fixture.league.id, fixture.users[0]!.userId);
    expect(wbA).toBe(50.0);

    const wbB = await getWagerBalance(fixture.league.id, fixture.users[1]!.userId);
    expect(wbB).toBe(50.0);
  });

  test("DUE-18: Duelo y predicción normal coexisten", async ({ request }) => {
    const externalRef = `ref-due18-${Date.now()}`;
    const matches = await seedMatches([
      editableMatch({ homeTeamCode: "ARG", awayTeamCode: "BOL", matchday: 2, externalRef }), // J2 so multiplier is higher than 1.0 (let's say 1.25)
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    // Normal prediction for A
    await admin.from("predictions").insert({
      league_id: fixture.league.id,
      user_id: fixture.users[0]!.userId,
      match_id: m.id,
      home_score_pred: 3,
      away_score_pred: 0,
      multiplier: 1.25,
    });

    const challengeId = await seedChallenge({
      leagueId: fixture.league.id,
      matchId: m.id,
      creator: fixture.users[0]!,
      pointsBet: 10,
      type: "direct",
      challengedId: fixture.users[1]!.userId,
      creatorPred: { home: 3, away: 0 },
    });

    await acceptChallengeAs(fixture.users[1]!, challengeId, { home: 1, away: 1 });

    // Finalize match: ARG 3, BOL 0
    // Normal prediction: 5 base * 1.25 multiplier = 6.25 pts.
    // Duel payout: 20.00 pts.
    // Total change: -10 (escrow) + 6.25 + 20.00 = +16.25 pts.
    // Final balance A: 50.00 + 16.25 = 66.25 pts.
    await sendZafronixEvent(request, {
      type: "match.finalized",
      matchExternalRef: externalRef,
      teams: { home: m.home_team, away: m.away_team },
      payload: {
        homeScore: 3,
        awayScore: 0,
      },
    });

    const wbA = await getWagerBalance(fixture.league.id, fixture.users[0]!.userId);
    expect(wbA).toBe(66.25);
  });

  // ──────────────────────────────────────────────────────────────────────
  // LANDING PÚBLICA (Marcados como fixme debido al BUG-001)
  // ──────────────────────────────────────────────────────────────────────

  test("DUE-19: /desafio/[id] anónima oculta predicciones", async ({ browser }) => {
    // Marcado fixme por BUG-001: el middleware redirige a /auth/login a los anónimos
    test.fixme(true, "BUG-001: /desafio/[id] no es accesible de forma anónima");

    const matches = await seedMatches([
      editableMatch({ homeTeamCode: "USA", awayTeamCode: "MEX" }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    const challengeId = await seedChallenge({
      leagueId: fixture.league.id,
      matchId: m.id,
      creator: fixture.users[0]!,
      pointsBet: 10,
      type: "direct",
      challengedId: fixture.users[1]!.userId,
      creatorPred: { home: 2, away: 1 },
    });

    await acceptChallengeAs(fixture.users[1]!, challengeId, { home: 1, away: 1 });

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/desafio/${challengeId}`);

    // Verify creator display name and match info
    await expect(page.getByRole("main").getByText(fixture.users[0]!.displayName!)).toBeVisible();
    await expect(page.getByRole("main").getByText("USA vs MEX")).toBeVisible();
    await expect(page.getByRole("main").getByText("Apuesta: 10 pts")).toBeVisible();

    // Verify predictions are hidden/masked with padlocks 🔒
    await expect(page.getByRole("main").getByText("🔒")).toHaveCount(2);

    await context.close();
  });

  test("DUE-20: Metadata OG del desafío", async ({ browser }) => {
    // Marcado fixme por BUG-001: el middleware redirige a /auth/login a los anónimos
    test.fixme(true, "BUG-001: /desafio/[id] no es accesible de forma anónima");

    const matches = await seedMatches([
      editableMatch({ homeTeamCode: "USA", awayTeamCode: "MEX" }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    const challengeId = await seedChallenge({
      leagueId: fixture.league.id,
      matchId: m.id,
      creator: fixture.users[0]!,
      pointsBet: 10,
      type: "direct",
      challengedId: fixture.users[1]!.userId,
      creatorPred: { home: 2, away: 1 },
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/desafio/${challengeId}`);

    const title = await page.locator('meta[property="og:title"]').getAttribute("content");
    const description = await page.locator('meta[property="og:description"]').getAttribute("content");

    expect(title).toContain(`Desafío 1v1: ${fixture.users[0]!.displayName}`);
    expect(description).toContain("Apuesta tus puntos en el partido USA vs MEX");

    await context.close();
  });

  test("DUE-21: Deep-link: landing -> login -> aceptar", async ({ browser }) => {
    // Marcado fixme por BUG-001: requiere abrir la landing anónimamente primero
    test.fixme(true, "BUG-001: /desafio/[id] no es accesible de forma anónima");

    const matches = await seedMatches([
      editableMatch({ homeTeamCode: "USA", awayTeamCode: "MEX" }),
    ]);
    const m = matches[0]!;
    localMatchIds.push(m.id);

    const challengeId = await seedChallenge({
      leagueId: fixture.league.id,
      matchId: m.id,
      creator: fixture.users[0]!,
      pointsBet: 10,
      type: "direct",
      challengedId: fixture.users[1]!.userId,
      creatorPred: { home: 2, away: 1 },
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Anon user opens the page and is prompted to sign in
    await page.goto(`/desafio/${challengeId}`);
    await expect(page.getByRole("main").getByText("Debes iniciar sesión con Google")).toBeVisible();

    // Simulating redirect to password login with auto-accept parameter
    await page.goto(`/auth/login?next=/desafio/${challengeId}?accept=true`);
    await page.getByLabel("Correo electrónico").fill(fixture.users[1]!.email);
    await page.getByLabel("Contraseña").fill(fixture.users[1]!.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();

    // Login redirects B to the challenge page, which opens AcceptDuelDialog modal
    await page.waitForURL(new RegExp(`/desafio/${challengeId}`), { timeout: 15_000 });
    
    const dialog = page.getByRole("main").locator("form");
    await expect(dialog.getByTestId("accept-duel-submit")).toBeVisible();

    // Fill prediction and accept duel
    const homePicker = dialog.getByTestId("accept-home-pred");
    await homePicker.getByTestId("goal-increment").click(); // 1
    const awayPicker = dialog.getByTestId("accept-away-pred");
    await awayPicker.getByTestId("goal-increment").click(); // 1
    await dialog.getByTestId("accept-duel-submit").click();

    // Check challenge is now active
    const chal = await getChallenge(challengeId);
    expect(chal!.status).toBe("active");

    await context.close();
  });
});

import { test, expect, type Locator, type Page } from "@playwright/test";

import { createAdminClient, createAnonClient } from "./helpers/admin";
import { createCleanupStack } from "./helpers/cleanup";
import { getPrediction } from "./helpers/db-assert";
import {
  deleteMatches,
  editableMatch,
  liveMatch,
  seedMatches,
  tbdKnockoutMatch,
  type SeededMatchRow,
} from "./helpers/seed/matches";
import { seedPrediction } from "./helpers/seed/predictions";
import {
  createLeagueWithUsers,
  type LeagueWithUsers,
} from "./helpers/users";
import { selectPhaseTab } from "./helpers/ui";

// Fase 4 — Candados de kickoff y time-gating (PRED-14..19).
//
// DESVIACIÓN del plan/contexto (§4.3): la migración vigente
// (20260605150000_fix_tbd_knockout_predictions_lock.sql) bloquea en el
// kickoff EXACTO (now() < match_time), SIN la ventana previa de 1 minuto; la
// UI espeja ese corte (KICKOFF_LOCK_MS = 0 en MatchCard). Por eso el partido
// "bloqueado" se siembra con kickoff en el pasado reciente (status scheduled),
// no con kickoff +30 s (eso hoy sigue siendo editable).

function cardFor(page: Page, matchId: string): Locator {
  return page
    .getByRole("main")
    .locator(`article[data-match-id="${matchId}"]`);
}

function picker(card: Locator, side: "home" | "away"): Locator {
  return card.locator(`[data-testid="goal-picker"][data-side="${side}"]`);
}

test.describe("/predictions — candados y time-gating", () => {
  const stack = createCleanupStack();
  let fixture: LeagueWithUsers;
  let page: Page;

  let mLocked: SeededMatchRow; // PRED-14 (scheduled, kickoff ya pasado)
  let mLive: SeededMatchRow; // PRED-15
  let mTbd: SeededMatchRow; // PRED-16
  let mRace: SeededMatchRow; // PRED-18
  let mGate: SeededMatchRow; // PRED-19

  test.beforeAll(async ({ browser }) => {
    const matches = await seedMatches([
      // Candado por kickoff: scheduled con kickoff hace 30 s (el resultado aún
      // no llega): la BD y la UI lo tratan como cerrado.
      editableMatch({ matchday: 2, groupLabel: "A", kickoffOffsetMs: -30_000 }),
      liveMatch({ home: 1, away: 0 }, { matchday: 2, groupLabel: "B" }),
      tbdKnockoutMatch(),
      editableMatch({ matchday: 2, groupLabel: "C" }), // mRace (kickoff +2d)
      editableMatch({ matchday: 2, groupLabel: "D" }), // mGate (kickoff +2d)
    ]);
    [mLocked, mLive, mTbd, mRace, mGate] = matches as [
      SeededMatchRow, SeededMatchRow, SeededMatchRow, SeededMatchRow, SeededMatchRow,
    ];
    stack.add(() => deleteMatches(matches.map((m) => m.id)));

    fixture = await createLeagueWithUsers(browser, { members: 2 });
    stack.add(() => fixture.cleanup());
    page = fixture.users[0]!.page!;
  });

  test.afterAll(async () => {
    await stack.run();
  });

  test("PRED-14: partido con kickoff alcanzado queda bloqueado (scheduled)", async () => {
    await page.goto("/predictions");
    await selectPhaseTab(page, "Jornada 2");
    const card = cardFor(page, mLocked.id);

    const lock = card.getByTestId("lock-indicator");
    await expect(lock).toBeVisible();
    await expect(lock).toHaveText("Pronostico cerrado");
    await expect(lock).toHaveAttribute("data-reason", "scheduled");
    await expect(
      picker(card, "home").getByTestId("goal-increment"),
    ).toBeDisabled();
    await expect(
      picker(card, "away").getByTestId("goal-increment"),
    ).toBeDisabled();
  });

  test("PRED-15: partido en vivo bloqueado, sin botón de deshacer", async () => {
    await page.goto("/predictions");
    await selectPhaseTab(page, "Jornada 2");
    const card = cardFor(page, mLive.id);

    const lock = card.getByTestId("lock-indicator");
    await expect(lock).toHaveText("En vivo");
    await expect(
      picker(card, "home").getByTestId("goal-increment"),
    ).toBeDisabled();
    await expect(card.getByTestId("undo-button")).toHaveCount(0);
  });

  test("PRED-16: slot TBD de eliminatoria sin controles de edición activos", async () => {
    await page.goto("/predictions");
    await selectPhaseTab(page, "Semis");
    const card = cardFor(page, mTbd.id);

    const lock = card.getByTestId("lock-indicator");
    await expect(lock).toHaveText("Pendiente de clasificacion");
    await expect(lock).toHaveAttribute("data-reason", "tbd");
    // El origen del bracket sustituye a los equipos sin resolver.
    await expect(card).toContainText("Ganador 97");
    await expect(
      picker(card, "home").getByTestId("goal-increment"),
    ).toBeDisabled();
    await expect(
      picker(card, "away").getByTestId("goal-increment"),
    ).toBeDisabled();
  });

  test("PRED-17: @slow la card editable se bloquea al llegar el kickoff", async () => {
    // Único test de espera real (>30 s) de la suite, por presupuesto de tiempo.
    test.setTimeout(150_000);
    const kickoff = new Date(Date.now() + 75_000).toISOString();
    const match = await seedMatches([
      editableMatch({ matchday: 2, groupLabel: "E", matchTime: kickoff }),
    ]);
    stack.add(() => deleteMatches([match[0]!.id]));

    await page.goto("/predictions");
    await selectPhaseTab(page, "Jornada 2");
    const card = cardFor(page, match[0]!.id);

    // Al cargar, faltan ~75 s: editable.
    await expect(
      picker(card, "home").getByTestId("goal-increment"),
    ).toBeEnabled();

    // Espera real documentada (@slow): cruzamos el kickoff y recargamos.
    await page.waitForTimeout(80_000);
    await page.reload();
    await selectPhaseTab(page, "Jornada 2");
    const cardAfter = cardFor(page, match[0]!.id);
    await expect(cardAfter.getByTestId("lock-indicator")).toHaveText(
      "Pronostico cerrado",
    );
    await expect(
      picker(cardAfter, "home").getByTestId("goal-increment"),
    ).toBeDisabled();
  });

  test("PRED-18: el servidor rechaza el guardado tardío (carrera usuario vs kickoff)", async () => {
    await page.goto("/predictions");
    await selectPhaseTab(page, "Jornada 2");
    const card = cardFor(page, mRace.id);

    // La card sigue mostrando el partido editable (datos SSR previos), pero
    // movemos el kickoff al pasado vía service role ANTES de que el debounce
    // dispare el guardado: simula la carrera real usuario-vs-kickoff.
    const admin = createAdminClient();
    const { error } = await admin
      .from("matches")
      .update({ match_time: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", mRace.id);
    expect(error).toBeNull();

    await picker(card, "home").getByTestId("goal-increment").click();

    // fn_save_prediction rechaza con P0001 → mensaje estable del action.
    const status = card.getByTestId("save-status");
    await expect(status).toHaveAttribute("data-state", "error", {
      timeout: 10_000,
    });
    await expect(status).toHaveText(
      "Pronostico cerrado. El partido esta por comenzar.",
    );

    // La BD conserva el default 0-0 (el guardado tardío no pasó).
    const row = await getPrediction(
      fixture.league.id,
      fixture.users[0]!.userId,
      mRace.id,
    );
    expect(row!.home_score_pred).toBe(0);
  });

  test("PRED-19: las predicciones ajenas están ocultas hasta el kickoff (RLS)", async () => {
    const userA = fixture.users[0]!;
    const userB = fixture.users[1]!;

    // B tiene una predicción distintiva en un partido aún editable.
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: userB.userId,
      matchId: mGate.id,
      home: 7,
      away: 6,
      multiplier: 1.0,
    });

    // No existe superficie de UI que liste predicciones ajenas pre-kickoff
    // (las queries de /standings y /live filtran por finished/live), así que
    // la invariante se verifica por la VÍA REAL del cliente: una sesión
    // autenticada de A consultando la tabla con la anon key (misma ruta que
    // producción; la policy SELECT usa fn_match_unlocked).
    const clientA = createAnonClient();
    const { error: signInError } = await clientA.auth.signInWithPassword({
      email: userA.email,
      password: userA.password,
    });
    expect(signInError).toBeNull();

    const queryBPrediction = async () => {
      const { data, error } = await clientA
        .from("predictions")
        .select("home_score_pred, away_score_pred")
        .eq("match_id", mGate.id)
        .eq("user_id", userB.userId);
      expect(error).toBeNull();
      return data ?? [];
    };

    try {
      // Pre-kickoff: la predicción de B es invisible para A.
      expect(await queryBPrediction()).toHaveLength(0);

      // Simular el kickoff: match_time al pasado y en vivo (service role).
      const admin = createAdminClient();
      await admin
        .from("matches")
        .update({
          match_time: new Date(Date.now() - 2 * 60_000).toISOString(),
          status: "live",
          home_score: 0,
          away_score: 0,
        })
        .eq("id", mGate.id);

      // Post-kickoff (fn_match_unlocked): la predicción de B ya es legible.
      const visible = await queryBPrediction();
      expect(visible).toHaveLength(1);
      expect(visible[0]!.home_score_pred).toBe(7);
      expect(visible[0]!.away_score_pred).toBe(6);

      // Y la superficie de UI que la consume (/live, tabla proyectada) lista
      // a ambos miembros con el partido en vivo.
      await page.goto("/live");
      const board = page.getByRole("main").getByTestId("live-board");
      await expect(board).toBeVisible();
      await expect(board.getByTestId("live-row")).toHaveCount(2);
    } finally {
      await clientA.auth.signOut();
    }
  });
});

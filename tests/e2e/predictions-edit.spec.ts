import { test, expect, type Locator, type Page } from "@playwright/test";

import { createCleanupStack } from "./helpers/cleanup";
import { getPrediction } from "./helpers/db-assert";
import { createAdminClient } from "./helpers/admin";
import { expectedMultiplierForMatch } from "./helpers/multiplier";
import {
  deleteMatches,
  editableMatch,
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

// Fase 4 — Edición y autosave del tablero de predicciones (PRED-01..13).
// Complementa (NO duplica) predictions-finished.spec.ts. Textos y testids
// copiados de MatchCard.tsx / GoalPicker.tsx.
//
// OJO (desviación del plan): el debounce real de MatchCard es 1500 ms
// (DEBOUNCE_MS), no 500 ms. No hace falta esperarlo a mano: los asserts del
// save-status usan el auto-wait de expect con margen (expectSaved).

// Localiza la card de un partido dentro del tablero (anclada a <main> por el
// flake del takeover de next dev; ver SEGUIMIENTO.md).
function cardFor(page: Page, matchId: string): Locator {
  return page
    .getByRole("main")
    .locator(`article[data-match-id="${matchId}"]`);
}

function picker(card: Locator, side: "home" | "away"): Locator {
  return card.locator(`[data-testid="goal-picker"][data-side="${side}"]`);
}

// Espera a que el guardado del autosave se confirme ("Guardado ✓" dura 3 s).
async function expectSaved(card: Locator): Promise<void> {
  await expect(card.getByTestId("save-status")).toHaveAttribute(
    "data-state",
    "saved",
    { timeout: 10_000 },
  );
}

test.describe("/predictions — edición y autosave", () => {
  const stack = createCleanupStack();
  let fixture: LeagueWithUsers;
  let page: Page;

  // Partidos dedicados por caso para que los tests no se pisen entre sí.
  let mBasic: SeededMatchRow; // PRED-01/02
  let mReload: SeededMatchRow; // PRED-03
  let mDebounce: SeededMatchRow; // PRED-04
  let mUndo: SeededMatchRow; // PRED-05
  let mRecalc: SeededMatchRow; // PRED-06/08
  let mJ1: SeededMatchRow; // PRED-07/12
  let mDrift: SeededMatchRow; // PRED-09
  let mOffline: SeededMatchRow; // PRED-10
  let mJ3: SeededMatchRow; // PRED-13
  let mTbd: SeededMatchRow; // PRED-13

  test.beforeAll(async ({ browser }) => {
    // El login aterriza en /predictions: ese primer load ya dispara
    // fn_ensure_default_predictions sobre TODOS los editables (incluidos los
    // de abajo NO, porque se siembran después). Sembramos ANTES de loguear
    // para que los defaults también cubran nuestros partidos (PRED-11/12).
    const matches = await seedMatches([
      editableMatch({ matchday: 2, groupLabel: "A" }), // mBasic
      editableMatch({ matchday: 2, groupLabel: "B" }), // mReload
      editableMatch({ matchday: 2, groupLabel: "C" }), // mDebounce
      editableMatch({ matchday: 2, groupLabel: "D" }), // mUndo
      editableMatch({ matchday: 2, groupLabel: "E" }), // mRecalc
      editableMatch({ matchday: 1, groupLabel: "F" }), // mJ1
      editableMatch({ matchday: 2, groupLabel: "G" }), // mDrift
      editableMatch({ matchday: 2, groupLabel: "H" }), // mOffline
      editableMatch({ matchday: 3, groupLabel: "I" }), // mJ3
      tbdKnockoutMatch(), // mTbd
    ]);
    [mBasic, mReload, mDebounce, mUndo, mRecalc, mJ1, mDrift, mOffline, mJ3, mTbd] =
      matches as [
        SeededMatchRow, SeededMatchRow, SeededMatchRow, SeededMatchRow,
        SeededMatchRow, SeededMatchRow, SeededMatchRow, SeededMatchRow,
        SeededMatchRow, SeededMatchRow,
      ];
    stack.add(() => deleteMatches(matches.map((m) => m.id)));

    fixture = await createLeagueWithUsers(browser, { members: 1 });
    stack.add(() => fixture.cleanup());
    page = fixture.users[0]!.page!;
  });

  test.afterAll(async () => {
    await stack.run();
  });

  test("PRED-11: al entrar, todos los editables tienen predicción default 0-0 persistida (idempotente)", async () => {
    const userId = fixture.users[0]!.userId;
    const admin = createAdminClient();

    // El login del beforeAll ya visitó /predictions → defaults creados.
    await page.goto("/predictions");
    await selectPhaseTab(page, "Jornada 2");
    const card = cardFor(page, mBasic.id);
    await expect(picker(card, "home").getByTestId("goal-value")).toHaveText("0");
    await expect(picker(card, "away").getByTestId("goal-value")).toHaveText("0");

    // BD: hay fila default 0-0 para nuestros editables.
    for (const match of [mBasic, mJ1, mJ3]) {
      const row = await getPrediction(fixture.league.id, userId, match.id);
      expect(row, `default ausente para ${match.home_team}`).not.toBeNull();
      expect(row!.home_score_pred).toBe(0);
      expect(row!.away_score_pred).toBe(0);
    }
    // El TBD NO es editable → sin default.
    expect(await getPrediction(fixture.league.id, userId, mTbd.id)).toBeNull();

    // Idempotencia: recargar no crea ni duplica filas.
    const countRows = async () => {
      const { count } = await admin
        .from("predictions")
        .select("id", { count: "exact", head: true })
        .eq("league_id", fixture.league.id)
        .eq("user_id", userId);
      return count ?? 0;
    };
    const before = await countRows();
    await page.reload();
    await selectPhaseTab(page, "Jornada 2");
    expect(await countRows()).toBe(before);
  });

  test("PRED-12: los defaults respetan J1=1.00 y el resto multiplicador dinámico", async () => {
    const userId = fixture.users[0]!.userId;

    const j1Row = await getPrediction(fixture.league.id, userId, mJ1.id);
    expect(j1Row!.multiplier).toBe(1.0);

    const j2Row = await getPrediction(fixture.league.id, userId, mBasic.id);
    const j2Expected = await expectedMultiplierForMatch(mBasic.id);
    expect(j2Row!.multiplier).toBe(j2Expected);
  });

  test("PRED-01: incrementar local y visitante guarda 1-1 con confirmación visual", async () => {
    await page.goto("/predictions");
    await selectPhaseTab(page, "Jornada 2");
    const card = cardFor(page, mBasic.id);

    await picker(card, "home").getByTestId("goal-increment").click();
    await picker(card, "away").getByTestId("goal-increment").click();

    await expect(picker(card, "home").getByTestId("goal-value")).toHaveText("1");
    await expect(picker(card, "away").getByTestId("goal-value")).toHaveText("1");
    await expectSaved(card);

    const row = await getPrediction(
      fixture.league.id,
      fixture.users[0]!.userId,
      mBasic.id,
    );
    expect(row!.home_score_pred).toBe(1);
    expect(row!.away_score_pred).toBe(1);
  });

  test("PRED-02: el decrement en 0 está deshabilitado y no baja de 0", async () => {
    await page.goto("/predictions");
    await selectPhaseTab(page, "Jornada 2");
    const card = cardFor(page, mReload.id);

    const decrement = picker(card, "home").getByTestId("goal-decrement");
    await expect(picker(card, "home").getByTestId("goal-value")).toHaveText("0");
    // GoalPicker: canDecrement = value > min → botón disabled en 0.
    await expect(decrement).toBeDisabled();
  });

  test("PRED-03: la edición 2-1 persiste tras recargar (UI y BD)", async () => {
    await page.goto("/predictions");
    await selectPhaseTab(page, "Jornada 2");
    const card = cardFor(page, mReload.id);

    await picker(card, "home").getByTestId("goal-increment").click();
    await picker(card, "home").getByTestId("goal-increment").click();
    await picker(card, "away").getByTestId("goal-increment").click();
    await expectSaved(card);

    await page.reload();
    await selectPhaseTab(page, "Jornada 2");
    const cardAfter = cardFor(page, mReload.id);
    await expect(
      picker(cardAfter, "home").getByTestId("goal-value"),
    ).toHaveText("2");
    await expect(
      picker(cardAfter, "away").getByTestId("goal-value"),
    ).toHaveText("1");

    const row = await getPrediction(
      fixture.league.id,
      fixture.users[0]!.userId,
      mReload.id,
    );
    expect(row!.home_score_pred).toBe(2);
    expect(row!.away_score_pred).toBe(1);
  });

  test("PRED-04: el debounce colapsa 5 clicks rápidos en un único guardado final", async () => {
    await page.goto("/predictions");
    await selectPhaseTab(page, "Jornada 2");
    const card = cardFor(page, mDebounce.id);

    const increment = picker(card, "home").getByTestId("goal-increment");
    for (let i = 0; i < 5; i++) {
      await increment.click();
    }

    await expect(picker(card, "home").getByTestId("goal-value")).toHaveText("5");
    await expectSaved(card);

    const row = await getPrediction(
      fixture.league.id,
      fixture.users[0]!.userId,
      mDebounce.id,
    );
    expect(row!.home_score_pred).toBe(5);
    expect(row!.away_score_pred).toBe(0);
  });

  test("PRED-05: deshacer restaura el último estado persistido previo (UI y BD)", async () => {
    await page.goto("/predictions");
    await selectPhaseTab(page, "Jornada 2");
    const card = cardFor(page, mUndo.id);

    // Estado previo persistido: el default 0-0. Editamos a 3-1 y guardamos.
    for (let i = 0; i < 3; i++) {
      await picker(card, "home").getByTestId("goal-increment").click();
    }
    await picker(card, "away").getByTestId("goal-increment").click();
    await expectSaved(card);

    // Semántica real de revertPrediction: el servidor restaura el marcador y
    // el multiplicador del ÚLTIMO guardado anterior al cambio (stash de
    // fn_save_prediction), dentro de la ventana de gracia de 2 min.
    await card.getByTestId("undo-button").click();
    await expect(picker(card, "home").getByTestId("goal-value")).toHaveText("0");
    await expect(picker(card, "away").getByTestId("goal-value")).toHaveText("0");

    const row = await getPrediction(
      fixture.league.id,
      fixture.users[0]!.userId,
      mUndo.id,
    );
    expect(row!.home_score_pred).toBe(0);
    expect(row!.away_score_pred).toBe(0);
  });

  test("PRED-06: el multiplicador mostrado coincide con el cálculo dinámico", async () => {
    await page.goto("/predictions");
    await selectPhaseTab(page, "Jornada 2");
    const card = cardFor(page, mRecalc.id);

    // Nunca hardcodear: la expectativa sale del estado real de la BD
    // (currentRoundOrdinal avanza con el tiempo real del Mundial).
    const expected = await expectedMultiplierForMatch(mRecalc.id);
    await expect(card.getByTestId("multiplier-badge")).toHaveText(
      `${expected.toFixed(1)}x`,
    );
  });

  test("PRED-07: la Jornada 1 siempre vale 1.0x (UI y BD tras editar)", async () => {
    await page.goto("/predictions");
    await selectPhaseTab(page, "Jornada 1");
    const card = cardFor(page, mJ1.id);

    await expect(card.getByTestId("multiplier-badge")).toHaveText("1.0x");

    await picker(card, "home").getByTestId("goal-increment").click();
    await expectSaved(card);

    const row = await getPrediction(
      fixture.league.id,
      fixture.users[0]!.userId,
      mJ1.id,
    );
    expect(row!.multiplier).toBe(1.0);
  });

  test("PRED-08: editar recalcula el multiplicador en BD con el valor dinámico", async () => {
    await page.goto("/predictions");
    await selectPhaseTab(page, "Jornada 2");
    const card = cardFor(page, mRecalc.id);

    await picker(card, "away").getByTestId("goal-increment").click();
    await expectSaved(card);

    const expected = await expectedMultiplierForMatch(mRecalc.id);
    const row = await getPrediction(
      fixture.league.id,
      fixture.users[0]!.userId,
      mRecalc.id,
    );
    expect(row!.multiplier).toBe(expected);
  });

  test("PRED-09: la advertencia de degradación bloquea la edición hasta confirmar", async () => {
    // Predicción sembrada con multiplicador 2.5 (vía service role): el valor
    // dinámico actual de un J2 siempre es menor → drift + advertencia.
    await seedPrediction({
      leagueId: fixture.league.id,
      userId: fixture.users[0]!.userId,
      matchId: mDrift.id,
      home: 1,
      away: 0,
      multiplier: 2.5,
    });

    await page.goto("/predictions");
    await selectPhaseTab(page, "Jornada 2");
    const card = cardFor(page, mDrift.id);

    // El chip de drift ya es visible antes de editar (cubierto en la suite
    // existente; aquí solo confirmamos la precondición).
    await expect(card.getByTestId("multiplier-drift-chip")).toBeVisible();

    const nextMultiplier = await expectedMultiplierForMatch(mDrift.id);

    // 1) Editar abre la advertencia ANTES de aplicar el cambio.
    await picker(card, "home").getByTestId("goal-increment").click();
    const dialog = card.getByRole("alertdialog", {
      name: "Advertencia de multiplicador",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      `Tu multiplicador bajara de 2.5x a ${nextMultiplier.toFixed(1)}x.`,
    );

    // 2) Cancelar: no cambia el marcador ni guarda.
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(picker(card, "home").getByTestId("goal-value")).toHaveText("1");

    // 3) Continuar: aplica la edición y el servidor recalcula el multiplicador.
    await picker(card, "home").getByTestId("goal-increment").click();
    await dialog.getByRole("button", { name: "Continuar" }).click();
    await expect(picker(card, "home").getByTestId("goal-value")).toHaveText("2");
    await expectSaved(card);

    const row = await getPrediction(
      fixture.league.id,
      fixture.users[0]!.userId,
      mDrift.id,
    );
    expect(row!.home_score_pred).toBe(2);
    expect(row!.multiplier).toBe(nextMultiplier);
  });

  test("PRED-10: sin conexión muestra el estado offline y reintenta al volver", async () => {
    const context = fixture.users[0]!.context!;

    await page.goto("/predictions");
    await selectPhaseTab(page, "Jornada 2");
    const card = cardFor(page, mOffline.id);

    try {
      await context.setOffline(true);
      await picker(card, "home").getByTestId("goal-increment").click();

      // MatchCard detecta navigator.onLine y muestra el estado offline con
      // borde destructivo (copy real: "Sin conexion - Pendiente").
      const status = card.getByTestId("save-status");
      await expect(status).toHaveAttribute("data-state", "offline", {
        timeout: 10_000,
      });
      await expect(status).toHaveText("Sin conexion - Pendiente");

      // Mecanismo real de recuperación: listener del evento window 'online'
      // reintenta el guardado pendiente automáticamente.
      await context.setOffline(false);
      await expectSaved(card);
    } finally {
      await context.setOffline(false);
    }

    const row = await getPrediction(
      fixture.league.id,
      fixture.users[0]!.userId,
      mOffline.id,
    );
    expect(row!.home_score_pred).toBe(1);
  });

  test("PRED-13: las pestañas de jornadas y eliminatorias filtran sus partidos", async () => {
    await page.goto("/predictions");

    // J1, J2, J3 y Semis (tbdKnockoutMatch → stage "semi" → tab "Semis").
    await selectPhaseTab(page, "Jornada 1");
    await expect(cardFor(page, mJ1.id)).toHaveCount(1);
    await expect(cardFor(page, mJ3.id)).toHaveCount(0);

    await selectPhaseTab(page, "Jornada 2");
    await expect(cardFor(page, mBasic.id)).toHaveCount(1);
    await expect(cardFor(page, mJ1.id)).toHaveCount(0);

    await selectPhaseTab(page, "Jornada 3");
    await expect(cardFor(page, mJ3.id)).toHaveCount(1);
    await expect(cardFor(page, mBasic.id)).toHaveCount(0);

    await selectPhaseTab(page, "Semis");
    await expect(cardFor(page, mTbd.id)).toHaveCount(1);
    await expect(cardFor(page, mJ3.id)).toHaveCount(0);
  });
});

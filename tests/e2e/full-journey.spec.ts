import { test, expect, type Locator, type Page } from "@playwright/test";

import { buildStandings } from "../../src/utils/standings";
import { createAdminClient } from "./helpers/admin";
import { createCleanupStack } from "./helpers/cleanup";
import {
  assertLedgerInvariant,
  getChallenge,
  getMatch,
  getWagerBalance,
} from "./helpers/db-assert";
import { deleteMatches, seedMatches, type SeededMatchRow } from "./helpers/seed/matches";
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
  getCandidate,
  type WinnersSnapshot,
} from "./helpers/seed/awards";
import {
  createUser,
  deleteE2EUser,
  loginAs,
  newRunId,
  type E2EUser,
} from "./helpers/users";
import { expectedMultiplierForMatch } from "./helpers/multiplier";
import { sendZafronixEvent } from "./helpers/webhook";

// Fase 9 — El GRAN TOUR. UN solo test @slow, serial, que recorre la vida de una
// liga con tres usuarios reales (Ana admin/creadora, Beto, Carla) y verifica al
// final TODOS los números (standings vía buildStandings importado, ledger,
// duelo resuelto). Cada paso usa test.step() para que el reporte señale dónde
// falla (riesgo: es el test más valioso y el más frágil — invertir en estabilidad).
//
// Decisiones de diseño (ver "Notas de ejecución" de 09-fase-9-journey-edge.md):
//  - Los usuarios se crean por admin API + login por formulario real (estrategia
//    estándar de la suite); el sign-up por formulario ya se cubre en Fase 2.
//  - El contrato Zafronix NO tiene evento "go live": la transición a live se
//    hace por service role (igual que Fase 8 / webhooks.spec); el circuito
//    FIRMADO se ejercita en el gol (match.patched) y el finalized (match.finalized).
//  - partido 1 es de Jornada 1 → multiplicador SIEMPRE 1.0x: los puntos quedan
//    deterministas sin depender de la "jornada en curso" (trampa §7.2).

// ── Helpers de interacción (copiados de los patrones de Fases 4/6/7) ──

function cardFor(page: Page, matchId: string): Locator {
  return page.getByRole("main").locator(`article[data-match-id="${matchId}"]`);
}

function picker(card: Locator, side: "home" | "away"): Locator {
  return card.locator(`[data-testid="goal-picker"][data-side="${side}"]`);
}

async function expectSaved(card: Locator): Promise<void> {
  await expect(card.getByTestId("save-status")).toHaveAttribute("data-state", "saved", {
    timeout: 10_000,
  });
}

// Pone el marcador de una card a (home, away) desde el default 0-0 y confirma el
// autosave. La J1 no degrada el multiplicador → sin alertdialog de advertencia.
async function setPrediction(
  page: Page,
  matchId: string,
  jornadaTab: string,
  home: number,
  away: number,
): Promise<void> {
  await page.goto("/predictions");
  // Los miembros pendientes de una liga CON pago ven el welcome-payment-modal
  // (overlay fixed que tapa el tablero). Se cierra para poder usar la app
  // (LIG-13). Si el usuario ya está al día, el botón no aparece → se ignora.
  await page
    .getByTestId("welcome-payment-close")
    .click({ timeout: 2500 })
    .catch(() => {});
  // Selección de pestaña robusta ante el flake del takeover de next dev.
  const tab = page.getByRole("tab", { name: jornadaTab, exact: true });
  await expect(tab).toHaveCount(1);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");

  const card = cardFor(page, matchId);
  await expect(card).toHaveCount(1);
  // dispatchEvent('click': el takeover de next dev deja una card huérfana FUERA
  // de <main> que solapa los steppers e intercepta el click físico; el dispatch
  // dispara el onClick del GoalPicker (que igual actualiza estado y autosave)
  // sin depender del hit-test. cardFor está anclada a <main> → la card real.
  for (let i = 0; i < home; i++) {
    await picker(card, "home").getByTestId("goal-increment").dispatchEvent("click");
  }
  for (let i = 0; i < away; i++) {
    await picker(card, "away").getByTestId("goal-increment").dispatchEvent("click");
  }
  await expect(picker(card, "home").getByTestId("goal-value")).toHaveText(String(home));
  await expect(picker(card, "away").getByTestId("goal-value")).toHaveText(String(away));
  await expectSaved(card);
}

// Selección de candidato en /awards (patrón de awards.spec.ts).
async function selectChampion(page: Page, searchQuery: string, candidateName: string): Promise<void> {
  await page.goto("/awards");
  const board = page.getByRole("main").getByTestId("awards-board");
  await expect(board).toBeVisible();
  const card = board.locator('[data-category="champion"]');
  const input = card.getByRole("combobox");
  await input.fill(searchQuery);
  const option = card.getByTestId("candidate-option").filter({ hasText: candidateName });
  await expect(option).toBeVisible({ timeout: 5_000 });
  await option.click();
  await expect(card.getByTestId("selected-candidate")).toContainText(candidateName);
  await expect(input).toBeEnabled({ timeout: 5_000 });
  await page.waitForTimeout(500); // respiro de persistencia (igual que awards.spec)
}

test.describe("Gran tour multi-usuario (e2e)", () => {
  const admin = createAdminClient();
  const stack = createCleanupStack();
  const runId = newRunId();

  let ana: E2EUser;
  let beto: E2EUser;
  let carla: E2EUser;
  let pageAna: Page;
  let pageBeto: Page;
  let pageCarla: Page;

  let phasesSnap: PhasesSnapshot;
  let winnersSnap: WinnersSnapshot;
  let leagueId = "";
  let inviteCode = "";
  let partido1: SeededMatchRow; // J1, finalizable + duelo
  let partidoJ2: SeededMatchRow; // J2, editable (Beto pronostica)
  const externalRef = `test-journey-${runId}`;

  test.beforeAll(async ({ browser }) => {
    // Fases A activa (premios desbloqueados) — estado GLOBAL: snapshot + restore.
    phasesSnap = await snapshotPhases();
    await setActivePhase("A");
    stack.add(() => restorePhases(phasesSnap));

    // Ganadores de premios especiales (estado GLOBAL): snapshot + restore.
    winnersSnap = await snapshotWinners();
    stack.add(() => restoreWinners(winnersSnap));

    // Tres usuarios reales (admin API + login por formulario).
    ana = await createUser({ runId, tag: "ana", displayName: `E2E Ana ${runId}` });
    stack.add(() => deleteE2EUser(ana.userId));
    beto = await createUser({ runId, tag: "beto", displayName: `E2E Beto ${runId}` });
    stack.add(() => deleteE2EUser(beto.userId));
    carla = await createUser({ runId, tag: "carla", displayName: `E2E Carla ${runId}` });
    stack.add(() => deleteE2EUser(carla.userId));

    const sAna = await loginAs(browser, ana);
    pageAna = sAna.page;
    stack.add(() => sAna.context.close());
    const sBeto = await loginAs(browser, beto);
    pageBeto = sBeto.page;
    stack.add(() => sBeto.context.close());
    const sCarla = await loginAs(browser, carla);
    pageCarla = sCarla.page;
    stack.add(() => sCarla.context.close());

    // Partidos test_: partido1 (J1, futuro → editable) con external_ref + códigos;
    // partidoJ2 (J2, futuro → editable). Ambos con kickoff futuro para que la
    // "jornada en curso" del seed real no se altere (trampa §7.2).
    const matches = await seedMatches([
      {
        home: `journey_h_${runId}`,
        away: `journey_a_${runId}`,
        homeTeamCode: "AAA",
        awayTeamCode: "BBB",
        kickoffOffsetMs: 2 * 24 * 60 * 60 * 1000,
        status: "scheduled",
        matchday: 1,
        stage: "group",
        groupLabel: "A",
        externalRef,
      },
      {
        home: `journey_j2h_${runId}`,
        away: `journey_j2a_${runId}`,
        kickoffOffsetMs: 2 * 24 * 60 * 60 * 1000,
        status: "scheduled",
        matchday: 2,
        stage: "group",
        groupLabel: "B",
      },
    ]);
    partido1 = matches[0]!;
    partidoJ2 = matches[1]!;
    stack.add(() => deleteMatches(matches.map((m) => m.id)));
  });

  test.afterAll(async () => {
    // Limpieza explícita de la liga creada por UI (no es SeededLeague) antes de
    // soltar la pila (usuarios/contextos/partidos/fases).
    if (leagueId) {
      await admin.from("point_transactions").delete().eq("league_id", leagueId);
      await admin.from("challenges").delete().eq("league_id", leagueId);
      await admin.from("special_predictions").delete().eq("league_id", leagueId);
      await admin.from("predictions").delete().eq("league_id", leagueId);
      await admin.from("league_members").delete().eq("league_id", leagueId);
      await admin.from("profiles").update({ active_league_id: null }).eq("active_league_id", leagueId);
      await admin.from("leagues").delete().eq("id", leagueId);
    }
    await stack.run();
  });

  test("JOURNEY: vida completa de una liga con tres usuarios @slow", async ({ request }) => {
    test.setTimeout(240_000);
    const SEED_BALANCE = 50;

    await test.step("1. Ana crea una liga CON pago (form real) y queda admin", async () => {
      const name = `E2E Journey League ${runId}`;
      await pageAna.goto("/leagues/new");
      await pageAna.getByTestId("league-name-input").fill(name);
      await pageAna.getByTestId("requires-payment-switch").click();
      await pageAna.getByTestId("payment-amount-input").fill("10");
      await pageAna
        .getByTestId("payment-instructions-input")
        .fill("Zelle al 555-0100, concepto: quiniela journey");
      await pageAna.getByTestId("create-league-submit").click();
      await pageAna.waitForURL(/\/predictions/, { timeout: 15_000 });

      const { data: league } = await admin
        .from("leagues")
        .select("id, invite_code, requires_payment")
        .eq("created_by", ana.userId)
        .eq("name", name)
        .single();
      expect(league).not.toBeNull();
      expect(league!.requires_payment).toBe(true);
      leagueId = league!.id as string;
      inviteCode = league!.invite_code as string;

      const { data: member } = await admin
        .from("league_members")
        .select("role")
        .eq("league_id", leagueId)
        .eq("user_id", ana.userId)
        .single();
      expect(member!.role).toBe("admin");

      // Sembrar saldo de duelos para los 3 (con la transacción seed_initial_balance
      // para no romper la invariante del ledger). Ana ya es miembro; Beto/Carla
      // se sembrarán tras unirse (paso 3/4).
      await admin
        .from("league_members")
        .update({ wager_balance: SEED_BALANCE })
        .eq("league_id", leagueId)
        .eq("user_id", ana.userId);
      await admin.from("point_transactions").insert({
        user_id: ana.userId,
        league_id: leagueId,
        amount: SEED_BALANCE,
        description: "seed_initial_balance",
      });
    });

    await test.step("2. El código de invitación es visible para Ana", async () => {
      await pageAna.goto("/account");
      const item = pageAna
        .getByRole("main")
        .getByTestId("account-league-item")
        .filter({ hasText: `E2E Journey League ${runId}` })
        .filter({ visible: true });
      await expect(item).toHaveCount(1);
      await expect(item).toContainText(inviteCode);
    });

    await test.step("3. Beto entra por /join/<code> y queda member/pending", async () => {
      await pageBeto.goto(`/join/${inviteCode}`);
      await pageBeto.waitForURL(/\/predictions\?joined=1/, { timeout: 15_000 });
      const { data: member } = await admin
        .from("league_members")
        .select("role, payment_status")
        .eq("league_id", leagueId)
        .eq("user_id", beto.userId)
        .single();
      expect(member!.role).toBe("member");
      expect(member!.payment_status).toBe("pending");

      // Modal de pago de bienvenida para el miembro pendiente.
      await expect(
        pageBeto.getByRole("main").getByTestId("welcome-payment-modal"),
      ).toBeVisible();

      await admin
        .from("league_members")
        .update({ wager_balance: SEED_BALANCE })
        .eq("league_id", leagueId)
        .eq("user_id", beto.userId);
      await admin.from("point_transactions").insert({
        user_id: beto.userId,
        league_id: leagueId,
        amount: SEED_BALANCE,
        description: "seed_initial_balance",
      });
    });

    await test.step("4. Carla entra igual → la liga tiene 3 miembros", async () => {
      await pageCarla.goto(`/join/${inviteCode}`);
      await pageCarla.waitForURL(/\/predictions\?joined=1/, { timeout: 15_000 });
      const { count } = await admin
        .from("league_members")
        .select("user_id", { count: "exact", head: true })
        .eq("league_id", leagueId);
      expect(count).toBe(3);

      await admin
        .from("league_members")
        .update({ wager_balance: SEED_BALANCE })
        .eq("league_id", leagueId)
        .eq("user_id", carla.userId);
      await admin.from("point_transactions").insert({
        user_id: carla.userId,
        league_id: leagueId,
        amount: SEED_BALANCE,
        description: "seed_initial_balance",
      });
    });

    await test.step("5. Ana marca a Beto como pagado en /standings/manage", async () => {
      await pageAna.goto("/standings/manage");
      const row = pageAna.locator(
        `[data-testid="member-admin-row"][data-user-id="${beto.userId}"]`,
      );
      const toggle = row.getByTestId("payment-toggle");
      await expect(toggle).toHaveText("Pendiente");
      await toggle.click();
      await expect(toggle).toHaveText("Pagado");

      // El toggle refleja la UI antes de que el server action confirme: esperar
      // a que la BD persista (evita carrera con la transición).
      await expect
        .poll(
          async () => {
            const { data } = await admin
              .from("league_members")
              .select("payment_status")
              .eq("league_id", leagueId)
              .eq("user_id", beto.userId)
              .single();
            return data?.payment_status;
          },
          { timeout: 10_000 },
        )
        .toBe("paid");
    });

    await test.step("6. Los tres pronostican partido 1 (J1): exacto/resultado/fallo", async () => {
      // Resultado que vendrá: 2-0. Ana 2-0 (exacto), Beto 1-0 (resultado), Carla 0-2 (fallo).
      await setPrediction(pageAna, partido1.id, "Jornada 1", 2, 0);
      await setPrediction(pageBeto, partido1.id, "Jornada 1", 1, 0);
      await setPrediction(pageCarla, partido1.id, "Jornada 1", 0, 2);
    });

    await test.step("7. Beto pronostica el partido de J2 (multiplicador dinámico)", async () => {
      await setPrediction(pageBeto, partidoJ2.id, "Jornada 2", 3, 1);
      const expected = await expectedMultiplierForMatch(partidoJ2.id);
      const { data: pred } = await admin
        .from("predictions")
        .select("multiplier")
        .eq("league_id", leagueId)
        .eq("user_id", beto.userId)
        .eq("match_id", partidoJ2.id)
        .single();
      expect(Number(pred!.multiplier)).toBe(expected);
    });

    let challengeId = "";
    await test.step("8. Ana reta a Beto (duelo directo, apuesta 10) — escrow deducido", async () => {
      await pageAna.goto("/duels");
      await pageAna.getByRole("main").getByTestId("create-duel-button").click();
      await pageAna.getByRole("main").getByTestId("duel-match-select").selectOption(partido1.id);
      await pageAna.getByRole("main").getByTestId("duel-type-direct").click();
      await pageAna.getByRole("main").getByTestId("duel-rival-select").selectOption(beto.userId);
      await pageAna.getByRole("main").getByTestId("duel-bet-input").fill("10");
      // Predicción del duelo de Ana: 2-0 (exacto → base 5).
      const homePred = pageAna.getByRole("main").getByTestId("duel-home-pred");
      await homePred.getByTestId("goal-increment").click();
      await homePred.getByTestId("goal-increment").click();
      await pageAna.getByRole("main").getByTestId("create-duel-submit").click();
      await expect(pageAna.getByRole("main").getByTestId("create-duel-success")).toBeVisible();

      const { data: challenge } = await admin
        .from("challenges")
        .select("id, status, points_bet")
        .eq("league_id", leagueId)
        .eq("creator_id", ana.userId)
        .single();
      expect(challenge).not.toBeNull();
      challengeId = challenge!.id as string;
      expect(Number(challenge!.points_bet)).toBe(10);

      // Escrow deducido al crear: Ana 50 - 10 = 40.
      expect(await getWagerBalance(leagueId, ana.userId)).toBe(SEED_BALANCE - 10);
    });

    await test.step("9. Beto acepta el duelo con su predicción → active", async () => {
      await pageBeto.goto("/duels");
      const card = pageBeto
        .getByRole("main")
        .locator(`[data-testid="duel-card"][data-challenge-id="${challengeId}"]`);
      await expect(card).toBeVisible();
      await card.getByTestId("accept-duel-button").click();

      // Predicción del duelo de Beto: 0-0 (default → fallo, base 0).
      const dialog = pageBeto.locator("form");
      await dialog.getByTestId("accept-duel-submit").click();

      await expect(card.getByText("En Juego")).toBeVisible();
      const chal = await getChallenge(challengeId);
      expect(chal!.status).toBe("active");
      expect(chal!.participants.length).toBe(2);
      // Escrow del aceptante: Beto 50 - 10 = 40.
      expect(await getWagerBalance(leagueId, beto.userId)).toBe(SEED_BALANCE - 10);
    });

    await test.step("10. Cada uno elige campeón en /awards (3 selecciones per-league)", async () => {
      await selectChampion(pageAna, "Arg", "Argentina");
      await selectChampion(pageBeto, "Bra", "Brazil");
      await selectChampion(pageCarla, "Arg", "Argentina");

      const { count } = await admin
        .from("special_predictions")
        .select("user_id", { count: "exact", head: true })
        .eq("league_id", leagueId)
        .eq("category", "champion");
      expect(count).toBe(3);
    });

    await test.step("11. partido 1 pasa a live → /predictions muestra En vivo", async () => {
      // Sin evento Zafronix "go live": transición por service role (Fase 8).
      const { error } = await admin
        .from("matches")
        .update({ status: "live", home_score: 0, away_score: 0 })
        .eq("id", partido1.id);
      expect(error).toBeNull();

      await pageAna.goto("/predictions");
      await expect(cardFor(pageAna, partido1.id).getByText("En vivo")).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("12. Carla en /live: webhook gol (firmado) → toast + reorden @realtime", async () => {
      await pageCarla.goto("/standings");
      const liveLink = pageCarla.getByLabel("Ver tabla en vivo").first();
      await expect(liveLink).toBeVisible({ timeout: 10_000 });
      await liveLink.click();
      await pageCarla.waitForURL(/\/live/);
      await expect(pageCarla.getByText("En vivo").first()).toBeVisible({ timeout: 15_000 });
      // Asentar el websocket antes del primer UPDATE (handshake en frío).
      await pageCarla.waitForTimeout(3000);

      // Gol firmado: match.patched 0-0 → 1-0 (conserva status live).
      const result = await sendZafronixEvent(request, {
        type: "match.patched",
        matchExternalRef: externalRef,
        payload: {
          homeTeam: partido1.home_team,
          awayTeam: partido1.away_team,
          changes: { homeScore: { from: 0, to: 1 } },
        },
      });
      expect(result.status).toBe(200);

      // Beto (predijo 1-0) sube al 1er puesto proyectado → toast de gol.
      const toast = pageCarla.getByTestId("goal-toast").first();
      await expect(toast).toBeVisible({ timeout: 15_000 });
      await expect(toast).toContainText(`¡Gol de ${partido1.home_team}!`);
      await expect(toast).toContainText("puesto proyectado");

      // Reorden: la primera fila live es Beto.
      const rows = pageCarla.getByTestId("live-row");
      await expect(rows.nth(0)).toContainText(beto.displayName!, { timeout: 10_000 });
    });

    await test.step("13. Webhook finalized (firmado) del partido 1 → 2-0 finished", async () => {
      const result = await sendZafronixEvent(request, {
        type: "match.finalized",
        matchExternalRef: externalRef,
        payload: {
          homeTeam: partido1.home_team,
          awayTeam: partido1.away_team,
          homeScore: 2,
          awayScore: 0,
          result: "2-0",
        },
      });
      expect(result.status).toBe(200);

      const m = await getMatch(partido1.id);
      expect(m!.status).toBe("finished");
      expect(m!.home_score).toBe(2);
      expect(m!.away_score).toBe(0);
    });

    await test.step("13b. Resolver ganador de premios especiales → Argentina gana campeón", async () => {
      const argCandidate = await getCandidate("champion", { name: "Argentina" });
      await setWinner("champion", argCandidate.id);

      // Verificar que en base de datos se hayan procesado correctamente los puntos
      const { data: points } = await admin
        .from("special_predictions_with_points")
        .select("user_id, points")
        .eq("league_id", leagueId)
        .eq("category", "champion");

      const anaPts = points!.find((p) => p.user_id === ana.userId)?.points;
      const betoPts = points!.find((p) => p.user_id === beto.userId)?.points;
      const carlaPts = points!.find((p) => p.user_id === carla.userId)?.points;

      expect(anaPts).toBe(50);
      expect(betoPts).toBe(0);
      expect(carlaPts).toBe(50);
    });

    await test.step("14. /standings: orden y puntos = buildStandings(datos sembrados)", async () => {
      // Expectativa SIN números mágicos: se reconstruye con la MISMA lógica de
      // producción (buildStandings) a partir de los datos reales en BD.
      const { data: memberRows } = await admin
        .from("league_members")
        .select("user_id, joined_at, payment_status, wager_balance")
        .eq("league_id", leagueId);
      const { data: predRows } = await admin
        .from("predictions")
        .select("user_id, match_id, home_score_pred, away_score_pred, multiplier")
        .eq("league_id", leagueId)
        .eq("match_id", partido1.id);
      const m = await getMatch(partido1.id);

      const { data: awardRows } = await admin
        .from("special_predictions_with_points")
        .select("user_id, points")
        .eq("league_id", leagueId);

      const awardPointsByUser = new Map<string, number>();
      for (const row of (awardRows ?? [])) {
        const current = awardPointsByUser.get(row.user_id) ?? 0;
        awardPointsByUser.set(row.user_id, current + Number(row.points ?? 0));
      }

      const displayNameById: Record<string, string> = {
        [ana.userId]: ana.displayName!,
        [beto.userId]: beto.displayName!,
        [carla.userId]: carla.displayName!,
      };

      const expectedRows = buildStandings(
        (memberRows ?? []).map((r) => ({
          userId: r.user_id,
          displayName: displayNameById[r.user_id] ?? r.user_id,
          avatarUrl: "",
          paymentStatus: r.payment_status,
          joinedAt: r.joined_at,
          duelPoints: Number(r.wager_balance),
          awardPoints: awardPointsByUser.get(r.user_id) ?? 0,
        })),
        [
          {
            id: partido1.id,
            status: m!.status,
            matchday: 1,
            stage: "group",
            homeScore: m!.home_score,
            awayScore: m!.away_score,
          },
        ],
        (predRows ?? []).map((p) => ({
          userId: p.user_id,
          matchId: p.match_id,
          homeScorePred: p.home_score_pred,
          awayScorePred: p.away_score_pred,
          multiplier: Number(p.multiplier),
        })),
      );

      // Cordura: el orden esperado ahora incluye premios especiales.
      // Puntos predicciones: Ana (5.0), Beto (2.0), Carla (0.0)
      // Puntos premios: Ana (50.0), Beto (0.0), Carla (50.0)
      // Totales: Ana (55.0), Carla (50.0), Beto (2.0)
      // Por tanto, el orden de la clasificación oficial es: Ana > Carla > Beto
      expect(expectedRows.map((r) => r.displayName)).toEqual([
        ana.displayName,
        carla.displayName,
        beto.displayName,
      ]);

      await pageAna.goto("/standings");
      const uiRows = pageAna.getByRole("main").getByTestId("standings-row");
      await expect(uiRows).toHaveCount(expectedRows.length);
      for (let i = 0; i < expectedRows.length; i++) {
        const row = uiRows.nth(i);
        await expect(row).toContainText(expectedRows[i]!.displayName);
        await expect(row.getByTestId("standings-points")).toHaveText(
          expectedRows[i]!.totalPoints.toFixed(1),
        );

        // Validar si muestra el chip de premios
        const expectedAwardPts = expectedRows[i]!.awardPoints;
        if (expectedAwardPts > 0) {
          await expect(row.getByTestId("standings-awards")).toContainText(
            expectedAwardPts.toFixed(1),
          );
        } else {
          await expect(row.getByTestId("standings-awards")).toHaveCount(0);
        }
      }
    });

    await test.step("15. /duels: duelo resuelto y saldo del ganador (Ana) actualizado", async () => {
      const chal = await getChallenge(challengeId);
      expect(chal!.status).toBe("completed");
      expect(chal!.winner_ids).toEqual([ana.userId]);

      // Ana: 50 - 10 escrow + 20 pozo + 5.0 accrual (exacto J1) = 65.0
      // Beto: 50 - 10 escrow + 0 + 2.0 accrual (resultado J1) = 42.0
      // Carla: 50 + 0 = 50.0
      expect(await getWagerBalance(leagueId, ana.userId)).toBe(65.0);
      expect(await getWagerBalance(leagueId, beto.userId)).toBe(42.0);
      expect(await getWagerBalance(leagueId, carla.userId)).toBe(50.0);

      await pageAna.goto("/duels");
      await expect(pageAna.getByRole("main").getByTestId("duel-balance")).toHaveText("65.00");
      await pageAna.getByRole("main").getByRole("button", { name: /historial/i }).first().click();
      const card = pageAna
        .getByRole("main")
        .locator(`[data-testid="duel-card"][data-challenge-id="${challengeId}"]`);
      await expect(card).toContainText("Ganado");
    });

    await test.step("16. assertLedgerInvariant para los tres", async () => {
      await assertLedgerInvariant(leagueId);
    });

    await test.step("17. Predicciones ajenas del partido 1 ahora visibles (time-gating)", async () => {
      // No hay UI que liste predicciones ajenas; la invariante de lectura se
      // verifica vía cliente autenticado (patrón PRED-19 / STD-09): tras el
      // kickoff (partido finished), Ana puede leer la predicción de Beto.
      const { createAnonClient } = await import("./helpers/admin");
      const clientAna = createAnonClient();
      const { error: signInError } = await clientAna.auth.signInWithPassword({
        email: ana.email,
        password: ana.password,
      });
      expect(signInError).toBeNull();
      try {
        const { data, error } = await clientAna
          .from("predictions")
          .select("home_score_pred, away_score_pred")
          .eq("match_id", partido1.id)
          .eq("user_id", beto.userId);
        expect(error).toBeNull();
        expect(data).toHaveLength(1);
        expect(data![0]!.home_score_pred).toBe(1);
        expect(data![0]!.away_score_pred).toBe(0);
      } finally {
        await clientAna.auth.signOut();
      }
    });

    await test.step("18. Carla sale de la liga → roster con 2 y standings con 2", async () => {
      await pageCarla.goto("/account");
      const item = pageCarla
        .getByRole("main")
        .getByTestId("account-league-item")
        .filter({ hasText: `E2E Journey League ${runId}` })
        .filter({ visible: true });
      await item.getByTestId("leave-league-button").click();
      const dialog = pageCarla.getByTestId("leave-league-dialog");
      await expect(dialog).toBeVisible();
      // Doble verificación: marcar consentimiento habilita el botón destructivo.
      await dialog.getByRole("checkbox").check();
      await dialog.getByTestId("leave-league-confirm").click();
      await expect(dialog).toHaveCount(0, { timeout: 15_000 });

      const { count } = await admin
        .from("league_members")
        .select("user_id", { count: "exact", head: true })
        .eq("league_id", leagueId);
      expect(count).toBe(2);

      await pageAna.goto("/standings");
      await expect(pageAna.getByTestId("standings-row")).toHaveCount(2);
      await expect(
        pageAna.getByRole("main").getByText(carla.displayName!),
      ).toHaveCount(0);
    });

    await test.step("19. Ana NO puede salir (último admin): mensaje claro", async () => {
      await pageAna.goto("/account");
      const item = pageAna
        .getByRole("main")
        .getByTestId("account-league-item")
        .filter({ hasText: `E2E Journey League ${runId}` })
        .filter({ visible: true });
      await item.getByTestId("leave-league-button").click();
      const dialog = pageAna.getByTestId("leave-league-dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("checkbox").check();
      await dialog.getByTestId("leave-league-confirm").click();

      // El RPC fn_leave_league propaga el mensaje del único admin (42501).
      await expect(dialog.getByRole("alert")).toContainText(
        "Eres el único admin de la liga",
      );

      // Sigue siendo miembro admin.
      const { data: member } = await admin
        .from("league_members")
        .select("role")
        .eq("league_id", leagueId)
        .eq("user_id", ana.userId)
        .single();
      expect(member!.role).toBe("admin");
    });

    // El paso 20 (cleanup completo, sin restos test_/usuarios e2e) lo realiza el
    // afterAll de forma idempotente.
  });
});

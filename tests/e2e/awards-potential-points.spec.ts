import { test, expect } from "@playwright/test";
import { createAdminClient } from "./helpers/admin";
import { createCleanupStack } from "./helpers/cleanup";
import { createLeagueWithUsers, type LeagueWithUsers } from "./helpers/users";
import { getCandidate } from "./helpers/seed/awards";
import { seedMatches, liveMatch, deleteMatches } from "./helpers/seed/matches";
import { setActiveLeague } from "./helpers/seed/league";
import { snapshotPhases, restorePhases, type PhasesSnapshot } from "./helpers/seed/phases";

async function setFinalKickoff(inPast: boolean) {
  const admin = createAdminClient();
  const matchTime = inPast
    ? new Date(Date.now() - 3600 * 1000).toISOString()
    : new Date(Date.now() + 86400 * 1000).toISOString();
  await admin
    .from("matches")
    .update({ match_time: matchTime })
    .eq("stage", "final");
}

test.describe("Premios Especiales — Visualización de Puntos Potenciales", () => {
  const stack = createCleanupStack();
  let fixture: LeagueWithUsers;
  let phasesSnap: PhasesSnapshot;

  test.beforeAll(async ({ browser }) => {
    phasesSnap = await snapshotPhases();

    // 1) Crear liga con 1 usuario y establecer como liga activa
    fixture = await createLeagueWithUsers(browser, { members: 1 });
    stack.add(() => fixture.cleanup());
    await setActiveLeague(fixture.users[0]!.userId, fixture.league.id);

    // 2) Sembrar un partido en vivo para que las pantallas /live y /standings rendericen la tabla
    const seeded = await seedMatches([
      liveMatch({ home: 1, away: 0 }, { matchday: 1, homeTeamCode: "ARG", awayTeamCode: "BOL" }),
    ]);
    stack.add(() => deleteMatches(seeded.map((m) => m.id)));
  });

  test.afterAll(async () => {
    await stack.run();
    await restorePhases(phasesSnap);
    await setFinalKickoff(false);
  });

  test("Muestra los puntos potenciales (+50 pts, +25 pts, +10 pts) en /live y /standings cuando los premios están bloqueados", async () => {
    const admin = createAdminClient();
    const user0 = fixture.users[0]!;
    const page = user0.page!;

    // 1. Buscar candidatos válidos para cada categoría
    const championCand = await getCandidate("champion");
    const topScorerCand = await getCandidate("top_scorer");
    const mvpCand = await getCandidate("mvp");

    await admin.from("special_predictions").delete().eq("league_id", fixture.league.id);
    stack.add(async () => {
      await admin.from("special_predictions").delete().eq("league_id", fixture.league.id);
    });

    // 2. Insertar predicciones con pausas para obtener 3 timestamps (T1, T2, T3) distintos:
    const { data: p1, error: err1 } = await admin
      .from("special_predictions")
      .insert({
        user_id: user0.userId,
        league_id: fixture.league.id,
        category: "champion",
        candidate_id: championCand.id,
      })
      .select("predicted_at")
      .single();
    expect(err1).toBeNull();

    await page.waitForTimeout(2000);

    const { data: p2, error: err2 } = await admin
      .from("special_predictions")
      .insert({
        user_id: user0.userId,
        league_id: fixture.league.id,
        category: "top_scorer",
        candidate_id: topScorerCand.id,
      })
      .select("predicted_at")
      .single();
    expect(err2).toBeNull();

    await page.waitForTimeout(2000);

    const { data: p3, error: err3 } = await admin
      .from("special_predictions")
      .insert({
        user_id: user0.userId,
        league_id: fixture.league.id,
        category: "mvp",
        candidate_id: mvpCand.id,
      })
      .select("predicted_at")
      .single();
    expect(err3).toBeNull();

    const t1 = new Date(p1!.predicted_at).getTime();
    const t2 = new Date(p2!.predicted_at).getTime();
    const t3 = new Date(p3!.predicted_at).getTime();

    // Re-configurar las fases en la base de datos para subdividir los timestamps (igual que AWD-06):
    const b1 = new Date(t1 + (t2 - t1) / 2).toISOString();
    const b2 = new Date(t2 + (t3 - t2) / 2).toISOString();
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

    // 3. Forzar el inicio de la final en el pasado para que se bloqueen los premios y se active isAwardsLocked
    await setFinalKickoff(true);

    // 4. Verificar en la pantalla EN VIVO (/live)
    await page.goto("/live");
    const liveRow = page.locator(`[data-testid="live-row"][data-user-id="${user0.userId}"]`).first();
    await expect(liveRow).toBeVisible({ timeout: 15_000 });

    // Expandir el acordeón del usuario
    await liveRow.getByTestId("live-row-toggle").click();

    const liveSpecialPreds = liveRow.getByTestId("accordion-special-predictions");
    await expect(liveSpecialPreds).toBeVisible();

    // Verificar que se muestran las etiquetas de candidatos con sus puntos potenciales correspondientes
    await expect(liveSpecialPreds).toContainText(`${championCand.name} (+50 pts)`);
    await expect(liveSpecialPreds).toContainText(`${topScorerCand.name} (+25 pts)`);
    await expect(liveSpecialPreds).toContainText(`${mvpCand.name} (+10 pts)`);

    // 5. Verificar en la pantalla de POSICIONES (/standings)
    await page.goto("/standings");
    await expect(page.getByTestId("standings-skeleton")).toBeHidden({ timeout: 15_000 });

    const standingsRow = page.locator(`[data-testid="standings-row"][data-user-id="${user0.userId}"]`).first();
    await expect(standingsRow).toBeVisible();

    // Expandir el acordeón del usuario en standings
    await standingsRow.getByTestId("standings-row-toggle").click();

    const standingsSpecialPreds = standingsRow.getByTestId("accordion-special-predictions");
    await expect(standingsSpecialPreds).toBeVisible();

    // Verificar que también se muestran los puntos potenciales en /standings
    await expect(standingsSpecialPreds).toContainText(`${championCand.name} (+50 pts)`);
    await expect(standingsSpecialPreds).toContainText(`${topScorerCand.name} (+25 pts)`);
    await expect(standingsSpecialPreds).toContainText(`${mvpCand.name} (+10 pts)`);
  });
});

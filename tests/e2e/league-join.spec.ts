import { test, expect } from "@playwright/test";

import { MULTIPLIER_TIERS } from "../../src/utils/scoring";
import { createAdminClient } from "./helpers/admin";
import { createCleanupStack } from "./helpers/cleanup";
import { seedLeague, addMember, setActiveLeague, type SeededLeague } from "./helpers/seed/league";
import {
  createUser,
  deleteE2EUser,
  loginAs,
  newRunId,
  type E2EUser,
} from "./helpers/users";

// Fase 3 — Invitación y unión a ligas (LIG-08..18). Textos copiados de
// JoinLeagueCard.tsx / JoinByCodeForm.tsx / NoLeagueState.tsx /
// WelcomePaymentModal.tsx / rules/page.tsx; RPCs fn_get_invite_landing y
// fn_join_league_by_invite (normalizan con UPPER+TRIM e insertan idempotente).

const PAYMENT_INSTRUCTIONS = "Zelle al 555-0100, concepto: quiniela E2E";

test.describe("Invitación y unión a ligas", () => {
  const stack = createCleanupStack();
  const runId = newRunId();

  let creator: E2EUser;
  let paidLeague: SeededLeague; // liga CON pago del creador
  let joiner: E2EUser; // se une vía landing (LIG-11/12/13)

  test.beforeAll(async ({ browser }) => {
    void browser;
    creator = await createUser({ runId, tag: "host", displayName: "E2E Anfitrión" });
    stack.add(() => deleteE2EUser(creator.userId));

    paidLeague = await seedLeague({
      runId,
      creatorId: creator.userId,
      name: `E2E Join League ${runId}`,
      requiresPayment: true,
      paymentAmount: 10,
      paymentInstructions: PAYMENT_INSTRUCTIONS,
    });
    stack.add(() => paidLeague.cleanup());
    await addMember(paidLeague.id, creator.userId, {
      role: "admin",
      paymentStatus: "paid",
    });
    await setActiveLeague(creator.userId, paidLeague.id);

    joiner = await createUser({ runId, tag: "joiner", displayName: "E2E Invitado" });
    stack.add(() => deleteE2EUser(joiner.userId));
  });

  test.afterAll(async () => {
    await stack.run();
  });

  test("LIG-08: la landing anónima muestra los datos públicos y solo esos", async ({
    page,
  }) => {
    await page.goto(`/join/${paidLeague.inviteCode}`);

    // Anclado a <main> (la copia huérfana del takeover de next dev queda
    // fuera, ver SEGUIMIENTO.md).
    const main = page.getByRole("main");
    await expect(main.getByTestId("join-league-card")).toBeVisible();
    await expect(main.getByTestId("join-league-name")).toHaveText(
      `Únete a ${paidLeague.name}`,
    );
    // Creador (nombre visible; el avatar es decorativo con alt="").
    await expect(main.getByText("Invitación de")).toBeVisible();
    await expect(main.getByText("E2E Anfitrión")).toBeVisible();
    // Datos de pago públicos (formato $10 USD de format-currency.ts).
    await expect(main.getByTestId("join-payment-info")).toContainText(
      "Tarifa de inscripción: $10 USD",
    );
    await expect(main.getByTestId("join-payment-info")).toContainText(
      PAYMENT_INSTRUCTIONS,
    );
    // Sin datos privados: el RPC no expone email ni IDs internos.
    const html = await page.content();
    expect(html).not.toContain(creator.email);
    expect(html).not.toContain(creator.userId);
  });

  test("LIG-09: código inválido muestra error amable, sin crash", async ({
    page,
  }) => {
    await page.goto("/join/NOEXISTE123");

    // Conteo de visibles: tolera la copia transitoria del takeover de next dev.
    await expect(
      page.getByText("Invitación no disponible").filter({ visible: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("link", { name: "Volver al inicio" }),
    ).toBeVisible();
    await expect(page.getByText("Sorry, something went wrong.")).toHaveCount(0);
  });

  test("LIG-10: el código es case-insensitive en URL y tolera espacios en el form", async ({
    browser,
  }) => {
    // a) URL en minúsculas: la página normaliza con trim().toUpperCase().
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    try {
      await anonPage.goto(`/join/${paidLeague.inviteCode.toLowerCase()}`);
      await expect(anonPage.getByTestId("join-league-name")).toHaveText(
        `Únete a ${paidLeague.name}`,
      );
    } finally {
      await anon.close();
    }

    // b) Código pegado con espacios en el form manual (JoinByCodeForm en el
    //    no-league-state): la server action normaliza con trim+upper.
    const formUser = await createUser({ runId, tag: "form", displayName: "E2E Formulario" });
    stack.add(() => deleteE2EUser(formUser.userId));
    const session = await loginAs(browser, formUser);
    stack.add(() => session.context.close());

    const page = session.page;
    await page.goto("/predictions");
    await page
      .getByTestId("join-code-input")
      .fill(`  ${paidLeague.inviteCode.toLowerCase()}  `);
    await page.getByTestId("join-submit").click();

    await page.waitForURL(/\/predictions\?joined=1/, { timeout: 15_000 });
    const admin = createAdminClient();
    const { data: rows } = await admin
      .from("league_members")
      .select("user_id")
      .eq("league_id", paidLeague.id)
      .eq("user_id", formUser.userId);
    expect(rows).toHaveLength(1);
  });

  test("LIG-11: la unión autenticada por landing crea member/pending y redirige con ?joined=1", async ({
    browser,
  }) => {
    const session = await loginAs(browser, joiner);
    stack.add(() => session.context.close());
    const page = session.page;

    // La landing autenticada hace auto-join server-side y redirige (join/page.tsx).
    await page.goto(`/join/${paidLeague.inviteCode}`);
    await page.waitForURL(/\/predictions\?joined=1&league=/, { timeout: 15_000 });

    // Banner de éxito de /predictions (?joined=1).
    await expect(
      page.getByText("¡Te has unido con éxito! Ya puedes registrar tus pronósticos."),
    ).toBeVisible();

    const admin = createAdminClient();
    const { data: member } = await admin
      .from("league_members")
      .select("role, payment_status")
      .eq("league_id", paidLeague.id)
      .eq("user_id", joiner.userId)
      .single();
    expect(member?.role).toBe("member");
    expect(member?.payment_status).toBe("pending");
  });

  test("LIG-12: repetir la invitación es idempotente (sin duplicados ni error)", async ({
    browser,
  }) => {
    const session = await loginAs(browser, joiner);
    stack.add(() => session.context.close());
    const page = session.page;

    await page.goto(`/join/${paidLeague.inviteCode}`);
    await page.waitForURL(/\/predictions\?joined=1/, { timeout: 15_000 });

    const admin = createAdminClient();
    const { data: rows } = await admin
      .from("league_members")
      .select("user_id")
      .eq("league_id", paidLeague.id)
      .eq("user_id", joiner.userId);
    expect(rows).toHaveLength(1);
  });

  test("LIG-13: liga con pago muestra el modal de bienvenida al miembro pendiente", async ({
    browser,
  }) => {
    // joiner quedó member/pending en la liga con pago (LIG-11).
    const session = await loginAs(browser, joiner);
    stack.add(() => session.context.close());
    const page = session.page;

    await page.goto("/predictions");
    // El modal es overlay fixed pero DOM-wise vive dentro de <main>
    // (PredictionsBoard); el anclaje evita la copia huérfana del takeover.
    const modal = page.getByRole("main").getByTestId("welcome-payment-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId("payment-amount")).toHaveText(
      "Tarifa de inscripción: $10 USD",
    );
    await expect(modal.getByTestId("payment-instructions")).toHaveText(
      PAYMENT_INSTRUCTIONS,
    );

    // Es cerrable para usar la app.
    await page.getByTestId("welcome-payment-close").click();
    await expect(modal).toHaveCount(0);
  });

  test("LIG-14: deep-link anónimo completo: landing → login → auto-join → /predictions", async ({
    browser,
  }) => {
    const deepLinkUser = await createUser({ runId, tag: "deeplink", displayName: "E2E DeepLink" });
    stack.add(() => deleteE2EUser(deepLinkUser.userId));

    const context = await browser.newContext();
    stack.add(() => context.close());
    const page = await context.newPage();

    // 1) Landing anónima: CTA de email conserva el invite en ?next.
    await page.goto(`/join/${paidLeague.inviteCode}`);
    await page
      .getByRole("link", { name: "Inicia sesión o regístrate" })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/auth/login\\?next=${encodeURIComponent(`/join/${paidLeague.inviteCode}`).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );

    // 2) Login por el formulario real.
    await page.getByLabel("Correo electrónico").fill(deepLinkUser.email);
    await page.getByLabel("Contraseña").fill(deepLinkUser.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();

    // 3) Vuelve a /join/<code> ya autenticado → auto-join → /predictions.
    await page.waitForURL(/\/predictions\?joined=1/, { timeout: 20_000 });

    const admin = createAdminClient();
    const { data: member } = await admin
      .from("league_members")
      .select("role")
      .eq("league_id", paidLeague.id)
      .eq("user_id", deepLinkUser.userId)
      .single();
    expect(member?.role).toBe("member");
  });

  test("LIG-15: usuario sin ligas ve el no-league-state con CTAs de unirse y crear", async ({
    browser,
  }) => {
    const lonely = await createUser({ runId, tag: "lonely", displayName: "E2E Sin Liga" });
    stack.add(() => deleteE2EUser(lonely.userId));
    const session = await loginAs(browser, lonely);
    stack.add(() => session.context.close());
    const page = session.page;

    await page.goto("/predictions");
    const emptyState = page
      .getByRole("main")
      .getByTestId("no-league-state")
      .filter({ visible: true });
    await expect(emptyState).toHaveCount(1);
    await expect(
      emptyState.getByText("Aún no perteneces a una liga"),
    ).toBeVisible();
    // CTA de unión manual (JoinByCodeForm) y de creación.
    await expect(emptyState.getByTestId("join-code-input")).toBeVisible();
    await expect(
      emptyState.getByRole("link", { name: "Crear una liga" }),
    ).toBeVisible();
  });

  test("LIG-16: /rules refleja la tabla real de multiplicadores (MULTIPLIER_TIERS)", async ({
    browser,
  }) => {
    const session = await loginAs(browser, creator);
    stack.add(() => session.context.close());
    const page = session.page;

    await page.goto("/rules");
    await expect(
      page.getByRole("heading", {
        name: "Mientras antes pronosticas, más vale tu acierto",
      }),
    ).toBeVisible();

    // La tabla del producto se construye desde MULTIPLIER_TIERS; comparamos
    // contra la MISMA constante importada (rules/page.tsx).
    for (const tier of MULTIPLIER_TIERS) {
      const label =
        tier.distance === 1
          ? "1 jornada antes"
          : `${tier.distance} jornadas antes`;
      const row = page
        .getByRole("main")
        .locator("div")
        .filter({ hasText: new RegExp(`^${label}${tier.value.toFixed(2)}x$`) });
      await expect(row.first()).toBeVisible();
    }
  });

  test("LIG-17: con dos ligas, la liga activa decide los datos y se puede cambiar", async ({
    browser,
  }) => {
    // Usuario en dos ligas, cada una con un rival distinto para detectar cruces.
    const dual = await createUser({ runId, tag: "dual", displayName: "E2E Dual" });
    stack.add(() => deleteE2EUser(dual.userId));
    const rivalA = await createUser({ runId, tag: "rivalA", displayName: "E2E Rival Alfa" });
    stack.add(() => deleteE2EUser(rivalA.userId));
    const rivalB = await createUser({ runId, tag: "rivalB", displayName: "E2E Rival Beta" });
    stack.add(() => deleteE2EUser(rivalB.userId));

    const leagueA = await seedLeague({
      runId: `${runId}A`,
      creatorId: dual.userId,
      name: `E2E Dual Alfa ${runId}`,
    });
    stack.add(() => leagueA.cleanup());
    const leagueB = await seedLeague({
      runId: `${runId}B`,
      creatorId: dual.userId,
      name: `E2E Dual Beta ${runId}`,
    });
    stack.add(() => leagueB.cleanup());

    await addMember(leagueA.id, dual.userId, { role: "admin", paymentStatus: "paid" });
    await addMember(leagueA.id, rivalA.userId, { paymentStatus: "paid" });
    await addMember(leagueB.id, dual.userId, { role: "admin", paymentStatus: "paid" });
    await addMember(leagueB.id, rivalB.userId, { paymentStatus: "paid" });
    // Mecanismo real de liga activa: profiles.active_league_id
    // (getActiveLeagueMembership + fn_set_active_league).
    await setActiveLeague(dual.userId, leagueA.id);

    const session = await loginAs(browser, dual);
    stack.add(() => session.context.close());
    const page = session.page;

     // Con la liga A activa, /standings lista al rival de A y NO al de B.
    await page.goto("/standings");
    await expect(page.getByRole("main").getByText("E2E Rival Alfa")).toBeVisible();
    await expect(page.getByRole("main").getByText("E2E Rival Beta")).toHaveCount(0);

    // Cambio de liga activa por la UI real (/account → "Usar esta liga").
    await page.goto("/account");
    const itemB = page
      .getByRole("main")
      .getByTestId("account-league-item")
      .filter({ hasText: leagueB.name })
      .filter({ visible: true });
    await expect(itemB).toHaveCount(1);
    await itemB
      .getByRole("button", { name: `Usar ${leagueB.name} como liga actual` })
      .click();
    // router.refresh(): el badge "Liga actual" pasa al item de B.
    await expect(itemB.getByText("Liga actual")).toBeVisible({ timeout: 15_000 });

    // Los datos ya no se cruzan: ahora /standings es de la liga B.
    await page.goto("/standings");
    await expect(page.getByRole("main").getByText("E2E Rival Beta")).toBeVisible();
    await expect(page.getByRole("main").getByText("E2E Rival Alfa")).toHaveCount(0);
  });

  test("LIG-18: la landing trae metadata OG correcta para compartir", async ({
    page,
  }) => {
    await page.goto(`/join/${paidLeague.inviteCode}`);

    await expect(page).toHaveTitle(
      `Únete a ${paidLeague.name} | PIJA Quiniela`,
    );
    await expect(
      page.locator('meta[property="og:title"]'),
    ).toHaveAttribute("content", `Únete a ${paidLeague.name}`);
    await expect(
      page.locator('meta[property="og:description"]'),
    ).toHaveAttribute(
      "content",
      "E2E Anfitrión te invita a jugar la quiniela del Mundial.",
    );
  });
});

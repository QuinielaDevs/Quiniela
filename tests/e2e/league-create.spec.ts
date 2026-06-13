import { test, expect, type Page } from "@playwright/test";

import { createAdminClient } from "./helpers/admin";
import { createCleanupStack } from "./helpers/cleanup";
import {
  createUser,
  deleteE2EUser,
  loginAs,
  newRunId,
  type E2EUser,
} from "./helpers/users";

// Fase 3 — Creación de ligas (LIG-01..07). Absorbe el caso de guard del
// antiguo create-league.spec.ts. Textos y testids copiados de
// LeagueCreateForm.tsx; validaciones de leagues.schema.ts.

// Prefijo único del run para identificar y limpiar TODO lo creado por la UI.
const runId = newRunId();
const NAME_PREFIX = `E2E-CREATE-${runId}`;

async function deleteLeaguesByPrefix(prefix: string): Promise<void> {
  const admin = createAdminClient();
  const { data: leagues } = await admin
    .from("leagues")
    .select("id")
    .like("name", `${prefix}%`);
  const ids = (leagues ?? []).map((l) => l.id as string);
  if (ids.length === 0) return;
  await admin.from("league_members").delete().in("league_id", ids);
  await admin
    .from("profiles")
    .update({ active_league_id: null })
    .in("active_league_id", ids);
  await admin.from("leagues").delete().in("id", ids);
}

async function getLeaguesByName(name: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("leagues")
    .select("id, name, invite_code, requires_payment, payment_amount, payment_instructions, created_by")
    .eq("name", name);
  return data ?? [];
}

test("LIG-01: /leagues/new redirige al login sin sesión", async ({ page }) => {
  await page.goto("/leagues/new");
  await expect(page).toHaveURL(/\/auth\/login/);
});

test.describe("Creación de ligas (autenticado)", () => {
  const stack = createCleanupStack();
  let user: E2EUser;
  let page: Page;
  // Estado compartido LIG-02 → LIG-06 (mismo orden serial del archivo).
  let createdLeagueName: string;

  test.beforeAll(async ({ browser }) => {
    user = await createUser({ runId, displayName: "E2E Creador" });
    stack.add(() => deleteE2EUser(user.userId));
    stack.add(() => deleteLeaguesByPrefix(NAME_PREFIX));

    const session = await loginAs(browser, user);
    page = session.page;
    stack.add(() => session.context.close());
  });

  test.afterAll(async () => {
    await stack.run();
  });

  async function ensureLeagueCreated(p: Page) {
    if (!createdLeagueName) {
      createdLeagueName = `${NAME_PREFIX} Sin Pago`;
      await p.goto("/leagues/new");
      await p.getByTestId("league-name-input").fill(createdLeagueName);
      await p.getByTestId("create-league-submit").click();
      await p.waitForURL(/\/predictions/, { timeout: 15_000 });
    }
  }

  test("LIG-02: crear liga sin pago redirige a /predictions y aparece en /account", async () => {
    createdLeagueName = `${NAME_PREFIX} Sin Pago`;

    await page.goto("/leagues/new");
    await page.getByTestId("league-name-input").fill(createdLeagueName);
    await page.getByTestId("create-league-submit").click();

    // Destino real post-creación: router.push("/predictions") (LeagueCreateForm).
    await page.waitForURL(/\/predictions/, { timeout: 15_000 });

    // La liga aparece en /account (AccountLeaguesPanel).
    await page.goto("/account");
    await expect(
      page
        .getByRole("main")
        .getByTestId("account-league-item")
        .filter({ hasText: createdLeagueName })
        .filter({ visible: true }),
    ).toHaveCount(1);
  });

  test("LIG-06: el creador queda admin y el invite_code se genera (BD)", async () => {
    // Depende del estado creado por LIG-02 (orden serial del spec).
    await ensureLeagueCreated(page);
    const leagues = await getLeaguesByName(createdLeagueName);
    expect(leagues).toHaveLength(1);
    const league = leagues[0]!;

    expect(league.created_by).toBe(user.userId);
    expect(String(league.invite_code).length).toBeGreaterThanOrEqual(6);

    const admin = createAdminClient();
    const { data: member } = await admin
      .from("league_members")
      .select("role, payment_status")
      .eq("league_id", league.id)
      .eq("user_id", user.userId)
      .single();
    expect(member?.role).toBe("admin");
  });

  test("LIG-19: Copiar código y enlace de invitación al portapapeles", async () => {
    await ensureLeagueCreated(page);
    const leagues = await getLeaguesByName(createdLeagueName);
    expect(leagues).toHaveLength(1);
    const league = leagues[0]!;

    await page.goto("/account");

    // Mock navigator.clipboard to avoid window focus dependencies and timeouts
    await page.evaluate(() => {
      let clipboardText = "";
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (text: string) => {
            clipboardText = text;
          },
          readText: async () => {
            return clipboardText;
          }
        },
        configurable: true,
        writable: true
      });
    });

    const leagueItem = page
      .getByRole("main")
      .getByTestId("account-league-item")
      .filter({ hasText: createdLeagueName })
      .filter({ visible: true });

    await expect(leagueItem).toBeVisible();

    // Copiar código
    const copyCodeBtn = leagueItem.getByRole("button", {
      name: `Copiar código de invitación de ${createdLeagueName}`,
    });
    await copyCodeBtn.click();
    await expect(
      leagueItem.getByRole("button", {
        name: `Código de invitación de ${createdLeagueName} copiado`,
      }),
    ).toBeVisible();

    const clipboardCode = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardCode).toBe(league.invite_code);

    // Copiar enlace
    const copyLinkBtn = leagueItem.getByRole("button", {
      name: `Copiar enlace de invitación de ${createdLeagueName}`,
    });
    await copyLinkBtn.click();
    await expect(
      leagueItem.getByRole("button", {
        name: `Enlace de invitación de ${createdLeagueName} copiado`,
      }),
    ).toBeVisible();

    const clipboardLink = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardLink).toContain(`/join/${league.invite_code}`);
  });

  test("LIG-03: crear liga con pago refleja monto e instrucciones en la invitación", async () => {
    const name = `${NAME_PREFIX} Con Pago`;
    const instructions = "Zelle al 555-0100, concepto: quiniela";

    await page.goto("/leagues/new");
    await page.getByTestId("league-name-input").fill(name);
    await page.getByTestId("requires-payment-switch").click();
    await page.getByTestId("payment-amount-input").fill("10");
    await page.getByTestId("payment-instructions-input").fill(instructions);
    await page.getByTestId("create-league-submit").click();
    await page.waitForURL(/\/predictions/, { timeout: 15_000 });

    const leagues = await getLeaguesByName(name);
    expect(leagues).toHaveLength(1);
    expect(leagues[0]!.requires_payment).toBe(true);
    expect(Number(leagues[0]!.payment_amount)).toBe(10);

    // Los datos de pago se reflejan en la landing pública de invitación.
    // OJO: hay que mirarla ANÓNIMO — un usuario autenticado que visita /join
    // es auto-unido y redirigido a /predictions (join/page.tsx), y el creador
    // ya es miembro.
    const browser = page.context().browser()!;
    const anon = await browser.newContext();
    try {
      const anonPage = await anon.newPage();
      await anonPage.goto(`/join/${leagues[0]!.invite_code}`);
      await expect(anonPage.getByRole("main").getByTestId("join-payment-info")).toContainText(
        "Tarifa de inscripción: $10 USD",
      );
      await expect(anonPage.getByRole("main").getByTestId("join-payment-info")).toContainText(
        instructions,
      );
    } finally {
      await anon.close();
    }
  });

  test("LIG-04: nombre vacío o solo espacios no crea la liga", async () => {
    await page.goto("/leagues/new");

    // a) Vacío: lo bloquea la validación nativa (required) sin submit.
    await page.getByTestId("create-league-submit").click();
    const nativeMessage = await page
      .getByTestId("league-name-input")
      .evaluate((el: HTMLInputElement) => el.validationMessage);
    expect(nativeMessage).not.toBe("");
    await expect(page).toHaveURL(/\/leagues\/new/);

    // b) Solo espacios: pasa el required nativo pero el schema lo rechaza
    //    con el mensaje exacto de leagues.schema.ts.
    await page.getByTestId("league-name-input").fill("   ");
    await page.getByTestId("create-league-submit").click();
    await expect(page.getByTestId("create-league-error")).toHaveText(
      "El nombre de la liga es obligatorio.",
    );

    const admin = createAdminClient();
    const { data: whitespaceLeagues } = await admin
      .from("leagues")
      .select("id")
      .eq("created_by", user.userId)
      .eq("name", "");
    expect(whitespaceLeagues ?? []).toHaveLength(0);
  });

  test("LIG-05: validaciones de monto con pago activado", async () => {
    const name = `${NAME_PREFIX} Validación Monto`;
    await page.goto("/leagues/new");
    await page.getByTestId("league-name-input").fill(name);
    await page.getByTestId("requires-payment-switch").click();

    const amountInput = page.getByTestId("payment-amount-input");
    const instructionsInput = page.getByTestId("payment-instructions-input");

    // a) Monto vacío: bloqueado por required nativo.
    await instructionsInput.fill("Instrucciones de prueba");
    await page.getByTestId("create-league-submit").click();
    expect(
      await amountInput.evaluate((el: HTMLInputElement) => el.validationMessage),
    ).not.toBe("");

    // b) Monto negativo: bloqueado por min=0 nativo (rangeUnderflow).
    await amountInput.fill("-5");
    await page.getByTestId("create-league-submit").click();
    expect(
      await amountInput.evaluate((el: HTMLInputElement) => el.validity.rangeUnderflow),
    ).toBe(true);

    // c) Instrucciones vacías: bloqueado por required nativo del textarea.
    await amountInput.fill("10");
    await instructionsInput.fill("");
    await page.getByTestId("create-league-submit").click();
    expect(
      await instructionsInput.evaluate(
        (el: HTMLTextAreaElement) => el.validationMessage,
      ),
    ).not.toBe("");

    // Nada de lo anterior creó la liga.
    expect(await getLeaguesByName(name)).toHaveLength(0);

    // d) Monto 0: el schema lo PERMITE (z.number().nonnegative(), decisión
    //    deliberada documentada en leagues.schema.ts) → la liga SE CREA.
    //    Desviación del plan (que asumía error); anotada en las notas de fase.
    await instructionsInput.fill("Inscripción gratuita simbólica");
    await amountInput.fill("0");
    await page.getByTestId("create-league-submit").click();
    await page.waitForURL(/\/predictions/, { timeout: 15_000 });

    const created = await getLeaguesByName(name);
    expect(created).toHaveLength(1);
    expect(Number(created[0]!.payment_amount)).toBe(0);
  });

  test("LIG-07: doble click en el submit no duplica la liga", async () => {
    const name = `${NAME_PREFIX} Doble Click`;

    await page.goto("/leagues/new");
    await page.getByTestId("league-name-input").fill(name);
    // dblclick dispara dos clicks inmediatos; el botón se deshabilita con
    // isPending (useTransition) en el primer submit.
    await page.getByTestId("create-league-submit").dblclick();
    await page.waitForURL(/\/predictions/, { timeout: 15_000 });

    expect(await getLeaguesByName(name)).toHaveLength(1);
  });
});

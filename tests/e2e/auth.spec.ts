import { test, expect } from "@playwright/test";

import { createAdminClient } from "./helpers/admin";
import { extractLinks, waitForEmailTo } from "./helpers/mail";
import {
  createUser,
  deleteE2EUser,
  loginViaForm,
  newRunId,
  TEST_PASSWORD,
  type E2EUser,
} from "./helpers/users";

// Fase 2 — Ciclo de vida completo de la sesión (AUTH-01..14).
// Textos de error y labels copiados de login-form.tsx / sign-up-form.tsx /
// forgot-password-form.tsx / update-password-form.tsx (mensajes de Supabase
// Auth en inglés; UI propia en español).

// Borra (si existe) el usuario de auth con ese email. Para los tests de
// sign-up, donde el id lo genera el flujo y no el helper.
async function deleteUserByEmail(email: string): Promise<void> {
  const admin = createAdminClient();
  const target = email.toLowerCase();
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const found = (data?.users ?? []).filter(
    (u) => u.email?.toLowerCase() === target,
  );
  for (const user of found) {
    await admin.auth.admin.deleteUser(user.id);
  }
}

async function countUsersByEmail(email: string): Promise<number> {
  const admin = createAdminClient();
  const target = email.toLowerCase();
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return (data?.users ?? []).filter((u) => u.email?.toLowerCase() === target)
    .length;
}

test.describe("Autenticación — login y redirecciones", () => {
  let user: E2EUser;

  test.beforeAll(async () => {
    user = await createUser();
  });

  test.afterAll(async () => {
    await deleteE2EUser(user.userId);
  });

  test("AUTH-01: login correcto redirige a /predictions", async ({ page }) => {
    await loginViaForm(page, user.email, user.password);

    await expect(page).toHaveURL(/\/predictions/);
  });

  test("AUTH-02: credenciales inválidas muestran error y no navegan", async ({
    page,
  }) => {
    await page.goto("/auth/login");
    await page.getByLabel("Correo electrónico").fill(user.email);
    await page.getByLabel("Contraseña").fill("password-incorrecta");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();

    // Mensaje de Supabase Auth mostrado en el testid auth-error (login-form.tsx).
    await expect(page.getByTestId("auth-error")).toHaveText(
      "Invalid login credentials",
    );
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("AUTH-03: email malformado bloquea el submit (validación nativa)", async ({
    page,
  }) => {
    await page.goto("/auth/login");
    await page.getByLabel("Correo electrónico").fill("noesunemail");
    await page.getByLabel("Contraseña").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();

    // El input type="email" required invalida el form: no hay navegación ni
    // request; el navegador reporta el problema en validationMessage.
    await expect(page).toHaveURL(/\/auth\/login/);
    const validationMessage = await page
      .getByLabel("Correo electrónico")
      .evaluate((el: HTMLInputElement) => el.validationMessage);
    expect(validationMessage).not.toBe("");
    await expect(page.getByTestId("auth-error")).toHaveCount(0);
  });

  test("AUTH-04: ?next seguro se respeta tras el login", async ({ page }) => {
    await page.goto("/auth/login?next=/standings");
    await page.getByLabel("Correo electrónico").fill(user.email);
    await page.getByLabel("Contraseña").fill(user.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();

    await page.waitForURL(/\/standings/, { timeout: 15_000 });
  });

  test("AUTH-05: ?next malicioso se normaliza al fallback interno", async ({
    page,
  }) => {
    // getSafeNextPath (src/utils/redirect.ts) descarta URLs absolutas y
    // protocol-relative; el fallback es /predictions.
    for (const evil of ["https://evil.com", "//evil.com"]) {
      await page.goto(`/auth/login?next=${encodeURIComponent(evil)}`);
      await page.getByLabel("Correo electrónico").fill(user.email);
      await page.getByLabel("Contraseña").fill(user.password);
      await page.getByRole("button", { name: "Iniciar sesión" }).click();

      // NUNCA sale del origen del app server: termina en el fallback interno.
      await page.waitForURL(/\/predictions/, { timeout: 15_000 });
      const url = new URL(page.url());
      expect(url.hostname).toBe("127.0.0.1");
      expect(url.pathname).toBe("/predictions");

      // Volver a estado anon para la segunda iteración.
      await page.context().clearCookies();
    }
  });

  test("AUTH-12: el botón Google redirige al provider de Supabase", async ({
    page,
  }) => {
    await page.goto("/auth/login");

    // Interceptamos la salida hacia GoTrue para NO completar el OAuth real
    // (en local las credenciales de Google son placeholders).
    const authorizeRequest = page.waitForRequest(
      (req) =>
        req.url().includes("/auth/v1/authorize") &&
        req.url().includes("provider=google"),
      { timeout: 15_000 },
    );
    await page.route("**/auth/v1/authorize**", (route) => route.abort());

    await page.getByTestId("google-signin-button").click();

    const request = await authorizeRequest;
    const url = new URL(request.url());
    expect(url.pathname).toContain("/auth/v1/authorize");
    expect(url.searchParams.get("provider")).toBe("google");
  });

  test("AUTH-13: las rutas protegidas redirigen a login con ?next", async ({
    page,
  }) => {
    const protectedRoutes = [
      "/predictions",
      "/standings",
      "/standings/manage",
      "/live",
      "/duels",
      "/awards",
      "/account",
      "/leagues/new",
      "/rules",
    ];

    for (const route of protectedRoutes) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/auth\/login/);
      // El middleware conserva el destino original en ?next (middleware.ts).
      const next = new URL(page.url()).searchParams.get("next");
      expect(next).toBe(route);
    }
  });

  test("AUTH-14: la sesión sobrevive recargas", async ({ page }) => {
    await loginViaForm(page, user.email, user.password);

    await page.reload();

    // Sigue autenticado: no hay redirect a login. El usuario no tiene liga,
    // así que /predictions renderiza el estado sin-liga (contenido auth real,
    // no un error ni el login).
    // Anclado a <main> + conteo de visibles: tolera la copia huérfana
    // transitoria del takeover de next dev (ver SEGUIMIENTO.md).
    await expect(page).toHaveURL(/\/predictions/);
    await expect(
      page.getByRole("main").getByTestId("no-league-state").filter({ visible: true }),
    ).toHaveCount(1);
  });
});

test.describe("Autenticación — registro", () => {
  test("AUTH-06: sign-up con email+password crea cuenta y perfil", async ({
    page,
  }) => {
    const email = `e2e-${newRunId()}-signup@test.pija`;

    try {
      await page.goto("/auth/sign-up");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
      await page.getByLabel("Repeat Password").fill(TEST_PASSWORD);
      await page.getByRole("button", { name: "Sign up" }).click();

      // Comportamiento real (sign-up-form.tsx): siempre navega a la página de
      // éxito, aunque en local enable_confirmations=false cree sesión directa.
      await page.waitForURL(/\/auth\/sign-up-success/, { timeout: 15_000 });
      await expect(
        page.getByText("Thank you for signing up!"),
      ).toBeVisible();

      // El trigger fn_handle_new_user creó el profile con el display_name
      // por defecto ("Jugador Anónimo", init_schema.sql).
      const admin = createAdminClient();
      const { data: users } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      const created = (users?.users ?? []).find(
        (u) => u.email?.toLowerCase() === email.toLowerCase(),
      );
      expect(created).toBeTruthy();

      const { data: profile } = await admin
        .from("profiles")
        .select("display_name")
        .eq("id", created!.id)
        .single();
      expect(profile?.display_name).toBe("Jugador Anónimo");
    } finally {
      await deleteUserByEmail(email);
    }
  });

  test("AUTH-07: password corta (4 chars) es rechazada", async ({ page }) => {
    const email = `e2e-${newRunId()}-short@test.pija`;

    try {
      await page.goto("/auth/sign-up");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill("1234");
      await page.getByLabel("Repeat Password").fill("1234");
      await page.getByRole("button", { name: "Sign up" }).click();

      // GoTrue rechaza por minimum_password_length=8 (config.toml); el form
      // muestra el mensaje en auth-error y NO navega.
      await expect(page.getByTestId("auth-error")).toContainText(
        /password/i,
      );
      await expect(page).toHaveURL(/\/auth\/sign-up/);
      expect(await countUsersByEmail(email)).toBe(0);
    } finally {
      await deleteUserByEmail(email);
    }
  });

  test("AUTH-08: email duplicado en sign-up muestra error y no duplica", async ({
    page,
  }) => {
    const existing = await createUser({ tag: "dup" });

    try {
      await page.goto("/auth/sign-up");
      await page.getByLabel("Email").fill(existing.email);
      await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
      await page.getByLabel("Repeat Password").fill(TEST_PASSWORD);
      await page.getByRole("button", { name: "Sign up" }).click();

      // Con confirmaciones desactivadas, GoTrue responde error explícito.
      await expect(page.getByTestId("auth-error")).toContainText(
        /already registered/i,
      );
      await expect(page).toHaveURL(/\/auth\/sign-up/);
      expect(await countUsersByEmail(existing.email)).toBe(1);
    } finally {
      await deleteE2EUser(existing.userId);
    }
  });
});

test.describe("Autenticación — logout y recuperación", () => {
  test("AUTH-09: logout vuelve a estado anónimo", async ({ page }) => {
    const user = await createUser({ tag: "logout" });

    try {
      await loginViaForm(page, user.email, user.password);

      // El botón vive en /account (logout-button.tsx, aria-label "Cerrar sesión").
      // Anclado a <main> (la copia huérfana del takeover de next dev queda
      // fuera) y filtrado por visible para esperar a que el DOM se asiente.
      await page.goto("/account");
      const logoutButton = page
        .getByRole("main")
        .getByTestId("logout-button")
        .filter({ visible: true });
      await expect(logoutButton).toHaveCount(1);
      await logoutButton.click();
      await page.waitForURL(/\/auth\/login/, { timeout: 15_000 });

      // La sesión murió: una ruta protegida vuelve a redirigir a login.
      await page.goto("/predictions");
      await expect(page).toHaveURL(/\/auth\/login/);
    } finally {
      await deleteE2EUser(user.userId);
    }
  });

  test("AUTH-10: recuperación de contraseña completa por email local", async ({
    page,
    browser,
  }) => {
    const user = await createUser({ tag: "recovery" });
    const NEW_PASSWORD = "PijaE2E!Nueva-2026";

    try {
      // 1) Solicitar el email de recuperación por el formulario real.
      await page.goto("/auth/forgot-password");
      await page.getByLabel("Email").fill(user.email);
      await page.getByRole("button", { name: "Send reset email" }).click();
      await expect(page.getByText("Check Your Email")).toBeVisible();

      // 2) Leer el email capturado por Mailpit y seguir el link de verify.
      const email = await waitForEmailTo(user.email, { timeoutMs: 20_000 });
      const links = extractLinks(`${email.html}\n${email.text}`);
      const verifyLink = links.find((link) => link.includes("/auth/v1/verify"));
      expect(
        verifyLink,
        `el email debe traer un link de verify; links: ${links.join(", ")}`,
      ).toBeTruthy();

      // 3) El verify de GoTrue redirige (allow-list del puerto 3100) a
      //    /auth/update-password con la sesión de recovery en la URL.
      await page.goto(verifyLink!);
      await page.waitForURL(/\/auth\/update-password/, { timeout: 15_000 });
      await page.getByLabel("New password").fill(NEW_PASSWORD);
      await page.getByRole("button", { name: "Save new password" }).click();
      await page.waitForURL(/\/predictions/, { timeout: 15_000 });

      // 4) La nueva password sirve; la vieja ya no.
      const freshContext = await browser.newContext();
      const freshPage = await freshContext.newPage();
      try {
        await freshPage.goto("/auth/login");
        await freshPage.getByLabel("Correo electrónico").fill(user.email);
        await freshPage.getByLabel("Contraseña").fill(user.password);
        await freshPage
          .getByRole("button", { name: "Iniciar sesión" })
          .click();
        await expect(freshPage.getByTestId("auth-error")).toHaveText(
          "Invalid login credentials",
        );

        await freshPage.getByLabel("Contraseña").fill(NEW_PASSWORD);
        await freshPage
          .getByRole("button", { name: "Iniciar sesión" })
          .click();
        await freshPage.waitForURL(/\/predictions/, { timeout: 15_000 });
      } finally {
        await freshContext.close();
      }
    } finally {
      await deleteE2EUser(user.userId);
    }
  });

  test("AUTH-11: /auth/update-password sin sesión de recovery falla controlado", async ({
    page,
  }) => {
    // Comportamiento real: la ruta es pública (middleware permite /auth/*) y
    // renderiza el formulario; el updateUser sin sesión devuelve error de
    // Supabase mostrado en auth-error (update-password-form.tsx). No hay crash.
    await page.goto("/auth/update-password");
    await expect(page.getByLabel("New password")).toBeVisible();

    await page.getByLabel("New password").fill("OtraPassword!123");
    await page.getByRole("button", { name: "Save new password" }).click();

    await expect(page.getByTestId("auth-error")).toContainText(
      /session missing/i,
    );
    await expect(page).toHaveURL(/\/auth\/update-password/);
  });
});

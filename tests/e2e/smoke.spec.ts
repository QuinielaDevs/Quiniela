import { test, expect, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { createCleanupStack } from "./helpers/cleanup";
import {
  createLeagueWithUsers,
  type LeagueWithUsers,
} from "./helpers/users";
import {
  deleteMatches,
  editableMatch,
  finishedMatch,
  liveMatch,
  seedMatches,
  suspendedMatch,
} from "./helpers/seed/matches";

// Fase 2 — Smoke de todas las rutas (SMK-01..11).
// Verifica que cada ruta del producto carga sin error en su estado correcto
// (anon / autenticado / admin). Textos copiados de los componentes fuente.

// ─────────────────────────────────────────────────────────────────────────────
// Rutas anónimas
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Smoke — rutas anónimas", () => {
  test("SMK-01: / carga para anónimo y muestra el login", async ({ page }) => {
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    // HomeEntry sin sesión renderiza el LoginForm (login-form.tsx).
    await expect(
      page.getByRole("button", { name: "Iniciar sesión" }),
    ).toBeVisible();
    await expect(page.getByText("Sorry, something went wrong.")).toHaveCount(0);
  });

  test("SMK-02: /auth/login muestra email, contraseña y botón Google", async ({
    page,
  }) => {
    await page.goto("/auth/login");

    await expect(page.getByLabel("Correo electrónico")).toBeVisible();
    await expect(page.getByLabel("Contraseña")).toBeVisible();
    await expect(page.getByTestId("google-signin-button")).toBeVisible();
  });

  test("SMK-03: /auth/sign-up muestra el formulario de registro", async ({
    page,
  }) => {
    await page.goto("/auth/sign-up");

    // Labels y botón copiados de sign-up-form.tsx (el form está en inglés).
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Repeat Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign up" })).toBeVisible();
  });

  test("SMK-04: /auth/forgot-password muestra el formulario", async ({
    page,
  }) => {
    await page.goto("/auth/forgot-password");

    // Textos de forgot-password-form.tsx (exact: la descripción del card
    // también contiene la frase "reset your password").
    await expect(
      page.getByText("Reset Your Password", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send reset email" }),
    ).toBeVisible();
  });

  test("SMK-10: ruta inexistente responde con el 404 de Next, no error boundary", async ({
    page,
  }) => {
    // Nota: para rutas fuera de /auth el middleware intercepta ANTES que el
    // router y redirige al login (catch-all de sesión), así que el 404 puro
    // solo es observable anónimo bajo prefijos públicos como /auth/*.
    const response = await page.goto("/auth/ruta-que-no-existe-e2e");

    expect(response?.status()).toBe(404);
    // Página not-found por defecto de Next (no hay not-found.tsx propio).
    await expect(
      page.getByText("This page could not be found."),
    ).toBeVisible();
    await expect(page.getByText("Sorry, something went wrong.")).toHaveCount(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rutas autenticadas (usuario admin + liga + un partido test_ de cada estado)
// ─────────────────────────────────────────────────────────────────────────────

// Espera a que el elemento raíz de la ruta quede asentado y visible.
// `toHaveCount(1)` reintenta mientras `next dev` duplica el DOM unos ms tras
// el goto (flake conocido de la Fase 1, ver SEGUIMIENTO.md) y FALLA fuerte si
// la duplicación fuera permanente (eso sí sería bug de producto).
// Subconjunto de la API de localización común a Page y Locator (para poder
// anclar el mismo locate() a <main>).
type Scope = Pick<Locator, "getByTestId" | "getByRole">;

async function expectSettledVisible(
  page: Page,
  locate: (scope: Scope) => Locator,
): Promise<void> {
  // La copia huérfana del takeover queda FUERA de <main>; anclar el locator a
  // main y exigir exactamente UNA instancia visible reintenta a través de los
  // estados transitorios (0 visibles, copia oculta, 2 copias unos ms) y falla
  // si la duplicación fuera permanente (eso sí sería bug de producto).
  const scoped = locate(page.getByRole("main"));
  await expect(scoped.filter({ visible: true })).toHaveCount(1);
}

// Cada entrada: ruta + locator raíz que prueba que el contenido real
// (no un error boundary) se renderizó.
const GAME_ROUTES: Array<{
  path: string;
  locate: (scope: Scope) => Locator;
}> = [
  { path: "/predictions", locate: (s) => s.getByTestId("predictions-board") },
  { path: "/standings", locate: (s) => s.getByTestId("standings-table") },
  { path: "/live", locate: (s) => s.getByTestId("live-board") },
  { path: "/duels", locate: (s) => s.getByTestId("duels-dashboard") },
  { path: "/awards", locate: (s) => s.getByTestId("awards-board") },
  { path: "/account", locate: (s) => s.getByTestId("profile-summary") },
  {
    path: "/rules",
    locate: (s) =>
      s.getByRole("heading", { name: "Instrucciones de la quiniela" }),
  },
];

// Ruido conocido de consola en next dev que NO es un error de producto
// (SMK-11). Lista blanca deliberadamente estrecha; cualquier otro error falla.
const CONSOLE_ERROR_WHITELIST: RegExp[] = [
  // next dev descarga las source maps de React desde el navegador.
  /Failed to load resource.*404/i,
  // Aviso de hidratación de extensiones/atributos del dev overlay.
  /Warning: Extra attributes from the server/i,
];

function isWhitelisted(message: string): boolean {
  return CONSOLE_ERROR_WHITELIST.some((pattern) => pattern.test(message));
}

test.describe("Smoke — rutas autenticadas", () => {
  let fixture: LeagueWithUsers;
  const stack = createCleanupStack();

  test.beforeAll(async ({ browser }) => {
    // Un solo usuario admin con liga activa (payment paid → sin modal) y un
    // partido test_ de cada estado para que las páginas tengan datos.
    fixture = await createLeagueWithUsers(browser, { members: 1 });
    stack.add(() => fixture.cleanup());

    const matches = await seedMatches([
      editableMatch(),
      liveMatch({ home: 1, away: 0 }),
      finishedMatch({ home: 2, away: 1 }),
      suspendedMatch(),
    ]);
    stack.add(() => deleteMatches(matches.map((m) => m.id)));
  });

  test.afterAll(async () => {
    await stack.run();
  });

  test("SMK-05: las rutas de juego cargan autenticado sin error", async () => {
    const page = fixture.users[0]!.page!;

    for (const route of GAME_ROUTES) {
      await page.goto(route.path);
      await expectSettledVisible(page, route.locate);
      // Un error boundary de Next reemplazaría el contenido por este texto.
      await expect(
        page.getByText("Application error: a client-side exception"),
      ).toHaveCount(0);
    }
  });

  test("SMK-06: /standings/manage carga para el admin", async () => {
    const page = fixture.users[0]!.page!;

    await page.goto("/standings/manage");
    // El panel lista miembros y partidos gestionables (MemberAdminList /
    // MatchAdminList); con el seed hay al menos el propio admin.
    await expect(page.getByTestId("member-admin-row").first()).toBeVisible();
    await expect(page.getByTestId("match-admin-row").first()).toBeVisible();
  });

  test("SMK-07: /leagues/new carga autenticado con el formulario", async () => {
    const page = fixture.users[0]!.page!;

    await page.goto("/leagues/new");
    await expect(
      page.getByRole("heading", { name: "Crear nueva liga" }),
    ).toBeVisible();
    await expect(page.getByTestId("league-name-input")).toBeVisible();
    await expect(page.getByTestId("create-league-submit")).toBeVisible();
  });

  test("SMK-08: /join/<código válido> carga anónimo con el nombre de la liga", async ({
    browser,
  }) => {
    // Contexto SIN sesión: la landing de invitación es pública.
    const anonContext = await browser.newContext();
    const page = await anonContext.newPage();

    try {
      await page.goto(`/join/${fixture.league.inviteCode}`);
      await expectSettledVisible(page, (s) => s.getByTestId("join-league-card"));
      // El título real es "Únete a <nombre>" (JoinLeagueCard.tsx).
      await expect(
        page.getByRole("main").getByTestId("join-league-name"),
      ).toContainText(fixture.league.name);
    } finally {
      await anonContext.close();
    }
  });

  test("SMK-09: /desafio/<uuid inexistente> autenticado no crashea (404 amable)", async () => {
    // Desviación del plan (setup anon): el middleware actual intercepta
    // /desafio para anónimos (ver BUG-001 y el fixme de abajo); el caso "no
    // crashea con uuid inexistente" se verifica autenticado.
    const page = fixture.users[0]!.page!;

    await page.goto(`/desafio/${randomUUID()}`);
    // El notFound() se lanza dentro de un <Suspense> en streaming, así que el
    // status HTTP es 200; lo observable es la UI not-found de Next (sin 500
    // ni error boundary).
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await expect(page.getByText("Sorry, something went wrong.")).toHaveCount(0);
  });

  // BUG-001 (docs/e2e-plan/BUGS.md): /desafio/[id] está documentada como
  // landing PÚBLICA (00-contexto §2: anon/auth, OG para WhatsApp), pero el
  // middleware redirige a /auth/login a los visitantes anónimos.
  test.fixme(
    "SMK-09b: /desafio/<id> es accesible para anónimos (BUG-001)",
    async ({ page }) => {
      await page.goto(`/desafio/${randomUUID()}`);
      await expect(page).not.toHaveURL(/\/auth\/login/);
    },
  );

  test("SMK-11: sin errores graves de consola en las rutas de juego", async ({
    browser,
  }) => {
    // Contexto nuevo (mismo usuario) para capturar la consola desde cero,
    // incluido el primer render post-login.
    const session = await browser.newContext();
    const freshPage = await session.newPage();
    const errors: string[] = [];
    freshPage.on("console", (msg) => {
      if (msg.type() === "error" && !isWhitelisted(msg.text())) {
        errors.push(`[${freshPage.url()}] ${msg.text()}`);
      }
    });
    freshPage.on("pageerror", (error) => {
      errors.push(`[pageerror ${freshPage.url()}] ${error.message}`);
    });

    try {
      // Login por el formulario real con el usuario del fixture.
      await freshPage.goto("/auth/login");
      await freshPage.getByLabel("Correo electrónico").fill(fixture.users[0]!.email);
      await freshPage.getByLabel("Contraseña").fill(fixture.users[0]!.password);
      await freshPage.getByRole("button", { name: /iniciar sesi/i }).click();
      await freshPage.waitForURL(/\/predictions/, { timeout: 15_000 });

      for (const route of GAME_ROUTES) {
        await freshPage.goto(route.path);
        await expectSettledVisible(freshPage, route.locate);
      }

      expect(errors).toEqual([]);
    } finally {
      await session.close();
    }
  });
});

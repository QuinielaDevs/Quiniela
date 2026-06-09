// Helpers de autenticación para tests e2e. La estrategia es FORM-BASED:
// 1) Crea un usuario de prueba vía admin API (server-side, sin UI)
// 2) Inicia sesión en el navegador a través del formulario de login real
//    (esto setea las cookies chunked/base64 que Supabase SSR espera)
// 3) Devuelve el contexto autenticado + credenciales para cleanup.
//
// Es la misma forma en que un usuario real entra a la app: pasar por
// `/auth/login` evita tener que adivinar el formato exacto del cookie
// chunked de Supabase (sb-<ref>-auth-token.0/.1/...) y sus opciones.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Browser, BrowserContext, Page } from "@playwright/test";

export interface E2EAuth {
  context: BrowserContext;
  page: Page;
  userId: string;
  email: string;
  password: string;
}

const TEST_PASSWORD = "PijaE2E!Test-2026";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name}. ` +
        "Asegúrate de que Supabase local está corriendo y exportado en el entorno (CI usa `supabase status -o env`).",
    );
  }
  return value;
}

function createAdminClient(): SupabaseClient {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// Crea un usuario de prueba, le crea un league_member (con su liga y predicción
// default), y abre un browser context autenticado. Devuelve también credenciales
// y referencias para cleanup.
//
// Se separa la creación de la data de prueba (seed) en `tests/e2e/helpers/seed.ts`
// para mantener este helper enfocado en auth.
export async function createAuthenticatedContext(
  browser: Browser,
): Promise<E2EAuth> {
  const admin = createAdminClient();
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.pija`;

  const { data: created, error: createErr } =
    await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
  if (createErr || !created.user) {
    throw new Error(
      `No se pudo crear el usuario e2e: ${createErr?.message ?? "unknown"}`,
    );
  }
  const userId = created.user.id;

  // Abre un browser context limpio y navega a /auth/login para usar el
  // formulario real. Esto setea las cookies correctas de Supabase SSR
  // (chunks base64 con la key sb-<ref>-auth-token.N) en el context.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/auth/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /iniciar sesi/i }).click();
  // El login redirige a /predictions tras éxito. Esperamos a que la URL
  // cambie para asegurar que las cookies se persistieron.
  await page.waitForURL(/\/predictions/, { timeout: 15_000 });

  return { context, page, userId, email, password: TEST_PASSWORD };
}

export async function deleteE2EUser(userId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.auth.admin.deleteUser(userId);
}

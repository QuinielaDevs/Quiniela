import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

// Carga credenciales de Supabase local desde .env.test.local / .env
// (CI las exporta directamente con `supabase status -o env`).
config({ path: ".env.test.local" });
config({ path: ".env" });

// Puerto dedicado para E2E (evita el 3000, que en este entorno puede estar
// ocupado por el backend de Docker Desktop).
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

// Playwright SÓLO ejecuta E2E (tests/e2e). Los specs Vitest viven aparte.
export default defineConfig({
  testDir: "./tests/e2e",
  // NO PARALELIZAR (ni "optimizar" esto): `matches` es un catálogo GLOBAL sin
  // league_id — cualquier partido sembrado lo ven TODOS los tests y altera la
  // pestaña por defecto y la "jornada en curso" (00-contexto.md §7.1). La BD
  // de test es compartida: la suite debe correr secuencial con 1 worker.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // SSR/Realtime locales pueden tardar: margen global para los expect()
  // (los tests @realtime usan timeouts explícitos aún mayores).
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  // App mobile-first: la suite corre sobre viewport móvil con motor Chromium
  // (único navegador instalado, en línea con el pipeline de CI). Los tests
  // etiquetados @desktop corren SOLO en el proyecto desktop-chromium.
  projects: [
    {
      name: "mobile-chromium",
      grepInvert: /@desktop/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "desktop-chromium",
      grep: /@desktop/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

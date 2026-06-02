import { defineConfig, devices } from "@playwright/test";

// Puerto dedicado para E2E (evita el 3000, que en este entorno puede estar
// ocupado por el backend de Docker Desktop).
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

// Playwright SÓLO ejecuta E2E (tests/e2e). Los specs Vitest viven aparte.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  // App mobile-first: el smoke test corre sobre un viewport móvil con motor
  // Chromium (único navegador instalado, en línea con el pipeline de CI).
  projects: [
    {
      name: "mobile-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
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

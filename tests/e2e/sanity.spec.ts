import { test, expect } from "@playwright/test";

// Smoke test E2E sobre viewport móvil: verifica que la UI carga.
// No valida lógica de negocio (eso llega en stories posteriores); sólo
// confirma que la app sirve la página inicial correctamente.
test("la página inicial carga en viewport móvil", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveTitle(/.+/);
  await expect(page.locator("body")).toBeVisible();
});

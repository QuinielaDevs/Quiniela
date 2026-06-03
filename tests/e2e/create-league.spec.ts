import { test, expect } from "@playwright/test";

// Story 1.3 — smoke E2E (móvil) de la ruta de creación de liga.
// No autentica (el login con OAuth no es trivial en E2E); valida que la ruta
// existe y que su guardia de sesión redirige al login a un usuario anónimo.
test("/leagues/new redirige al login sin sesión", async ({ page }) => {
  await page.goto("/leagues/new");
  await expect(page).toHaveURL(/\/auth\/login/);
});

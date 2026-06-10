// Helpers de interacción UI compartidos (Fase 1 del plan E2E).

import { expect, type Page } from "@playwright/test";

/**
 * Selecciona un tab de fase/jornada por su nombre accesible.
 *
 * Estabilización deliberada (NO debilita asserts): en `next dev`, justo tras
 * un goto, la toma de control del router cliente puede duplicar el tablist en
 * el DOM durante unos milisegundos (observado de forma intermitente en la
 * suite: dos tabs idénticos, ambos aria-selected, que se asientan en uno).
 * `toHaveCount(1)` reintenta hasta que el DOM se asienta — y FALLA fuerte si
 * la duplicación fuera permanente (eso sí sería un bug de producto).
 */
export async function selectPhaseTab(page: Page, name: string): Promise<void> {
  const tab = page.getByRole("tab", { name, exact: true });
  await expect(tab).toHaveCount(1);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

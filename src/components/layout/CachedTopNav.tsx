"use client";

import { TopNav } from "@/components/layout/TopNav";

/**
 * Valor por defecto que se muestra cuando no hay liga activa o los datos
 * aun no se han resuelto. Coincide con DEFAULT_HEADER_WORD de header-word.ts
 * pero se repite aqui para evitar traer dependencias de servidor al bundle cliente.
 */
const DEFAULT = "PIJA";

/**
 * Cache a nivel de modulo que sobrevive ciclos de Suspense (mount/unmount del
 * fallback). Cuando el servidor resuelve la palabra real de la liga, la guardamos
 * aqui. En el siguiente ciclo de Suspense, el fallback usa este valor cacheado en
 * lugar de "PIJA", eliminando el parpadeo en navegaciones y router.refresh().
 */
let cachedWord = "";

export function CachedTopNav({ brandWord }: { brandWord: string }) {
  if (brandWord && brandWord !== DEFAULT) {
    cachedWord = brandWord;
  }

  return <TopNav brandWord={cachedWord || brandWord} />;
}

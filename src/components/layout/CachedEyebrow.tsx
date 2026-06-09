"use client";

/**
 * Valor por defecto — coincide con DEFAULT_HEADER_WORD. Repetido aqui para
 * mantener este componente libre de dependencias de servidor.
 */
const DEFAULT = "PIJA";

/**
 * Cache a nivel de modulo que sobrevive ciclos de Suspense. Igual mecanismo
 * que CachedTopNav pero para el eyebrow movil (lg:hidden).
 */
let cachedWord = "";

export function CachedEyebrow({ word }: { word: string }) {
  if (word && word !== DEFAULT) {
    cachedWord = word;
  }

  return (
    <p className="font-display text-xs font-semibold uppercase tracking-wide text-accent lg:hidden">
      {cachedWord || word} Quiniela
    </p>
  );
}

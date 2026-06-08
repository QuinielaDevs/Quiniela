import { Suspense } from "react";

import { DEFAULT_HEADER_WORD, getActiveHeaderWord } from "@/utils/header-word";

// "Eyebrow" móvil del encabezado: «{palabra} Quiniela» en mayúsculas, oculto en
// desktop (la marca la lleva el TopNav). Resuelve la liga activa (acceso a
// cookies) → el trabajo async va dentro de <Suspense>; el fallback usa la marca
// por defecto para que el texto aparezca al instante y se refine al hidratar.
function Eyebrow({ word }: { word: string }) {
  return (
    <p className="font-display text-xs font-semibold uppercase tracking-wide text-accent lg:hidden">
      {word} Quiniela
    </p>
  );
}

async function ResolvedEyebrow() {
  const word = await getActiveHeaderWord();
  return <Eyebrow word={word} />;
}

export function BrandEyebrow() {
  return (
    <Suspense fallback={<Eyebrow word={DEFAULT_HEADER_WORD} />}>
      <ResolvedEyebrow />
    </Suspense>
  );
}

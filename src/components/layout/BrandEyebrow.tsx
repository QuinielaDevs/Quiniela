import { Suspense } from "react";

import { CachedEyebrow } from "@/components/layout/CachedEyebrow";
import { DEFAULT_HEADER_WORD, getActiveHeaderWord } from "@/utils/header-word";

// "Eyebrow" móvil del encabezado: «{palabra} Quiniela» en mayúsculas, oculto en
// desktop (la marca la lleva el TopNav). Resuelve la liga activa (acceso a
// cookies) → el trabajo async va dentro de <Suspense>.
// CachedEyebrow recuerda la ultima palabra resuelta en un cache a nivel de modulo,
// evitando que el fallback muestre "PIJA" en navegaciones y router.refresh().
async function ResolvedEyebrow() {
  const word = await getActiveHeaderWord();
  return <CachedEyebrow word={word} />;
}

export function BrandEyebrow() {
  return (
    <Suspense fallback={<CachedEyebrow word={DEFAULT_HEADER_WORD} />}>
      <ResolvedEyebrow />
    </Suspense>
  );
}

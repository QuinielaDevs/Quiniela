import { Suspense } from "react";

import { CachedTopNav } from "@/components/layout/CachedTopNav";
import { DEFAULT_HEADER_WORD, getActiveHeaderWord } from "@/utils/header-word";

// Variante servidor de TopNav que resuelve la marca de la liga activa. El acceso
// a cookies (vía getActiveHeaderWord) es dinámico → va dentro de <Suspense>.
// CachedTopNav recuerda la ultima palabra resuelta en un cache a nivel de modulo,
// evitando que el fallback muestre "PIJA" en navegaciones y router.refresh().
async function TopNavWithBrand() {
  const brandWord = await getActiveHeaderWord();
  return <CachedTopNav brandWord={brandWord} />;
}

export function AppTopNav() {
  return (
    <Suspense fallback={<CachedTopNav brandWord={DEFAULT_HEADER_WORD} />}>
      <TopNavWithBrand />
    </Suspense>
  );
}

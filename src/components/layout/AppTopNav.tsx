import { Suspense } from "react";

import { TopNav } from "@/components/layout/TopNav";
import { DEFAULT_HEADER_WORD, getActiveHeaderWord } from "@/utils/header-word";

// Variante servidor de TopNav que resuelve la marca de la liga activa. El acceso
// a cookies (vía getActiveHeaderWord) es dinámico → va dentro de <Suspense>; el
// fallback muestra el nav con la marca por defecto para evitar layout shift.
async function TopNavWithBrand() {
  const brandWord = await getActiveHeaderWord();
  return <TopNav brandWord={brandWord} />;
}

export function AppTopNav() {
  return (
    <Suspense fallback={<TopNav brandWord={DEFAULT_HEADER_WORD} />}>
      <TopNavWithBrand />
    </Suspense>
  );
}

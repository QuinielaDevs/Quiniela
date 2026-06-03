import { Suspense } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/utils/supabase/server";
import { LoginForm } from "@/components/login-form";

/**
 * Entrada de la app. Si hay sesión activa redirige al área autenticada; si no,
 * muestra el login. El acceso a cookies (`getClaims`) es un dato dinámico, así
 * que vive en este hijo async dentro de <Suspense> (requisito de
 * `cacheComponents` en Next 16).
 */
async function HomeEntry() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (data?.claims) {
    redirect("/protected");
  }

  return <LoginForm next="/protected" />;
}

export default function Home() {
  return (
    <main className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Suspense
          fallback={<div className="h-12 animate-pulse rounded-sm bg-muted" />}
        >
          <HomeEntry />
        </Suspense>
      </div>
    </main>
  );
}

import { Suspense } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/utils/supabase/server";
import { LeagueCreateForm } from "@/components/leagues/LeagueCreateForm";

/**
 * Verifica la sesión y renderiza el formulario. Vive en un componente async
 * separado porque `getClaims()` lee cookies (dato dinámico): con
 * `cacheComponents` (Next 16) ese acceso debe ocurrir dentro de un <Suspense>,
 * o el prerender estático falla con "Uncached data accessed outside <Suspense>".
 */
async function NewLeagueContent() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  return <LeagueCreateForm />;
}

/**
 * Panel de creación de liga (Story 1.3). Contenedor mobile-first `max-w-md`
 * centrado (UX-DR-1). El header es estático; la parte dinámica (sesión +
 * formulario) se aísla tras un <Suspense>.
 */
export default function NewLeaguePage() {
  return (
    <main className="flex min-h-screen justify-center px-4 py-6">
      <div className="w-full max-w-md">
        <header className="mb-6">
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-accent">
            Crear nueva liga
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configura las reglas de tu quiniela. Quedarás registrado como
            administrador.
          </p>
        </header>
        <Suspense
          fallback={
            <div className="h-12 animate-pulse rounded-sm bg-muted" />
          }
        >
          <NewLeagueContent />
        </Suspense>
      </div>
    </main>
  );
}

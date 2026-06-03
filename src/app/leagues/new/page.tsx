import { redirect } from "next/navigation";

import { createClient } from "@/utils/supabase/server";
import { LeagueCreateForm } from "@/components/leagues/LeagueCreateForm";

/**
 * Panel de creación de liga (Story 1.3). Server Component: verifica sesión
 * antes de renderizar y, si no hay, redirige al login. El formulario en sí es
 * un client component. Contenedor mobile-first `max-w-md` centrado (UX-DR-1).
 */
export default async function NewLeaguePage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

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
        <LeagueCreateForm />
      </div>
    </main>
  );
}

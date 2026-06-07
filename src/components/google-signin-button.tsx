"use client";

import { createClient } from "@/utils/supabase/client";
import { Button } from "@/components/ui/button";
import { getSafeNextPath } from "@/utils/redirect";
import { useState } from "react";

/**
 * Botón "Continuar con Google".
 * Dispara el flujo OAuth de Supabase; el callback (src/app/auth/callback)
 * intercambia el código por una sesión basada en cookies (SSR).
 *
 * Nota: el flujo real requiere credenciales de Google configuradas
 * (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). En local sin credenciales el
 * botón existe pero el proveedor devolverá error hasta configurarlas.
 */
export function GoogleSignInButton({ next = "/predictions" }: { next?: string }) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    const supabase = createClient();
    setIsLoading(true);
    setError(null);
    const safeNext = getSafeNextPath(next);

    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
      safeNext,
    )}`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) {
      setError(error.message);
      setIsLoading(false);
    }
    // En el camino feliz, signInWithOAuth redirige el navegador a Google.
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        size="xl"
        className="w-full"
        onClick={handleGoogleSignIn}
        disabled={isLoading}
      >
        {isLoading ? "Redirigiendo…" : "Continuar con Google"}
      </Button>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

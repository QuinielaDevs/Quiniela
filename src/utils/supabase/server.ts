import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Especially important if using Fluid compute: Don't put this client in a
 * global variable. Always create a new client within each function when using
 * it.
 *
 * Comportamiento de cookies:
 *   - Server Components: `cookies().set()` funciona y se propaga al response
 *     (las guardas silenciosas en `setAll` lo reflejan).
 *   - Route Handlers: `cookies().set()` también funciona, pero el caller debe
 *     copiar manualmente las cookies del cookie store al `NextResponse` que
 *     retorna (ver `src/app/auth/callback/route.ts` como referencia).
 *   - En dev (`NODE_ENV=development`): se sobreescribe `secure: false` en las
 *     cookies de sesión para que el browser las acepte en `http://`. Esto NO
 *     afecta producción porque la condición evalúa `NODE_ENV` en runtime.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(
                name,
                value,
                process.env.NODE_ENV === "development"
                  ? { ...options, secure: false }
                  : options,
              ),
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have proxy refreshing
            // user sessions.
          }
        },
      },
    },
  );
}

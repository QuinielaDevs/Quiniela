import { createServerClient } from "@supabase/ssr";
import { getSafeNextPath } from "@/utils/redirect";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Callback de OAuth (p. ej. Google).
 * Supabase redirige aquí con un `code` de autorización; lo intercambiamos por
 * una sesión persistida en cookies (SSR) y luego redirigimos a `next`.
 *
 * Importante: en Route Handlers, las cookies que escribe `exchangeCodeForSession`
 * NO se adjuntan solas al response. El patrón robusto es atar el cliente Supabase
 * directamente al `NextResponse.redirect()` que vamos a devolver, de modo que
 * `setAll` escriba las cookies (CON todas sus opciones: Max-Age, HttpOnly,
 * SameSite, Path) sobre ese response. Copiar a mano sólo name/value pierde esas
 * opciones y deja la sesión como cookie de sesión, sin endurecer.
 *
 * En dev (`NODE_ENV=development`) forzamos `secure:false` para que el browser
 * acepte las cookies sobre `http://`.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = getSafeNextPath(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(
      `${origin}/auth/error?error=${encodeURIComponent("No authorization code provided")}`,
    );
  }

  const response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          const safeOptions =
            process.env.NODE_ENV === "development" ? { secure: false } : {};
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, { ...options, ...safeOptions }),
          );
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${origin}/auth/error?error=${encodeURIComponent(error.message)}`,
    );
  }

  return response;
}

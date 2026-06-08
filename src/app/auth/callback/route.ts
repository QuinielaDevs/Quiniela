import { createClient } from "@/utils/supabase/server";
import { getSafeNextPath } from "@/utils/redirect";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Callback de OAuth (p. ej. Google).
 * Supabase redirige aquí con un `code` de autorización; lo intercambiamos por
 * una sesión persistida en cookies (SSR) y luego redirigimos a `next`.
 *
 * Importante: en Route Handlers, `cookies().set()` (vía `createClient`) acumula
 * las cookies en el cookie store del request. Tras `exchangeCodeForSession`,
 * copiamos explícitamente TODAS las cookies del store al `NextResponse.redirect()`
 * para que el browser las reciba en los `Set-Cookie` headers. Sin esta copia,
 * la sesión no se persiste.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = getSafeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const cookieStore = await cookies();
      const redirect = NextResponse.redirect(`${origin}${next}`);
      cookieStore.getAll().forEach((c) =>
        redirect.cookies.set(c.name, c.value),
      );
      return redirect;
    }
    return NextResponse.redirect(
      `${origin}/auth/error?error=${encodeURIComponent(error.message)}`,
    );
  }

  return NextResponse.redirect(
    `${origin}/auth/error?error=${encodeURIComponent("No authorization code provided")}`,
  );
}

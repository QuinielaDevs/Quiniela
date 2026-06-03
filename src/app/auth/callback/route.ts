import { createClient } from "@/utils/supabase/server";
import { getSafeNextPath } from "@/utils/redirect";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Callback de OAuth (p. ej. Google).
 * Supabase redirige aquí con un `code` de autorización; lo intercambiamos por
 * una sesión persistida en cookies (SSR) y luego redirigimos a `next`.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = getSafeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(
      `${origin}/auth/error?error=${encodeURIComponent(error.message)}`,
    );
  }

  return NextResponse.redirect(
    `${origin}/auth/error?error=${encodeURIComponent("No authorization code provided")}`,
  );
}

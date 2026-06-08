import { createClient } from "@/utils/supabase/server";
import { getActiveLeagueMembership } from "@/utils/active-league";

/** Marca por defecto cuando no hay liga activa (sesión nueva, sin membresías). */
export const DEFAULT_HEADER_WORD = "PIJA";

/**
 * Resuelve la primera palabra del encabezado («{word} Quiniela») según la liga
 * activa del usuario. Lee cookies vía createClient → debe consumirse dentro de
 * un <Suspense> (cacheComponents). Si no hay sesión o liga, devuelve "PIJA".
 */
export async function getActiveHeaderWord(): Promise<string> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return DEFAULT_HEADER_WORD;

  const membership = await getActiveLeagueMembership({ supabase, userId });
  return membership?.league?.headerWord || DEFAULT_HEADER_WORD;
}

"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/utils/supabase/server";
import {
  setMatchResultSchema,
  type SetMatchResultInput,
} from "@/app/actions/matches.schema";
import {
  ADMIN_NOT_AUTHORIZED_ERROR,
  ADMIN_SAVE_ERROR,
} from "@/app/actions/leagues.constants";
import type { Match, ServerActionResult } from "@/types";

/** Código Postgres de privilegio insuficiente (no autenticado / no admin). */
const INSUFFICIENT_PRIVILEGE = "42501";

/** Mapea un error del RPC a un mensaje de UI seguro (no filtra detalles). */
function toAdminError(error: { code?: string | null } | null): string {
  return error?.code === INSUFFICIENT_PRIVILEGE
    ? ADMIN_NOT_AUTHORIZED_ERROR
    : ADMIN_SAVE_ERROR;
}

/**
 * Fija marcador + estado de un partido (Story 7.2 — AC #2, #4). El RPC
 * `fn_admin_set_match_result` (SECURITY DEFINER) valida que el llamante sea admin
 * de alguna liga (matches es catálogo global), los marcadores, la transición de
 * estado y bloquea knockout TBD. NUNCA propaga excepciones; revalida la tabla de
 * posiciones y el panel de gestión. El UPDATE se propaga solo a la tabla en vivo
 * (Epic 4) vía Realtime, y `buildStandings` incorpora los `finished` on-the-fly.
 */
export async function setMatchResult(
  input: SetMatchResultInput,
): Promise<ServerActionResult<Match>> {
  try {
    const parsed = setMatchResultSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        data: null,
        error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
      };
    }

    const { matchId, homeScore, awayScore, status } = parsed.data;

    const supabase = await createClient();
    // El RPC tipa los marcadores como `number` (no nullable). Para los estados
    // sin marcador (scheduled/suspended/canceled) enviamos 0; el RPC los persiste
    // como NULL igual. Para live/finished el schema ya garantizó que no son null.
    const { data, error } = await supabase
      .rpc("fn_admin_set_match_result", {
        p_match_id: matchId,
        p_home_score: homeScore ?? 0,
        p_away_score: awayScore ?? 0,
        p_status: status,
      })
      .single();

    if (error) {
      return { success: false, data: null, error: toAdminError(error) };
    }

    revalidatePath("/standings");
    revalidatePath("/standings/manage");
    return { success: true, data: data as Match, error: null };
  } catch {
    return { success: false, data: null, error: ADMIN_SAVE_ERROR };
  }
}

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
import { calculateTournamentAdvancement } from "@/utils/tournament-advancement";
import type { Match, ServerActionResult } from "@/types";

/** Código Postgres de privilegio insuficiente (no autenticado / no admin). */
const INSUFFICIENT_PRIVILEGE = "42501";

/** Mapea un error del RPC a un mensaje de UI seguro (no filtra detalles). */
function toAdminError(error: { code?: string | null } | null): string {
  return error?.code === INSUFFICIENT_PRIVILEGE
    ? ADMIN_NOT_AUTHORIZED_ERROR
    : ADMIN_SAVE_ERROR;
}

const MATCH_ADVANCEMENT_SELECT =
  "id, external_ref, home_team, away_team, home_team_code, away_team_code, home_score, away_score, penalties_home_score, penalties_away_score, match_time, status, matchday, stage, group_label, bracket_slot, home_source, away_source, venue";
const ADVANCEMENT_WARNING =
  "Resultado guardado. No se pudo actualizar el bracket automáticamente; intenta recalcular el avance nuevamente.";

function revalidateMatchSurfaces(): void {
  revalidatePath("/standings");
  revalidatePath("/standings/manage");
  revalidatePath("/predictions");
  revalidatePath("/live");
}

/**
 * Recalcula el avance del Mundial 2026 desde `public.matches` y aplica los
 * equipos reales a slots knockout. El algoritmo es puro en TS; este wrapper solo
 * carga datos y persiste por RPC admin-gated. NUNCA propaga excepciones.
 */
export async function recalculateTournamentAdvancement(): Promise<
  ServerActionResult<null>
> {
  try {
    const supabase = await createClient();
    const { data: matches, error: matchesError } = await supabase
      .from("matches")
      .select(MATCH_ADVANCEMENT_SELECT)
      .like("external_ref", "2026-%")
      .order("match_time", { ascending: true });

    if (matchesError) {
      return { success: false, data: null, error: ADMIN_SAVE_ERROR };
    }

    const advancement = calculateTournamentAdvancement((matches ?? []) as Match[]);
    const slotsPayload = advancement.knockoutSlots.map((slot) => ({
      bracket_slot: slot.bracketSlot,
      home_team: slot.homeTeam,
      away_team: slot.awayTeam,
      home_team_code: slot.homeTeamCode,
      away_team_code: slot.awayTeamCode,
    }));

    const { error: applyError } = await supabase.rpc(
      "fn_admin_apply_knockout_advancement",
      { p_slots: slotsPayload },
    );
    if (applyError) {
      return { success: false, data: null, error: toAdminError(applyError) };
    }

    revalidateMatchSurfaces();
    return { success: true, data: null, error: null };
  } catch {
    return { success: false, data: null, error: ADMIN_SAVE_ERROR };
  }
}

/**
 * Fija marcador + estado de un partido (Story 7.2 — AC #2, #4). El RPC
 * `fn_admin_set_match_result` (SECURITY DEFINER) valida que el llamante sea admin
 * de alguna liga (matches es catálogo global), los marcadores, la transición de
 * estado y bloquea knockout TBD. NUNCA propaga excepciones; revalida la tabla de
 * posiciones, el panel de gestión, pronósticos y live. Tras un guardado exitoso
 * recalcula Story 7.3 para llenar equipos reales del bracket knockout.
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

    const { matchId, homeScore, awayScore, status, penaltiesHomeScore, penaltiesAwayScore } = parsed.data;

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
        p_penalties_home_score: penaltiesHomeScore ?? null,
        p_penalties_away_score: penaltiesAwayScore ?? null,
      })
      .single();

    if (error) {
      return { success: false, data: null, error: toAdminError(error) };
    }

    const advancement = await recalculateTournamentAdvancement();
    if (!advancement.success) {
      revalidateMatchSurfaces();
      return {
        success: true,
        data: data as Match,
        error: null,
        warning: ADVANCEMENT_WARNING,
      };
    }

    revalidateMatchSurfaces();
    return { success: true, data: data as Match, error: null };
  } catch {
    return { success: false, data: null, error: ADMIN_SAVE_ERROR };
  }
}

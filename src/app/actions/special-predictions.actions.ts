"use server";

import { revalidatePath } from "next/cache";

import { resolvePhase } from "@/utils/awardsScoring";
import { createClient } from "@/utils/supabase/server";
import type {
  AwardCategory,
  ServerActionResult,
  SpecialPrediction,
} from "@/types";

/**
 * Guarda (crea o actualiza) la predicción de premio del usuario para una liga y
 * categoría. Es la primera Server Action del proyecto: retorna siempre el sobre
 * canónico ServerActionResult<T> y nunca propaga excepciones al cliente.
 *
 * Las predicciones son POR LIGA: la clave de conflicto es (user_id, league_id,
 * category). NO enviamos predicted_at — lo controla el servidor (default now())
 * y el trigger tr_touch_special_prediction lo refresca al cambiar de candidato.
 *
 * La autorización real (que la fila sea del usuario y que pertenezca a la liga)
 * la impone RLS en la BD; aquí solo resolvemos el usuario de la sesión.
 */
export async function saveSpecialPrediction(
  leagueId: string,
  category: AwardCategory,
  candidateId: string,
): Promise<ServerActionResult<SpecialPrediction>> {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(leagueId)) {
    return { success: false, data: null, error: "ID de liga inválido" };
  }
  if (!uuidRegex.test(candidateId)) {
    return { success: false, data: null, error: "ID de candidato inválido" };
  }
  if (category !== "champion" && category !== "top_scorer" && category !== "mvp") {
    return { success: false, data: null, error: "Categoría de premio inválida" };
  }

  // Comprobación de tiempo en el servidor: si editsLocked = true, rechazar
  try {
    const currentPhase = resolvePhase(new Date());
    if (currentPhase.editsLocked) {
      return {
        success: false,
        data: null,
        error: "Las predicciones de premios especiales están bloqueadas en esta fase del torneo.",
      };
    }
  } catch (phaseErr) {
    const phaseMsg = phaseErr instanceof Error ? phaseErr.message : "Error al validar la fase del torneo";
    return { success: false, data: null, error: phaseMsg };
  }

  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, data: null, error: "No autenticado" };
    }

    const { data, error } = await supabase
      .from("special_predictions")
      .upsert(
        {
          user_id: user.id,
          league_id: leagueId,
          category,
          candidate_id: candidateId,
        },
        { onConflict: "user_id,league_id,category" },
      )
      .select()
      .single();

    if (error) {
      return { success: false, data: null, error: error.message };
    }

    revalidatePath("/awards");
    return { success: true, data, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error inesperado al guardar";
    return { success: false, data: null, error: message };
  }
}

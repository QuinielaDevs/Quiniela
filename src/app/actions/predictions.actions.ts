"use server";

import { createClient } from "@/utils/supabase/server";
import {
  savePredictionSchema,
  type SavePredictionInput,
} from "@/app/actions/predictions.schema";
import {
  PREDICTION_LOCKED_ERROR,
  SAVE_ERROR,
  TRANSIENT_SAVE_ERROR,
} from "@/app/actions/predictions.constants";
import type { Prediction, ServerActionResult } from "@/types";

type SupabaseErrorLike = {
  code?: string | null;
  message?: string | null;
  status?: number | null;
};

// El partido cerró por kickoff: la RPC lanza 'Pronostico cerrado' con errcode
// P0001. Es DEFINITIVO (no entra en la cola offline/retry de 2.3).
function isPredictionLockedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as SupabaseErrorLike;
  const message = (maybeError.message ?? "").toLowerCase();
  return maybeError.code === "P0001" || message.includes("cerrado");
}

function isTransientSaveError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const maybeError = error as SupabaseErrorLike;
  if (typeof maybeError.status === "number" && maybeError.status >= 500) {
    return true;
  }

  const message =
    error instanceof Error ? error.message : (maybeError.message ?? "");
  const normalized = message.toLowerCase();

  return [
    "fetch failed",
    "network",
    "timeout",
    "timed out",
    "connection",
    "econn",
    "socket",
    "gateway",
    "temporarily",
    "aborted",
  ].some((needle) => normalized.includes(needle));
}

function toSafeSaveError(error?: unknown): string {
  return isTransientSaveError(error) ? TRANSIENT_SAVE_ERROR : SAVE_ERROR;
}

/**
 * Guarda (crea/actualiza) la predicción del usuario autenticado vía la RPC
 * segura `fn_save_prediction` (Story 2.4): el backend valida usuario, pertenencia,
 * scores y kickoff, y calcula/persiste el `multiplier` con `now()` del servidor.
 * El cliente NUNCA envía `multiplier` ni `user_id`. NUNCA propaga excepciones.
 */
export async function savePrediction(
  input: SavePredictionInput,
): Promise<ServerActionResult<Prediction>> {
  try {
    const parsed = savePredictionSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        data: null,
        error: parsed.error.issues[0]?.message ?? "Datos invalidos.",
      };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("fn_save_prediction", {
        p_league_id: parsed.data.leagueId,
        p_match_id: parsed.data.matchId,
        p_home_score_pred: parsed.data.homeScorePred,
        p_away_score_pred: parsed.data.awayScorePred,
      })
      .single();

    if (error) {
      if (isPredictionLockedError(error)) {
        return { success: false, data: null, error: PREDICTION_LOCKED_ERROR };
      }
      return { success: false, data: null, error: toSafeSaveError(error) };
    }

    return { success: true, data: data as Prediction, error: null };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: toSafeSaveError(error),
    };
  }
}

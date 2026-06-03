"use server";

import { createClient } from "@/utils/supabase/server";
import {
  savePredictionSchema,
  type SavePredictionInput,
} from "@/app/actions/predictions.schema";
import {
  SAVE_ERROR,
  TRANSIENT_SAVE_ERROR,
} from "@/app/actions/predictions.constants";
import type { Prediction, ServerActionResult } from "@/types";

const UNIQUE_VIOLATION = "23505";
const AUTH_ERROR = "Debes iniciar sesion para guardar tu prediccion.";

type SupabaseErrorLike = {
  code?: string | null;
  message?: string | null;
  status?: number | null;
};

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

async function updateExistingPrediction(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: ReturnType<typeof savePredictionSchema.parse>,
  userId: string,
): Promise<{ data: Prediction | null; error: SupabaseErrorLike | null }> {
  const { data, error } = await supabase
    .from("predictions")
    .update({
      home_score_pred: input.homeScorePred,
      away_score_pred: input.awayScorePred,
    })
    .eq("league_id", input.leagueId)
    .eq("match_id", input.matchId)
    .eq("user_id", userId)
    .select()
    .maybeSingle();

  return {
    data: data as Prediction | null,
    error,
  };
}

async function insertPrediction(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: ReturnType<typeof savePredictionSchema.parse>,
  userId: string,
): Promise<{ data: Prediction | null; error: SupabaseErrorLike | null }> {
  const { data, error } = await supabase
    .from("predictions")
    .insert({
      league_id: input.leagueId,
      match_id: input.matchId,
      user_id: userId,
      home_score_pred: input.homeScorePred,
      away_score_pred: input.awayScorePred,
    })
    .select()
    .single();

  return {
    data: data as Prediction | null,
    error,
  };
}

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
    const { data: userData, error: userError } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    if (userError || !userId) {
      return { success: false, data: null, error: AUTH_ERROR };
    }

    const updated = await updateExistingPrediction(
      supabase,
      parsed.data,
      userId,
    );
    if (updated.error) {
      return {
        success: false,
        data: null,
        error: toSafeSaveError(updated.error),
      };
    }
    if (updated.data) {
      return { success: true, data: updated.data, error: null };
    }

    const inserted = await insertPrediction(supabase, parsed.data, userId);
    if (!inserted.error && inserted.data) {
      return { success: true, data: inserted.data, error: null };
    }

    if (inserted.error?.code === UNIQUE_VIOLATION) {
      const retried = await updateExistingPrediction(
        supabase,
        parsed.data,
        userId,
      );
      if (!retried.error && retried.data) {
        return { success: true, data: retried.data, error: null };
      }
      return {
        success: false,
        data: null,
        error: toSafeSaveError(retried.error),
      };
    }

    return {
      success: false,
      data: null,
      error: toSafeSaveError(inserted.error),
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: toSafeSaveError(error),
    };
  }
}

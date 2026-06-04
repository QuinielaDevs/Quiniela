"use server";

import { createClient } from "@/utils/supabase/server";
import {
  createChallengeSchema,
  type CreateChallengeInput,
} from "@/app/actions/duels.schema";
import type { ServerActionResult } from "@/types";

type SupabaseErrorLike = {
  code?: string | null;
  message?: string | null;
  status?: number | null;
};

function getDuelsErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "Error inesperado al crear el desafío.";

  const err = error as SupabaseErrorLike;
  const message = (err.message ?? "").toLowerCase();

  // Mapeo por código SQL State
  if (err.code === "P0003") {
    return "Saldo de puntos insuficiente para crear el desafío.";
  }
  if (err.code === "P0001") {
    return "La apuesta debe ser mayor que cero.";
  }
  if (err.code === "42501") {
    return "No tienes permisos o no eres miembro de la liga.";
  }

  // Mapeo por mensaje de error
  if (message.includes("rival para un duelo directo")) {
    return "Debe especificar un rival para un duelo directo.";
  }
  if (message.includes("retarte a ti mismo")) {
    return "No puedes retarte a ti mismo.";
  }
  if (message.includes("rival no es miembro")) {
    return "El rival seleccionado no es miembro de la liga.";
  }
  if (message.includes("apuesta debe ser mayor que cero")) {
    return "La apuesta debe ser mayor que cero.";
  }
  if (message.includes("insuficiente")) {
    return "Saldo de puntos insuficiente para crear el desafío.";
  }

  return err.message ?? "Error inesperado al crear el desafío.";
}

/**
 * Server Action que invoca la función RPC create_challenge para crear un duelo de forma atómica.
 */
export async function createChallenge(
  input: CreateChallengeInput,
): Promise<ServerActionResult<string>> {
  try {
    const parsed = createChallengeSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        data: null,
        error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
      };
    }

    const supabase = await createClient();

    const { data: challengeId, error } = await supabase.rpc("create_challenge", {
      p_league_id: parsed.data.leagueId,
      p_match_id: parsed.data.matchId,
      p_points_bet: parsed.data.pointsBet,
      p_type: parsed.data.type,
      p_challenged_id: parsed.data.challengedId || null,
      p_prediction_home: parsed.data.predictionHome,
      p_prediction_away: parsed.data.predictionAway,
    });

    if (error) {
      return {
        success: false,
        data: null,
        error: getDuelsErrorMessage(error),
      };
    }

    return {
      success: true,
      data: challengeId as string,
      error: null,
    };
  } catch (e) {
    return {
      success: false,
      data: null,
      error: e instanceof Error ? e.message : "Error de red al crear el desafío.",
    };
  }
}

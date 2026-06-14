"use server";

import { createClient } from "@/utils/supabase/server";
import {
  createChallengeSchema,
  acceptChallengeSchema,
  challengeIdSchema,
  type CreateChallengeInput,
  type AcceptChallengeInput,
  type ChallengeIdInput,
} from "@/app/actions/duels.schema";
import type { ServerActionResult } from "@/types";

type SupabaseErrorLike = {
  code?: string | null;
  message?: string | null;
  status?: number | null;
};

function getDuelsErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "Error inesperado en la operación.";

  const err = error as SupabaseErrorLike;
  const message = (err.message ?? "").toLowerCase();

  // Mapeo por código SQL State
  if (err.code === "P0001") {
    return "La apuesta debe ser mayor que cero.";
  }
  if (err.code === "P0003") {
    return "Saldo de puntos insuficiente para este desafío.";
  }
  if (err.code === "P0004") {
    return "El partido ya comenzó; este desafío ya no admite aceptaciones.";
  }
  if (err.code === "P0005") {
    return "El desafío ya no se encuentra pendiente.";
  }
  if (err.code === "P0006") {
    return "No puedes cancelar un pozo que ya tiene participantes.";
  }
  if (err.code === "42501") {
    return "No estás autorizado para realizar esta acción o no eres miembro de la liga.";
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
    return "Saldo de puntos insuficiente para este desafío.";
  }

  return err.message ?? "Error inesperado en la operación.";
}

/**
 * Server Action que invoca la función RPC create_challenge para crear un duelo de forma atómica.
 */
export async function createChallenge(
  input: CreateChallengeInput,
): Promise<ServerActionResult<string>> {
  if (process.env.NEXT_PUBLIC_ENABLE_DUELS !== "true") {
    return {
      success: false,
      data: null,
      error: "La funcionalidad de duelos está desactivada temporalmente.",
    };
  }
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

/**
 * Server Action que invoca la función RPC accept_challenge para aceptar un duelo de forma atómica.
 */
export async function acceptChallenge(
  input: AcceptChallengeInput,
): Promise<ServerActionResult<void>> {
  if (process.env.NEXT_PUBLIC_ENABLE_DUELS !== "true") {
    return {
      success: false,
      data: null,
      error: "La funcionalidad de duelos está desactivada temporalmente.",
    };
  }
  try {
    const parsed = acceptChallengeSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        data: null,
        error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
      };
    }

    const supabase = await createClient();

    const { error } = await supabase.rpc("accept_challenge", {
      p_challenge_id: parsed.data.challengeId,
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
      data: null,
      error: null,
    };
  } catch (e) {
    return {
      success: false,
      data: null,
      error: e instanceof Error ? e.message : "Error de red al aceptar el desafío.",
    };
  }
}

/**
 * Server Action que invoca la función RPC reject_challenge para rechazar un duelo.
 */
export async function rejectChallenge(
  input: ChallengeIdInput,
): Promise<ServerActionResult<void>> {
  if (process.env.NEXT_PUBLIC_ENABLE_DUELS !== "true") {
    return {
      success: false,
      data: null,
      error: "La funcionalidad de duelos está desactivada temporalmente.",
    };
  }
  try {
    const parsed = challengeIdSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        data: null,
        error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
      };
    }

    const supabase = await createClient();

    const { error } = await supabase.rpc("reject_challenge", {
      p_challenge_id: parsed.data.challengeId,
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
      data: null,
      error: null,
    };
  } catch (e) {
    return {
      success: false,
      data: null,
      error: e instanceof Error ? e.message : "Error de red al rechazar el desafío.",
    };
  }
}

/**
 * Server Action que invoca la función RPC cancel_challenge para cancelar un desafío propio sin contraparte.
 */
export async function cancelChallenge(
  input: ChallengeIdInput,
): Promise<ServerActionResult<void>> {
  if (process.env.NEXT_PUBLIC_ENABLE_DUELS !== "true") {
    return {
      success: false,
      data: null,
      error: "La funcionalidad de duelos está desactivada temporalmente.",
    };
  }
  try {
    const parsed = challengeIdSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        data: null,
        error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
      };
    }

    const supabase = await createClient();

    const { error } = await supabase.rpc("cancel_challenge", {
      p_challenge_id: parsed.data.challengeId,
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
      data: null,
      error: null,
    };
  } catch (e) {
    return {
      success: false,
      data: null,
      error: e instanceof Error ? e.message : "Error de red al cancelar el desafío.",
    };
  }
}

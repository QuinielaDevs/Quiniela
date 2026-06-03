"use server";

import { createClient } from "@/utils/supabase/server";
import { generateInviteCode, INVITE_CODE_ALPHABET } from "@/utils/invite-code";
import { getJoinLeagueErrorMessage } from "@/utils/join-league-errors";
import {
  createLeagueSchema,
  type CreateLeagueInput,
} from "@/app/actions/leagues.schema";
import type { League, LeagueMember, ServerActionResult } from "@/types";

/** Código Postgres de violación de restricción unique (invite_code duplicado). */
const UNIQUE_VIOLATION = "23505";
/** Reintentos ante colisión de invite_code antes de rendirse. */
const MAX_INVITE_RETRIES = 5;
/** Longitud aceptada para códigos manuales o compartidos por enlace. */
const INVITE_CODE_MIN_LENGTH = 6;
const INVITE_CODE_MAX_LENGTH = 32;

function normalizeInviteCode(inviteCode: string): string | null {
  const normalized = inviteCode.trim().toUpperCase();
  if (
    normalized.length < INVITE_CODE_MIN_LENGTH ||
    normalized.length > INVITE_CODE_MAX_LENGTH
  ) {
    return null;
  }

  for (const char of normalized) {
    if (!INVITE_CODE_ALPHABET.includes(char)) return null;
  }

  return normalized;
}

/**
 * Crea una liga y registra al usuario actual como miembro admin, de forma
 * atómica vía el RPC `fn_create_league` (ver migración add_create_league_fn).
 * NUNCA lanza al cliente: siempre retorna un ServerActionResult.
 */
export async function createLeague(
  input: CreateLeagueInput,
): Promise<ServerActionResult<League>> {
  try {
    const parsed = createLeagueSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        data: null,
        error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
      };
    }
    const data = parsed.data;

    const supabase = await createClient();

    // Sólo se mandan los campos de pago si la liga los requiere; si no, se omiten
    // y el RPC los persiste como null (params con DEFAULT null).
    const paymentArgs = data.requiresPayment
      ? {
          p_payment_amount: data.paymentAmount ?? undefined,
          p_payment_instructions: data.paymentInstructions ?? undefined,
        }
      : {};

    let lastError: { code?: string; message: string } | null = null;

    for (let attempt = 0; attempt < MAX_INVITE_RETRIES; attempt++) {
      const { data: league, error } = await supabase
        .rpc("fn_create_league", {
          p_name: data.name,
          p_invite_code: generateInviteCode(),
          p_prediction_mode: data.predictionMode,
          p_requires_payment: data.requiresPayment,
          ...paymentArgs,
        })
        .single();

      if (!error) {
        return { success: true, data: league as League, error: null };
      }

      lastError = error;
      // Colisión de invite_code → regenerar y reintentar. Cualquier otro error
      // (RLS, no autenticado, red) es definitivo: salir del bucle.
      if (error.code !== UNIQUE_VIOLATION) break;
    }

    return {
      success: false,
      data: null,
      error: lastError?.message ?? "No se pudo crear la liga.",
    };
  } catch (e) {
    return {
      success: false,
      data: null,
      error: e instanceof Error ? e.message : "Error inesperado al crear la liga.",
    };
  }
}

/**
 * Une al usuario autenticado a una liga existente mediante invite_code.
 * La función SQL resuelve league_id y fuerza role/payment_status; esta acción
 * sólo normaliza/valida el código y traduce errores a ServerActionResult.
 */
export async function joinLeagueByInvite(
  inviteCode: string,
): Promise<ServerActionResult<LeagueMember>> {
  try {
    const normalizedInviteCode = normalizeInviteCode(inviteCode);
    if (!normalizedInviteCode) {
      return {
        success: false,
        data: null,
        error: "Código de invitación inválido.",
      };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("fn_join_league_by_invite", {
      p_invite_code: normalizedInviteCode,
    });

    if (error) {
      return {
        success: false,
        data: null,
        error: getJoinLeagueErrorMessage(error),
      };
    }

    return {
      success: true,
      data: data as LeagueMember,
      error: null,
    };
  } catch {
    return {
      success: false,
      data: null,
      error: "No pudimos unirte a la liga. Intenta de nuevo.",
    };
  }
}

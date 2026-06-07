"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/utils/supabase/server";
import { generateInviteCode, INVITE_CODE_ALPHABET } from "@/utils/invite-code";
import { getJoinLeagueErrorMessage } from "@/utils/join-league-errors";
import {
  createLeagueSchema,
  promoteMemberToAdminSchema,
  removeMemberSchema,
  setMemberPaymentStatusSchema,
  type CreateLeagueInput,
  type PromoteMemberToAdminInput,
  type RemoveMemberInput,
  type SetMemberPaymentStatusInput,
} from "@/app/actions/leagues.schema";
import {
  ADMIN_NOT_AUTHORIZED_ERROR,
  ADMIN_SAVE_ERROR,
} from "@/app/actions/leagues.constants";
import type { League, LeagueMember, ServerActionResult } from "@/types";

/** Código Postgres de privilegio insuficiente (no autenticado / no admin). */
const INSUFFICIENT_PRIVILEGE = "42501";

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

    if (lastError?.code === "23503") {
      return {
        success: false,
        data: null,
        error: "Tu perfil de usuario no ha sido inicializado completamente. Por favor, intenta cerrar sesión e iniciar sesión de nuevo.",
      };
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

/** Mapea un error del RPC a un mensaje de UI seguro y amigable. */
function toAdminError(error: { code?: string | null; message?: string | null } | null): string {
  if (!error) return ADMIN_SAVE_ERROR;

  if (error.code === INSUFFICIENT_PRIVILEGE) {
    if (error.message === "No autorizado" || error.message === "No autenticado") {
      return ADMIN_NOT_AUTHORIZED_ERROR;
    }
    return error.message ?? ADMIN_NOT_AUTHORIZED_ERROR;
  }

  if (error.code === "P0002") {
    return "El miembro especificado no existe o ya no pertenece a la liga.";
  }

  return error.message ?? ADMIN_SAVE_ERROR;
}

/**
 * Alterna/fija el estado de pago de un miembro (Story 3.3 — AC #3). El RPC
 * `fn_set_member_payment_status` (SECURITY DEFINER) valida que el llamante sea
 * admin de esa liga. NUNCA propaga excepciones; revalida la tabla y el panel.
 */
export async function setMemberPaymentStatus(
  input: SetMemberPaymentStatusInput,
): Promise<ServerActionResult<LeagueMember>> {
  try {
    const parsed = setMemberPaymentStatusSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        data: null,
        error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
      };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("fn_set_member_payment_status", {
        p_league_id: parsed.data.leagueId,
        p_user_id: parsed.data.userId,
        p_status: parsed.data.status,
      })
      .single();

    if (error) {
      console.error("Error al actualizar estado de pago del miembro:", error);
      return { success: false, data: null, error: toAdminError(error) };
    }

    revalidatePath("/standings");
    revalidatePath("/standings/manage");
    return { success: true, data: data as LeagueMember, error: null };
  } catch (e) {
    console.error("Excepción inesperada al actualizar estado de pago del miembro:", e);
    return { success: false, data: null, error: ADMIN_SAVE_ERROR };
  }
}

/**
 * Promueve un miembro a admin de la liga. El RPC `fn_promote_member_to_admin`
 * aplica admin-gating server-side y evita updates directos sobre league_members.
 */
export async function promoteMemberToAdmin(
  input: PromoteMemberToAdminInput,
): Promise<ServerActionResult<LeagueMember>> {
  try {
    const parsed = promoteMemberToAdminSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        data: null,
        error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
      };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("fn_promote_member_to_admin", {
        p_league_id: parsed.data.leagueId,
        p_user_id: parsed.data.userId,
      })
      .single();

    if (error) {
      console.error("Error al promover miembro a admin:", error);
      return { success: false, data: null, error: toAdminError(error) };
    }

    revalidatePath("/standings");
    revalidatePath("/standings/manage");
    return { success: true, data: data as LeagueMember, error: null };
  } catch (e) {
    console.error("Excepción inesperada al promover miembro a admin:", e);
    return { success: false, data: null, error: ADMIN_SAVE_ERROR };
  }
}

/**
 * Expulsa a un miembro de la liga (Story 3.3 — AC #4). El RPC `fn_remove_member`
 * (SECURITY DEFINER) aplica admin-gating y guardas (no auto-expulsión, no dejar
 * la liga sin admin) y un trigger borra en cascada sus predicciones. NUNCA
 * propaga excepciones; revalida la tabla y el panel.
 */
export async function removeMember(
  input: RemoveMemberInput,
): Promise<ServerActionResult<null>> {
  try {
    const parsed = removeMemberSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        data: null,
        error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
      };
    }

    const supabase = await createClient();
    const { error } = await supabase.rpc("fn_remove_member", {
      p_league_id: parsed.data.leagueId,
      p_user_id: parsed.data.userId,
    });

    if (error) {
      console.error("Error al expulsar al miembro:", error);
      return { success: false, data: null, error: toAdminError(error) };
    }

    revalidatePath("/standings");
    revalidatePath("/standings/manage");
    return { success: true, data: null, error: null };
  } catch (e) {
    console.error("Excepción inesperada al expulsar al miembro:", e);
    return { success: false, data: null, error: ADMIN_SAVE_ERROR };
  }
}

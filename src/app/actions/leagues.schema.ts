import { z } from "zod";

/**
 * Esquema de validación del formulario de creación de liga (AC #1, #2).
 * Vive aparte de `leagues.actions.ts` porque un módulo `"use server"` solo
 * puede exportar funciones async; además así se testea de forma aislada (unit)
 * sin arrastrar `next/headers`.
 *
 * Reglas condicionales: si `requiresPayment` es true, el monto debe ser un
 * número ≥ 0 y las instrucciones no pueden quedar vacías (refuerza la deuda de
 * 1.2: `payment_amount` no tiene CHECK >= 0 en la BD). Si es false, esos campos
 * se ignoran.
 */
export const createLeagueSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "El nombre de la liga es obligatorio.")
      .max(80, "El nombre no puede superar los 80 caracteres."),
    predictionMode: z.enum(["dual", "jornada", "grupos"], {
      message: "Selecciona un modo de predicción válido.",
    }),
    requiresPayment: z.boolean(),
    paymentAmount: z.number().nonnegative().nullish(),
    paymentInstructions: z.string().trim().nullish(),
  })
  .superRefine((data, ctx) => {
    if (!data.requiresPayment) return;

    if (data.paymentAmount === null || data.paymentAmount === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["paymentAmount"],
        message: "Indica el monto de inscripción.",
      });
    }
    if (!data.paymentInstructions || data.paymentInstructions.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["paymentInstructions"],
        message: "Indica las instrucciones de cobro.",
      });
    }
  });

export type CreateLeagueInput = z.input<typeof createLeagueSchema>;

/**
 * Esquema del toggle de pago por el admin (Story 3.3 — AC #3). El admin-gating
 * real lo hace el RPC `fn_set_member_payment_status` (SECURITY DEFINER); aquí
 * solo validamos forma: UUIDs y estado dentro del enum del CHECK de la tabla.
 */
export const setMemberPaymentStatusSchema = z.object({
  leagueId: z.string().uuid("Liga inválida."),
  userId: z.string().uuid("Miembro inválido."),
  status: z.enum(["pending", "paid"], {
    message: "Estado de pago inválido.",
  }),
});

export type SetMemberPaymentStatusInput = z.input<
  typeof setMemberPaymentStatusSchema
>;

/**
 * Esquema para promover a un miembro como admin de liga. Las guardas duras
 * (admin-gating, membresía existente, aislamiento por liga) viven en
 * `fn_promote_member_to_admin`.
 */
export const promoteMemberToAdminSchema = z.object({
  leagueId: z.string().uuid("Liga inválida."),
  userId: z.string().uuid("Miembro inválido."),
});

export type PromoteMemberToAdminInput = z.input<
  typeof promoteMemberToAdminSchema
>;

/**
 * Esquema de la expulsión de un miembro (Story 3.3 — AC #4). Las guardas duras
 * (admin, no auto-expulsión, no quedarse sin admin) viven en `fn_remove_member`.
 */
export const removeMemberSchema = z.object({
  leagueId: z.string().uuid("Liga inválida."),
  userId: z.string().uuid("Miembro inválido."),
});

export type RemoveMemberInput = z.input<typeof removeMemberSchema>;

import { z } from "zod";

/**
 * Esquema de la captura/edición de resultados por el admin (Story 7.2 — AC #2).
 * Vive aparte de `matches.actions.ts` porque un módulo `"use server"` solo puede
 * exportar funciones async; así se testea de forma aislada (unit).
 *
 * El admin-gating real (admin de alguna liga) y las reglas duras (transición de
 * estado, knockout TBD) viven en el RPC `fn_admin_set_match_result`. Aquí solo
 * validamos forma: UUID, marcadores enteros ≥ 0 nullable, estado del enum, y la
 * regla marcador↔estado de cliente (live/finished exigen marcador) para dar
 * feedback temprano antes de tocar la red.
 */
export const setMatchResultSchema = z
  .object({
    matchId: z.string().uuid("Partido inválido."),
    homeScore: z
      .number()
      .int("El marcador debe ser un número entero.")
      .nonnegative("El marcador no puede ser negativo.")
      .max(99, "El marcador es demasiado alto.")
      .nullable(),
    awayScore: z
      .number()
      .int("El marcador debe ser un número entero.")
      .nonnegative("El marcador no puede ser negativo.")
      .max(99, "El marcador es demasiado alto.")
      .nullable(),
    status: z.enum(["scheduled", "live", "finished", "suspended", "canceled"], {
      message: "Estado de partido inválido.",
    }),
    penaltiesHomeScore: z
      .number()
      .int("El marcador de penales debe ser un número entero.")
      .nonnegative("El marcador de penales no puede ser negativo.")
      .max(99, "El marcador de penales es demasiado alto.")
      .nullable()
      .optional(),
    penaltiesAwayScore: z
      .number()
      .int("El marcador de penales debe ser un número entero.")
      .nonnegative("El marcador de penales no puede ser negativo.")
      .max(99, "El marcador de penales es demasiado alto.")
      .nullable()
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status !== "live" && data.status !== "finished") return;
    if (data.homeScore === null) {
      ctx.addIssue({
        code: "custom",
        path: ["homeScore"],
        message: "Indica el marcador local.",
      });
    }
    if (data.awayScore === null) {
      ctx.addIssue({
        code: "custom",
        path: ["awayScore"],
        message: "Indica el marcador visitante.",
      });
    }

    if (
      data.status === "finished" &&
      data.homeScore !== null &&
      data.awayScore !== null &&
      data.homeScore === data.awayScore
    ) {
      if (
        data.penaltiesHomeScore !== undefined &&
        data.penaltiesHomeScore !== null &&
        data.penaltiesAwayScore !== undefined &&
        data.penaltiesAwayScore !== null
      ) {
        if (data.penaltiesHomeScore === data.penaltiesAwayScore) {
          ctx.addIssue({
            code: "custom",
            path: ["penaltiesHomeScore"],
            message: "La tanda de penales no puede terminar en empate.",
          });
        }
      }
    }
  });

export type SetMatchResultInput = z.input<typeof setMatchResultSchema>;

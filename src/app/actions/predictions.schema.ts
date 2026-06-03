import { z } from "zod";

import { MAX_PREDICTION_SCORE } from "@/app/actions/predictions.constants";

/**
 * Entrada de guardado de prediccion. Vive fuera de `predictions.actions.ts`
 * porque un modulo `"use server"` solo debe exportar funciones async.
 */
export const savePredictionSchema = z.object({
  leagueId: z.string().uuid("Liga invalida."),
  matchId: z.string().uuid("Partido invalido."),
  homeScorePred: z
    .number()
    .int("El marcador local debe ser un entero.")
    .nonnegative("El marcador local no puede ser negativo.")
    .max(MAX_PREDICTION_SCORE, "El marcador local es demasiado alto."),
  awayScorePred: z
    .number()
    .int("El marcador visitante debe ser un entero.")
    .nonnegative("El marcador visitante no puede ser negativo.")
    .max(MAX_PREDICTION_SCORE, "El marcador visitante es demasiado alto."),
});

export type SavePredictionInput = z.input<typeof savePredictionSchema>;

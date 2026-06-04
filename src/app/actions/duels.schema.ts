import { z } from "zod";

export const createChallengeSchema = z.object({
  leagueId: z.string().uuid("Liga inválida."),
  matchId: z.string().uuid("Partido inválido."),
  pointsBet: z
    .number()
    .int("La apuesta debe ser un número entero.")
    .positive("La apuesta debe ser mayor que cero."),
  type: z.enum(["direct", "open"], {
    message: "Tipo de duelo inválido.",
  }),
  challengedId: z.string().uuid("Rival inválido.").nullable().optional(),
  predictionHome: z
    .number()
    .int("El marcador local debe ser un entero.")
    .nonnegative("El marcador local no puede ser negativo.")
    .max(99, "El marcador local es demasiado alto."),
  predictionAway: z
    .number()
    .int("El marcador visitante debe ser un entero.")
    .nonnegative("El marcador visitante no puede ser negativo.")
    .max(99, "El marcador visitante es demasiado alto."),
}).refine((data) => {
  if (data.type === "direct" && !data.challengedId) {
    return false;
  }
  return true;
}, {
  message: "Debe especificar un rival para un duelo directo.",
  path: ["challengedId"],
});

export type CreateChallengeInput = z.input<typeof createChallengeSchema>;
export type CreateChallengeParsed = z.output<typeof createChallengeSchema>;

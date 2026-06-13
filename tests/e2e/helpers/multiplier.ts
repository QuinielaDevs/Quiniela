// Multiplicador esperado calculado DINÁMICAMENTE (Fase 1 del plan E2E).
//
// Respuesta a la trampa §7.2: la "jornada en curso" avanza con el tiempo REAL
// (el seed trae las fechas del Mundial 2026 y fn_current_round_ordinal mira
// match_time <= now() sobre TODA la tabla matches). PROHIBIDO hardcodear
// multiplicadores esperados: este helper carga el estado real de la BD y
// reutiliza la MISMA lógica de producción importada de src/utils/scoring.ts.

import {
  calculatePredictionMultiplier,
  currentRoundOrdinal,
} from "../../../src/utils/scoring";

import { createAdminClient } from "./admin";

export interface MatchRoundInfo {
  matchday: number | null;
  stage: string | null;
}

// Carga los campos mínimos de TODOS los partidos (catálogo global) para
// calcular la jornada en curso igual que el servidor.
async function loadAllMatchesForOrdinal(): Promise<
  Array<{ matchday: number | null; stage: string | null; match_time: string; status: string }>
> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("matches")
    .select("matchday, stage, match_time, status");
  if (error || !data) {
    throw new Error(`Error cargando matches para el ordinal: ${error?.message}`);
  }
  return data;
}

/** Ordinal de la jornada en curso según el estado REAL de la BD. */
export async function currentRoundOrdinalFromDb(): Promise<number> {
  const matches = await loadAllMatchesForOrdinal();
  return currentRoundOrdinal(matches);
}

/**
 * Multiplicador que fn_save_prediction otorgaría AHORA a un partido. Acepta el
 * objeto del partido ({matchday, stage}) o su id (se consulta a la BD).
 */
export async function expectedMultiplierForMatch(
  match: MatchRoundInfo | string,
): Promise<number> {
  let info: MatchRoundInfo;
  if (typeof match === "string") {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("matches")
      .select("matchday, stage")
      .eq("id", match)
      .single();
    if (error || !data) {
      throw new Error(`expectedMultiplierForMatch: partido ${match} no encontrado: ${error?.message}`);
    }
    info = data;
  } else {
    info = match;
  }

  const ordinal = await currentRoundOrdinalFromDb();
  return calculatePredictionMultiplier(info.matchday, info.stage, ordinal);
}

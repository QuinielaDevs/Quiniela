// Seed de predicciones vía service role (Fase 1 del plan E2E).
// `multiplier` y `points_earned` tienen REVOKE de escritura para
// `authenticated` (solo el RPC los escribe en producción): el service role es
// la ÚNICA vía válida para sembrarlos en tests (00-contexto §7.9).

import { createAdminClient } from "../admin";

export interface SeedPredictionOpts {
  leagueId: string;
  userId: string;
  matchId: string;
  home: number;
  away: number;
  multiplier?: number;
  pointsEarned?: number | null;
  /** Marca de idempotencia del accrual (00-contexto §3). */
  evaluatedAt?: string | null;
}

export interface SeededPrediction {
  id: string;
}

export async function seedPrediction(opts: SeedPredictionOpts): Promise<SeededPrediction> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("predictions")
    .upsert(
      {
        league_id: opts.leagueId,
        user_id: opts.userId,
        match_id: opts.matchId,
        home_score_pred: opts.home,
        away_score_pred: opts.away,
        multiplier: opts.multiplier ?? 1.0,
        ...(opts.pointsEarned !== undefined ? { points_earned: opts.pointsEarned } : {}),
        ...(opts.evaluatedAt !== undefined ? { evaluated_at: opts.evaluatedAt } : {}),
      },
      { onConflict: "league_id,user_id,match_id" },
    )
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Error creando predicción e2e: ${error?.message}`);
  }
  return { id: data.id as string };
}

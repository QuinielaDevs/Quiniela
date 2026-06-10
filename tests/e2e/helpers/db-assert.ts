// Aserciones de BD para los tests E2E (Fase 1 del plan).
// Convención §8: los E2E verifican primero la UI; las invariantes (ledger,
// evaluated_at) se verifican DESPUÉS con el admin client. Esto es deliberado.

import { createAdminClient } from "./admin";

export interface PointTransaction {
  id: string;
  user_id: string;
  league_id: string;
  amount: number;
  description: string;
  reference_id: string | null;
  created_at: string;
}

export async function getWagerBalance(leagueId: string, userId: string): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("league_members")
    .select("wager_balance")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .single();
  if (error || !data) {
    throw new Error(`getWagerBalance: ${error?.message ?? "miembro no encontrado"}`);
  }
  return Number(data.wager_balance);
}

export async function getTransactions(
  leagueId: string,
  userId: string,
): Promise<PointTransaction[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("point_transactions")
    .select("id, user_id, league_id, amount, description, reference_id, created_at")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`getTransactions: ${error.message}`);
  }
  return (data ?? []).map((row) => ({ ...row, amount: Number(row.amount) })) as PointTransaction[];
}

/**
 * Invariante del ledger (00-contexto §3 / migración accrual_correction_rpc):
 * para CADA miembro de la liga, wager_balance == SUM(point_transactions.amount).
 * Lanza con un diff claro si algún miembro la viola.
 */
export async function assertLedgerInvariant(leagueId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: members, error: membersError } = await admin
    .from("league_members")
    .select("user_id, wager_balance")
    .eq("league_id", leagueId);
  if (membersError) {
    throw new Error(`assertLedgerInvariant: error leyendo miembros: ${membersError.message}`);
  }

  const { data: transactions, error: txError } = await admin
    .from("point_transactions")
    .select("user_id, amount")
    .eq("league_id", leagueId);
  if (txError) {
    throw new Error(`assertLedgerInvariant: error leyendo transacciones: ${txError.message}`);
  }

  const sums = new Map<string, number>();
  for (const tx of transactions ?? []) {
    sums.set(tx.user_id, (sums.get(tx.user_id) ?? 0) + Number(tx.amount));
  }

  const EPSILON = 0.005; // numeric(12,2): medio centavo de margen por redondeo
  const violations: string[] = [];
  for (const member of members ?? []) {
    const balance = Number(member.wager_balance);
    const ledgerSum = sums.get(member.user_id) ?? 0;
    if (Math.abs(balance - ledgerSum) > EPSILON) {
      violations.push(
        `  user ${member.user_id}: wager_balance=${balance.toFixed(2)} != SUM(point_transactions)=${ledgerSum.toFixed(2)} (diff ${(balance - ledgerSum).toFixed(2)})`,
      );
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `Invariante del ledger VIOLADA en liga ${leagueId}:\n${violations.join("\n")}`,
    );
  }
}

export interface PredictionRow {
  id: string;
  league_id: string;
  user_id: string;
  match_id: string;
  home_score_pred: number;
  away_score_pred: number;
  multiplier: number | null;
  points_earned: number | null;
  evaluated_at: string | null;
  updated_at: string | null;
}

export async function getPrediction(
  leagueId: string,
  userId: string,
  matchId: string,
): Promise<PredictionRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("predictions")
    .select(
      "id, league_id, user_id, match_id, home_score_pred, away_score_pred, multiplier, points_earned, evaluated_at, updated_at",
    )
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("match_id", matchId)
    .maybeSingle();
  if (error) {
    throw new Error(`getPrediction: ${error.message}`);
  }
  if (!data) return null;
  return {
    ...data,
    multiplier: data.multiplier === null ? null : Number(data.multiplier),
    points_earned: data.points_earned === null ? null : Number(data.points_earned),
  } as PredictionRow;
}

export interface ChallengeRow {
  id: string;
  league_id: string;
  match_id: string;
  creator_id: string;
  challenged_id: string | null;
  points_bet: number;
  type: "direct" | "open";
  status: "pending" | "active" | "completed" | "canceled";
  winner_ids: string[] | null;
  participants: Array<{ user_id: string; prediction_home: number; prediction_away: number }>;
}

export async function getChallenge(id: string): Promise<ChallengeRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("challenges")
    .select(
      "id, league_id, match_id, creator_id, challenged_id, points_bet, type, status, winner_ids, challenge_participants(user_id, prediction_home, prediction_away)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new Error(`getChallenge: ${error.message}`);
  }
  if (!data) return null;
  const { challenge_participants, ...rest } = data as ChallengeRow & {
    challenge_participants: ChallengeRow["participants"];
  };
  return { ...rest, participants: challenge_participants ?? [] };
}

export async function getMatch(id: string): Promise<{
  id: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  external_last_sync_at: string | null;
} | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("matches")
    .select("id, status, home_score, away_score, external_last_sync_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new Error(`getMatch: ${error.message}`);
  }
  return data;
}

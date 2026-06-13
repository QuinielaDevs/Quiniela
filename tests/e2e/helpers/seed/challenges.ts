// Seed de duelos (Fase 1 del plan E2E).
//
// Preferencia deliberada: llamar al RPC REAL autenticado como el creador (con
// un client anon + signInWithPassword), para ejercitar exactamente la misma
// ruta que producción (validaciones P0001-P0004, escrow y transacción de
// ledger incluidos). NOTA: el nombre real del RPC en BD es `create_challenge`
// (no `fn_create_challenge` como asume el plan) — ver duels.actions.ts.

import { createAdminClient, createAnonClient } from "../admin";
import { TEST_PASSWORD } from "../users";

export interface SeedChallengeOpts {
  leagueId: string;
  matchId: string;
  /** Credenciales del creador (el RPC usa auth.uid()). El password de los
   *  usuarios E2E es fijo (TEST_PASSWORD), así que basta el email. */
  creator: { email: string; password?: string };
  pointsBet: number;
  type: "direct" | "open";
  /** Rival (requerido para type=direct). */
  challengedId?: string | null;
  creatorPred: { home: number; away: number };
}

/** Crea un duelo por la misma ruta que producción y devuelve su id. */
export async function seedChallenge(opts: SeedChallengeOpts): Promise<string> {
  const client = createAnonClient();
  const { error: authError } = await client.auth.signInWithPassword({
    email: opts.creator.email,
    password: opts.creator.password ?? TEST_PASSWORD,
  });
  if (authError) {
    throw new Error(`seedChallenge: login del creador falló: ${authError.message}`);
  }

  try {
    const { data, error } = await client.rpc("create_challenge", {
      p_league_id: opts.leagueId,
      p_match_id: opts.matchId,
      p_points_bet: opts.pointsBet,
      p_type: opts.type,
      p_challenged_id: opts.challengedId ?? null,
      p_prediction_home: opts.creatorPred.home,
      p_prediction_away: opts.creatorPred.away,
    });
    if (error) {
      throw new Error(`seedChallenge: create_challenge falló: ${error.message} (${error.code})`);
    }
    return data as string;
  } finally {
    await client.auth.signOut();
  }
}

/** Acepta un duelo autenticado como el aceptante (misma ruta que producción). */
export async function acceptChallengeAs(
  acceptor: { email: string; password?: string },
  challengeId: string,
  prediction: { home: number; away: number },
): Promise<void> {
  const client = createAnonClient();
  const { error: authError } = await client.auth.signInWithPassword({
    email: acceptor.email,
    password: acceptor.password ?? TEST_PASSWORD,
  });
  if (authError) {
    throw new Error(`acceptChallengeAs: login del aceptante falló: ${authError.message}`);
  }

  try {
    const { error } = await client.rpc("accept_challenge", {
      p_challenge_id: challengeId,
      p_prediction_home: prediction.home,
      p_prediction_away: prediction.away,
    });
    if (error) {
      throw new Error(`acceptChallengeAs: accept_challenge falló: ${error.message} (${error.code})`);
    }
  } finally {
    await client.auth.signOut();
  }
}

/** Fallback service-role SOLO para estados imposibles de alcanzar por RPC
 *  (p. ej. un duelo ya `completed` con winner_ids arbitrarios). */
export async function seedChallengeRaw(row: {
  leagueId: string;
  matchId: string;
  creatorId: string;
  pointsBet: number;
  type: "direct" | "open";
  challengedId?: string | null;
  status?: "pending" | "active" | "completed" | "canceled";
  winnerIds?: string[] | null;
  participants?: Array<{ userId: string; home: number; away: number }>;
}): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("challenges")
    .insert({
      league_id: row.leagueId,
      match_id: row.matchId,
      creator_id: row.creatorId,
      points_bet: row.pointsBet,
      type: row.type,
      challenged_id: row.challengedId ?? null,
      status: row.status ?? "pending",
      winner_ids: row.winnerIds ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedChallengeRaw: insert falló: ${error?.message}`);
  }
  const challengeId = data.id as string;

  if (row.participants && row.participants.length > 0) {
    const { error: partError } = await admin.from("challenge_participants").insert(
      row.participants.map((p) => ({
        challenge_id: challengeId,
        user_id: p.userId,
        prediction_home: p.home,
        prediction_away: p.away,
      })),
    );
    if (partError) {
      throw new Error(`seedChallengeRaw: participantes fallaron: ${partError.message}`);
    }
  }

  return challengeId;
}

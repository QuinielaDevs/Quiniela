// Seed composable de ligas y membresías (Fase 1 del plan E2E).
// Escrituras vía service role; la invariante del ledger se respeta sembrando
// una transacción `seed_initial_balance` por cada saldo inicial (00-contexto §4.5).

import { createAdminClient } from "../admin";

export interface SeedLeagueOpts {
  runId: string;
  creatorId: string;
  name?: string;
  requiresPayment?: boolean;
  paymentAmount?: number | null;
  paymentInstructions?: string | null;
}

export interface SeededLeague {
  id: string;
  name: string;
  inviteCode: string;
  cleanup: () => Promise<void>;
}

// Código de invitación solo-alfanumérico (los guiones del runId se eliminan)
// para que sea apto para /join/<code> y fn_join_league_by_invite.
function inviteCodeFromRunId(runId: string): string {
  return `E2E${runId.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(-12)}`;
}

export async function seedLeague(opts: SeedLeagueOpts): Promise<SeededLeague> {
  const admin = createAdminClient();
  const name = opts.name ?? `E2E Test League ${opts.runId}`;
  const inviteCode = inviteCodeFromRunId(opts.runId);

  const { data: league, error } = await admin
    .from("leagues")
    .insert({
      name,
      invite_code: inviteCode,
      created_by: opts.creatorId,
      requires_payment: opts.requiresPayment ?? false,
      payment_amount: opts.paymentAmount ?? null,
      payment_instructions: opts.paymentInstructions ?? null,
    })
    .select("id")
    .single();
  if (error || !league) {
    throw new Error(`Error creando liga e2e: ${error?.message}`);
  }
  const leagueId = league.id as string;

  const cleanup = async () => {
    // Orden inverso de FKs. point_transactions/predictions/challenges cuelgan
    // de la liga con ON DELETE CASCADE, pero se borran explícito por claridad
    // e idempotencia (si una FK cambiara, el cleanup sigue siendo válido).
    await admin.from("point_transactions").delete().eq("league_id", leagueId);
    await admin.from("challenges").delete().eq("league_id", leagueId);
    await admin.from("special_predictions").delete().eq("league_id", leagueId);
    await admin.from("predictions").delete().eq("league_id", leagueId);
    await admin.from("league_members").delete().eq("league_id", leagueId);
    await admin
      .from("profiles")
      .update({ active_league_id: null })
      .eq("active_league_id", leagueId);
    await admin.from("leagues").delete().eq("id", leagueId);
  };

  return { id: leagueId, name, inviteCode, cleanup };
}

export interface AddMemberOpts {
  role?: "admin" | "member";
  paymentStatus?: "pending" | "paid";
  /** Saldo inicial de duelos. Si > 0, inserta también la transacción
   *  `seed_initial_balance` equivalente para no romper la invariante
   *  wager_balance == SUM(point_transactions.amount). */
  wagerBalance?: number;
}

export async function addMember(
  leagueId: string,
  userId: string,
  opts: AddMemberOpts = {},
): Promise<void> {
  const admin = createAdminClient();

  // El profile lo crea el trigger de auth.users; el upsert es una red de
  // seguridad por si el trigger aún no corrió.
  await admin
    .from("profiles")
    .upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true });

  const wagerBalance = opts.wagerBalance ?? 0;
  const { error } = await admin.from("league_members").insert({
    league_id: leagueId,
    user_id: userId,
    role: opts.role ?? "member",
    payment_status: opts.paymentStatus ?? "pending",
    wager_balance: wagerBalance,
  });
  if (error) {
    throw new Error(`Error creando membresía e2e: ${error.message}`);
  }

  if (wagerBalance > 0) {
    const { error: txError } = await admin.from("point_transactions").insert({
      user_id: userId,
      league_id: leagueId,
      amount: wagerBalance,
      description: "seed_initial_balance",
    });
    if (txError) {
      throw new Error(`Error sembrando transacción de saldo inicial: ${txError.message}`);
    }
  }
}

// Las páginas leen profiles.active_league_id para resolver la liga del usuario.
export async function setActiveLeague(userId: string, leagueId: string | null): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ active_league_id: leagueId })
    .eq("id", userId);
  if (error) {
    throw new Error(`Error seteando liga activa e2e: ${error.message}`);
  }
}

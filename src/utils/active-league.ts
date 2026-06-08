import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, LeagueRole, PaymentStatus } from "@/types";

type Client = SupabaseClient<Database>;

export type ActiveLeagueMembership = {
  leagueId: string;
  joinedAt: string;
  role: LeagueRole;
  paymentStatus: PaymentStatus;
  wagerBalance: number;
  league: {
    name: string;
    inviteCode: string;
    requiresPayment: boolean;
    paymentAmount: number | null;
    paymentInstructions: string | null;
  } | null;
};

type MembershipRow = {
  league_id: string;
  joined_at: string;
  role: LeagueRole;
  payment_status: PaymentStatus;
  wager_balance: number;
  leagues: {
    name: string;
    invite_code: string;
    requires_payment: boolean;
    payment_amount: number | null;
    payment_instructions: string | null;
  } | null;
};

function normalizeMembership(
  row: MembershipRow | null | undefined,
): ActiveLeagueMembership | null {
  if (!row) return null;

  return {
    leagueId: row.league_id,
    joinedAt: row.joined_at,
    role: row.role,
    paymentStatus: row.payment_status,
    wagerBalance: Number(row.wager_balance ?? 0),
    league: row.leagues
      ? {
          name: row.leagues.name,
          inviteCode: row.leagues.invite_code,
          requiresPayment: row.leagues.requires_payment,
          paymentAmount: row.leagues.payment_amount,
          paymentInstructions: row.leagues.payment_instructions,
        }
      : null,
  };
}

export async function getActiveLeagueMembership({
  supabase,
  userId,
}: {
  supabase: Client;
  userId: string;
}): Promise<ActiveLeagueMembership | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("active_league_id")
    .eq("id", userId)
    .single();

  const activeLeagueId = profile?.active_league_id ?? null;

  if (activeLeagueId) {
    const { data: activeMembership } = await supabase
      .from("league_members")
      .select(
        "league_id, joined_at, role, payment_status, wager_balance, leagues(name, invite_code, requires_payment, payment_amount, payment_instructions)",
      )
      .eq("user_id", userId)
      .eq("league_id", activeLeagueId)
      .maybeSingle();

    const normalized = normalizeMembership(
      activeMembership as unknown as MembershipRow | null,
    );
    if (normalized) return normalized;
  }

  const { data: memberships } = await supabase
    .from("league_members")
    .select(
      "league_id, joined_at, role, payment_status, wager_balance, leagues(name, invite_code, requires_payment, payment_amount, payment_instructions)",
    )
    .eq("user_id", userId)
    .order("joined_at", { ascending: false })
    .limit(1);

  return normalizeMembership(
    (memberships?.[0] ?? null) as unknown as MembershipRow | null,
  );
}

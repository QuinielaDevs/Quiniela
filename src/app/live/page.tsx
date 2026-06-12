import { redirect } from "next/navigation";

import { LiveStandingsBoard } from "@/components/live/LiveStandingsBoard";
import type { LiveMatch } from "@/components/live/goalImpact";
import { NoLeagueState } from "@/components/join/NoLeagueState";
import { createClient } from "@/utils/supabase/server";
import { getActiveLeagueMembership } from "@/utils/active-league";
import type { PaymentStatus } from "@/types";
import type { StandingMember, StandingPrediction } from "@/utils/standings";

type MemberRow = {
  user_id: string;
  payment_status: PaymentStatus;
  joined_at: string;
  wager_balance: number;
  profiles: { display_name: string; avatar_url: string } | null;
};

export async function LiveBoard() {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/auth/login");

  const membership = await getActiveLeagueMembership({ supabase, userId });
  const leagueId = membership?.leagueId;
  if (!leagueId) {
    return (
      <NoLeagueState body="Únete con un código de invitación o crea tu propia quiniela para ver la tabla en vivo." />
    );
  }

  const [{ data: memberRows }, { data: matchRows }] = await Promise.all([
    supabase
      .from("league_members")
      .select("user_id, payment_status, joined_at, wager_balance, profiles(display_name, avatar_url)")
      .eq("league_id", leagueId),
    supabase
      .from("matches")
      .select(
        "id, status, matchday, home_team, away_team, home_team_code, away_team_code, home_score, away_score, match_time",
      )
      .in("status", ["finished", "live"])
      .order("match_time", { ascending: true }),
  ]);

  const matches: LiveMatch[] = (matchRows ?? []).map((match) => ({
    id: match.id,
    status: match.status,
    matchday: match.matchday,
    homeScore: match.home_score,
    awayScore: match.away_score,
    homeTeam: match.home_team ?? null,
    awayTeam: match.away_team ?? null,
  }));
  const matchIds = matches.map((match) => match.id);

  let predictions: StandingPrediction[] = [];
  if (matchIds.length > 0) {
    const { data: predRows } = await supabase
      .from("predictions")
      .select("user_id, match_id, home_score_pred, away_score_pred, multiplier")
      .eq("league_id", leagueId)
      .in("match_id", matchIds);

    predictions = (predRows ?? []).map((prediction) => ({
      userId: prediction.user_id,
      matchId: prediction.match_id,
      homeScorePred: prediction.home_score_pred,
      awayScorePred: prediction.away_score_pred,
      multiplier: prediction.multiplier,
    }));
  }

  const members = ((memberRows ?? []) as unknown as MemberRow[]).map(
    (member): StandingMember => ({
      userId: member.user_id,
      displayName: member.profiles?.display_name ?? "Jugador Anónimo",
      avatarUrl: member.profiles?.avatar_url ?? "/assets/avatars/default-player.svg",
      paymentStatus: member.payment_status,
      joinedAt: member.joined_at,
      duelPoints: Number(member.wager_balance ?? 0),
    }),
  );

  return (
    <LiveStandingsBoard
      leagueId={leagueId}
      currentUserId={userId}
      members={members}
      initialMatches={matches}
      initialPredictions={predictions}
    />
  );
}

// La tabla "En vivo" está deshabilitada temporalmente: la API de partidos no
// entrega marcadores en directo, así que la ruta redirige a /standings. Todo el
// andamiaje (LiveBoard, LiveStandingsBoard, polling/realtime) se conserva para
// reactivarlo sin reescribir cuando la fuente de datos lo soporte.
export default function LivePage() {
  redirect("/standings");
}

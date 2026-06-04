import type { SupabaseClient } from "@supabase/supabase-js";

import {
  closedMatchdays,
  deriveAwardsForMatchday,
  type AwardMatch,
  type AwardPrediction,
} from "@/utils/member-awards";
import type { Database, MemberBadgeInsert, MemberGameProfileInsert } from "@/types";

type AuthedSupabase = SupabaseClient<Database>;

export type MaterializeAwardsResult = {
  closedMatchdays: number[];
  predictedClosedMatchdays: number[];
  materializedMatchdays: number[];
  errors: string[];
};

type ExistingBadgeRow = {
  matchday: number;
  badge_type: string;
};

type ExistingProfileRow = {
  matchday: number;
};

export async function materializeCurrentMemberAwards({
  supabase,
  leagueId,
  userId,
}: {
  supabase: AuthedSupabase;
  leagueId: string;
  userId: string;
}): Promise<MaterializeAwardsResult> {
  const errors: string[] = [];

  const [
    { data: matchRows, error: matchError },
    { data: predictionRows, error: predictionError },
    { data: existingBadgeRows, error: badgeError },
    { data: existingProfileRows, error: profileError },
  ] = await Promise.all([
    supabase
      .from("matches")
      .select("id, status, matchday, home_score, away_score")
      .not("matchday", "is", null),
    supabase
      .from("predictions")
      .select("match_id, home_score_pred, away_score_pred, multiplier")
      .eq("league_id", leagueId)
      .eq("user_id", userId),
    supabase
      .from("member_badges")
      .select("matchday, badge_type")
      .eq("league_id", leagueId)
      .eq("user_id", userId),
    supabase
      .from("member_game_profiles")
      .select("matchday")
      .eq("league_id", leagueId)
      .eq("user_id", userId),
  ]);

  if (matchError) errors.push(matchError.message);
  if (predictionError) errors.push(predictionError.message);
  if (badgeError) errors.push(badgeError.message);
  if (profileError) errors.push(profileError.message);

  if (errors.length > 0) {
    return {
      closedMatchdays: [],
      predictedClosedMatchdays: [],
      materializedMatchdays: [],
      errors,
    };
  }

  const matches: AwardMatch[] = (matchRows ?? []).map((match) => ({
    id: match.id,
    status: match.status,
    matchday: match.matchday,
    homeScore: match.home_score,
    awayScore: match.away_score,
  }));

  const predictions: AwardPrediction[] = (predictionRows ?? []).map(
    (prediction) => ({
      matchId: prediction.match_id,
      homeScorePred: prediction.home_score_pred,
      awayScorePred: prediction.away_score_pred,
      multiplier: Number(prediction.multiplier),
    }),
  );

  const existingBadgeKeys = new Set(
    ((existingBadgeRows ?? []) as ExistingBadgeRow[]).map(
      (badge) => `${badge.matchday}:${badge.badge_type}`,
    ),
  );
  const existingProfileMatchdays = new Set(
    ((existingProfileRows ?? []) as ExistingProfileRow[]).map(
      (profile) => profile.matchday,
    ),
  );

  const badgesToUpsert: MemberBadgeInsert[] = [];
  const profilesToUpsert: MemberGameProfileInsert[] = [];
  const closed = closedMatchdays(matches);
  const predictedClosed = new Set<number>();
  const materialized = new Set<number>();

  for (const matchday of closed) {
    const derived = deriveAwardsForMatchday(matches, predictions, matchday);
    if (derived.predictedCount === 0) continue;
    predictedClosed.add(matchday);

    for (const badge of derived.badges) {
      const key = `${matchday}:${badge.badgeType}`;
      if (existingBadgeKeys.has(key)) continue;

      badgesToUpsert.push({
        league_id: leagueId,
        user_id: userId,
        matchday,
        badge_type: badge.badgeType,
        badge_label: badge.badgeLabel,
        reason: badge.reason,
        points: badge.points,
      });
      materialized.add(matchday);
    }

    if (derived.profile && !existingProfileMatchdays.has(matchday)) {
      profilesToUpsert.push({
        league_id: leagueId,
        user_id: userId,
        matchday,
        profile_type: derived.profile.profileType,
        profile_label: derived.profile.profileLabel,
        summary: derived.profile.summary,
      });
      materialized.add(matchday);
    }
  }

  if (badgesToUpsert.length > 0) {
    const { error } = await supabase.from("member_badges").upsert(badgesToUpsert, {
      onConflict: "league_id,user_id,matchday,badge_type",
    });
    if (error) errors.push(error.message);
  }

  if (profilesToUpsert.length > 0) {
    const { error } = await supabase
      .from("member_game_profiles")
      .upsert(profilesToUpsert, {
        onConflict: "league_id,user_id,matchday",
      });
    if (error) errors.push(error.message);
  }

  return {
    closedMatchdays: closed,
    predictedClosedMatchdays: [...predictedClosed].sort((a, b) => a - b),
    materializedMatchdays: errors.length > 0 ? [] : [...materialized].sort((a, b) => a - b),
    errors,
  };
}

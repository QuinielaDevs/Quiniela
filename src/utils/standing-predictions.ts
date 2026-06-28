import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";
import type { StandingPrediction } from "@/utils/standings";

const PREDICTION_PAGE_SIZE = 1000;
const PREDICTION_SELECT =
  "user_id, match_id, home_score_pred, away_score_pred, multiplier";

type PredictionRow = Pick<
  Database["public"]["Tables"]["predictions"]["Row"],
  | "user_id"
  | "match_id"
  | "home_score_pred"
  | "away_score_pred"
  | "multiplier"
>;

type PredictionFetchResult = {
  data: StandingPrediction[];
  error: PostgrestError | null;
};

function mapPrediction(row: PredictionRow): StandingPrediction {
  return {
    userId: row.user_id,
    matchId: row.match_id,
    homeScorePred: row.home_score_pred,
    awayScorePred: row.away_score_pred,
    multiplier: row.multiplier,
  };
}

export async function fetchStandingPredictions(
  supabase: SupabaseClient<Database>,
  leagueId: string,
  matchIds: string[],
): Promise<PredictionFetchResult> {
  if (matchIds.length === 0) return { data: [], error: null };

  const predictions: StandingPrediction[] = [];

  for (let from = 0; ; from += PREDICTION_PAGE_SIZE) {
    const to = from + PREDICTION_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("predictions")
      .select(PREDICTION_SELECT)
      .eq("league_id", leagueId)
      .in("match_id", matchIds)
      .order("user_id", { ascending: true })
      .order("match_id", { ascending: true })
      .range(from, to);

    if (error) return { data: [], error };

    const rows = (data ?? []) as PredictionRow[];
    predictions.push(...rows.map(mapPrediction));

    if (rows.length < PREDICTION_PAGE_SIZE) {
      return { data: predictions, error: null };
    }
  }
}

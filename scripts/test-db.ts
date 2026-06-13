import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.test.local" });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

async function main() {
  console.log("Supabase connected.");
  
  // Let's select all test matches
  const { data: testMatches, error: matchesError } = await supabase
    .from("matches")
    .select("id, home_team, away_team, match_time, status, matchday, stage")
    .like("home_team", "test_%");

  if (matchesError) {
    console.error("Error fetching matches:", matchesError);
  } else {
    console.log("Test matches in DB:");
    console.table(testMatches);
  }

  // Let's call the functions via RPC
  const { data: currentRound, error: rpcError } = await supabase.rpc("fn_current_round_ordinal");
  console.log("fn_current_round_ordinal():", currentRound, rpcError ? `Error: ${rpcError.message}` : "");

  const { data: multiplier, error: multError } = await supabase.rpc("fn_prediction_multiplier", {
    p_matchday: 2,
    p_stage: "group"
  });
  console.log("fn_prediction_multiplier(2, 'group'):", multiplier, multError ? `Error: ${multError.message}` : "");
}

main();

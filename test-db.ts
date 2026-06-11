import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.test.local" });
config({ path: ".env" });

const supabaseUrl = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(supabaseUrl, supabaseServiceRole, {
  auth: { persistSession: false },
});

async function run() {
  // Check if matches is in publication
  const { data: pubTables, error: err1 } = await admin.rpc("fn_run_query", {
    query_text: "select * from pg_publication_tables where tablename = 'matches';"
  });
  if (err1) {
    // If RPC doesn't exist, try running raw query through other means or check schemas
    console.error("Error checking pg_publication_tables:", err1);
  } else {
    console.log("Publication tables for matches:", pubTables);
  }

  // Check replica identity
  const { data: replicaIdent, error: err2 } = await admin.rpc("fn_run_query", {
    query_text: "select relname, relreplident from pg_class where relname = 'matches';"
  });
  if (err2) {
    console.error("Error checking replica identity:", err2);
  } else {
    console.log("Replica identity for matches:", replicaIdent);
  }
}

run();

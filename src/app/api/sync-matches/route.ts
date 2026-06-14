import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { syncMatches } from "../../../../scripts/sync-matches";

// Vercel Hobby allows up to 60 seconds of execution time for serverless functions
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // 1. Authentication check
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("CRON_SECRET is not configured on the server");
    return NextResponse.json({ success: false, error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    console.warn("Unauthorized sync-matches attempt");
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validate Zafronix API Key
  const wcApiKey = process.env.WC_API_KEY;
  if (!wcApiKey) {
    console.error("WC_API_KEY is not configured on the server");
    return NextResponse.json({ success: false, error: "WC_API_KEY is not configured" }, { status: 500 });
  }

  // 3. Create Supabase Client (bypassing RLS)
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Database configuration missing (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)");
    return NextResponse.json({ success: false, error: "Database configuration missing" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // 4. Execute Synchronization
  try {
    // Note: The logic to decide IF we should sync is now delegated to a Supabase RPC
    // that n8n will evaluate before calling this endpoint. Thus, if we reach this point,
    // we assume the sync should be forced/executed.
    const result = await syncMatches(supabase, wcApiKey);
    
    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error) {
    console.error("Error during sync in Next.js API:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Internal Server Error" }, 
      { status: 500 }
    );
  }
}

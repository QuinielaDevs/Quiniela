import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

// Zod Schema to validate payload
const syncMatchItemSchema = z.object({
  match_id: z.string().uuid().optional(),
  external_ref: z.string().optional(),
  status: z.enum(['scheduled', 'live', 'finished', 'suspended', 'canceled']),
  home_score: z.number().int().nonnegative().nullable().optional(),
  away_score: z.number().int().nonnegative().nullable().optional(),
}).refine(data => data.match_id || data.external_ref, {
  message: "Debe proporcionar match_id o external_ref",
  path: ["match_id", "external_ref"],
});

const syncMatchesSchema = z.array(syncMatchItemSchema);

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  
  // 500 error if CRON_SECRET is not configured on the server
  if (!cronSecret) {
    return NextResponse.json(
      { success: false, error: "CRON_SECRET is not configured on the server" },
      { status: 500 }
    );
  }

  // Authorization check
  const authHeader = req.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  // Parse and validate the body
  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const result = syncMatchesSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { success: false, error: "Validation failed", details: result.error.issues },
      { status: 400 }
    );
  }

  const matchesToSync = result.data;
  
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { success: false, error: "Database configuration missing" },
      { status: 500 }
    );
  }

  // Client using service role key to bypass RLS
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    const withId = matchesToSync
      .filter(m => m.match_id !== undefined)
      .map(m => ({
        id: m.match_id,
        external_ref: m.external_ref,
        status: m.status,
        home_score: m.home_score !== undefined ? m.home_score : null,
        away_score: m.away_score !== undefined ? m.away_score : null,
        updated_at: new Date().toISOString(),
      }));

    const withoutId = matchesToSync
      .filter(m => m.match_id === undefined && m.external_ref !== undefined)
      .map(m => ({
        external_ref: m.external_ref,
        status: m.status,
        home_score: m.home_score !== undefined ? m.home_score : null,
        away_score: m.away_score !== undefined ? m.away_score : null,
        updated_at: new Date().toISOString(),
      }));

    let updated = 0;

    if (withId.length > 0) {
      const { data, error } = await supabase
        .from("matches")
        .upsert(withId, { onConflict: "id" })
        .select("id");
      
      if (error) {
        throw error;
      }
      updated += data?.length ?? 0;
    }

    if (withoutId.length > 0) {
      const { data, error } = await supabase
        .from("matches")
        .upsert(withoutId, { onConflict: "external_ref" })
        .select("id");
      
      if (error) {
        throw error;
      }
      updated += data?.length ?? 0;
    }

    return NextResponse.json(
      { success: true, updated },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to update matches in database" },
      { status: 500 }
    );
  }
}

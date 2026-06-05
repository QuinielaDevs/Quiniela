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
});

const syncMatchesSchema = z.array(syncMatchItemSchema).max(100, "El lote no puede superar los 100 partidos");

// Forma de las filas de `matches` que este endpoint lee/mezcla (subconjunto del select).
type ExistingMatch = {
  id: string;
  external_ref: string | null;
  home_team: string;
  away_team: string;
  match_time: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
};

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  
  // 500 error if CRON_SECRET is not configured on the server
  if (!cronSecret) {
    console.error("CRON_SECRET is not configured on the server");
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
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
  let body: unknown;
  try {
    body = await req.json();
  } catch {
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
    console.error("Database configuration missing (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)");
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 }
    );
  }

  // Client using service role key to bypass RLS
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    // 1. Deduplicate input payload to prevent unique constraint failures on bulk operations
    const seenKeys = new Set<string>();
    const deduplicatedMatches: typeof matchesToSync = [];
    for (const m of matchesToSync) {
      const key = m.match_id || `ref:${m.external_ref}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        deduplicatedMatches.push(m);
      }
    }

    // 2. Fetch existing match records to preserve NOT NULL constraints and avoid null overwrites
    const matchIds = deduplicatedMatches.map(m => m.match_id).filter((id): id is string => !!id);
    const externalRefs = deduplicatedMatches.map(m => m.external_ref).filter((ref): ref is string => !!ref);

    let existingMatches: ExistingMatch[] = [];
    if (matchIds.length > 0 || externalRefs.length > 0) {
      const filters: string[] = [];
      if (matchIds.length > 0) {
        filters.push(`id.in.(${matchIds.join(",")})`);
      }
      if (externalRefs.length > 0) {
        filters.push(`external_ref.in.(${externalRefs.map(ref => `"${ref}"`).join(",")})`);
      }

      const { data, error } = await supabase
        .from("matches")
        .select("id, external_ref, home_team, away_team, match_time, status, home_score, away_score")
        .or(filters.join(","));

      if (error) {
        throw error;
      }
      existingMatches = data ?? [];
    }

    const existingById = new Map<string, ExistingMatch>();
    const existingByRef = new Map<string, ExistingMatch>();
    for (const m of existingMatches) {
      if (m.id) existingById.set(m.id, m);
      if (m.external_ref) existingByRef.set(m.external_ref, m);
    }

    // 3. Map and merge sync data with database records
    const mergedMatches = deduplicatedMatches.map(m => {
      const existing = (m.match_id ? existingById.get(m.match_id) : null) || 
                       (m.external_ref ? existingByRef.get(m.external_ref) : null);
      
      if (!existing) {
        // Skip match if it does not exist in DB (as we cannot construct the required NOT NULL fields)
        return null;
      }

      // Preserve existing score if it is not provided in payload
      const home_score = m.home_score !== undefined ? m.home_score : existing.home_score;
      const away_score = m.away_score !== undefined ? m.away_score : existing.away_score;

      return {
        id: existing.id,
        external_ref: m.external_ref || existing.external_ref,
        home_team: existing.home_team,
        away_team: existing.away_team,
        match_time: existing.match_time,
        status: m.status,
        home_score,
        away_score,
        updated_at: new Date().toISOString(),
      };
    }).filter((m): m is NonNullable<typeof m> => m !== null);

    let updated = 0;

    if (mergedMatches.length > 0) {
      // Upsert all merged matches in one bulk call
      const { data, error } = await supabase
        .from("matches")
        .upsert(mergedMatches, { onConflict: "id" })
        .select("id");
      
      if (error) {
        throw error;
      }
      updated = data?.length ?? 0;
    }

    return NextResponse.json(
      { success: true, updated },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error syncing matches:", error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

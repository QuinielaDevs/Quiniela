"use server";

import { createClient } from "@/utils/supabase/server";
import type { AwardCandidate, AwardCategory } from "@/types";

export async function searchAwardCandidates(
  query: string,
  category: AwardCategory,
): Promise<AwardCandidate[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("award_candidates")
    .select("*")
    .eq("category", category)
    .eq("is_active", true)
    .or(
      `name.ilike.%${q}%,team_name.ilike.%${q}%,flag_code.ilike.%${q}%`,
    )
    .order("display_order", { ascending: true })
    .limit(80);

  if (error) {
    console.error("searchAwardCandidates error:", error);
    return [];
  }

  return (data ?? []) as AwardCandidate[];
}

export async function getAwardCandidateById(
  id: string,
): Promise<AwardCandidate | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("award_candidates")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("getAwardCandidateById error:", error);
    return null;
  }

  return data as AwardCandidate | null;
}

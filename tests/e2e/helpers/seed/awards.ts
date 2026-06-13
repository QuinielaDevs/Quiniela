// Control de ganadores de premios especiales (Fase 1 del plan E2E).
// award_candidates es un catálogo GLOBAL: snapshot + restore obligatorios en
// cleanup, igual que las fases del torneo.

import { createAdminClient } from "../admin";

export type AwardCategory = "champion" | "top_scorer" | "mvp";

export interface WinnersSnapshot {
  /** ids de candidatos con is_winner=true al momento del snapshot. */
  winnerIds: string[];
}

export async function snapshotWinners(): Promise<WinnersSnapshot> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("award_candidates")
    .select("id")
    .eq("is_winner", true);
  if (error) {
    throw new Error(`Error leyendo ganadores actuales: ${error.message}`);
  }
  return { winnerIds: (data ?? []).map((row) => row.id as string) };
}

/** Marca al candidato como ganador de su categoría (desmarca al resto). */
export async function setWinner(category: AwardCategory, candidateId: string): Promise<void> {
  const admin = createAdminClient();
  const { error: clearError } = await admin
    .from("award_candidates")
    .update({ is_winner: false })
    .eq("category", category)
    .eq("is_winner", true);
  if (clearError) {
    throw new Error(`Error limpiando ganadores de ${category}: ${clearError.message}`);
  }

  const { error } = await admin
    .from("award_candidates")
    .update({ is_winner: true })
    .eq("id", candidateId)
    .eq("category", category);
  if (error) {
    throw new Error(`Error marcando ganador de ${category}: ${error.message}`);
  }
}

/** Desmarca TODOS los ganadores (estado del seed: ninguno). */
export async function clearWinners(): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("award_candidates")
    .update({ is_winner: false })
    .eq("is_winner", true);
  if (error) {
    throw new Error(`Error limpiando ganadores: ${error.message}`);
  }
}

export async function restoreWinners(snapshot: WinnersSnapshot): Promise<void> {
  await clearWinners();
  if (snapshot.winnerIds.length === 0) return;
  const admin = createAdminClient();
  const { error } = await admin
    .from("award_candidates")
    .update({ is_winner: true })
    .in("id", snapshot.winnerIds);
  if (error) {
    throw new Error(`Error restaurando ganadores: ${error.message}`);
  }
}

/** Busca un candidato activo de la categoría (para elegir ganador en tests). */
export async function getCandidate(
  category: AwardCategory,
  filter: { name?: string } = {},
): Promise<{ id: string; name: string; team_name: string | null }> {
  const admin = createAdminClient();
  let query = admin
    .from("award_candidates")
    .select("id, name, team_name")
    .eq("category", category)
    .eq("is_active", true)
    .order("display_order", { ascending: true })
    .limit(1);
  if (filter.name) {
    query = admin
      .from("award_candidates")
      .select("id, name, team_name")
      .eq("category", category)
      .ilike("name", `%${filter.name}%`)
      .limit(1);
  }
  const { data, error } = await query;
  if (error || !data || data.length === 0) {
    throw new Error(
      `No se encontró candidato de ${category}${filter.name ? ` con nombre ~ "${filter.name}"` : ""}: ${error?.message ?? "sin filas"}`,
    );
  }
  return data[0] as { id: string; name: string; team_name: string | null };
}

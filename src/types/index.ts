// Tipos de dominio derivados del esquema autogenerado (database.types.ts).
// Reutilizables en componentes, server actions y tests. Regenerar la fuente
// con `npm run db:types` tras cambiar el esquema.
import type { Database } from "@/types/database.types";

export type { Database } from "@/types/database.types";

/** Atajo a las filas (Row) de una tabla pública. */
type TableRow<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
type TableInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
type TableUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

// --- profiles ---
export type Profile = TableRow<"profiles">;
export type ProfileInsert = TableInsert<"profiles">;
export type ProfileUpdate = TableUpdate<"profiles">;

// --- leagues ---
export type League = TableRow<"leagues">;
export type LeagueInsert = TableInsert<"leagues">;
export type LeagueUpdate = TableUpdate<"leagues">;

// --- league_members ---
export type LeagueMember = TableRow<"league_members">;
export type LeagueMemberInsert = TableInsert<"league_members">;
export type LeagueMemberUpdate = TableUpdate<"league_members">;

/** Roles válidos de un miembro de liga (espeja el CHECK de la tabla). */
export type LeagueRole = "admin" | "member";
/** Estados de pago de un miembro (espeja el CHECK de la tabla). */
export type PaymentStatus = "pending" | "paid";

// --- award_candidates (Story 6.1) ---
export type AwardCandidate = TableRow<"award_candidates">;
export type AwardCandidateInsert = TableInsert<"award_candidates">;
export type AwardCandidateUpdate = TableUpdate<"award_candidates">;

// --- special_predictions (Story 6.1) ---
export type SpecialPrediction = TableRow<"special_predictions">;
export type SpecialPredictionInsert = TableInsert<"special_predictions">;
export type SpecialPredictionUpdate = TableUpdate<"special_predictions">;

/**
 * Categorías de galardón (espeja el CHECK de award_candidates/special_predictions).
 * RIESGO DE DRIFT: si cambias el CHECK en la migración, actualiza esta unión a mano
 * (database.types.ts genera `category: string`, no la unión literal). Mismo patrón
 * que LeagueRole/PaymentStatus en 1.2.
 */
export type AwardCategory = "champion" | "top_scorer" | "mvp";

/**
 * Resultado canónico de toda Server Action del proyecto (primera definida en 6.1).
 * Las Server Actions NUNCA propagan excepciones al cliente: capturan y devuelven
 * este sobre. Reutilizable por 1.3/1.4/2.x/5.x.
 */
export type ServerActionResult<T> = {
  success: boolean;
  data: T | null;
  error: string | null;
};

// Re-export AwardPhase from the canonical config so there is ONE definition.
export type { AwardPhase } from "@/config/tournamentPhases";

// DB row/insert/update types for tournament_phases.
export type TournamentPhase = TableRow<"tournament_phases">;
export type TournamentPhaseInsert = TableInsert<"tournament_phases">;
export type TournamentPhaseUpdate = TableUpdate<"tournament_phases">;


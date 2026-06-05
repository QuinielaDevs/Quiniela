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

// --- matches ---
export type Match = TableRow<"matches">;
export type MatchInsert = TableInsert<"matches">;
export type MatchUpdate = TableUpdate<"matches">;

// --- predictions ---
export type Prediction = TableRow<"predictions">;
export type PredictionInsert = TableInsert<"predictions">;
export type PredictionUpdate = TableUpdate<"predictions">;

// --- member_badges ---
export type MemberBadge = TableRow<"member_badges">;
export type MemberBadgeInsert = TableInsert<"member_badges">;
export type MemberBadgeUpdate = TableUpdate<"member_badges">;

// --- member_game_profiles ---
export type MemberGameProfile = TableRow<"member_game_profiles">;
export type MemberGameProfileInsert = TableInsert<"member_game_profiles">;
export type MemberGameProfileUpdate = TableUpdate<"member_game_profiles">;

/**
 * Estados válidos de un partido (espeja el CHECK de `matches.status`). Los tipos
 * generados lo tipan como `string`; mantener sincronizado con la migración
 * matches_and_predictions.sql y con `MatchStatus` en src/utils/scoring.ts.
 */
export type MatchStatus =
  | "scheduled"
  | "live"
  | "finished"
  | "suspended"
  | "canceled";

/** Roles válidos de un miembro de liga (espeja el CHECK de la tabla). */
export type LeagueRole = "admin" | "member";
/** Estados de pago de un miembro (espeja el CHECK de la tabla). */
export type PaymentStatus = "pending" | "paid";
/** Insignias válidas por jornada (espeja el CHECK de member_badges.badge_type). */
export type BadgeType = "nostradamus" | "el_salado" | "el_tibio";
/** Perfiles psicológicos válidos (espeja el CHECK de member_game_profiles.profile_type). */
export type GameProfileType =
  | "optimista"
  | "conservador"
  | "cazador_sorpresas";

// --- reglas de liga (columna leagues.rules JSONB) ---
/**
 * Modo de predicción de una liga. Se guarda una clave ESTABLE en
 * `rules.predictionMode` (no el label de la UI) para no romper datos si cambia
 * el texto del mockup. (Story 1.3 — admin-settings.html)
 */
export type PredictionMode = "dual" | "jornada" | "grupos";

/** Forma del JSONB `leagues.rules`. Crece en stories futuras. */
export type LeagueRules = { predictionMode: PredictionMode };

/**
 * Contrato de retorno de TODA Server Action (Story 1.3, primer uso).
 * La acción atrapa con try/catch y NUNCA propaga excepciones al cliente:
 * éxito → { success:true, data, error:null }; fallo → { success:false, data:null, error }.
 * `warning` es opcional para flujos parcialmente exitosos con acción secundaria
 * reintentable (p. ej. resultado guardado, pero avance de bracket pendiente).
 * [Source: architecture.md#Format Patterns / #Error Handling Patterns]
 */
export type ServerActionResult<T> = {
  success: boolean;
  data: T | null;
  error: string | null;
  warning?: string | null;
};

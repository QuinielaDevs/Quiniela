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

// Cliente admin (service role) compartido por todos los helpers E2E.
// Extraído de auth.ts/seed.ts (Fase 1 del plan E2E) para no duplicar la
// creación del cliente ni la validación de variables de entorno.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name}. ` +
        "Asegúrate de que Supabase local está corriendo y exportado en el entorno (CI usa `supabase status -o env`).",
    );
  }
  return value;
}

// Cliente con service role: bypass de RLS y sin sesión persistida. Es la única
// vía válida para escribir columnas protegidas (predictions.multiplier /
// points_earned tienen REVOKE para authenticated) y para mover estado global
// de test (tournament_phases, award_candidates).
export function createAdminClient(): SupabaseClient {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// Cliente anónimo (anon key) para ejercitar RPCs autenticándose como un usuario
// real con signInWithPassword — misma ruta que producción (seed/challenges.ts).
export function createAnonClient(): SupabaseClient {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_ANON_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

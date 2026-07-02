import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Map local Supabase CLI env keys to E2E expected keys
const url = process.env.SUPABASE_URL || process.env.API_URL || process.env.api_external_url;
if (url) {
  process.env.SUPABASE_URL = url;
}
const anon = process.env.SUPABASE_ANON_KEY || process.env.ANON_KEY || process.env.anon_key;
if (anon) {
  process.env.SUPABASE_ANON_KEY = anon;
}
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.service_role_key;
if (svc) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = svc;
}

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

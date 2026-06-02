import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Helpers para instanciar clientes de Supabase con distintas identidades
// contra la instancia LOCAL de Supabase. Se usan en las pruebas de
// integración (RLS, triggers, lógica de negocio) de esta y futuras stories.
//
// Reglas clave:
//   - service_role: BYPASSA RLS. Para fixtures/seed y aserciones de admin.
//   - anon:         RESPETA RLS. Simula un usuario NO autenticado.
//   - authed(jwt):  RESPETA RLS bajo la identidad del JWT provisto.
//   - Todos usan persistSession:false para aislar sesiones entre tests.

const noPersist = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name}. ` +
        `Genera .env.test.local con \`npx supabase status -o env\` o expórtala en CI.`,
    );
  }
  return value;
}

/** Cliente con la clave `service_role`: bypassa RLS (admin/fixtures). */
export function createServiceRoleClient(): SupabaseClient {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    noPersist,
  );
}

/** Cliente con la clave `anon`: respeta RLS (usuario no autenticado). */
export function createAnonClient(): SupabaseClient {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_ANON_KEY"),
    noPersist,
  );
}

/**
 * Cliente autenticado: usa la clave `anon` como apikey pero adjunta el
 * access token (JWT) del usuario en el header Authorization, de modo que
 * RLS evalúe las políticas bajo esa identidad.
 */
export function createAuthedClient(accessToken: string): SupabaseClient {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_ANON_KEY"),
    {
      ...noPersist,
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    },
  );
}

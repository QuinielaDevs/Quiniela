// setupFile del proyecto "integration".
// Carga las credenciales del Supabase local desde archivos .env locales.
// dotenv NO sobreescribe variables ya presentes en process.env, por lo que
// en CI (donde se exportan directamente desde `supabase status -o env`) esas
// tienen precedencia sobre cualquier archivo.
import { config } from "dotenv";

config({ path: ".env.test.local" });
config({ path: ".env.test" });

// Map local Supabase CLI env keys to Vitest expected keys
const url = process.env.api_external_url || process.env.API_URL || process.env.supabase_url || process.env.SUPABASE_URL;
if (url && !process.env.SUPABASE_URL) {
  process.env.SUPABASE_URL = url;
}
const anon = process.env.anon_key || process.env.ANON_KEY || process.env.supabase_anon_key || process.env.SUPABASE_ANON_KEY;
if (anon && !process.env.SUPABASE_ANON_KEY) {
  process.env.SUPABASE_ANON_KEY = anon;
}
const svc = process.env.service_role_key || process.env.SERVICE_ROLE_KEY || process.env.supabase_service_role_key || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (svc && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = svc;
}

// Auto-configure webhook secret fallback for integration tests
process.env.ZAFRONIX_WEBHOOK_SECRET =
  process.env.ZAFRONIX_WEBHOOK_SECRET ??
  "whsec_test_secret_for_integration_tests_only";

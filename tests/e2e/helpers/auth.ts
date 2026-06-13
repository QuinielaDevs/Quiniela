// Façade de compatibilidad (Fase 1 del plan E2E): la implementación vive en
// users.ts (creación de usuarios + login por el formulario real) y admin.ts
// (cliente service role). Los specs existentes siguen importando desde aquí.
//
// La estrategia de auth sigue siendo FORM-BASED (deliberada, NO forjar
// cookies): pasar por /auth/login setea las cookies chunked/base64 que
// Supabase SSR espera, igual que un usuario real.

export {
  createAuthenticatedContext,
  deleteE2EUser,
  loginAs,
  loginViaForm,
  createUser,
  TEST_PASSWORD,
  type E2EAuth,
  type E2EUser,
} from "./users";

export { createAdminClient, requireEnv } from "./admin";

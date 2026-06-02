import { describe, it, expect } from "vitest";
import { createServiceRoleClient } from "./setup";

// Smoke test de integración: verifica que el andamiaje conecta con la
// instancia LOCAL de Supabase usando la identidad service_role.
// Aún no hay tablas de negocio (el esquema llega en la Story 1.2), así que
// validamos la conectividad contra un endpoint de admin (GoTrue) que sólo
// responde con la clave service_role.
describe("Conexión a Supabase local", () => {
  it("el cliente service_role conecta y responde sin error", async () => {
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase.auth.admin.listUsers();

    expect(error).toBeNull();
    expect(Array.isArray(data.users)).toBe(true);
  });
});

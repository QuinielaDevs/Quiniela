import { afterEach, describe, expect, it } from "vitest";
import { createServiceRoleClient } from "./setup";

// AC #3 / #4: al crear un usuario en auth.users, el trigger
// tr_on_auth_user_created → fn_handle_new_user materializa su fila en
// public.profiles, aplicando defaults cuando la metadata viene nula/vacía.

const admin = createServiceRoleClient();
const createdUserIds: string[] = [];

afterEach(async () => {
  // Limpieza: borrar el usuario borra el perfil por FK on delete cascade.
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await admin.auth.admin.deleteUser(id);
  }
});

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

describe("Trigger de perfil (fn_handle_new_user)", () => {
  it("crea el perfil con la metadata completa de Google", async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: uniqueEmail("full"),
      email_confirm: true,
      user_metadata: {
        full_name: "Cris Horn",
        avatar_url: "https://example.com/cris.png",
      },
    });
    expect(error).toBeNull();
    const userId = data.user!.id;
    createdUserIds.push(userId);

    const { data: profile, error: pErr } = await admin
      .from("profiles")
      .select("id, email, display_name, avatar_url")
      .eq("id", userId)
      .single();

    expect(pErr).toBeNull();
    expect(profile!.display_name).toBe("Cris Horn");
    expect(profile!.avatar_url).toBe("https://example.com/cris.png");
  });

  it("aplica defaults cuando la metadata es nula o vacía", async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: uniqueEmail("empty"),
      email_confirm: true,
      user_metadata: { full_name: "   ", avatar_url: "" },
    });
    expect(error).toBeNull();
    const userId = data.user!.id;
    createdUserIds.push(userId);

    const { data: profile, error: pErr } = await admin
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", userId)
      .single();

    expect(pErr).toBeNull();
    expect(profile!.display_name).toBe("Jugador Anónimo");
    expect(profile!.avatar_url).toBe("/assets/avatars/default-player.svg");
  });
});

import { afterAll, describe, expect, it } from "vitest";
import { createAnonClient, createServiceRoleClient } from "./setup";

const admin = createServiceRoleClient();
const createdUserIds: string[] = [];

afterAll(async () => {
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await admin.auth.admin.deleteUser(id);
  }
});

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

function uniqueInvite(): string {
  return `LAND${Date.now().toString(36).toUpperCase()}${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
}

async function createOwner() {
  const { data, error } = await admin.auth.admin.createUser({
    email: uniqueEmail("landing-owner"),
    email_confirm: true,
    user_metadata: {
      full_name: "Cris Admin",
      avatar_url: "/assets/avatars/default-player.svg",
    },
  });
  expect(error).toBeNull();
  const id = data.user!.id;
  createdUserIds.push(id);
  return id;
}

describe("fn_get_invite_landing", () => {
  it("permite a anon leer solo los datos mínimos de bienvenida", async () => {
    const ownerId = await createOwner();
    const inviteCode = uniqueInvite();
    await admin.from("leagues").insert({
      name: "La Pija Quiniela",
      created_by: ownerId,
      invite_code: inviteCode,
      requires_payment: true,
      payment_amount: 10,
      payment_instructions: "Zelle: cris@test.local",
      rules: { predictionMode: "dual" },
    });

    const anon = createAnonClient();
    const { data, error } = await anon.rpc("fn_get_invite_landing", {
      p_invite_code: inviteCode.toLowerCase(),
    }).single();

    expect(error).toBeNull();
    expect(data).toMatchObject({
      league_name: "La Pija Quiniela",
      creator_display_name: "Cris Admin",
      creator_avatar_url: "/assets/avatars/default-player.svg",
      requires_payment: true,
      payment_amount: 10,
      payment_instructions: "Zelle: cris@test.local",
      invite_code: inviteCode,
    });
    expect(data).not.toHaveProperty("created_by");
    expect(data).not.toHaveProperty("email");
  });

  it("rechaza invitaciones inexistentes con error estándar", async () => {
    const anon = createAnonClient();

    const { error } = await anon.rpc("fn_get_invite_landing", {
      p_invite_code: "LANDNOPE",
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("22023");
    expect(error?.message).toContain("Invitación inválida");
  });
});

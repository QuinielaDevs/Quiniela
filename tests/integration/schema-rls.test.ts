import { afterAll, describe, expect, it } from "vitest";
import {
  createAnonClient,
  createAuthedClient,
  createServiceRoleClient,
} from "./setup";

// AC #2: RLS bloquea la escritura de usuarios no autenticados (anon) y permite
// a un usuario autenticado crear ligas solo declarándose como creador.

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
  return `INV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Crea un usuario confirmado y devuelve {id, accessToken} autenticado. */
async function createAuthedUser(): Promise<{ id: string; token: string }> {
  const email = uniqueEmail("user");
  const password = "Password123!";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  expect(error).toBeNull();
  const id = data.user!.id;
  createdUserIds.push(id);

  const anon = createAnonClient();
  const { data: signIn, error: sErr } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  expect(sErr).toBeNull();
  return { id, token: signIn.session!.access_token };
}

// Código de error de PostgreSQL para violación de RLS ("new row violates
// row-level security policy"). Lo afirmamos explícitamente para garantizar que
// el bloqueo es por RLS y NO por otra restricción (p. ej. una FK), evitando un
// falso positivo de cobertura.
const RLS_VIOLATION = "42501";

describe("RLS: escritura anónima bloqueada", () => {
  it("anon NO puede insertar en leagues (bloqueado por RLS, no por FK)", async () => {
    const anon = createAnonClient();
    const { error } = await anon.from("leagues").insert({
      name: "Liga Pirata",
      created_by: crypto.randomUUID(),
      invite_code: uniqueInvite(),
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("anon NO puede insertar en profiles (bloqueado por RLS)", async () => {
    const anon = createAnonClient();
    const { error } = await anon.from("profiles").insert({
      id: crypto.randomUUID(),
      display_name: "Intruso",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe(RLS_VIOLATION);
  });
});

describe("RLS: pertenencia y roles de league_members", () => {
  it("un usuario puede unirse a su propia liga como 'member'", async () => {
    const user = await createAuthedUser();
    const client = createAuthedClient(user.token);

    const { data: league, error: lErr } = await client
      .from("leagues")
      .insert({
        name: "Liga Propia",
        created_by: user.id,
        invite_code: uniqueInvite(),
      })
      .select("id")
      .single();
    expect(lErr).toBeNull();

    const { error } = await client.from("league_members").insert({
      league_id: league!.id,
      user_id: user.id,
      role: "member",
    });
    expect(error).toBeNull();
  });

  it("un usuario NO puede auto-insertarse como 'admin' (RLS bloquea la auto-promoción)", async () => {
    const user = await createAuthedUser();
    const client = createAuthedClient(user.token);

    const { data: league } = await client
      .from("leagues")
      .insert({
        name: "Liga Sin Auto-Admin",
        created_by: user.id,
        invite_code: uniqueInvite(),
      })
      .select("id")
      .single();

    const { error } = await client.from("league_members").insert({
      league_id: league!.id,
      user_id: user.id,
      role: "admin", // auto-promoción → with_check de RLS debe rechazar
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe(RLS_VIOLATION);
  });
});

describe("RLS: usuario autenticado y ligas", () => {
  it("un usuario puede crear una liga declarándose como creador", async () => {
    const user = await createAuthedUser();
    const client = createAuthedClient(user.token);

    const { data, error } = await client
      .from("leagues")
      .insert({
        name: "Liga de Cris",
        created_by: user.id,
        invite_code: uniqueInvite(),
      })
      .select("id, created_by")
      .single();

    expect(error).toBeNull();
    expect(data!.created_by).toBe(user.id);
  });

  it("un usuario NO puede crear una liga a nombre de otro", async () => {
    const userA = await createAuthedUser();
    const userB = await createAuthedUser();
    const clientA = createAuthedClient(userA.token);

    const { error } = await clientA.from("leagues").insert({
      name: "Liga Suplantada",
      created_by: userB.id, // distinto de auth.uid() → with_check falla
      invite_code: uniqueInvite(),
    });

    expect(error).not.toBeNull();
  });
});

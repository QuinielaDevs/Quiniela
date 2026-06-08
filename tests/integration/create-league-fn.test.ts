import { afterAll, describe, expect, it } from "vitest";
import {
  createAnonClient,
  createAuthedClient,
  createServiceRoleClient,
} from "./setup";
import type { League } from "@/types";

// Story 1.3 — RPC atómico fn_create_league (AC #3, #4).
// Verifica: creación de liga + membresía admin del creador en una sola
// transacción; bloqueo de anónimos; atomicidad ante invite_code duplicado.

const admin = createServiceRoleClient();
const createdUserIds: string[] = [];

afterAll(async () => {
  // Borrar el usuario arrastra (FK cascade) sus ligas y membresías.
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await admin.auth.admin.deleteUser(id);
  }
});

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

function uniqueInvite(): string {
  return `INV${Date.now()}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

async function createAuthedUser(): Promise<{ id: string; token: string }> {
  const email = uniqueEmail("creator");
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

const RLS_VIOLATION = "42501";

describe("fn_create_league: creación atómica", () => {
  it("crea la liga y registra al creador como miembro admin", async () => {
    const user = await createAuthedUser();
    const client = createAuthedClient(user.token);
    const invite = uniqueInvite();

    const { data, error } = await client
      .rpc("fn_create_league", {
        p_name: "Liga de Cris",
        p_invite_code: invite,
        p_prediction_mode: "dual",
        p_requires_payment: true,
        p_payment_amount: 10,
        p_payment_instructions: "Zelle: cris@test.local",
      })
      .single();
    const league = data as League | null;

    expect(error).toBeNull();
    expect(league!.created_by).toBe(user.id);
    expect(league!.invite_code).toBe(invite);
    expect(league!.requires_payment).toBe(true);
    expect(league!.rules).toEqual({ predictionMode: "dual" });

    // El creador debe existir como miembro admin de esa liga.
    const { data: member, error: mErr } = await admin
      .from("league_members")
      .select("user_id, role, payment_status")
      .eq("league_id", league!.id)
      .eq("user_id", user.id)
      .single();

    expect(mErr).toBeNull();
    expect(member!.role).toBe("admin");
    expect(member!.payment_status).toBe("pending");

    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("active_league_id")
      .eq("id", user.id)
      .single();

    expect(profileErr).toBeNull();
    expect(profile!.active_league_id).toBe(league!.id);
  });

  it("persiste null en los campos de pago cuando se omiten", async () => {
    const user = await createAuthedUser();
    const client = createAuthedClient(user.token);

    const { data, error } = await client
      .rpc("fn_create_league", {
        p_name: "Liga Gratis",
        p_invite_code: uniqueInvite(),
        p_prediction_mode: "jornada",
        p_requires_payment: false,
      })
      .single();
    const league = data as League | null;

    expect(error).toBeNull();
    expect(league!.requires_payment).toBe(false);
    expect(league!.payment_amount).toBeNull();
    expect(league!.payment_instructions).toBeNull();
  });

  it("bloquea al cliente anónimo (sin auth.uid())", async () => {
    const anon = createAnonClient();
    const { error } = await anon
      .rpc("fn_create_league", {
        p_name: "Liga Pirata",
        p_invite_code: uniqueInvite(),
        p_prediction_mode: "dual",
      })
      .single();

    // La función lanza errcode 42501 cuando auth.uid() es null.
    expect(error).not.toBeNull();
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("es atómico: un invite_code duplicado no deja liga ni membresía huérfanas", async () => {
    const user = await createAuthedUser();
    const client = createAuthedClient(user.token);
    const invite = uniqueInvite();

    // Primera creación OK.
    const { data: firstData, error: firstErr } = await client
      .rpc("fn_create_league", {
        p_name: "Liga Original",
        p_invite_code: invite,
        p_prediction_mode: "dual",
      })
      .single();
    const first = firstData as League | null;
    expect(firstErr).toBeNull();

    // Conteo de ligas/membresías del usuario antes del intento fallido.
    const { count: leaguesBefore } = await admin
      .from("leagues")
      .select("id", { count: "exact", head: true })
      .eq("created_by", user.id);
    const { count: membersBefore } = await admin
      .from("league_members")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    // Segunda creación con el MISMO invite_code → viola unique (23505).
    const { error: dupErr } = await client
      .rpc("fn_create_league", {
        p_name: "Liga Duplicada",
        p_invite_code: invite,
        p_prediction_mode: "dual",
      })
      .single();
    expect(dupErr).not.toBeNull();
    expect(dupErr?.code).toBe("23505");

    // No debe haberse creado liga ni membresía nuevas (rollback de la función).
    const { count: leaguesAfter } = await admin
      .from("leagues")
      .select("id", { count: "exact", head: true })
      .eq("created_by", user.id);
    const { count: membersAfter } = await admin
      .from("league_members")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    expect(leaguesAfter).toBe(leaguesBefore);
    expect(membersAfter).toBe(membersBefore);
    expect(first!.invite_code).toBe(invite);
  });
});

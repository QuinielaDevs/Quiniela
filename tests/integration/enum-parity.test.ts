import { afterAll, describe, expect, it } from "vitest";
import {
  createAnonClient,
  createAuthedClient,
  createServiceRoleClient,
} from "./setup";
import {
  MATCH_STATUSES,
  LEAGUE_ROLES,
  PAYMENT_STATUSES,
  PREDICTION_MODES,
} from "@/types";

// Paridad tipos↔BD: valida que los arrays-constante de src/types/index.ts (fuente
// única en TS, de la que se DERIVAN los tipos) coincidan con los CHECK reales de
// la BD. Cierra la deuda diferida de 1.2/2.1 ("tipos sincronizados a mano →
// drift silencioso"). Detecta el drift de forma conductual: cada literal del
// array debe ser aceptado por la BD, y un valor fuera del array debe rechazarse.

const admin = createServiceRoleClient();
const PG_CHECK_VIOLATION = "23514";

const createdUserIds: string[] = [];
const createdMatchIds: string[] = [];

afterAll(async () => {
  if (createdMatchIds.length > 0) {
    await admin.from("matches").delete().in("id", createdMatchIds);
  }
  while (createdUserIds.length > 0) {
    // Borrar el usuario cascada elimina sus ligas (created_by) y membresías.
    await admin.auth.admin.deleteUser(createdUserIds.pop()!);
  }
});

function uniq(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createUser(): Promise<{ id: string; token: string }> {
  const email = `${uniq("enum")}@test.local`;
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
  const { data: signIn } = await anon.auth.signInWithPassword({ email, password });
  return { id, token: signIn.session!.access_token };
}

describe("paridad enum: matches.status", () => {
  it("la BD acepta exactamente cada MATCH_STATUSES", async () => {
    for (const status of MATCH_STATUSES) {
      const { data, error } = await admin
        .from("matches")
        .insert({
          home_team: "A",
          away_team: "B",
          match_time: new Date().toISOString(),
          status,
        })
        .select("id")
        .single();
      expect(error, `status válido rechazado: ${status}`).toBeNull();
      if (data?.id) createdMatchIds.push(data.id);
    }
  });

  it("la BD rechaza un status fuera del array (CHECK 23514)", async () => {
    const { error } = await admin.from("matches").insert({
      home_team: "A",
      away_team: "B",
      match_time: new Date().toISOString(),
      status: "drifted_status",
    });
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });
});

describe("paridad enum: league_members.role / payment_status", () => {
  it("la BD acepta cada LEAGUE_ROLES y PAYMENT_STATUSES, y rechaza otros", async () => {
    const { id } = await createUser();
    const { data: league, error: lErr } = await admin
      .from("leagues")
      .insert({ name: "Liga Paridad", created_by: id, invite_code: uniq("INV") })
      .select("id")
      .single();
    expect(lErr).toBeNull();

    const { data: member } = await admin
      .from("league_members")
      .insert({ league_id: league!.id, user_id: id, role: "admin" })
      .select("id")
      .single();

    for (const role of LEAGUE_ROLES) {
      const { error } = await admin
        .from("league_members")
        .update({ role })
        .eq("id", member!.id);
      expect(error, `role válido rechazado: ${role}`).toBeNull();
    }
    for (const ps of PAYMENT_STATUSES) {
      const { error } = await admin
        .from("league_members")
        .update({ payment_status: ps })
        .eq("id", member!.id);
      expect(error, `payment_status válido rechazado: ${ps}`).toBeNull();
    }

    const { error: roleErr } = await admin
      .from("league_members")
      .update({ role: "superadmin" })
      .eq("id", member!.id);
    expect(roleErr?.code).toBe(PG_CHECK_VIOLATION);

    const { error: psErr } = await admin
      .from("league_members")
      .update({ payment_status: "refunded" })
      .eq("id", member!.id);
    expect(psErr?.code).toBe(PG_CHECK_VIOLATION);
  });
});

describe("paridad enum: PredictionMode (validado en fn_create_league)", () => {
  it("fn_create_league acepta cada PREDICTION_MODES y rechaza otros", async () => {
    const { token } = await createUser();
    const authed = createAuthedClient(token);

    for (const mode of PREDICTION_MODES) {
      const { error } = await authed.rpc("fn_create_league", {
        p_name: "Liga Modo",
        p_invite_code: uniq("INV"),
        p_prediction_mode: mode,
      });
      expect(error, `modo válido rechazado: ${mode}`).toBeNull();
    }

    const { error: badMode } = await authed.rpc("fn_create_league", {
      p_name: "Liga Modo",
      p_invite_code: uniq("INV"),
      p_prediction_mode: "telepatia",
    });
    // fn_create_league lanza 22023 (invalid_parameter_value) para modo inválido.
    expect(badMode?.code).toBe("22023");
  });
});

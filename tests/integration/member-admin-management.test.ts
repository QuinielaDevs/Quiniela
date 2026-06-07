import { afterAll, describe, expect, it } from "vitest";
import {
  createAnonClient,
  createAuthedClient,
  createServiceRoleClient,
} from "./setup";

// Story 3.3 — gestión de miembros por el admin vía RPCs SECURITY DEFINER.
// Verifica: toggle de pago (admin sí / no-admin / anon no), expulsión con
// cascada de borrado de predicciones (trigger), guardas (auto-expulsión, último
// admin) y aislamiento entre ligas. NO toca tests/integration/triggers.test.ts.

const admin = createServiceRoleClient();
const RLS_VIOLATION = "42501";

const createdUserIds: string[] = [];
const createdLeagueIds: string[] = [];
const createdMatchIds: string[] = [];

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

function uniqueInvite(): string {
  return `ADM${Date.now()}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

async function createAuthedUser(): Promise<{ id: string; token: string }> {
  const email = uniqueEmail("adm");
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

/**
 * Crea una liga (con service_role) y registra a sus miembros. El primero es
 * admin; el resto, member/pending. Devuelve el league_id.
 */
async function seedLeague(
  adminUser: { id: string },
  memberUsers: { id: string }[],
): Promise<string> {
  const { data: league, error: lErr } = await admin
    .from("leagues")
    .insert({
      name: "Liga Admin 3.3",
      created_by: adminUser.id,
      invite_code: uniqueInvite(),
    })
    .select("id")
    .single();
  expect(lErr).toBeNull();
  const leagueId = league!.id as string;
  createdLeagueIds.push(leagueId);

  const rows = [
    { league_id: leagueId, user_id: adminUser.id, role: "admin", payment_status: "pending" },
    ...memberUsers.map((m) => ({
      league_id: leagueId,
      user_id: m.id,
      role: "member",
      payment_status: "pending",
    })),
  ];
  const { error: mErr } = await admin.from("league_members").insert(rows);
  expect(mErr).toBeNull();
  return leagueId;
}

async function seedFinishedMatchWithPrediction(
  leagueId: string,
  userId: string,
): Promise<string> {
  const { data: match, error: matchErr } = await admin
    .from("matches")
    .insert({
      home_team: "A",
      away_team: "B",
      match_time: new Date(Date.now() - 86_400_000).toISOString(),
      status: "finished",
      home_score: 1,
      away_score: 0,
      matchday: 1,
    })
    .select("id")
    .single();
  expect(matchErr).toBeNull();
  const matchId = match!.id as string;
  createdMatchIds.push(matchId);

  const { error: predErr } = await admin.from("predictions").insert({
    league_id: leagueId,
    match_id: matchId,
    user_id: userId,
    home_score_pred: 1,
    away_score_pred: 0,
  });
  expect(predErr).toBeNull();
  return matchId;
}

/** Siembra una medalla y un perfil de juego (Story 3.2) para un miembro. */
async function seedMemberAwards(leagueId: string, userId: string): Promise<void> {
  const { error: badgeErr } = await admin.from("member_badges").insert({
    league_id: leagueId,
    user_id: userId,
    matchday: 1,
    badge_type: "nostradamus",
    badge_label: "Nostradamus",
    reason: "Acierto improbable",
    points: 0,
  });
  expect(badgeErr).toBeNull();

  const { error: profileErr } = await admin
    .from("member_game_profiles")
    .insert({
      league_id: leagueId,
      user_id: userId,
      matchday: 1,
      profile_type: "conservador",
      profile_label: "Conservador",
      summary: "Juega a lo seguro",
    });
  expect(profileErr).toBeNull();
}

afterAll(async () => {
  // Limpieza explícita de partidos creados (no cuelgan de un usuario por FK).
  for (const id of createdMatchIds) {
    await admin.from("matches").delete().eq("id", id);
  }
  // Borrar usuarios arrastra (FK cascade) ligas, membresías y predicciones.
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await admin.auth.admin.deleteUser(id);
  }
});

describe("fn_set_member_payment_status", () => {
  it("un admin alterna el estado de pago de un miembro (pending ↔ paid)", async () => {
    const adminUser = await createAuthedUser();
    const member = await createAuthedUser();
    const leagueId = await seedLeague(adminUser, [member]);

    const client = createAuthedClient(adminUser.token);

    const { data: toPaid, error: e1 } = await client
      .rpc("fn_set_member_payment_status", {
        p_league_id: leagueId,
        p_user_id: member.id,
        p_status: "paid",
      })
      .single();
    expect(e1).toBeNull();
    expect((toPaid as { payment_status: string }).payment_status).toBe("paid");

    const { data: toPending, error: e2 } = await client
      .rpc("fn_set_member_payment_status", {
        p_league_id: leagueId,
        p_user_id: member.id,
        p_status: "pending",
      })
      .single();
    expect(e2).toBeNull();
    expect((toPending as { payment_status: string }).payment_status).toBe(
      "pending",
    );
  });

  it("rechaza un estado inválido (22023)", async () => {
    const adminUser = await createAuthedUser();
    const leagueId = await seedLeague(adminUser, []);
    const client = createAuthedClient(adminUser.token);

    const { error } = await client
      .rpc("fn_set_member_payment_status", {
        p_league_id: leagueId,
        p_user_id: adminUser.id,
        p_status: "frozen",
      })
      .single();
    expect(error?.code).toBe("22023");
  });

  it("un no-admin (member) no puede cambiar el pago (42501)", async () => {
    const adminUser = await createAuthedUser();
    const member = await createAuthedUser();
    const leagueId = await seedLeague(adminUser, [member]);

    const memberClient = createAuthedClient(member.token);
    const { error } = await memberClient
      .rpc("fn_set_member_payment_status", {
        p_league_id: leagueId,
        p_user_id: member.id,
        p_status: "paid",
      })
      .single();
    expect(error?.code).toBe(RLS_VIOLATION);

    // No mutó nada.
    const { data: row } = await admin
      .from("league_members")
      .select("payment_status")
      .eq("league_id", leagueId)
      .eq("user_id", member.id)
      .single();
    expect(row!.payment_status).toBe("pending");
  });

  it("el cliente anónimo no puede cambiar el pago", async () => {
    const adminUser = await createAuthedUser();
    const member = await createAuthedUser();
    const leagueId = await seedLeague(adminUser, [member]);

    const anon = createAnonClient();
    const { error } = await anon
      .rpc("fn_set_member_payment_status", {
        p_league_id: leagueId,
        p_user_id: member.id,
        p_status: "paid",
      })
      .single();
    expect(error).not.toBeNull();
  });

  it("un admin no puede tocar miembros de OTRA liga (aislamiento)", async () => {
    const adminA = await createAuthedUser();
    const leagueA = await seedLeague(adminA, []);

    const adminB = await createAuthedUser();
    const memberB = await createAuthedUser();
    const leagueB = await seedLeague(adminB, [memberB]);
    void leagueA;

    // adminA intenta cambiar el pago de un miembro de la liga B.
    const clientA = createAuthedClient(adminA.token);
    const { error } = await clientA
      .rpc("fn_set_member_payment_status", {
        p_league_id: leagueB,
        p_user_id: memberB.id,
        p_status: "paid",
      })
      .single();
    expect(error?.code).toBe(RLS_VIOLATION);
  });
});

describe("fn_promote_member_to_admin", () => {
  it("un admin promueve a otro miembro como admin", async () => {
    const adminUser = await createAuthedUser();
    const member = await createAuthedUser();
    const leagueId = await seedLeague(adminUser, [member]);

    const client = createAuthedClient(adminUser.token);
    const { data, error } = await client
      .rpc("fn_promote_member_to_admin", {
        p_league_id: leagueId,
        p_user_id: member.id,
      })
      .single();

    expect(error).toBeNull();
    expect((data as { role: string }).role).toBe("admin");

    const { data: row } = await admin
      .from("league_members")
      .select("role")
      .eq("league_id", leagueId)
      .eq("user_id", member.id)
      .single();
    expect(row!.role).toBe("admin");
  });

  it("un no-admin no puede promover miembros", async () => {
    const adminUser = await createAuthedUser();
    const member = await createAuthedUser();
    const target = await createAuthedUser();
    const leagueId = await seedLeague(adminUser, [member, target]);

    const memberClient = createAuthedClient(member.token);
    const { error } = await memberClient
      .rpc("fn_promote_member_to_admin", {
        p_league_id: leagueId,
        p_user_id: target.id,
      })
      .single();
    expect(error?.code).toBe(RLS_VIOLATION);

    const { data: stillMember } = await admin
      .from("league_members")
      .select("role")
      .eq("league_id", leagueId)
      .eq("user_id", target.id)
      .single();
    expect(stillMember!.role).toBe("member");
  });
});

describe("fn_remove_member (expulsión + cascada)", () => {
  it("un admin expulsa a un miembro y el trigger borra en cascada sus predicciones, medallas y perfil en la liga", async () => {
    const adminUser = await createAuthedUser();
    const member = await createAuthedUser();
    const other = await createAuthedUser();
    const leagueId = await seedLeague(adminUser, [member, other]);

    await seedFinishedMatchWithPrediction(leagueId, member.id);
    await seedFinishedMatchWithPrediction(leagueId, other.id);
    await seedMemberAwards(leagueId, member.id);
    await seedMemberAwards(leagueId, other.id);

    const client = createAuthedClient(adminUser.token);
    const { error } = await client.rpc("fn_remove_member", {
      p_league_id: leagueId,
      p_user_id: member.id,
    });
    expect(error).toBeNull();

    // La membresía desaparece.
    const { data: gone } = await admin
      .from("league_members")
      .select("id")
      .eq("league_id", leagueId)
      .eq("user_id", member.id);
    expect(gone).toEqual([]);

    // Predicciones, medallas y perfil del expulsado borrados por el trigger.
    const { data: preds } = await admin
      .from("predictions")
      .select("id")
      .eq("league_id", leagueId)
      .eq("user_id", member.id);
    expect(preds).toEqual([]);

    const { data: badges } = await admin
      .from("member_badges")
      .select("id")
      .eq("league_id", leagueId)
      .eq("user_id", member.id);
    expect(badges).toEqual([]);

    const { data: profiles } = await admin
      .from("member_game_profiles")
      .select("id")
      .eq("league_id", leagueId)
      .eq("user_id", member.id);
    expect(profiles).toEqual([]);

    // Los datos de OTRO miembro permanecen intactos.
    const { data: otherPreds } = await admin
      .from("predictions")
      .select("id")
      .eq("league_id", leagueId)
      .eq("user_id", other.id);
    expect(otherPreds!.length).toBe(1);
    const { data: otherBadges } = await admin
      .from("member_badges")
      .select("id")
      .eq("league_id", leagueId)
      .eq("user_id", other.id);
    expect(otherBadges!.length).toBe(1);
    const { data: otherProfiles } = await admin
      .from("member_game_profiles")
      .select("id")
      .eq("league_id", leagueId)
      .eq("user_id", other.id);
    expect(otherProfiles!.length).toBe(1);
  });

  it("un no-admin no puede expulsar (42501)", async () => {
    const adminUser = await createAuthedUser();
    const member = await createAuthedUser();
    const target = await createAuthedUser();
    const leagueId = await seedLeague(adminUser, [member, target]);

    const memberClient = createAuthedClient(member.token);
    const { error } = await memberClient.rpc("fn_remove_member", {
      p_league_id: leagueId,
      p_user_id: target.id,
    });
    expect(error?.code).toBe(RLS_VIOLATION);

    const { data: stillThere } = await admin
      .from("league_members")
      .select("id")
      .eq("league_id", leagueId)
      .eq("user_id", target.id);
    expect(stillThere!.length).toBe(1);
  });

  it("un admin no puede expulsarse a sí mismo (42501)", async () => {
    const adminUser = await createAuthedUser();
    const member = await createAuthedUser();
    const leagueId = await seedLeague(adminUser, [member]);

    const client = createAuthedClient(adminUser.token);
    const { error } = await client.rpc("fn_remove_member", {
      p_league_id: leagueId,
      p_user_id: adminUser.id,
    });
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("la liga nunca se queda sin admin: un admin puede expulsar a otro admin pero no dejarla huérfana", async () => {
    // Con dos admins, A puede expulsar a B (queda 1 admin → permitido). Luego A,
    // ya único admin, no puede auto-expulsarse (guarda de auto-expulsión) — que
    // es la protección efectiva del único admin en flujo secuencial. La rama
    // `v_admin_count <= 1` + `FOR UPDATE` cubre además la carrera concurrente.
    const adminA = await createAuthedUser();
    const adminB = await createAuthedUser();
    const leagueId = await seedLeague(adminA, []);
    // Promover a B como segundo admin (no hay flujo de cliente para esto aún).
    const { error: upErr } = await admin.from("league_members").insert({
      league_id: leagueId,
      user_id: adminB.id,
      role: "admin",
      payment_status: "pending",
    });
    expect(upErr).toBeNull();

    // A expulsa a B → queda A (1 admin). Permitido.
    const clientA = createAuthedClient(adminA.token);
    const { error: e1 } = await clientA.rpc("fn_remove_member", {
      p_league_id: leagueId,
      p_user_id: adminB.id,
    });
    expect(e1).toBeNull();

    // Invariante: sigue habiendo exactamente 1 admin.
    const { count: adminCount } = await admin
      .from("league_members")
      .select("id", { count: "exact", head: true })
      .eq("league_id", leagueId)
      .eq("role", "admin");
    expect(adminCount).toBe(1);

    // A, ya único admin, no puede auto-expulsarse → la liga no queda sin admin.
    const { error: e2 } = await clientA.rpc("fn_remove_member", {
      p_league_id: leagueId,
      p_user_id: adminA.id,
    });
    expect(e2?.code).toBe(RLS_VIOLATION);

    const { count: adminCountAfter } = await admin
      .from("league_members")
      .select("id", { count: "exact", head: true })
      .eq("league_id", leagueId)
      .eq("role", "admin");
    expect(adminCountAfter).toBe(1);
  });
});

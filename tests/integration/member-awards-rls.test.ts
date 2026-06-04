import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAnonClient,
  createAuthedClient,
  createServiceRoleClient,
} from "./setup";

const admin = createServiceRoleClient();
const createdUserIds: string[] = [];
const createdLeagueIds: string[] = [];

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

function uniqueInvite(): string {
  return `AWD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createAuthedUser(prefix: string): Promise<{
  id: string;
  token: string;
}> {
  const email = uniqueEmail(prefix);
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

let memberA: { id: string; token: string };
let memberB: { id: string; token: string };
let outsider: { id: string; token: string };
let leagueId: string;

beforeAll(async () => {
  memberA = await createAuthedUser("award-a");
  memberB = await createAuthedUser("award-b");
  outsider = await createAuthedUser("award-out");

  const { data: league, error: lErr } = await admin
    .from("leagues")
    .insert({
      name: "Liga Awards",
      created_by: memberA.id,
      invite_code: uniqueInvite(),
    })
    .select("id")
    .single();
  expect(lErr).toBeNull();
  leagueId = league!.id;
  createdLeagueIds.push(leagueId);

  const { error: membersErr } = await admin.from("league_members").insert([
    {
      league_id: leagueId,
      user_id: memberA.id,
      role: "admin",
      joined_at: "2026-06-01T00:00:00.000Z",
    },
    {
      league_id: leagueId,
      user_id: memberB.id,
      role: "member",
      joined_at: "2026-06-02T00:00:00.000Z",
    },
  ]);
  expect(membersErr).toBeNull();

  const { error: badgeErr } = await admin.from("member_badges").insert({
    league_id: leagueId,
    user_id: memberA.id,
    matchday: 1,
    badge_type: "nostradamus",
    badge_label: "Nostradamus",
    reason: "Marcador exacto difícil",
    points: 5,
  });
  expect(badgeErr).toBeNull();

  const { error: profileErr } = await admin
    .from("member_game_profiles")
    .insert({
      league_id: leagueId,
      user_id: memberA.id,
      matchday: 1,
      profile_type: "optimista",
      profile_label: "Optimista",
      summary: "Promedio alto de goles pronosticados.",
    });
  expect(profileErr).toBeNull();
});

afterAll(async () => {
  if (createdLeagueIds.length > 0) {
    await admin.from("leagues").delete().in("id", createdLeagueIds);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
});

describe("member awards RLS", () => {
  it("anon no puede leer insignias ni perfiles", async () => {
    const anon = createAnonClient();
    const { data: badges } = await anon.from("member_badges").select("*");
    const { data: profiles } = await anon
      .from("member_game_profiles")
      .select("*");

    expect(badges).toHaveLength(0);
    expect(profiles).toHaveLength(0);
  });

  it("un miembro de la liga lee premios de la liga", async () => {
    const authed = createAuthedClient(memberB.token);
    const { data: badges, error: badgeErr } = await authed
      .from("member_badges")
      .select("user_id, badge_type")
      .eq("league_id", leagueId);
    const { data: profiles, error: profileErr } = await authed
      .from("member_game_profiles")
      .select("user_id, profile_type")
      .eq("league_id", leagueId);

    expect(badgeErr).toBeNull();
    expect(profileErr).toBeNull();
    expect(badges).toEqual([
      { user_id: memberA.id, badge_type: "nostradamus" },
    ]);
    expect(profiles).toEqual([
      { user_id: memberA.id, profile_type: "optimista" },
    ]);
  });

  it("un usuario ajeno no lee premios de otra liga", async () => {
    const authed = createAuthedClient(outsider.token);
    const { data: badges } = await authed
      .from("member_badges")
      .select("id")
      .eq("league_id", leagueId);
    const { data: profiles } = await authed
      .from("member_game_profiles")
      .select("id")
      .eq("league_id", leagueId);

    expect(badges).toHaveLength(0);
    expect(profiles).toHaveLength(0);
  });

  it("un miembro solo inserta premios propios", async () => {
    const authed = createAuthedClient(memberB.token);
    const { error: ownBadgeErr } = await authed.from("member_badges").insert({
      league_id: leagueId,
      user_id: memberB.id,
      matchday: 2,
      badge_type: "el_tibio",
      badge_label: "El Tibio",
      reason: "Mayoría de empates pronosticados",
      points: 0,
    });
    expect(ownBadgeErr).toBeNull();

    const { error: ownProfileErr } = await authed
      .from("member_game_profiles")
      .insert({
        league_id: leagueId,
        user_id: memberB.id,
        matchday: 2,
        profile_type: "conservador",
        profile_label: "Conservador",
        summary: "Perfil propio.",
      });
    expect(ownProfileErr).toBeNull();

    const { error: otherBadgeErr } = await authed.from("member_badges").insert({
      league_id: leagueId,
      user_id: memberA.id,
      matchday: 3,
      badge_type: "el_salado",
      badge_label: "El Salado",
      reason: "Intento de escribir insignia ajena.",
      points: 0,
    });
    expect(otherBadgeErr).not.toBeNull();

    const { error: otherProfileErr } = await authed
      .from("member_game_profiles")
      .insert({
        league_id: leagueId,
        user_id: memberA.id,
        matchday: 2,
        profile_type: "conservador",
        profile_label: "Conservador",
        summary: "Intento de escribir perfil ajeno.",
      });

    expect(otherProfileErr).not.toBeNull();
  });

  it("un miembro solo actualiza premios propios", async () => {
    const authed = createAuthedClient(memberB.token);

    const { error: setupBadgeErr } = await authed.from("member_badges").insert({
      league_id: leagueId,
      user_id: memberB.id,
      matchday: 4,
      badge_type: "el_salado",
      badge_label: "El Salado",
      reason: "Fixture para update propio",
      points: 0,
    });
    expect(setupBadgeErr).toBeNull();

    const { error: setupProfileErr } = await authed
      .from("member_game_profiles")
      .insert({
        league_id: leagueId,
        user_id: memberB.id,
        matchday: 4,
        profile_type: "optimista",
        profile_label: "Optimista",
        summary: "Fixture para update propio.",
      });
    expect(setupProfileErr).toBeNull();

    const { error: ownBadgeErr } = await authed
      .from("member_badges")
      .update({ reason: "Actualización propia permitida" })
      .eq("league_id", leagueId)
      .eq("user_id", memberB.id)
      .eq("matchday", 4)
      .eq("badge_type", "el_salado");
    expect(ownBadgeErr).toBeNull();

    const { error: ownProfileErr } = await authed
      .from("member_game_profiles")
      .update({ summary: "Actualización propia permitida." })
      .eq("league_id", leagueId)
      .eq("user_id", memberB.id)
      .eq("matchday", 4);
    expect(ownProfileErr).toBeNull();

    const { data: otherBadgeUpdate, error: otherBadgeErr } = await authed
      .from("member_badges")
      .update({ reason: "Intento de update ajeno" })
      .eq("league_id", leagueId)
      .eq("user_id", memberA.id)
      .eq("matchday", 1)
      .select("id");
    expect(otherBadgeErr).toBeNull();
    expect(otherBadgeUpdate).toHaveLength(0);

    const { data: otherProfileUpdate, error: otherProfileErr } = await authed
      .from("member_game_profiles")
      .update({ summary: "Intento de update ajeno." })
      .eq("league_id", leagueId)
      .eq("user_id", memberA.id)
      .eq("matchday", 1)
      .select("id");
    expect(otherProfileErr).toBeNull();
    expect(otherProfileUpdate).toHaveLength(0);
  });
});

import { afterAll, describe, expect, it } from "vitest";
import {
  createAnonClient,
  createAuthedClient,
  createServiceRoleClient,
} from "./setup";
import { calculateTournamentAdvancement } from "@/utils/tournament-advancement";
import type { TournamentMatch } from "@/utils/tournament-advancement";

const admin = createServiceRoleClient();
const RLS_VIOLATION = "42501";
const INVALID_INPUT = "22023";

const createdUserIds: string[] = [];
const createdLeagueIds: string[] = [];
const createdMatchIds: string[] = [];

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

function uniqueInvite(): string {
  return `ADV${Date.now()}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

async function createAuthedUser(): Promise<{ id: string; token: string }> {
  const email = uniqueEmail("adv");
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
  const { data: signIn, error: signInError } =
    await anon.auth.signInWithPassword({ email, password });
  expect(signInError).toBeNull();
  return { id, token: signIn.session!.access_token };
}

async function seedLeague(
  adminUser: { id: string },
  memberUsers: { id: string }[] = [],
): Promise<string> {
  const { data: league, error: leagueError } = await admin
    .from("leagues")
    .insert({
      name: "Liga Avance 7.3",
      created_by: adminUser.id,
      invite_code: uniqueInvite(),
    })
    .select("id")
    .single();
  expect(leagueError).toBeNull();
  const leagueId = league!.id as string;
  createdLeagueIds.push(leagueId);

  const rows = [
    {
      league_id: leagueId,
      user_id: adminUser.id,
      role: "admin",
      payment_status: "pending",
    },
    ...memberUsers.map((member) => ({
      league_id: leagueId,
      user_id: member.id,
      role: "member",
      payment_status: "pending",
    })),
  ];
  const { error: membersError } = await admin.from("league_members").insert(rows);
  expect(membersError).toBeNull();
  return leagueId;
}

async function resetSeedKnockout(): Promise<void> {
  await admin
    .from("matches")
    .update({
      home_team: "Por definir",
      away_team: "Por definir",
      home_team_code: null,
      away_team_code: null,
      status: "scheduled",
      home_score: null,
      away_score: null,
    })
    .gte("bracket_slot", 73)
    .lte("bracket_slot", 104)
    .like("external_ref", "wc2026:ko:%");
}

async function resetSeedGroups(): Promise<void> {
  await admin
    .from("matches")
    .update({
      status: "scheduled",
      home_score: null,
      away_score: null,
    })
    .like("external_ref", "wc2026:grp:%");
}

afterAll(async () => {
  await resetSeedKnockout();
  await resetSeedGroups();
  for (const id of createdMatchIds) {
    await admin.from("matches").delete().eq("id", id);
  }
  if (createdLeagueIds.length > 0) {
    await admin.from("league_members").delete().in("league_id", createdLeagueIds);
    await admin.from("leagues").delete().in("id", createdLeagueIds);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await admin.auth.admin.deleteUser(id);
  }
});

describe("fn_admin_apply_knockout_advancement", () => {
  it("un admin aplica equipos resueltos a un slot knockout sin tocar resultado/estado", async () => {
    const adminUser = await createAuthedUser();
    await seedLeague(adminUser);
    await resetSeedKnockout();

    const client = createAuthedClient(adminUser.token);
    const { data, error } = await client.rpc(
      "fn_admin_apply_knockout_advancement",
      {
        p_slots: [
          {
            bracket_slot: 73,
            home_team: "Mexico",
            away_team: "Korea Republic",
            home_team_code: "MEX",
            away_team_code: "KOR",
          },
        ],
      },
    );

    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const { data: row, error: fetchError } = await admin
      .from("matches")
      .select(
        "home_team, away_team, home_team_code, away_team_code, status, home_score, away_score, home_source, away_source, venue",
      )
      .eq("bracket_slot", 73)
      .single();
    expect(fetchError).toBeNull();
    expect(row).toMatchObject({
      home_team: "Mexico",
      away_team: "Korea Republic",
      home_team_code: "MEX",
      away_team_code: "KOR",
      status: "scheduled",
      home_score: null,
      away_score: null,
    });
    expect(row!.home_source).toBeTruthy();
    expect(row!.away_source).toBeTruthy();
    expect(row!.venue).toBeTruthy();
  });

  it("un member/no-admin no puede aplicar avance (42501)", async () => {
    const adminUser = await createAuthedUser();
    const member = await createAuthedUser();
    await seedLeague(adminUser, [member]);

    const client = createAuthedClient(member.token);
    const { error } = await client.rpc("fn_admin_apply_knockout_advancement", {
      p_slots: [
        {
          bracket_slot: 73,
          home_team: "A",
          away_team: "B",
          home_team_code: "AAA",
          away_team_code: "BBB",
        },
      ],
    });

    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("un anon no puede aplicar avance", async () => {
    const anon = createAnonClient();
    const { error } = await anon.rpc("fn_admin_apply_knockout_advancement", {
      p_slots: [],
    });
    expect(error).not.toBeNull();
  });

  it("rechaza payload inválido, campos faltantes, duplicados y bracket_slot fuera de rango", async () => {
    const adminUser = await createAuthedUser();
    await seedLeague(adminUser);
    const client = createAuthedClient(adminUser.token);

    const invalidPayload = await client.rpc(
      "fn_admin_apply_knockout_advancement",
      { p_slots: { bracket_slot: 73 } },
    );
    expect(invalidPayload.error?.code).toBe(INVALID_INPUT);

    const missingFields = await client.rpc(
      "fn_admin_apply_knockout_advancement",
      { p_slots: [{ bracket_slot: 73 }] },
    );
    expect(missingFields.error?.code).toBe(INVALID_INPUT);

    const duplicatedSlot = await client.rpc(
      "fn_admin_apply_knockout_advancement",
      {
        p_slots: [
          {
            bracket_slot: 73,
            home_team: "A",
            away_team: "B",
            home_team_code: "AAA",
            away_team_code: "BBB",
          },
          {
            bracket_slot: 73,
            home_team: "C",
            away_team: "D",
            home_team_code: "CCC",
            away_team_code: "DDD",
          },
        ],
      },
    );
    expect(duplicatedSlot.error?.code).toBe(INVALID_INPUT);

    const inconsistentPayload = await client.rpc(
      "fn_admin_apply_knockout_advancement",
      {
        p_slots: [
          {
            bracket_slot: 73,
            home_team: "Por definir",
            away_team: "B",
            home_team_code: "AAA",
            away_team_code: "BBB",
          },
        ],
      },
    );
    expect(inconsistentPayload.error?.code).toBe(INVALID_INPUT);

    const invalidSlot = await client.rpc("fn_admin_apply_knockout_advancement", {
      p_slots: [
        {
          bracket_slot: 72,
          home_team: "A",
          away_team: "B",
          home_team_code: "AAA",
          away_team_code: "BBB",
        },
      ],
    });
    expect(invalidSlot.error?.code).toBe(INVALID_INPUT);
  });

  it("no muta partidos de grupo del calendario", async () => {
    const adminUser = await createAuthedUser();
    await seedLeague(adminUser);

    const { data: before, error: beforeError } = await admin
      .from("matches")
      .select("id, home_team, away_team, home_team_code, away_team_code")
      .like("external_ref", "wc2026:grp:%")
      .limit(1)
      .single();
    expect(beforeError).toBeNull();

    const client = createAuthedClient(adminUser.token);
    const { error } = await client.rpc("fn_admin_apply_knockout_advancement", {
      p_slots: [
        {
          bracket_slot: 73,
          home_team: "Mexico",
          away_team: "Korea Republic",
          home_team_code: "MEX",
          away_team_code: "KOR",
        },
      ],
    });
    expect(error).toBeNull();

    const { data: row, error: fetchError } = await admin
      .from("matches")
      .select("home_team, away_team, home_team_code, away_team_code")
      .eq("id", before!.id)
      .single();
    expect(fetchError).toBeNull();
    expect(row).toMatchObject({
      home_team: before!.home_team,
      away_team: before!.away_team,
      home_team_code: before!.home_team_code,
      away_team_code: before!.away_team_code,
    });
  });

  it("es idempotente y preserva resultados ya capturados", async () => {
    const adminUser = await createAuthedUser();
    await seedLeague(adminUser);
    await resetSeedKnockout();

    await admin
      .from("matches")
      .update({ status: "finished", home_score: 2, away_score: 1 })
      .eq("bracket_slot", 74);

    const payload = [
      {
        bracket_slot: 74,
        home_team: "Germany",
        away_team: "Japan",
        home_team_code: "GER",
        away_team_code: "JPN",
      },
    ];
    const client = createAuthedClient(adminUser.token);
    const first = await client.rpc("fn_admin_apply_knockout_advancement", {
      p_slots: payload,
    });
    const second = await client.rpc("fn_admin_apply_knockout_advancement", {
      p_slots: payload,
    });
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();

    const { data: row } = await admin
      .from("matches")
      .select("home_team_code, away_team_code, status, home_score, away_score")
      .eq("bracket_slot", 74)
      .single();
    expect(row).toMatchObject({
      home_team_code: "GER",
      away_team_code: "JPN",
      status: "finished",
      home_score: 2,
      away_score: 1,
    });
  });

  it("aplica avance calculado tras grupos completos a slots round-32", async () => {
    const adminUser = await createAuthedUser();
    await seedLeague(adminUser);
    await resetSeedKnockout();
    await resetSeedGroups();

    const { error: updateGroupsError } = await admin
      .from("matches")
      .update({ status: "finished", home_score: 1, away_score: 0 })
      .like("external_ref", "wc2026:grp:%");
    expect(updateGroupsError).toBeNull();

    const { data: matches, error: matchesError } = await admin
      .from("matches")
      .select(
        "id, external_ref, home_team, away_team, home_team_code, away_team_code, home_score, away_score, match_time, status, matchday, stage, group_label, bracket_slot, home_source, away_source, venue",
      )
      .like("external_ref", "wc2026:%")
      .order("match_time", { ascending: true });
    expect(matchesError).toBeNull();

    const advancement = calculateTournamentAdvancement(
      (matches ?? []) as TournamentMatch[],
    );
    expect(advancement.phaseBoundaries.groupsComplete).toBe(true);

    const client = createAuthedClient(adminUser.token);
    const { error: rpcError } = await client.rpc(
      "fn_admin_apply_knockout_advancement",
      {
        p_slots: advancement.knockoutSlots.map((slot) => ({
          bracket_slot: slot.bracketSlot,
          home_team: slot.homeTeam,
          away_team: slot.awayTeam,
          home_team_code: slot.homeTeamCode,
          away_team_code: slot.awayTeamCode,
        })),
      },
    );
    expect(rpcError).toBeNull();

    const { data: slot73, error: slotError } = await admin
      .from("matches")
      .select("home_team_code, away_team_code")
      .eq("external_ref", "wc2026:ko:73")
      .single();
    expect(slotError).toBeNull();
    expect(slot73!.home_team_code).toBeTruthy();
    expect(slot73!.away_team_code).toBeTruthy();
  });
});

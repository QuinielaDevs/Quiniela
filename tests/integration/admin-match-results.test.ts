import { afterAll, describe, expect, it } from "vitest";
import {
  createAnonClient,
  createAuthedClient,
  createServiceRoleClient,
} from "./setup";

// Story 7.2 — captura/edición de resultados por el admin vía RPC SECURITY DEFINER
// fn_admin_set_match_result. matches es catálogo GLOBAL → el gate es "admin de
// alguna liga" (fn_user_is_any_league_admin). Verifica: admin sí / no-admin /
// anon no, marcador negativo, transición inválida, regla marcador↔estado, guarda
// de knockout TBD, partido inexistente, nulado de scores en estados sin marcador
// e idempotencia. NO toca otros tests de integración.

const admin = createServiceRoleClient();
const RLS_VIOLATION = "42501";
const INVALID_INPUT = "22023";
const NOT_FOUND = "P0002";

const createdUserIds: string[] = [];
const createdLeagueIds: string[] = [];
const createdMatchIds: string[] = [];

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

function uniqueInvite(): string {
  return `MTC${Date.now()}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

async function createAuthedUser(): Promise<{ id: string; token: string }> {
  const email = uniqueEmail("mtc");
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

/** Crea una liga con `adminUser` como admin y opcionalmente miembros. */
async function seedLeague(
  adminUser: { id: string },
  memberUsers: { id: string }[] = [],
): Promise<string> {
  const { data: league, error: lErr } = await admin
    .from("leagues")
    .insert({
      name: "Liga Resultados 7.2",
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

type SeedMatchOpts = {
  status?: string;
  homeScore?: number | null;
  awayScore?: number | null;
  bracketSlot?: number | null;
  homeTeamCode?: string | null;
  awayTeamCode?: string | null;
};

/** Siembra un partido (service_role bypassa RLS). Grupo real por defecto. */
async function seedMatch(opts: SeedMatchOpts = {}): Promise<string> {
  const { data: match, error } = await admin
    .from("matches")
    .insert({
      home_team: "Equipo A",
      away_team: "Equipo B",
      home_team_code: opts.homeTeamCode === undefined ? "AAA" : opts.homeTeamCode,
      away_team_code: opts.awayTeamCode === undefined ? "BBB" : opts.awayTeamCode,
      match_time: new Date(Date.now() - 3_600_000).toISOString(),
      status: opts.status ?? "scheduled",
      home_score: opts.homeScore ?? null,
      away_score: opts.awayScore ?? null,
      bracket_slot: opts.bracketSlot ?? null,
      matchday: 1,
      stage: opts.bracketSlot ? "round-32" : "group",
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  const id = match!.id as string;
  createdMatchIds.push(id);
  return id;
}

async function fetchMatch(id: string) {
  const { data, error } = await admin
    .from("matches")
    .select("status, home_score, away_score")
    .eq("id", id)
    .single();
  expect(error).toBeNull();
  return data as { status: string; home_score: number | null; away_score: number | null };
}

afterAll(async () => {
  for (const id of createdMatchIds) {
    await admin.from("matches").delete().eq("id", id);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await admin.auth.admin.deleteUser(id);
  }
});

describe("fn_admin_set_match_result", () => {
  it("un admin de alguna liga fija marcador + finished (fila actualizada)", async () => {
    const adminUser = await createAuthedUser();
    await seedLeague(adminUser);
    const matchId = await seedMatch({ status: "scheduled" });

    const client = createAuthedClient(adminUser.token);
    const { data, error } = await client
      .rpc("fn_admin_set_match_result", {
        p_match_id: matchId,
        p_home_score: 2,
        p_away_score: 1,
        p_status: "finished",
      })
      .single();
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe("finished");
    expect((data as { home_score: number }).home_score).toBe(2);
    expect((data as { away_score: number }).away_score).toBe(1);

    const row = await fetchMatch(matchId);
    expect(row.status).toBe("finished");
    expect(row.home_score).toBe(2);
    expect(row.away_score).toBe(1);
  });

  it("transición scheduled → live conserva el marcador en vivo", async () => {
    const adminUser = await createAuthedUser();
    await seedLeague(adminUser);
    const matchId = await seedMatch({ status: "scheduled" });
    const client = createAuthedClient(adminUser.token);

    const { error } = await client.rpc("fn_admin_set_match_result", {
      p_match_id: matchId,
      p_home_score: 1,
      p_away_score: 0,
      p_status: "live",
    });
    expect(error).toBeNull();
    const row = await fetchMatch(matchId);
    expect(row.status).toBe("live");
    expect(row.home_score).toBe(1);
  });

  it("un no-admin (member) no puede capturar resultados (42501)", async () => {
    const adminUser = await createAuthedUser();
    const member = await createAuthedUser();
    await seedLeague(adminUser, [member]);
    const matchId = await seedMatch();

    const memberClient = createAuthedClient(member.token);
    const { error } = await memberClient
      .rpc("fn_admin_set_match_result", {
        p_match_id: matchId,
        p_home_score: 1,
        p_away_score: 1,
        p_status: "finished",
      })
      .single();
    expect(error?.code).toBe(RLS_VIOLATION);

    const row = await fetchMatch(matchId);
    expect(row.status).toBe("scheduled");
  });

  it("un usuario sin ninguna liga no puede capturar (42501)", async () => {
    const loner = await createAuthedUser(); // no pertenece a ninguna liga
    const matchId = await seedMatch();

    const client = createAuthedClient(loner.token);
    const { error } = await client
      .rpc("fn_admin_set_match_result", {
        p_match_id: matchId,
        p_home_score: 0,
        p_away_score: 0,
        p_status: "live",
      })
      .single();
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("el cliente anónimo no puede capturar", async () => {
    const matchId = await seedMatch();
    const anon = createAnonClient();
    const { error } = await anon
      .rpc("fn_admin_set_match_result", {
        p_match_id: matchId,
        p_home_score: 1,
        p_away_score: 0,
        p_status: "finished",
      })
      .single();
    expect(error).not.toBeNull();
  });

  it("rechaza marcador negativo (22023)", async () => {
    const adminUser = await createAuthedUser();
    await seedLeague(adminUser);
    const matchId = await seedMatch();
    const client = createAuthedClient(adminUser.token);

    const { error } = await client
      .rpc("fn_admin_set_match_result", {
        p_match_id: matchId,
        p_home_score: -1,
        p_away_score: 0,
        p_status: "finished",
      })
      .single();
    expect(error?.code).toBe(INVALID_INPUT);
  });

  it("rechaza marcador nulo en finished (22023)", async () => {
    const adminUser = await createAuthedUser();
    await seedLeague(adminUser);
    const matchId = await seedMatch();
    const client = createAuthedClient(adminUser.token);

    const { error } = await client
      .rpc("fn_admin_set_match_result", {
        p_match_id: matchId,
        p_home_score: null,
        p_away_score: null,
        p_status: "finished",
      })
      .single();
    expect(error?.code).toBe(INVALID_INPUT);
  });

  it("rechaza una transición inválida finished → scheduled (22023)", async () => {
    const adminUser = await createAuthedUser();
    await seedLeague(adminUser);
    const matchId = await seedMatch({
      status: "finished",
      homeScore: 1,
      awayScore: 1,
    });
    const client = createAuthedClient(adminUser.token);

    const { error } = await client
      .rpc("fn_admin_set_match_result", {
        p_match_id: matchId,
        p_home_score: null,
        p_away_score: null,
        p_status: "scheduled",
      })
      .single();
    expect(error?.code).toBe(INVALID_INPUT);
  });

  it("al volver a scheduled (desde live) limpia el marcador", async () => {
    const adminUser = await createAuthedUser();
    await seedLeague(adminUser);
    const matchId = await seedMatch({ status: "live", homeScore: 1, awayScore: 0 });
    const client = createAuthedClient(adminUser.token);

    const { error } = await client.rpc("fn_admin_set_match_result", {
      p_match_id: matchId,
      p_home_score: 0,
      p_away_score: 0,
      p_status: "scheduled",
    });
    expect(error).toBeNull();
    const row = await fetchMatch(matchId);
    expect(row.status).toBe("scheduled");
    expect(row.home_score).toBeNull();
    expect(row.away_score).toBeNull();
  });

  it("bloquea capturar resultado de un knockout TBD sin equipos (22023)", async () => {
    const adminUser = await createAuthedUser();
    await seedLeague(adminUser);
    const matchId = await seedMatch({
      status: "scheduled",
      bracketSlot: 999,
      homeTeamCode: null,
      awayTeamCode: null,
    });
    const client = createAuthedClient(adminUser.token);

    const { error } = await client
      .rpc("fn_admin_set_match_result", {
        p_match_id: matchId,
        p_home_score: 1,
        p_away_score: 0,
        p_status: "finished",
      })
      .single();
    expect(error?.code).toBe(INVALID_INPUT);
  });

  it("bloquea empate finished en knockout hasta modelar penales", async () => {
    const adminUser = await createAuthedUser();
    await seedLeague(adminUser);
    const matchId = await seedMatch({
      status: "scheduled",
      bracketSlot: 901,
      homeTeamCode: "AAA",
      awayTeamCode: "BBB",
    });
    const client = createAuthedClient(adminUser.token);

    const { error } = await client.rpc("fn_admin_set_match_result", {
      p_match_id: matchId,
      p_home_score: 1,
      p_away_score: 1,
      p_status: "finished",
    });

    expect(error?.code).toBe(INVALID_INPUT);
  });

  it("partido inexistente → P0002", async () => {
    const adminUser = await createAuthedUser();
    await seedLeague(adminUser);
    const client = createAuthedClient(adminUser.token);

    const { error } = await client
      .rpc("fn_admin_set_match_result", {
        p_match_id: "00000000-0000-0000-0000-000000000000",
        p_home_score: 1,
        p_away_score: 0,
        p_status: "finished",
      })
      .single();
    expect(error?.code).toBe(NOT_FOUND);
  });

  it("es idempotente: re-fijar el mismo resultado finished no falla", async () => {
    const adminUser = await createAuthedUser();
    await seedLeague(adminUser);
    const matchId = await seedMatch({ status: "scheduled" });
    const client = createAuthedClient(adminUser.token);

    for (let i = 0; i < 2; i++) {
      const { error } = await client.rpc("fn_admin_set_match_result", {
        p_match_id: matchId,
        p_home_score: 3,
        p_away_score: 2,
        p_status: "finished",
      });
      expect(error).toBeNull();
    }
    const row = await fetchMatch(matchId);
    expect(row.status).toBe("finished");
    expect(row.home_score).toBe(3);
    expect(row.away_score).toBe(2);
  });
});

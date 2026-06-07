import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createAnonClient,
  createAuthedClient,
  createServiceRoleClient,
} from "./setup";

const admin = createServiceRoleClient();
const createdUserIds: string[] = [];
const createdLeagueIds: string[] = [];
const createdMatchIds: string[] = [];

const DAY_MS = 24 * 60 * 60 * 1000;
const UNDO_EXPIRED = "P0003";

type PredRow = {
  home_score_pred: number;
  away_score_pred: number;
  multiplier: number;
  prev_home_score_pred: number | null;
  prev_saved_at: string | null;
};

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

function uniqueInvite(): string {
  return `INV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createAuthedUser(): Promise<{ id: string; token: string }> {
  const email = uniqueEmail("undo");
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

async function insertMatch(): Promise<string> {
  const { data, error } = await admin
    .from("matches")
    .insert({
      home_team: "Argentina",
      away_team: "México",
      home_team_code: "ARG",
      away_team_code: "MEX",
      match_time: new Date(Date.now() + 40 * DAY_MS).toISOString(),
      status: "scheduled",
      matchday: 2,
    })
    .select("id")
    .single();

  expect(error).toBeNull();
  createdMatchIds.push(data!.id);
  return data!.id;
}

async function save(
  client: ReturnType<typeof createAuthedClient>,
  leagueId: string,
  matchId: string,
  home: number,
  away: number,
) {
  const { data, error } = await client
    .rpc("fn_save_prediction", {
      p_league_id: leagueId,
      p_match_id: matchId,
      p_home_score_pred: home,
      p_away_score_pred: away,
    })
    .single();
  expect(error).toBeNull();
  return data as unknown as PredRow;
}

let user: { id: string; token: string };
let leagueId: string;

beforeAll(async () => {
  user = await createAuthedUser();

  const { data: league, error: leagueError } = await admin
    .from("leagues")
    .insert({
      name: "Liga Undo",
      created_by: user.id,
      invite_code: uniqueInvite(),
    })
    .select("id")
    .single();
  expect(leagueError).toBeNull();
  leagueId = league!.id;
  createdLeagueIds.push(leagueId);

  const { error: memberError } = await admin.from("league_members").insert({
    league_id: leagueId,
    user_id: user.id,
    role: "admin",
    wager_balance: 100,
  });
  expect(memberError).toBeNull();
});

afterEach(async () => {
  for (const id of createdMatchIds.splice(0)) {
    await admin.from("predictions").delete().eq("match_id", id);
    await admin.from("matches").delete().eq("id", id);
  }
});

afterAll(async () => {
  for (const id of createdLeagueIds) {
    await admin.from("leagues").delete().eq("id", id);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await admin.auth.admin.deleteUser(id);
  }
});

describe("fn_revert_prediction", () => {
  it("restaura marcador y multiplicador previos al deshacer dentro de la ventana", async () => {
    const matchId = await insertMatch();
    const client = createAuthedClient(user.token);

    const first = await save(client, leagueId, matchId, 3, 2);
    await save(client, leagueId, matchId, 3, 4); // cambia el marcador → stash

    const { data, error } = await client
      .rpc("fn_revert_prediction", {
        p_league_id: leagueId,
        p_match_id: matchId,
      })
      .single();
    const reverted = data as unknown as PredRow;

    expect(error).toBeNull();
    expect(reverted.home_score_pred).toBe(3);
    expect(reverted.away_score_pred).toBe(2);
    expect(Number(reverted.multiplier)).toBe(Number(first.multiplier));
    // El estado previo se consume (un solo nivel de undo).
    expect(reverted.prev_saved_at).toBeNull();
    expect(reverted.prev_home_score_pred).toBeNull();
  });

  it("no stashea estado previo al re-guardar el mismo marcador", async () => {
    const matchId = await insertMatch();
    const client = createAuthedClient(user.token);

    await save(client, leagueId, matchId, 1, 1);
    await save(client, leagueId, matchId, 1, 1); // mismo marcador

    const { data: row } = await admin
      .from("predictions")
      .select("prev_home_score_pred, prev_saved_at")
      .eq("league_id", leagueId)
      .eq("user_id", user.id)
      .eq("match_id", matchId)
      .single();

    expect(row!.prev_home_score_pred).toBeNull();
    expect(row!.prev_saved_at).toBeNull();
  });

  it("rechaza deshacer si no hay cambio reciente que revertir", async () => {
    const matchId = await insertMatch();
    const client = createAuthedClient(user.token);

    await save(client, leagueId, matchId, 0, 0); // creación, sin prev

    const { error } = await client
      .rpc("fn_revert_prediction", {
        p_league_id: leagueId,
        p_match_id: matchId,
      })
      .single();

    expect(error).not.toBeNull();
    expect(error?.code).toBe(UNDO_EXPIRED);
  });

  it("rechaza deshacer fuera de la ventana de gracia (2 min)", async () => {
    const matchId = await insertMatch();
    const client = createAuthedClient(user.token);

    await save(client, leagueId, matchId, 2, 0);
    await save(client, leagueId, matchId, 2, 1); // cambia → stash

    // Envejecemos el stash 5 minutos: la ventana de gracia ya venció.
    const { error: ageError } = await admin
      .from("predictions")
      .update({ prev_saved_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() })
      .eq("league_id", leagueId)
      .eq("user_id", user.id)
      .eq("match_id", matchId);
    expect(ageError).toBeNull();

    const { error } = await client
      .rpc("fn_revert_prediction", {
        p_league_id: leagueId,
        p_match_id: matchId,
      })
      .single();

    expect(error).not.toBeNull();
    expect(error?.code).toBe(UNDO_EXPIRED);
  });
});

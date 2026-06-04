import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAnonClient,
  createAuthedClient,
  createServiceRoleClient,
} from "./setup";

const admin = createServiceRoleClient();
const createdUserIds: string[] = [];
const createdLeagueIds: string[] = [];
const createdMatchIds: string[] = [];

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

function uniqueInvite(): string {
  return `INV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createAuthedUser(): Promise<{ id: string; token: string }> {
  const email = uniqueEmail("trigger");
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

async function insertMatch(matchTimeIso: string): Promise<string> {
  const { data, error } = await admin
    .from("matches")
    .insert({
      home_team: "Argentina",
      away_team: "México",
      match_time: matchTimeIso,
      status: "scheduled",
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  createdMatchIds.push(data!.id);
  return data!.id;
}

async function seedBalance(userId: string, leagueId: string, balance: number) {
  // Elimina cualquier transacción previa de este usuario en esta liga para aislar
  await admin.from("point_transactions").delete().eq("user_id", userId).eq("league_id", leagueId);
  
  const { error: tErr } = await admin.from("point_transactions").insert({
    user_id: userId,
    league_id: leagueId,
    amount: balance,
    description: "test_seed",
  });
  expect(tErr).toBeNull();

  const { error: lErr } = await admin
    .from("league_members")
    .update({ wager_balance: balance })
    .eq("league_id", leagueId)
    .eq("user_id", userId);
  expect(lErr).toBeNull();
}

let userA: { id: string; token: string };
let userB: { id: string; token: string };
let userC: { id: string; token: string }; // No en liga
let leagueId: string;

beforeAll(async () => {
  userA = await createAuthedUser();
  userB = await createAuthedUser();
  userC = await createAuthedUser();

  const { data: league, error: lErr } = await admin
    .from("leagues")
    .insert({
      name: "Liga Duelos",
      created_by: userA.id,
      invite_code: uniqueInvite(),
    })
    .select("id")
    .single();
  expect(lErr).toBeNull();
  leagueId = league!.id;
  createdLeagueIds.push(leagueId);

  // Unir a userA como admin
  const { error: m1Err } = await admin
    .from("league_members")
    .insert({ league_id: leagueId, user_id: userA.id, role: "admin" });
  expect(m1Err).toBeNull();

  // Unir a userB como member
  const { error: m2Err } = await admin
    .from("league_members")
    .insert({ league_id: leagueId, user_id: userB.id, role: "member" });
  expect(m2Err).toBeNull();
});

afterAll(async () => {
  // Limpieza de retos y participantes
  if (leagueId) {
    await admin.from("challenges").delete().eq("league_id", leagueId);
  }
  for (const id of createdMatchIds) {
    await admin.from("matches").delete().eq("id", id);
  }
  for (const id of createdLeagueIds) {
    await admin.from("leagues").delete().eq("id", id);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await admin.auth.admin.deleteUser(id);
  }
});

describe("Duelos y Escrow: RPC create_challenge", () => {
  it("(a) Camino feliz: creación exitosa con saldo suficiente y deducción de escrow", async () => {
    const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
    await seedBalance(userA.id, leagueId, 100.00);

    const clientA = createAuthedClient(userA.token);

    const { data: challengeId, error } = await clientA.rpc("create_challenge", {
      p_league_id: leagueId,
      p_match_id: matchId,
      p_points_bet: 40,
      p_type: "direct",
      p_challenged_id: userB.id,
      p_prediction_home: 2,
      p_prediction_away: 1,
    });

    expect(error).toBeNull();
    expect(challengeId).toBeDefined();

    // Validar deducción de saldo
    const { data: memberA } = await admin
      .from("league_members")
      .select("wager_balance")
      .eq("league_id", leagueId)
      .eq("user_id", userA.id)
      .single();
    expect(Number(memberA!.wager_balance)).toBe(60.00);

    // Validar registro en point_transactions
    const { data: txs } = await admin
      .from("point_transactions")
      .select("*")
      .eq("user_id", userA.id)
      .eq("reference_id", challengeId);
    expect(txs).toHaveLength(1);
    expect(Number(txs![0]!.amount)).toBe(-40.00);
  });

  it("(b) Saldo insuficiente: rechaza la apuesta, no altera saldo y no deja saldo negativo", async () => {
    const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
    await seedBalance(userA.id, leagueId, 30.00);

    const clientA = createAuthedClient(userA.token);

    const { data: challengeId, error } = await clientA.rpc("create_challenge", {
      p_league_id: leagueId,
      p_match_id: matchId,
      p_points_bet: 50,
      p_type: "open",
      p_prediction_home: 1,
      p_prediction_away: 1,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("P0003");
    expect(challengeId).toBeNull();

    // Validar que el saldo sigue intacto
    const { data: memberA } = await admin
      .from("league_members")
      .select("wager_balance")
      .eq("league_id", leagueId)
      .eq("user_id", userA.id)
      .single();
    expect(Number(memberA!.wager_balance)).toBe(30.00);
  });

  it("(c) Concurrencia dura: previene race conditions en múltiples llamadas simultáneas", async () => {
    const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
    
    // Asignar exactamente 60 puntos a userA
    await seedBalance(userA.id, leagueId, 60.00);

    // Ejecutar 10 llamadas concurrentes usando clientes independientes
    const N = 10;
    const promises = Array.from({ length: N }).map(async () => {
      // Para cada promesa creamos un cliente con el token del usuario A.
      // Supabase-js maneja la conexión HTTP de forma aislada.
      const client = createAuthedClient(userA.token);
      return client.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 60,
        p_type: "open",
        p_prediction_home: 1,
        p_prediction_away: 0,
      });
    });

    const results = await Promise.allSettled(promises);

    let fulfilledCount = 0;
    let rejectedCount = 0;

    for (const res of results) {
      if (res.status === "fulfilled") {
        const { data, error } = res.value;
        if (error === null && data) {
          fulfilledCount++;
        } else {
          expect(error?.code).toBe("P0003");
          rejectedCount++;
        }
      } else {
        rejectedCount++;
      }
    }

    // Aserciones DURAS
    expect(fulfilledCount).toBe(1);
    expect(rejectedCount).toBe(N - 1);

    // wager_balance final debe ser exactamente 0
    const { data: memberA } = await admin
      .from("league_members")
      .select("wager_balance")
      .eq("league_id", leagueId)
      .eq("user_id", userA.id)
      .single();
    expect(Number(memberA!.wager_balance)).toBe(0.00);

    // Debe haber exactamente 1 transacción de escrow de -60 en point_transactions
    const { data: txs } = await admin
      .from("point_transactions")
      .select("*")
      .eq("user_id", userA.id)
      .eq("amount", -60.00);
    expect(txs).toHaveLength(1);
  });

  it("(d) Integridad referencial: creación exitosa inserta registros coherentes en las 3 tablas", async () => {
    const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
    await seedBalance(userA.id, leagueId, 100.00);

    const clientA = createAuthedClient(userA.token);

    const { data: challengeId, error } = await clientA.rpc("create_challenge", {
      p_league_id: leagueId,
      p_match_id: matchId,
      p_points_bet: 20,
      p_type: "direct",
      p_challenged_id: userB.id,
      p_prediction_home: 3,
      p_prediction_away: 0,
    });

    expect(error).toBeNull();

    // 1. Verificar challenges
    const { data: challenge } = await admin
      .from("challenges")
      .select("*")
      .eq("id", challengeId)
      .single();
    expect(challenge).toBeDefined();
    expect(challenge.league_id).toBe(leagueId);
    expect(challenge.match_id).toBe(matchId);
    expect(challenge.creator_id).toBe(userA.id);
    expect(challenge.points_bet).toBe(20);
    expect(challenge.type).toBe("direct");
    expect(challenge.challenged_id).toBe(userB.id);
    expect(challenge.status).toBe("pending");

    // 2. Verificar challenge_participants
    const { data: participants } = await admin
      .from("challenge_participants")
      .select("*")
      .eq("challenge_id", challengeId);
    expect(participants).toHaveLength(1);
    expect(participants![0]!.user_id).toBe(userA.id);
    expect(participants![0]!.prediction_home).toBe(3);
    expect(participants![0]!.prediction_away).toBe(0);

    // 3. Verificar point_transactions
    const { data: tx } = await admin
      .from("point_transactions")
      .select("*")
      .eq("reference_id", challengeId)
      .single();
    expect(tx).toBeDefined();
    expect(Number(tx.amount)).toBe(-20.00);
  });

  it("(e) Validación de apuesta: rechaza apuesta <= 0 sin alterar saldo ni tablas", async () => {
    const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
    await seedBalance(userA.id, leagueId, 100.00);

    const clientA = createAuthedClient(userA.token);

    const { error } = await clientA.rpc("create_challenge", {
      p_league_id: leagueId,
      p_match_id: matchId,
      p_points_bet: 0,
      p_type: "open",
      p_prediction_home: 1,
      p_prediction_away: 1,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("P0001");

    // Validar que el saldo sigue intacto
    const { data: memberA } = await admin
      .from("league_members")
      .select("wager_balance")
      .eq("league_id", leagueId)
      .eq("user_id", userA.id)
      .single();
    expect(Number(memberA!.wager_balance)).toBe(100.00);
  });

  it("Invariante de conservación: wager_balance == SUM(amount) en point_transactions", async () => {
    await seedBalance(userA.id, leagueId, 200.00);

    // Realizar un par de apuestas válidas
    const clientA = createAuthedClient(userA.token);
    const matchId1 = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
    const matchId2 = await insertMatch(new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString());

    await clientA.rpc("create_challenge", {
      p_league_id: leagueId,
      p_match_id: matchId1,
      p_points_bet: 50,
      p_type: "open",
      p_prediction_home: 1,
      p_prediction_away: 1,
    });

    await clientA.rpc("create_challenge", {
      p_league_id: leagueId,
      p_match_id: matchId2,
      p_points_bet: 30,
      p_type: "direct",
      p_challenged_id: userB.id,
      p_prediction_home: 0,
      p_prediction_away: 2,
    });

    // Consultar el saldo materializado
    const { data: member } = await admin
      .from("league_members")
      .select("wager_balance")
      .eq("league_id", leagueId)
      .eq("user_id", userA.id)
      .single();

    // Consultar la suma del ledger
    const { data: sumData } = await admin
      .from("point_transactions")
      .select("amount")
      .eq("league_id", leagueId)
      .eq("user_id", userA.id);

    const sumAmount = sumData!.reduce((sum, tx) => sum + Number(tx.amount), 0);

    expect(Number(member!.wager_balance)).toBe(120.00);
    expect(sumAmount).toBe(120.00);
  });

  it("(P1) Rollback todo-o-nada: valida que un fallo en point_transactions revierte todo", async () => {
    // Para probar el rollback, provocaremos un error al final de la RPC.
    // Como wager_balance y point_transactions.amount son numeric(6,2), su límite de almacenamiento
    // es 9999.99. Si intentamos apostar más de esto, causará un desbordamiento numérico
    // en point_transactions, pero necesitamos pasar el control de saldo primero.
    // Si asignamos 9999.99 de saldo a userA, y este intenta apostar 9999.99.
    // Espera, -9999.99 tiene 6 dígitos (4 antes del punto, 2 después). Cabe en numeric(6,2).
    // ¿Y si creamos una restricción check en point_transactions de manera temporal, o la añadimos en la migración?
    // De hecho, en la migración no añadimos restricciones complejas para no acoplar.
    // Pero espera, ¿hay alguna otra forma de hacer fallar la inserción en point_transactions?
    // Sí, point_transactions.description es text NOT NULL. Pero en la RPC está hardcoded:
    // 'Puntos retenidos en escrow por creación de desafío ' || p_type
    // ¿Y si p_type es muy largo? No, está restringido a check (p_type in ('direct', 'open')).
    // Espera, ¿y si agregamos una regla CHECK en la tabla point_transactions en la migración que prohíba apuestas de exactamente 999 puntos?
    // Por ejemplo: `constraint chk_no_999 check (amount <> -999.00)`
    // ¡Sí! Añadimos esta regla CHECK en la migración. Así, si apostamos 999 puntos, la inserción en point_transactions fallará con check violation.
    // Esto es limpio, seguro, y prueba exactamente la atomicidad y rollback.
    // Vamos a ver si en nuestra migración podemos añadir esto.
    // Espera, ya escribimos el archivo de migración. ¿Contiene chk_no_999? No.
    // Podemos recrear/sobreescribir el archivo de migración agregando esa restricción check, o podemos agregar la restricción CHECK dinámicamente en el test y luego quitarla!
    // ¡Agregar y remover la restricción dinámicamente en el test usando la conexión `admin`!
    // Esto es maravilloso y no ensucia la migración de producción con un CHECK artificial.
    // Hagamos eso. Añadimos el CHECK `chk_test_rollback` a `point_transactions` al inicio del test, y lo removemos en un try/finally block!
    
    const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
    await seedBalance(userA.id, leagueId, 1000.00);

    // El test asume que la restricción CHECK 'chk_point_transactions_rollback_test' de la migración impedirá insertar wagers de exactamente 999 puntos, forzando un error en el último paso (insert en point_transactions) y disparando el rollback completo.

    const clientA = createAuthedClient(userA.token);
    // Intentar apostar 999 puntos.
    // Esto debería violar la restricción CHECK `chk_point_transactions_rollback_test` que agregaremos en la migración.
    const { error: rError } = await clientA.rpc("create_challenge", {
      p_league_id: leagueId,
      p_match_id: matchId,
      p_points_bet: 999,
      p_type: "open",
      p_prediction_home: 2,
      p_prediction_away: 2,
    });

    expect(rError).not.toBeNull();
    // Debe haber fallado por violación de CHECK
    expect(rError?.message).toContain("chk_point_transactions_rollback_test");

    // Verificar que NADA quedó insertado (0 filas en las 3 tablas con referencia al test)
    // 1. challenges no tiene ningún desafío con points_bet = 999
    const { data: challenges } = await admin
      .from("challenges")
      .select("*")
      .eq("league_id", leagueId)
      .eq("points_bet", 999);
    expect(challenges).toHaveLength(0);

    // 2. point_transactions no tiene ninguna transacción de -999
    const { data: txs } = await admin
      .from("point_transactions")
      .select("*")
      .eq("league_id", leagueId)
      .eq("amount", -999.00);
    expect(txs).toHaveLength(0);

    // 3. El saldo de userA sigue siendo exactamente 1000.00 (sin descontar nada)
    const { data: memberA } = await admin
      .from("league_members")
      .select("wager_balance")
      .eq("league_id", leagueId)
      .eq("user_id", userA.id)
      .single();
    expect(Number(memberA!.wager_balance)).toBe(1000.00);
  });
});

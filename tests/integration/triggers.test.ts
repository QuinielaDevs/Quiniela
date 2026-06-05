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

  it("(f) Validación de partido: rechaza creación si el partido ya comenzó o no está programado", async () => {
    // Caso 1: Partido ya comenzó (status = 'live')
    const matchLive = await admin
      .from("matches")
      .insert({
        home_team: "Brasil",
        away_team: "Croacia",
        match_time: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        status: "live",
      })
      .select("id")
      .single();
    expect(matchLive.error).toBeNull();
    createdMatchIds.push(matchLive.data!.id);

    // Caso 2: Partido en el pasado (match_time < now())
    const matchPast = await admin
      .from("matches")
      .insert({
        home_team: "Francia",
        away_team: "Marruecos",
        match_time: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        status: "scheduled",
      })
      .select("id")
      .single();
    expect(matchPast.error).toBeNull();
    createdMatchIds.push(matchPast.data!.id);

    await seedBalance(userA.id, leagueId, 100.00);
    const clientA = createAuthedClient(userA.token);

    // Intentar crear con partido en vivo
    const { error: errLive } = await clientA.rpc("create_challenge", {
      p_league_id: leagueId,
      p_match_id: matchLive.data!.id,
      p_points_bet: 20,
      p_type: "open",
      p_prediction_home: 1,
      p_prediction_away: 1,
    });
    expect(errLive).not.toBeNull();
    expect(errLive?.code).toBe("P0004");

    // Intentar crear con partido en el pasado
    const { error: errPast } = await clientA.rpc("create_challenge", {
      p_league_id: leagueId,
      p_match_id: matchPast.data!.id,
      p_points_bet: 20,
      p_type: "open",
      p_prediction_home: 1,
      p_prediction_away: 1,
    });
    expect(errPast).not.toBeNull();
    expect(errPast?.code).toBe("P0004");
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

  describe("Duelos y Escrow: Aceptación, Rechazo, Cancelación y Triggers (Story 5.2)", () => {
    // Helper para verificar el invariante de conservación por miembro (comparación numérica en SQL)
    async function assertConservation(userId: string) {
      const { data: isConserved, error } = await admin.rpc("check_conservation_invariant", {
        p_league_id: leagueId,
        p_user_id: userId,
      });
      expect(error).toBeNull();
      expect(isConserved).toBe(true);
    }

    it("(a) Aceptación directa feliz: acepta con saldo suficiente", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);
      await seedBalance(userB.id, leagueId, 100.00);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);

      // userA crea un reto directo para userB
      const { data: challengeId, error: cErr } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 40,
        p_type: "direct",
        p_challenged_id: userB.id,
        p_prediction_home: 2,
        p_prediction_away: 1,
      });
      expect(cErr).toBeNull();

      // userB acepta el reto
      const { error: aErr } = await clientB.rpc("accept_challenge", {
        p_challenge_id: challengeId,
        p_prediction_home: 1,
        p_prediction_away: 1,
      });
      expect(aErr).toBeNull();

      // Verificar balance del oponente (100 - 40 = 60)
      const { data: memberB } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", userB.id)
        .single();
      expect(Number(memberB!.wager_balance)).toBe(60.00);

      // Verificar participante insertado
      const { data: participants } = await admin
        .from("challenge_participants")
        .select("*")
        .eq("challenge_id", challengeId)
        .eq("user_id", userB.id);
      expect(participants).toHaveLength(1);

      // Verificar transacción ledger
      const { data: txs } = await admin
        .from("point_transactions")
        .select("*")
        .eq("user_id", userB.id)
        .eq("reference_id", challengeId);
      expect(txs).toHaveLength(1);
      expect(Number(txs![0]!.amount)).toBe(-40.00);

      // El reto pasa a active
      const { data: challenge } = await admin
        .from("challenges")
        .select("status")
        .eq("id", challengeId)
        .single();
      expect(challenge!.status).toBe("active");

      await assertConservation(userA.id);
      await assertConservation(userB.id);
    });

    it("(b) Aceptación pozo abierto feliz: se une con saldo suficiente", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);
      await seedBalance(userB.id, leagueId, 100.00);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);

      // userA crea pozo abierto
      const { data: challengeId, error: cErr } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 30,
        p_type: "open",
        p_prediction_home: 2,
        p_prediction_away: 1,
      });
      expect(cErr).toBeNull();

      // userB se une
      const { error: aErr } = await clientB.rpc("accept_challenge", {
        p_challenge_id: challengeId,
        p_prediction_home: 0,
        p_prediction_away: 2,
      });
      expect(aErr).toBeNull();

      // Balance de userB
      const { data: memberB } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", userB.id)
        .single();
      expect(Number(memberB!.wager_balance)).toBe(70.00);

      // Sigue en pending
      const { data: challenge } = await admin
        .from("challenges")
        .select("status")
        .eq("id", challengeId)
        .single();
      expect(challenge!.status).toBe("pending");

      await assertConservation(userB.id);
    });

    it("(c) Rechazo de desafío directo: oponente rechaza un directo pending", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);

      // userA crea reto directo
      const { data: challengeId, error: cErr } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 50,
        p_type: "direct",
        p_challenged_id: userB.id,
        p_prediction_home: 1,
        p_prediction_away: 0,
      });
      expect(cErr).toBeNull();

      // userB rechaza
      const { error: rErr } = await clientB.rpc("reject_challenge", {
        p_challenge_id: challengeId,
      });
      expect(rErr).toBeNull();

      // Reto cancelado
      const { data: challenge } = await admin
        .from("challenges")
        .select("status")
        .eq("id", challengeId)
        .single();
      expect(challenge!.status).toBe("canceled");

      // Creador recobra escrow (vuelve a 100)
      const { data: memberA } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", userA.id)
        .single();
      expect(Number(memberA!.wager_balance)).toBe(100.00);

      // Ledger contiene fila de reembolso
      const { data: txs } = await admin
        .from("point_transactions")
        .select("*")
        .eq("user_id", userA.id)
        .eq("reference_id", challengeId)
        .eq("description", "challenge_escrow_refund");
      expect(txs).toHaveLength(1);
      expect(Number(txs![0]!.amount)).toBe(50.00);

      await assertConservation(userA.id);
    });

    it("(d) Aceptar tras el Kickoff (opción B): lanza P0004", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);
      await seedBalance(userB.id, leagueId, 100.00);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);

      // Crear reto
      const { data: challengeId, error: cErr } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 40,
        p_type: "direct",
        p_challenged_id: userB.id,
        p_prediction_home: 1,
        p_prediction_away: 1,
      });
      expect(cErr).toBeNull();

      // Actualizar match_time al pasado vía admin
      const { error: mErr } = await admin
        .from("matches")
        .update({ match_time: new Date(Date.now() - 1000).toISOString() })
        .eq("id", matchId);
      expect(mErr).toBeNull();

      // userB intenta aceptar -> lanza P0004
      const { error: aErr } = await clientB.rpc("accept_challenge", {
        p_challenge_id: challengeId,
        p_prediction_home: 2,
        p_prediction_away: 0,
      });
      expect(aErr).not.toBeNull();
      expect(aErr?.code).toBe("P0004");

      // Balance no se altera
      const { data: memberB } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", userB.id)
        .single();
      expect(Number(memberB!.wager_balance)).toBe(100.00);

      await assertConservation(userB.id);
    });

    it("(e1) Pozo abierto poblado en kickoff -> active", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);
      await seedBalance(userB.id, leagueId, 100.00);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);

      // Crear open challenge
      const { data: challengeId } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 30,
        p_type: "open",
        p_prediction_home: 1,
        p_prediction_away: 0,
      });

      // userB acepta
      await clientB.rpc("accept_challenge", {
        p_challenge_id: challengeId,
        p_prediction_home: 2,
        p_prediction_away: 2,
      });

      // Pasar a live
      await admin.from("matches").update({ status: "live" }).eq("id", matchId);

      // Estado pasa a active y NADIE es reembolsado
      const { data: challenge } = await admin
        .from("challenges")
        .select("status")
        .eq("id", challengeId)
        .single();
      expect(challenge!.status).toBe("active");

      const { data: memberA } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", userA.id)
        .single();
      expect(Number(memberA!.wager_balance)).toBe(70.00);

      const { data: memberB } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", userB.id)
        .single();
      expect(Number(memberB!.wager_balance)).toBe(70.00);

      await assertConservation(userA.id);
      await assertConservation(userB.id);
    });

    it("(e2) Reto sin contraparte en kickoff -> canceled", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);

      const clientA = createAuthedClient(userA.token);

      // userA crea reto
      const { data: challengeId } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 40,
        p_type: "open",
        p_prediction_home: 1,
        p_prediction_away: 1,
      });

      // Pasar a live sin adhesiones
      await admin.from("matches").update({ status: "live" }).eq("id", matchId);

      // Pasa a canceled y reembolsa
      const { data: challenge } = await admin
        .from("challenges")
        .select("status")
        .eq("id", challengeId)
        .single();
      expect(challenge!.status).toBe("canceled");

      const { data: memberA } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", userA.id)
        .single();
      expect(Number(memberA!.wager_balance)).toBe(100.00);

      await assertConservation(userA.id);
    });

    it("(e3) Reto cancelado o pospuesto en kickoff -> canceled y reembolsado", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);
      await seedBalance(userB.id, leagueId, 100.00);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);

      // Crear open challenge
      const { data: challengeId } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 30,
        p_type: "open",
        p_prediction_home: 1,
        p_prediction_away: 0,
      });

      // userB acepta
      await clientB.rpc("accept_challenge", {
        p_challenge_id: challengeId,
        p_prediction_home: 2,
        p_prediction_away: 2,
      });

      // Pasar match a 'canceled'
      await admin.from("matches").update({ status: "canceled" }).eq("id", matchId);

      // Ambos deben ser reembolsados y el reto cancelado
      const { data: challenge } = await admin
        .from("challenges")
        .select("status")
        .eq("id", challengeId)
        .single();
      expect(challenge!.status).toBe("canceled");

      const { data: memberA } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", userA.id)
        .single();
      expect(Number(memberA!.wager_balance)).toBe(100.00);

      const { data: memberB } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", userB.id)
        .single();
      expect(Number(memberB!.wager_balance)).toBe(100.00);

      await assertConservation(userA.id);
      await assertConservation(userB.id);
    });

    it("(f) Concurrencia de aceptación (double-spend): exactamente 1 exitoso", async () => {
      const matchId1 = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      const matchId2 = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);
      await seedBalance(userB.id, leagueId, 100.00);
      
      // userC tiene saldo para 1 sola apuesta de 50 pts
      await admin.from("league_members").upsert({ league_id: leagueId, user_id: userC.id, role: "member" });
      await seedBalance(userC.id, leagueId, 60.00);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);

      // Crear dos retos
      const { data: ch1 } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId1,
        p_points_bet: 50,
        p_type: "open",
        p_prediction_home: 1,
        p_prediction_away: 1,
      });

      const { data: ch2 } = await clientB.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId2,
        p_points_bet: 50,
        p_type: "open",
        p_prediction_home: 1,
        p_prediction_away: 1,
      });

      // Aceptación concurrente
      const promises = [
        createAuthedClient(userC.token).rpc("accept_challenge", {
          p_challenge_id: ch1,
          p_prediction_home: 2,
          p_prediction_away: 2,
        }),
        createAuthedClient(userC.token).rpc("accept_challenge", {
          p_challenge_id: ch2,
          p_prediction_home: 2,
          p_prediction_away: 2,
        }),
      ];

      const results = await Promise.allSettled(promises);

      let fulfilled = 0;
      let rejected = 0;

      for (const res of results) {
        if (res.status === "fulfilled" && (res.value as any).error === null) {
          fulfilled++;
        } else {
          rejected++;
        }
      }

      expect(fulfilled).toBe(1);
      expect(rejected).toBe(1);

      // Balance final = 10
      const { data: memberC } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", userC.id)
        .single();
      expect(Number(memberC!.wager_balance)).toBe(10.00);

      await assertConservation(userC.id);
    });

    it("(g) Reembolso multi-participante: recobra escrow exacto", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);
      await seedBalance(userB.id, leagueId, 100.00);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);

      // userA crea pozo
      const { data: challengeId } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 40,
        p_type: "open",
        p_prediction_home: 1,
        p_prediction_away: 1,
      });

      // userB se une
      await clientB.rpc("accept_challenge", {
        p_challenge_id: challengeId,
        p_prediction_home: 2,
        p_prediction_away: 2,
      });

      // Reembolsar usando el helper directamente
      const { error: rfErr } = await admin.rpc("refund_challenge_escrow", {
        p_challenge_id: challengeId,
      });
      expect(rfErr).toBeNull();

      // Ambos recobran su balance (100.00)
      const { data: memberA } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", userA.id)
        .single();
      expect(Number(memberA!.wager_balance)).toBe(100.00);

      const { data: memberB } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", userB.id)
        .single();
      expect(Number(memberB!.wager_balance)).toBe(100.00);

      await assertConservation(userA.id);
      await assertConservation(userB.id);
    });

    it("(h1) Idempotencia: doble disparo del trigger kickoff", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);

      const clientA = createAuthedClient(userA.token);
      const { data: challengeId } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 30,
        p_type: "open",
        p_prediction_home: 1,
        p_prediction_away: 1,
      });

      // Disparo 1: scheduled -> live
      await admin.from("matches").update({ status: "live" }).eq("id", matchId);

      // Disparo 2: live -> finished
      await admin.from("matches").update({ status: "finished" }).eq("id", matchId);

      // Reembolso único
      const { data: memberA } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", userA.id)
        .single();
      expect(Number(memberA!.wager_balance)).toBe(100.00);

      const { data: txs } = await admin
        .from("point_transactions")
        .select("*")
        .eq("user_id", userA.id)
        .eq("reference_id", challengeId)
        .eq("description", "challenge_escrow_refund");
      expect(txs).toHaveLength(1);

      await assertConservation(userA.id);
    });

    it("(h2) Idempotencia: reject y trigger kickoff casi simultáneos", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);
      await seedBalance(userB.id, leagueId, 100.00);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);

      // Crear directo
      const { data: challengeId } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 40,
        p_type: "direct",
        p_challenged_id: userB.id,
        p_prediction_home: 1,
        p_prediction_away: 1,
      });

      // Ejecutar en paralelo
      const promises = [
        clientB.rpc("reject_challenge", { p_challenge_id: challengeId }),
        admin.from("matches").update({ status: "live" }).eq("id", matchId),
      ];

      await Promise.allSettled(promises);

      // userA recobró una sola vez
      const { data: memberA } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", userA.id)
        .single();
      expect(Number(memberA!.wager_balance)).toBe(100.00);

      await assertConservation(userA.id);
    });

    it("(h3) Idempotencia: cancel y accept concurrentes", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);
      await seedBalance(userB.id, leagueId, 100.00);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);

      const { data: challengeId } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 40,
        p_type: "direct",
        p_challenged_id: userB.id,
        p_prediction_home: 1,
        p_prediction_away: 1,
      });

      // Ejecutar en paralelo
      const promises = [
        clientA.rpc("cancel_challenge", { p_challenge_id: challengeId }),
        clientB.rpc("accept_challenge", {
          p_challenge_id: challengeId,
          p_prediction_home: 2,
          p_prediction_away: 2,
        }),
      ];

      const results = await Promise.allSettled(promises);

      let success = 0;
      let failure = 0;

      for (const res of results) {
        if (res.status === "fulfilled" && (res.value as any).error === null) {
          success++;
        } else {
          failure++;
        }
      }

      expect(success).toBe(1);
      expect(failure).toBe(1);

      await assertConservation(userA.id);
      await assertConservation(userB.id);
    });

    it("(j) Atomicidad del reembolso múltiple: rollback total si uno falla (Story 5.2 AC 10j)", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 1000.00);

      const clientA = createAuthedClient(userA.token);

      // Crear pozo con apuesta de exactamente 888
      const { data: challengeId, error: cErr } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 888,
        p_type: "open",
        p_prediction_home: 1,
        p_prediction_away: 1,
      });
      expect(cErr).toBeNull();

      // Saldo de userA es 112 (1000 - 888 = 112)
      const { data: memberAInit } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", userA.id)
        .single();
      expect(Number(memberAInit!.wager_balance)).toBe(112.00);

      // Intentar reembolsar -> Debe violar `chk_point_transactions_refund_rollback_test` y fallar
      const { error: rfErr } = await admin.rpc("refund_challenge_escrow", {
        p_challenge_id: challengeId,
      });
      expect(rfErr).not.toBeNull();
      expect(rfErr?.message).toContain("chk_point_transactions_refund_rollback_test");

      // Balance sigue siendo 112.00 (sin cambios, rollback exitoso)
      const { data: memberA } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", userA.id)
        .single();
      expect(Number(memberA!.wager_balance)).toBe(112.00);

      // No debe existir ninguna transacción de reembolso de 888.00
      const { data: txs } = await admin
        .from("point_transactions")
        .select("*")
        .eq("user_id", userA.id)
        .eq("amount", 888.00);
      expect(txs).toHaveLength(0);
    });

    it("(k) Validación de cancelación: falla P0006 si pozo tiene participantes", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);
      await seedBalance(userB.id, leagueId, 100.00);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);

      // userA crea pozo
      const { data: challengeId } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 40,
        p_type: "open",
        p_prediction_home: 1,
        p_prediction_away: 1,
      });

      // userB se une
      await clientB.rpc("accept_challenge", {
        p_challenge_id: challengeId,
        p_prediction_home: 2,
        p_prediction_away: 2,
      });

      // userA intenta cancelar
      const { error: cnErr } = await clientA.rpc("cancel_challenge", {
        p_challenge_id: challengeId,
      });

      expect(cnErr).not.toBeNull();
      expect(cnErr?.code).toBe("P0006");

      // Estado sigue pending
      const { data: challenge } = await admin
        .from("challenges")
        .select("status")
        .eq("id", challengeId)
        .single();
      expect(challenge!.status).toBe("pending");

      // Balance sigue descontado
      const { data: memberA } = await admin
        .from("league_members")
        .select("wager_balance")
        .eq("league_id", leagueId)
        .eq("user_id", userA.id)
        .single();
      expect(Number(memberA!.wager_balance)).toBe(60.00);

      await assertConservation(userA.id);
    });
  });

  describe("Resolución y Reparto de Pozos (Story 5.3)", () => {
    async function assertConservation(userId: string) {
      const { data: isConserved, error } = await admin.rpc("check_conservation_invariant", {
        p_league_id: leagueId,
        p_user_id: userId,
      });
      expect(error).toBeNull();
      expect(isConserved).toBe(true);
    }

    it("(a) Duelo 1v1 directo sin empate: gana el de marcador exacto", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);
      await seedBalance(userB.id, leagueId, 100.00);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);

      // userA retador (2-1)
      const { data: challengeId, error: cErr } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 40,
        p_type: "direct",
        p_challenged_id: userB.id,
        p_prediction_home: 2,
        p_prediction_away: 1,
      });
      expect(cErr).toBeNull();

      // userB acepta (1-1)
      const { error: aErr } = await clientB.rpc("accept_challenge", {
        p_challenge_id: challengeId,
        p_prediction_home: 1,
        p_prediction_away: 1,
      });
      expect(aErr).toBeNull();

      // Finalizar partido 2-1
      const { error: mErr } = await admin
        .from("matches")
        .update({ status: "finished", home_score: 2, away_score: 1 })
        .eq("id", matchId);
      expect(mErr).toBeNull();

      // Verificar reto completado y ganador userA
      const { data: challenge } = await admin
        .from("challenges")
        .select("*")
        .eq("id", challengeId)
        .single();
      expect(challenge.status).toBe("completed");
      expect(challenge.winner_ids).toEqual([userA.id]);

      // Balances finales: A recibe 80, balance neto: A (60 + 80 = 140), B (60)
      const { data: memberA } = await admin.from("league_members").select("wager_balance").eq("league_id", leagueId).eq("user_id", userA.id).single();
      const { data: memberB } = await admin.from("league_members").select("wager_balance").eq("league_id", leagueId).eq("user_id", userB.id).single();
      expect(Number(memberA!.wager_balance)).toBe(140.00);
      expect(Number(memberB!.wager_balance)).toBe(60.00);

      // Transacción de pago
      const { data: txs } = await admin.from("point_transactions").select("*").eq("reference_id", challengeId).eq("description", "challenge_payout");
      expect(txs).toHaveLength(1);
      expect(txs![0]!.user_id).toBe(userA.id);
      expect(Number(txs![0]!.amount)).toBe(80.00);

      await assertConservation(userA.id);
      await assertConservation(userB.id);
    });

    it("(b) Empate con pozo divisible", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);
      await seedBalance(userB.id, leagueId, 100.00);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);

      const { data: challengeId } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 50,
        p_type: "open",
        p_prediction_home: 2,
        p_prediction_away: 1,
      });

      await clientB.rpc("accept_challenge", {
        p_challenge_id: challengeId,
        p_prediction_home: 2,
        p_prediction_away: 1,
      });

      // Finalizar partido 2-1 (ambos ganan)
      await admin.from("matches").update({ status: "finished", home_score: 2, away_score: 1 }).eq("id", matchId);

      const { data: challenge } = await admin.from("challenges").select("*").eq("id", challengeId).single();
      expect(challenge.status).toBe("completed");
      expect(challenge.winner_ids).toHaveLength(2);
      expect(challenge.winner_ids).toContain(userA.id);
      expect(challenge.winner_ids).toContain(userB.id);

      // Ambos reciben 50.00 de vuelta (pozo 100 / 2) -> balances finales 100.00
      const { data: memberA } = await admin.from("league_members").select("wager_balance").eq("league_id", leagueId).eq("user_id", userA.id).single();
      const { data: memberB } = await admin.from("league_members").select("wager_balance").eq("league_id", leagueId).eq("user_id", userB.id).single();
      expect(Number(memberA!.wager_balance)).toBe(100.00);
      expect(Number(memberB!.wager_balance)).toBe(100.00);

      await assertConservation(userA.id);
      await assertConservation(userB.id);
    });

    it("(b') Empate con pozo NO divisible: reparto con residuo determinista", async () => {
      // 4 participantes, pozo total 40, 3 ganadores.
      // Ganador con menor user_id recibe 13.34, los otros 13.33.
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      
      const userD = await createAuthedUser();
      const userE = await createAuthedUser();
      await admin.from("league_members").insert([
        { league_id: leagueId, user_id: userD.id, role: "member" },
        { league_id: leagueId, user_id: userE.id, role: "member" }
      ]);

      await seedBalance(userA.id, leagueId, 100.00);
      await seedBalance(userB.id, leagueId, 100.00);
      await seedBalance(userD.id, leagueId, 100.00);
      await seedBalance(userE.id, leagueId, 100.00);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);
      const clientD = createAuthedClient(userD.token);
      const clientE = createAuthedClient(userE.token);

      const { data: challengeId } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 10,
        p_type: "open",
        p_prediction_home: 2,
        p_prediction_away: 1,
      });

      await clientB.rpc("accept_challenge", { p_challenge_id: challengeId, p_prediction_home: 2, p_prediction_away: 1 });
      await clientD.rpc("accept_challenge", { p_challenge_id: challengeId, p_prediction_home: 2, p_prediction_away: 1 });
      await clientE.rpc("accept_challenge", { p_challenge_id: challengeId, p_prediction_home: 0, p_prediction_away: 0 }); // Perdedor

      // Finalizar partido 2-1 (A, B, D ganan. E pierde).
      await admin.from("matches").update({ status: "finished", home_score: 2, away_score: 1 }).eq("id", matchId);

      const { data: challenge } = await admin.from("challenges").select("*").eq("id", challengeId).single();
      expect(challenge.status).toBe("completed");
      expect(challenge.winner_ids).toHaveLength(3);

      // Ordenar ganadores por user_id
      const sortedWinners = [userA.id, userB.id, userD.id].sort();
      expect(challenge.winner_ids).toEqual(sortedWinners);

      // Primer ganador (menor user_id) recibe 13.34; los otros 13.33.
      // Balances finales esperados:
      // Primer ganador: 90.00 + 13.34 = 103.34
      // Otros ganadores: 90.00 + 13.33 = 103.33
      // Perdedor: 90.00
      const { data: memberFirst } = await admin.from("league_members").select("wager_balance").eq("league_id", leagueId).eq("user_id", sortedWinners[0]!).single();
      const { data: memberSecond } = await admin.from("league_members").select("wager_balance").eq("league_id", leagueId).eq("user_id", sortedWinners[1]!).single();
      const { data: memberThird } = await admin.from("league_members").select("wager_balance").eq("league_id", leagueId).eq("user_id", sortedWinners[2]!).single();
      const { data: memberLoser } = await admin.from("league_members").select("wager_balance").eq("league_id", leagueId).eq("user_id", userE.id).single();

      expect(Number(memberFirst!.wager_balance)).toBe(103.34);
      expect(Number(memberSecond!.wager_balance)).toBe(103.33);
      expect(Number(memberThird!.wager_balance)).toBe(103.33);
      expect(Number(memberLoser!.wager_balance)).toBe(90.00);

      // Suma total de los payouts en point_transactions debe ser exactamente 40.00
      const { data: payouts } = await admin.from("point_transactions").select("amount").eq("reference_id", challengeId).eq("description", "challenge_payout");
      expect(payouts).toHaveLength(3);
      const totalPayout = payouts!.reduce((sum, p) => sum + Number(p.amount), 0);
      expect(totalPayout).toBe(40.00);

      await assertConservation(userA.id);
      await assertConservation(userB.id);
      await assertConservation(userD.id);
      await assertConservation(userE.id);
    });

    it("(c) Accrual continuo de predicciones normales de liga", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);

      // Crear predicción normal de liga para userA (marcador 2-1)
      const { error: pErr } = await admin.from("predictions").insert({
        league_id: leagueId,
        match_id: matchId,
        user_id: userA.id,
        home_score_pred: 2,
        away_score_pred: 1,
        multiplier: 1.50
      });
      expect(pErr).toBeNull();

      // Finalizar partido con marcador 2-1 (exacto -> 5 puntos * 1.50 = 7.50)
      await admin.from("matches").update({ status: "finished", home_score: 2, away_score: 1 }).eq("id", matchId);

      // Verificar que se evaluó la predicción
      const { data: pred } = await admin.from("predictions").select("*").eq("match_id", matchId).eq("user_id", userA.id).single();
      expect(pred.evaluated_at).not.toBeNull();
      expect(Number(pred.points_earned)).toBe(7.50);

      // Verificar wager_balance (100.00 + 7.50 = 107.50)
      const { data: member } = await admin.from("league_members").select("wager_balance").eq("league_id", leagueId).eq("user_id", userA.id).single();
      expect(Number(member!.wager_balance)).toBe(107.50);

      // Verificar registro de transacción
      const { data: txs } = await admin.from("point_transactions").select("*").eq("reference_id", matchId).eq("description", "match_accrual");
      expect(txs).toHaveLength(1);
      expect(txs![0]!.user_id).toBe(userA.id);
      expect(Number(txs![0]!.amount)).toBe(7.50);

      await assertConservation(userA.id);
    });

    it("(d) Sin ganador (max = 0): reembolso total de escrow", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);
      await seedBalance(userB.id, leagueId, 100.00);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);

      const { data: challengeId } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 50,
        p_type: "open",
        p_prediction_home: 2,
        p_prediction_away: 1,
      });

      await clientB.rpc("accept_challenge", {
        p_challenge_id: challengeId,
        p_prediction_home: 3,
        p_prediction_away: 0,
      });

      // Finalizar partido 0-0 (ambos obtienen 0.00 puntos base)
      await admin.from("matches").update({ status: "finished", home_score: 0, away_score: 0 }).eq("id", matchId);

      // Verificar reto completado sin ganadores
      const { data: challenge } = await admin.from("challenges").select("*").eq("id", challengeId).single();
      expect(challenge.status).toBe("completed");
      expect(challenge.winner_ids).toEqual([]);

      // Balances restaurados a 100.00
      const { data: memberA } = await admin.from("league_members").select("wager_balance").eq("league_id", leagueId).eq("user_id", userA.id).single();
      const { data: memberB } = await admin.from("league_members").select("wager_balance").eq("league_id", leagueId).eq("user_id", userB.id).single();
      expect(Number(memberA!.wager_balance)).toBe(100.00);
      expect(Number(memberB!.wager_balance)).toBe(100.00);

      // Transacciones de reembolso
      const { data: txs } = await admin.from("point_transactions").select("*").eq("reference_id", challengeId).eq("description", "challenge_escrow_refund");
      expect(txs).toHaveLength(2);
      expect(Number(txs![0]!.amount)).toBe(50.00);
      expect(Number(txs![1]!.amount)).toBe(50.00);

      await assertConservation(userA.id);
      await assertConservation(userB.id);
    });

    it("(e) Cancelación y suspensión de partidos (por separado)", async () => {
      // 1. Caso Cancelación
      const matchId1 = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);
      await seedBalance(userB.id, leagueId, 100.00);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);

      const { data: ch1 } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId1,
        p_points_bet: 40,
        p_type: "direct",
        p_challenged_id: userB.id,
        p_prediction_home: 1,
        p_prediction_away: 1,
      });
      await clientB.rpc("accept_challenge", { p_challenge_id: ch1, p_prediction_home: 2, p_prediction_away: 2 });

      // Cancelar partido
      await admin.from("matches").update({ status: "canceled" }).eq("id", matchId1);

      const { data: challenge1 } = await admin.from("challenges").select("*").eq("id", ch1).single();
      expect(challenge1.status).toBe("canceled");

      const { data: m1A } = await admin.from("league_members").select("wager_balance").eq("league_id", leagueId).eq("user_id", userA.id).single();
      expect(Number(m1A!.wager_balance)).toBe(100.00);

      // 2. Caso Suspensión
      const matchId2 = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      const { data: ch2 } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId2,
        p_points_bet: 40,
        p_type: "direct",
        p_challenged_id: userB.id,
        p_prediction_home: 1,
        p_prediction_away: 1,
      });
      await clientB.rpc("accept_challenge", { p_challenge_id: ch2, p_prediction_home: 2, p_prediction_away: 2 });

      // Suspender partido
      await admin.from("matches").update({ status: "suspended" }).eq("id", matchId2);

      const { data: challenge2 } = await admin.from("challenges").select("*").eq("id", ch2).single();
      expect(challenge2.status).toBe("canceled"); // El trigger lo transiciona a canceled

      const { data: m2A } = await admin.from("league_members").select("wager_balance").eq("league_id", leagueId).eq("user_id", userA.id).single();
      expect(Number(m2A!.wager_balance)).toBe(100.00);

      await assertConservation(userA.id);
      await assertConservation(userB.id);
    });

    it("(f1) Transición directa scheduled -> finished con pozo poblado", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);
      await seedBalance(userB.id, leagueId, 100.00);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);

      const { data: challengeId } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 40,
        p_type: "open",
        p_prediction_home: 2,
        p_prediction_away: 1,
      });

      await clientB.rpc("accept_challenge", {
        p_challenge_id: challengeId,
        p_prediction_home: 2,
        p_prediction_away: 1,
      });

      // Transición directa a finished (el kickoff trigger debe activarlo antes de que el resolve trigger lo finalice)
      await admin.from("matches").update({ status: "finished", home_score: 2, away_score: 1 }).eq("id", matchId);

      // Debe estar completed
      const { data: challenge } = await admin.from("challenges").select("*").eq("id", challengeId).single();
      expect(challenge.status).toBe("completed");
      expect(challenge.winner_ids).toHaveLength(2);

      await assertConservation(userA.id);
      await assertConservation(userB.id);
    });

    it("(f2) Transición directa scheduled -> canceled con pozo poblado", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);
      await seedBalance(userB.id, leagueId, 100.00);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);

      const { data: challengeId } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 40,
        p_type: "open",
        p_prediction_home: 2,
        p_prediction_away: 1,
      });

      await clientB.rpc("accept_challenge", {
        p_challenge_id: challengeId,
        p_prediction_home: 2,
        p_prediction_away: 1,
      });

      // Transición directa a canceled
      await admin.from("matches").update({ status: "canceled" }).eq("id", matchId);

      // Debe cancelarse y reembolsarse a todos, sin doble reembolso
      const { data: challenge } = await admin.from("challenges").select("*").eq("id", challengeId).single();
      expect(challenge.status).toBe("canceled");

      const { data: memberA } = await admin.from("league_members").select("wager_balance").eq("league_id", leagueId).eq("user_id", userA.id).single();
      const { data: memberB } = await admin.from("league_members").select("wager_balance").eq("league_id", leagueId).eq("user_id", userB.id).single();
      expect(Number(memberA!.wager_balance)).toBe(100.00);
      expect(Number(memberB!.wager_balance)).toBe(100.00);

      await assertConservation(userA.id);
      await assertConservation(userB.id);
    });

    it("(g) Accrual + payout en el mismo partido y usuario", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);
      await seedBalance(userB.id, leagueId, 100.00);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);

      // Predicción normal de liga para userA (2-1)
      await admin.from("predictions").insert({
        league_id: leagueId,
        match_id: matchId,
        user_id: userA.id,
        home_score_pred: 2,
        away_score_pred: 1,
        multiplier: 1.00
      });

      // Crear y aceptar duelo 1v1 directo (A: 2-1, B: 0-0)
      const { data: challengeId } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 40,
        p_type: "direct",
        p_challenged_id: userB.id,
        p_prediction_home: 2,
        p_prediction_away: 1,
      });
      await clientB.rpc("accept_challenge", { p_challenge_id: challengeId, p_prediction_home: 0, p_prediction_away: 0 });

      // Finalizar match 2-1 (A gana accrual de liga y gana el duelo)
      await admin.from("matches").update({ status: "finished", home_score: 2, away_score: 1 }).eq("id", matchId);

      // UserA recibe: 5.00 (accrual) + 80.00 (duelo payout) = 85.00 adicionales.
      // Balance inicial: 100.00 - 40.00 (apuesta) = 60.00.
      // Balance final esperado: 60.00 + 85.00 = 145.00
      const { data: memberA } = await admin.from("league_members").select("wager_balance").eq("league_id", leagueId).eq("user_id", userA.id).single();
      expect(Number(memberA!.wager_balance)).toBe(145.00);

      // Verificar ambas transacciones registradas
      const { data: txs } = await admin.from("point_transactions").select("*").eq("user_id", userA.id).eq("reference_id", challengeId);
      const { data: accTxs } = await admin.from("point_transactions").select("*").eq("user_id", userA.id).eq("reference_id", matchId).eq("description", "match_accrual");

      expect(txs).not.toBeNull();
      expect(txs!.some(t => t.description === "challenge_payout")).toBe(true);
      expect(accTxs).toHaveLength(1);

      await assertConservation(userA.id);
    });

    it("(h) Idempotencia de re-disparo (accrual y payout)", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 100.00);
      await seedBalance(userB.id, leagueId, 100.00);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);

      // Predicción normal de liga (A: 0-0 legítimo -> 0 puntos)
      await admin.from("predictions").insert({
        league_id: leagueId,
        match_id: matchId,
        user_id: userA.id,
        home_score_pred: 0,
        away_score_pred: 0,
        multiplier: 1.00
      });

      const { data: challengeId } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 40,
        p_type: "direct",
        p_challenged_id: userB.id,
        p_prediction_home: 2,
        p_prediction_away: 1,
      });
      await clientB.rpc("accept_challenge", { p_challenge_id: challengeId, p_prediction_home: 1, p_prediction_away: 1 });

      // Disparo 1: finaliza 2-1 (A gana payout de 80.00, A gana 0 en liga)
      await admin.from("matches").update({ status: "finished", home_score: 2, away_score: 1 }).eq("id", matchId);

      const { data: memberA1 } = await admin.from("league_members").select("wager_balance").eq("league_id", leagueId).eq("user_id", userA.id).single();
      expect(Number(memberA1!.wager_balance)).toBe(140.00);

      // Capturar número de transacciones
      const { data: txs1 } = await admin.from("point_transactions").select("*").eq("user_id", userA.id);

      // Disparo 2: re-actualización (dummy update de matchday)
      await admin.from("matches").update({ matchday: 3 }).eq("id", matchId);

      // Balance y transacciones no deben cambiar
      const { data: memberA2 } = await admin.from("league_members").select("wager_balance").eq("league_id", leagueId).eq("user_id", userA.id).single();
      const { data: txs2 } = await admin.from("point_transactions").select("*").eq("user_id", userA.id);

      expect(Number(memberA2!.wager_balance)).toBe(140.00);
      expect(txs1).not.toBeNull();
      expect(txs2).not.toBeNull();
      expect(txs2!.length).toBe(txs1!.length);

      await assertConservation(userA.id);
    });

    it("(i) Atomicidad: rollback total si falla el ledger en multi-ganador", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      await seedBalance(userA.id, leagueId, 1000.00);
      await seedBalance(userB.id, leagueId, 1000.00);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);

      // Crear reto con apuesta de exactamente 888
      // Como el trigger reparte 888.00 a cada ganador, el insert en point_transactions violará
      // chk_point_transactions_refund_rollback_test (que prohíbe 888.00) y causará un rollback.
      const { data: challengeId } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: 888,
        p_type: "open",
        p_prediction_home: 2,
        p_prediction_away: 1,
      });

      await clientB.rpc("accept_challenge", {
        p_challenge_id: challengeId,
        p_prediction_home: 2,
        p_prediction_away: 1,
      });

      // Intentar finalizar partido -> Debe fallar y hacer rollback total
      const { error: mErr } = await admin
        .from("matches")
        .update({ status: "finished", home_score: 2, away_score: 1 })
        .eq("id", matchId);

      expect(mErr).not.toBeNull();
      expect(mErr?.message).toContain("chk_point_transactions_refund_rollback_test");

      // El partido debe seguir en estado scheduled
      const { data: match } = await admin.from("matches").select("status").eq("id", matchId).single();
      expect(match!.status).toBe("scheduled");

      // Reto sigue pending (puesto que se revirtió la transición a active del kickoff)
      const { data: challenge } = await admin.from("challenges").select("status").eq("id", challengeId).single();
      expect(challenge!.status).toBe("pending");

      // Balances siguen en 112 (1000 - 888)
      const { data: memberA } = await admin.from("league_members").select("wager_balance").eq("league_id", leagueId).eq("user_id", userA.id).single();
      expect(Number(memberA!.wager_balance)).toBe(112.00);

      await assertConservation(userA.id);
    });

    it("(j) Sin overflow en pozo grande", async () => {
      const matchId = await insertMatch(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString());
      
      // Asignar saldo gigante
      const hugeBalance = 9999999.00;
      await seedBalance(userA.id, leagueId, hugeBalance);
      await seedBalance(userB.id, leagueId, hugeBalance);

      const clientA = createAuthedClient(userA.token);
      const clientB = createAuthedClient(userB.token);

      // Crear reto con points_bet gigante
      const hugeBet = 5000000;
      const { data: challengeId } = await clientA.rpc("create_challenge", {
        p_league_id: leagueId,
        p_match_id: matchId,
        p_points_bet: hugeBet,
        p_type: "direct",
        p_challenged_id: userB.id,
        p_prediction_home: 2,
        p_prediction_away: 1,
      });

      await clientB.rpc("accept_challenge", {
        p_challenge_id: challengeId,
        p_prediction_home: 0,
        p_prediction_away: 0,
      });

      // Finalizar match -> payout de 10,000,000.00
      const { error: mErr } = await admin
        .from("matches")
        .update({ status: "finished", home_score: 2, away_score: 1 })
        .eq("id", matchId);
      expect(mErr).toBeNull(); // No debe fallar por overflow

      const { data: memberA } = await admin.from("league_members").select("wager_balance").eq("league_id", leagueId).eq("user_id", userA.id).single();
      // userA final balance: 9999999 - 5000000 + 10000000 = 14999999.00
      expect(Number(memberA!.wager_balance)).toBe(14999999.00);

      await assertConservation(userA.id);
      await assertConservation(userB.id);
    });
  });
});

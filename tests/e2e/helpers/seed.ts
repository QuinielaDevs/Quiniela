// Façade del seed histórico de /predictions (Fase 1 del plan E2E).
//
// `seedPredictionsE2E` conserva su API y su dataset EXACTOS (los 21 tests de
// predictions-finished.spec.ts dependen de él), pero ahora COMPONE los módulos
// nuevos de tests/e2e/helpers/seed/* en lugar de duplicar inserts. Para seeds
// nuevos usar directamente los módulos composables:
//   - seed/league.ts      (ligas, membresías, saldo con ledger)
//   - seed/matches.ts     (partidos declarativos + presets)
//   - seed/predictions.ts (predicciones via service role)
//   - seed/challenges.ts  (duelos via RPC real)
//   - seed/phases.ts      (fases del torneo, snapshot/restore)
//   - seed/awards.ts      (ganadores de premios, snapshot/restore)

import { createCleanupStack } from "./cleanup";
import { addMember, seedLeague, setActiveLeague } from "./seed/league";
import {
  deleteAllTestMatches,
  deleteMatches,
  seedMatches,
  type MatchSpec,
} from "./seed/matches";
import { seedPrediction } from "./seed/predictions";

export interface SeededMatch {
  id: string;
  home: string;
  away: string;
  home_team_code: string | null;
  away_team_code: string | null;
  status: "scheduled" | "live" | "finished" | "suspended" | "canceled";
  home_score: number | null;
  away_score: number | null;
  matchday: number | null;
  stage: string | null;
  group_label: string | null;
  expectedPrediction?: { home: number; away: number; multiplier: number };
  // Multiplicador que tendrá la predicción por defecto del partido si está
  // scheduled o live. Si no se especifica, default 1.0. Útil para producir
  // drift en el chip de "would-be" multiplicador.
  scheduledPredictionMultiplier?: number;
}

export interface SeedResult {
  leagueId: string;
  userId: string;
  matches: SeededMatch[];
  cleanup: () => Promise<void>;
}

// match_time con fechas relativas a las 20:00 UTC (mismo esquema del seed
// original): finalizados ayer/antier, scheduled mañana/pasado, TBD en 5 días.
function isoDaysFromNow(daysOffset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysOffset);
  d.setUTCHours(20, 0, 0, 0);
  return d.toISOString();
}

// Dataset del spec de partidos finalizados: 3 finished (J1) + 1 scheduled (J1)
// + 1 scheduled (J2, con drift) + 1 TBD (semi) + 1 live + 1 suspended.
const MATCH_ROWS: SeededMatch[] = [
  {
    id: "",
    home: "test_argentina",
    away: "test_bolivia",
    home_team_code: "ARG",
    away_team_code: "BOL",
    status: "finished",
    home_score: 3,
    away_score: 0,
    matchday: 1,
    stage: "group",
    group_label: "A",
    expectedPrediction: { home: 2, away: 0, multiplier: 1.25 }, // 2*1.25 = 2.50 pts (parcial con multiplicador)
  },
  {
    id: "",
    home: "test_brasil",
    away: "test_colombia",
    home_team_code: "BRA",
    away_team_code: "COL",
    status: "finished",
    home_score: 1,
    away_score: 1,
    matchday: 1,
    stage: "group",
    group_label: "B",
    expectedPrediction: { home: 1, away: 1, multiplier: 1.25 }, // 5*1.25 = 6.25 pts (exacto)
  },
  {
    id: "",
    home: "test_uruguay",
    away: "test_chile",
    home_team_code: "URU",
    away_team_code: "CHI",
    status: "finished",
    home_score: 0,
    away_score: 2,
    matchday: 1,
    stage: "group",
    group_label: "C",
    expectedPrediction: { home: 1, away: 0, multiplier: 1.0 }, // 0 pts (fallo)
  },
  {
    id: "",
    home: "test_ecuador",
    away: "test_peru",
    home_team_code: "ECU",
    away_team_code: "PER",
    status: "scheduled",
    home_score: null,
    away_score: null,
    matchday: 1,
    stage: "group",
    group_label: "A",
    // J1 base: nextMultiplier=1.0x. saved=1.0 → no hay drift (ya en floor)
    scheduledPredictionMultiplier: 1.0,
  },
  {
    id: "",
    home: "test_mexico",
    away: "test_canada",
    home_team_code: "MEX",
    away_team_code: "CAN",
    status: "scheduled",
    home_score: null,
    away_score: null,
    matchday: 2,
    stage: "group",
    group_label: "D",
    // J2 con saved=2.5x. Como hay 3 partidos finished de J1 en el seed,
    // currentRoundOrdinal>=1, distancia<=1, nextMultiplier<2.5x → drift
    // esperado: chip con el valor would-be en la cabecera.
    scheduledPredictionMultiplier: 2.5,
  },
  {
    id: "",
    home: "Por definir",
    away: "Por definir",
    home_team_code: null,
    away_team_code: null,
    status: "scheduled",
    home_score: null,
    away_score: null,
    matchday: null,
    stage: "semi",
    group_label: null,
  },
  {
    id: "",
    home: "test_espana",
    away: "test_alemania",
    home_team_code: "ESP",
    away_team_code: "GER",
    status: "live",
    home_score: 1,
    away_score: 0,
    matchday: 1,
    stage: "group",
    group_label: "E",
  },
  {
    id: "",
    home: "test_francia",
    away: "test_italia",
    home_team_code: "FRA",
    away_team_code: "ITA",
    status: "suspended",
    home_score: null,
    away_score: null,
    matchday: 2,
    stage: "group",
    group_label: "F",
  },
];

function matchTimeFor(m: SeededMatch): string {
  if (m.status === "finished") return isoDaysFromNow(-2);
  if (m.status === "live") return isoDaysFromNow(0);
  if (m.status === "suspended") return isoDaysFromNow(-1);
  // scheduled: J1 mañana, J2 pasado mañana, TBD dentro de 5 días
  const days = m.matchday === 1 ? 1 : m.matchday === 2 ? 2 : m.matchday === null ? 5 : 3;
  return isoDaysFromNow(days);
}

export async function seedPredictionsE2E(userId: string): Promise<SeedResult> {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const stack = createCleanupStack();

  // Limpieza previa idempotente: partidos test_% de runs anteriores muertos.
  // (No afecta al calendario WC2026 real, que no usa el prefijo.)
  await deleteAllTestMatches();

  // 1) Liga + membresía admin del usuario + liga activa.
  const league = await seedLeague({ runId, creatorId: userId });
  stack.add(() => league.cleanup());
  await addMember(league.id, userId, { role: "admin", paymentStatus: "paid" });
  await setActiveLeague(userId, league.id);
  stack.add(() => setActiveLeague(userId, null));

  // 2) Partidos. NOTA: la fila TBD usa nombres "Por definir" (sin prefijo
  //    test_) a propósito — espeja el dataset histórico; se borra por id.
  const specs: MatchSpec[] = MATCH_ROWS.map((m) => ({
    home: m.home,
    away: m.away,
    homeTeamCode: m.home_team_code,
    awayTeamCode: m.away_team_code,
    matchTime: matchTimeFor(m),
    status: m.status,
    matchday: m.matchday,
    stage: m.stage,
    groupLabel: m.group_label,
    homeScore: m.home_score,
    awayScore: m.away_score,
    rawTeamNames: m.home === "Por definir",
  }));
  const inserted = await seedMatches(specs);
  const matchIds = inserted.map((m) => m.id);
  stack.add(() => deleteMatches(matchIds));
  stack.add(() => deleteAllTestMatches()); // red de seguridad (LIFO: corre primero)

  const matchIdByName = new Map<string, string>();
  for (const m of inserted) {
    matchIdByName.set(m.home_team, m.id);
  }

  // 3) Predicciones del usuario: finalizadas con su multiplicador sembrado y
  //    points_earned/evaluated_at (espejo del accrual del trigger), y 0-0 en
  //    scheduled/live con el multiplicador pedido (para el chip de drift).
  for (const m of MATCH_ROWS) {
    const matchId = matchIdByName.get(m.home);
    if (!matchId) continue;

    if (m.status === "finished" && m.expectedPrediction) {
      const pred = m.expectedPrediction;
      let base: number;
      if (pred.home === m.home_score && pred.away === m.away_score) base = 5;
      else if (Math.sign(pred.home - pred.away) === Math.sign(m.home_score! - m.away_score!)) base = 2;
      else base = 0;
      const points = Math.round(base * pred.multiplier * 100) / 100;
      await seedPrediction({
        leagueId: league.id,
        userId,
        matchId,
        home: pred.home,
        away: pred.away,
        multiplier: pred.multiplier,
        pointsEarned: points,
        evaluatedAt: new Date().toISOString(),
      });
    } else if (m.status === "scheduled" || m.status === "live") {
      await seedPrediction({
        leagueId: league.id,
        userId,
        matchId,
        home: 0,
        away: 0,
        multiplier: m.scheduledPredictionMultiplier ?? 1.0,
      });
    }
  }

  const matches: SeededMatch[] = inserted.map((row) => {
    const spec = MATCH_ROWS.find((r) => r.home === row.home_team)!;
    return {
      ...spec,
      id: row.id,
      home_score: row.home_score,
      away_score: row.away_score,
    };
  });

  return {
    leagueId: league.id,
    userId,
    matches,
    cleanup: () => stack.run(),
  };
}

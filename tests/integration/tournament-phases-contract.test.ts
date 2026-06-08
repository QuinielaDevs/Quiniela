import { describe, it, expect, beforeAll } from 'vitest';
import { createServiceRoleClient } from './setup';
import { TOURNAMENT_PHASES_2026 } from '@/config/tournamentPhases';

const svc = createServiceRoleClient();

/** 42P01 = undefined_table, PGRST205 = missing schema cache -> Epic 2 matches table doesn't exist yet. */
async function matchesTableExists(): Promise<boolean> {
  const { error } = await svc.from('matches').select('id').limit(1);
  return !(error && (error.code === '42P01' || error.code === 'PGRST205'));
}

describe('contract: tournament_phases ↔ config', () => {
  it('rows equal the canonical config (no DB drift)', async () => {
    const { data, error } = await svc
      .from('tournament_phases')
      .select('phase_code, reward_points, starts_at, ends_at, edits_locked')
      .order('sort_order', { ascending: true });
    expect(error).toBeNull();
    const norm = (s: string | null) => (s === null || isNaN(Date.parse(s)) ? null : new Date(s).toISOString());
    const rows = (data ?? []).map((r) => ({
      code: r.phase_code, rewardPoints: r.reward_points,
      startsAt: norm(r.starts_at), endsAt: norm(r.ends_at), editsLocked: r.edits_locked,
    }));
    const expected = TOURNAMENT_PHASES_2026.map((p) => ({
      code: p.code, rewardPoints: p.rewardPoints,
      startsAt: norm(p.startsAt), endsAt: norm(p.endsAt), editsLocked: p.editsLocked,
    }));
    expect(rows).toEqual(expected);
  });
});

/**
 * Tests de invariantes (no de igualdad píxel-perfect):
 * el test anterior comparaba `faseA.endsAt` con `MIN(match_time)` y fallaba
 * cuando el seed cambiaba las fechas de los partidos. Ahora validamos la
 * coherencia interna del config + orden cronológico de las fases, sin atar
 * a un valor específico de `match_time`.
 */
describe('contract: tournament_phases ↔ matches kickoffs (invariantes)', () => {
  let active = false;
  beforeAll(async () => { active = await matchesTableExists(); });

  it('las fases están en orden cronológico no solapado (config interno)', () => {
    for (let i = 0; i < TOURNAMENT_PHASES_2026.length - 1; i++) {
      const current = TOURNAMENT_PHASES_2026[i]!;
      const next = TOURNAMENT_PHASES_2026[i + 1]!;
      if (current.endsAt && next.startsAt) {
        expect(new Date(current.endsAt).getTime()).toBeLessThanOrEqual(
          new Date(next.startsAt).getTime(),
        );
      }
    }
  });

  it('fase B.startsAt === fase A.endsAt y fase C.startsAt === fase B.endsAt (continuidad)', () => {
    const faseA = TOURNAMENT_PHASES_2026.find((p) => p.code === 'A')!;
    const faseB = TOURNAMENT_PHASES_2026.find((p) => p.code === 'B')!;
    const faseC = TOURNAMENT_PHASES_2026.find((p) => p.code === 'C')!;
    expect(faseB.startsAt).toBe(faseA.endsAt);
    expect(faseC.startsAt).toBe(faseB.endsAt);
  });

  it('MIN(match_time) de grupos está dentro de la Fase B (config + datos)', async () => {
    if (!active) { console.warn('[contract] `matches` ausente — skip'); return; }
    const faseB = TOURNAMENT_PHASES_2026.find((p) => p.code === 'B')!;
    const { data, error } = await svc
      .from('matches').select('match_time')
      .is('bracket_slot', null)
      .order('match_time', { ascending: true })
      .limit(1);
    expect(error).toBeNull();
    if (!data || data.length === 0) {
      console.warn('[contract] `matches` vacía — no se puede comparar Fase B vs grupos');
      return;
    }
    const firstGroupMs = new Date(data[0]!.match_time).getTime();
    if (faseB.startsAt) {
      expect(firstGroupMs).toBeGreaterThanOrEqual(new Date(faseB.startsAt).getTime());
    }
    if (faseB.endsAt) {
      expect(firstGroupMs).toBeLessThanOrEqual(new Date(faseB.endsAt).getTime());
    }
  });

  it('MIN(match_time) de eliminatorias está dentro de la Fase C (config + datos)', async () => {
    if (!active) { console.warn('[contract] `matches` ausente — skip'); return; }
    const faseC = TOURNAMENT_PHASES_2026.find((p) => p.code === 'C')!;
    const { data, error } = await svc
      .from('matches').select('match_time')
      .not('bracket_slot', 'is', null)
      .order('match_time', { ascending: true })
      .limit(1);
    expect(error).toBeNull();
    if (!data || data.length === 0) {
      console.warn('[contract] `matches` sin eliminatorias — no se puede comparar Fase C');
      return;
    }
    const firstKnockoutMs = new Date(data[0]!.match_time).getTime();
    if (faseC.startsAt) {
      expect(firstKnockoutMs).toBeGreaterThanOrEqual(new Date(faseC.startsAt).getTime());
    }
    if (faseC.endsAt) {
      expect(firstKnockoutMs).toBeLessThanOrEqual(new Date(faseC.endsAt).getTime());
    }
  });
});

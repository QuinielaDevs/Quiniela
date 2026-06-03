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

describe('contract: tournament_phases ↔ matches kickoffs', () => {
  let active = false;
  beforeAll(async () => { active = await matchesTableExists(); });

  it('group-stage end (Fase B.ends_at) === MIN(kickoff) of knockout matches', async () => {
    if (!active) { console.warn('[contract] `matches` ausente — skip (Story 2.1 BACKLOG)'); return; }
    const faseB = TOURNAMENT_PHASES_2026.find((p) => p.code === 'B')!;
    // ⚠️ PLACEHOLDER: alinear `stage`/'group'/`kickoff_at` con el schema real de Story 2.1.
    const { data, error } = await svc
      .from('matches').select('kickoff_at, stage')
      .neq('stage', 'group').order('kickoff_at', { ascending: true }).limit(1);
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    if (data && data.length > 0) {
      expect(new Date(faseB.endsAt!).toISOString())
        .toBe(new Date(data[0]!.kickoff_at).toISOString());
    } else {
      console.warn('[contract] `matches` vacía — no se puede comparar final de Fase B');
    }
  });

  it('Fase A end (inaugural) === MIN(kickoff) of all matches', async () => {
    if (!active) return;
    const faseA = TOURNAMENT_PHASES_2026.find((p) => p.code === 'A')!;
    const { data, error } = await svc
      .from('matches').select('kickoff_at').order('kickoff_at', { ascending: true }).limit(1);
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    if (data && data.length > 0) {
      expect(new Date(faseA.endsAt!).toISOString())
        .toBe(new Date(data[0]!.kickoff_at).toISOString());
    } else {
      console.warn('[contract] `matches` vacía — no se puede comparar final de Fase A');
    }
  });
});

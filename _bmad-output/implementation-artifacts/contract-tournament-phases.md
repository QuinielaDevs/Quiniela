# Contrato de Integración: `tournament_phases` (Fronteras de Fase del Mundial 2026)

**Estado:** Activo · **Fecha:** 2026-06-02 · **Dueño del contrato:** Epic 6 / Cris
**Costura entre:** Epic 6 / Story 6.2 (puntuación decreciente — EN CURSO, paralelo) ↔ Epic 2 / Story 2.1 (tabla `matches` — BACKLOG)
**Autores:** Winston (arquitectura/propiedad) · Amelia (artefactos concretos) · revisión de riesgo: Murat

---

## 0. Por qué existe este contrato

Dos épicas dependen de las **mismas fechas del torneo**: Story 6.2 necesita las fronteras de fase **ahora** para calcular los puntos decrecientes (FR-16); Epic 2 traerá la tabla `matches` con las fechas reales **después**. Si cada lado escribe sus propias fechas, hay **dos fuentes de verdad** y una divergencia silenciosa que estallaría en producción — a días del Mundial.

Este contrato garantiza dos cosas:
1. Cris puede implementar Story 6.2 **sin que exista `matches`**.
2. Cuando Epic 2 cargue las fechas reales, una divergencia con las fronteras de fase **rompe CI** (fallo ruidoso), no se filtra a producción.

---

## 1. Fuente de verdad: config canónico + tabla derivada (semilla única)

La verdad canónica vive en **un solo módulo**:

```
src/config/tournamentPhases.ts
```

De ahí derivan **dos** consumidores, **nunca al revés**:
1. La tabla **`tournament_phases`** se *siembra* con los mismos valores (vía migración).
2. El **loader de `matches`** de Epic 2 se ancla a las mismas constantes.

> La tabla `tournament_phases` **no es la verdad**: es una *proyección* de la verdad, necesaria porque triggers/RLS y consultas SQL no pueden leer un `.ts`. La asimetría `semilla → {tabla, loader}` es lo que elimina la segunda fuente de verdad.

**Regla dura:** *ningún consumidor escribe fronteras de fase a mano. Todos derivan de `src/config/tournamentPhases.ts`.*

---

## 2. Propiedad y protocolo de cambio

| Quién | SÍ puede cambiar | NO puede cambiar |
|---|---|---|
| **Epic 6 / Cris** | Las fronteras de fase en `src/config/tournamentPhases.ts` (es donde nace la regla FR-16) | — |
| **Epic 2 / dev** | Todo `matches`: esquema, partidos, `kickoff_at`, FKs, loader | Las fronteras de fase; **no** introducir fechas de fase paralelas en el loader |

**Propagación de un cambio de fecha** (p.ej. la FIFA ajusta horarios):
1. Editar `src/config/tournamentPhases.ts`.
2. Nueva migración que re-siembra `tournament_phases` (migración nueva — **no** editar la vieja, convención Supabase).
3. El loader de `matches` re-deriva automáticamente (ya apunta a la semilla).
4. El **contract test (§5)** verifica que ambos lados coinciden, o rompe CI.

Un punto de edición, propagación verificada.

---

## 3. Decisiones cerradas

| Tema | Decisión | Razón |
|---|---|---|
| **Round of 32** (formato 48 equipos) | **Fase C (10 pts)** — los pronósticos hechos durante el R32 puntúan igual que octavos/cuartos | `KNOCKOUT_START` = primer kickoff del R32. Coherente con "ya empezó el mata-mata". Confirmado por el PO el 2026-06-02. |
| **Semántica de borde** | Intervalo `[startsAt, endsAt)` — **inicio inclusivo, fin exclusivo**. El instante exacto del kickoff inaugural ya es Fase B (no Fase A) | Determinismo; `predicted_at` que caiga justo en un kickoff pertenece a la fase que *empieza* |
| **"Antes del partido inaugural"** | Frontera A→B = `kickoff_at` del primer partido del torneo (≈ 11 jun 2026, Ciudad de México) | — |
| **Rutas canónicas** | `src/config/tournamentPhases.ts` + `src/utils/awardsScoring.ts` | Alineado con lo que ya usa Story 6.1 (`src/utils/`, `src/config/`) |

> ⚠️ Las **fechas** siguen siendo `TBD-CONFIRM` hasta el fixture oficial de la FIFA. El dev de Epic 2 las reemplaza por kickoffs reales en config **y** seed en el mismo commit (§6).

---

## 4. Artefactos concretos

### 4.1 Módulo canónico — `src/config/tournamentPhases.ts`

```typescript
// src/config/tournamentPhases.ts
//
// CANONICAL SOURCE OF TRUTH for FIFA World Cup 2026 phase boundaries.
// Both `tournament_phases` (Epic 6) and Epic 2's `matches` loader (Story 2.1)
// MUST derive their dates from THIS file. Divergence is caught by the contract
// test in tests/integration/tournament-phases-contract.test.ts.
//
// ⚠️ ALL DATES BELOW ARE TBD-CONFIRM PLACEHOLDERS.
// Final FIFA fixture release pending. Replace with official kickoffs before prod.
// All values are ISO-8601 UTC (timestamptz). WC2026 host venues span UTC-7..UTC-4;
// store UTC, convert at the edge.

export type AwardPhase = 'A' | 'B' | 'C' | 'D';

export interface TournamentPhaseConfig {
  /** Stable key. Matches tournament_phases.phase_code. */
  readonly code: AwardPhase;
  /** Points for a correct special prediction made during this phase (FR-16). */
  readonly rewardPoints: 50 | 25 | 10 | 0;
  /** Inclusive lower bound (UTC). `null` = open-ended start (before tournament). */
  readonly startsAt: string | null;
  /** Exclusive upper bound (UTC). `null` = open-ended end (tournament over). */
  readonly endsAt: string | null;
  /** Whether edits to predictions are locked during this phase (FR-16, Fase D). */
  readonly editsLocked: boolean;
  readonly label: string;
}

// TBD-CONFIRM placeholders — see header.
const INAUGURAL_KICKOFF = '2026-06-11T18:00:00Z';   // Fase A → B boundary
const KNOCKOUT_START    = '2026-06-28T16:00:00Z';   // Fase B → C boundary (= first Round-of-32 kickoff)
const SEMIFINAL_START   = '2026-07-14T18:00:00Z';   // Fase C → D boundary

/**
 * Ordered, non-overlapping, gapless. resolvePhase relies on this order.
 * Boundary convention: [startsAt, endsAt) — start inclusive, end exclusive.
 */
export const TOURNAMENT_PHASES_2026: readonly TournamentPhaseConfig[] = [
  { code: 'A', rewardPoints: 50, startsAt: null,              endsAt: INAUGURAL_KICKOFF, editsLocked: false, label: 'Before inaugural match' },
  { code: 'B', rewardPoints: 25, startsAt: INAUGURAL_KICKOFF, endsAt: KNOCKOUT_START,    editsLocked: false, label: 'Group stage' },
  { code: 'C', rewardPoints: 10, startsAt: KNOCKOUT_START,    endsAt: SEMIFINAL_START,   editsLocked: false, label: 'Round of 32 + Round of 16 + Quarterfinals' },
  { code: 'D', rewardPoints: 0,  startsAt: SEMIFINAL_START,   endsAt: null,              editsLocked: true,  label: 'Semifinals onward' },
] as const;

// RESUELTO (2026-06-02): el Round of 32 del formato de 48 equipos cae en FASE C (10 pts).
// KNOCKOUT_START === primer kickoff del Round of 32. La Fase C cubre R32 + R16 + Cuartos.
```

### 4.2 Migración — `supabase/migrations/<timestamp>_tournament_phases.sql`

Generar con `npx supabase migration new tournament_phases` (timestamp autogenerado por la CLI; ver orden en §6).

```sql
-- supabase/migrations/<timestamp>_tournament_phases.sql

create table public.tournament_phases (
  id            uuid primary key default gen_random_uuid(),
  phase_code    text not null,
  reward_points integer not null,
  starts_at     timestamptz,            -- null = open-ended start (Fase A)
  ends_at       timestamptz,            -- null = open-ended end   (Fase D)
  edits_locked  boolean not null default false,
  label         text not null,
  sort_order    integer not null,       -- 0..3, mirrors array index in config
  created_at    timestamptz not null default now(),

  constraint tournament_phases_phase_code_key   unique (phase_code),
  constraint tournament_phases_sort_order_key   unique (sort_order),
  constraint tournament_phases_phase_code_check check (phase_code in ('A','B','C','D')),
  constraint tournament_phases_reward_check     check (reward_points in (50, 25, 10, 0)),
  -- [starts_at, ends_at): enforce ordering when both present.
  constraint tournament_phases_bounds_check     check (starts_at is null or ends_at is null or starts_at < ends_at)
);

comment on table public.tournament_phases is
  'WC2026 phase boundaries for FR-16 decreasing-points scoring. Derived from src/config/tournamentPhases.ts. Read-only for clients.';

-- RLS: deny-by-default. Authenticated read-only. No client writes.
alter table public.tournament_phases enable row level security;

create policy "tournament_phases_select_authenticated"
  on public.tournament_phases
  for select
  to authenticated
  using (true);

-- No INSERT/UPDATE/DELETE policies → all client writes blocked (42501).
-- Seeding runs via migration / service-role (bypasses RLS).

-- Seed FROM the same canonical dates as src/config/tournamentPhases.ts.
-- ⚠️ TBD-CONFIRM — keep byte-for-byte in sync with the config module (verified by the contract test).
insert into public.tournament_phases
  (phase_code, reward_points, starts_at,                ends_at,                  edits_locked, label,                                          sort_order)
values
  ('A', 50, null,                     '2026-06-11T18:00:00Z', false, 'Before inaugural match',                          0),
  ('B', 25, '2026-06-11T18:00:00Z',   '2026-06-28T16:00:00Z', false, 'Group stage',                                     1),
  ('C', 10, '2026-06-28T16:00:00Z',   '2026-07-14T18:00:00Z', false, 'Round of 32 + Round of 16 + Quarterfinals',       2),
  ('D', 0,  '2026-07-14T18:00:00Z',   null,                   true,  'Semifinals onward',                               3);
```

> El seed va **en la migración** (config de dominio inmutable), no en `supabase/seed.sql`, que queda libre para datos de test/dev.

### 4.3 Resolver puro — `src/utils/awardsScoring.ts`

Sin `Date.now()`, sin DB, sin I/O. Tiempo y fronteras **inyectados por parámetro**. Testeable bajo el proyecto Vitest `unit`/jsdom.

```typescript
// src/utils/awardsScoring.ts
import {
  type AwardPhase,
  type TournamentPhaseConfig,
  TOURNAMENT_PHASES_2026,
} from '@/config/tournamentPhases';

export interface ResolvedPhase {
  readonly code: AwardPhase;
  readonly rewardPoints: TournamentPhaseConfig['rewardPoints'];
  readonly editsLocked: boolean;
}

/**
 * Resolve which tournament phase a timestamp falls in.
 * Boundary convention: [startsAt, endsAt) — start inclusive, end exclusive.
 * @param at     Moment to classify (caller injects; e.g. special_predictions.predicted_at).
 * @param phases Ordered, gapless, non-overlapping. Defaults to WC2026 config.
 * @throws if `at` matches no phase (a gap/parse bug — fail loud, never silent).
 */
export function resolvePhase(
  at: Date,
  phases: readonly TournamentPhaseConfig[] = TOURNAMENT_PHASES_2026,
): ResolvedPhase {
  const t = at.getTime();
  if (isNaN(t)) {
    throw new Error("resolvePhase: invalid date passed");
  }
  for (const p of phases) {
    const lo = p.startsAt === null ? -Infinity : Date.parse(p.startsAt);
    const hi = p.endsAt   === null ?  Infinity : Date.parse(p.endsAt);
    if (t >= lo && t < hi) {
      return { code: p.code, rewardPoints: p.rewardPoints, editsLocked: p.editsLocked };
    }
  }
  throw new Error(`resolvePhase: no phase covers ${at.toISOString()} — phase config has a gap`);
}

/**
 * Score a correct special prediction made at `predictedAt` (FR-16).
 * Returns the phase reward, or 0 when edits were locked (Fase D).
 */
export function scoreAward(
  predictedAt: Date,
  isCorrect: boolean,
  phases: readonly TournamentPhaseConfig[] = TOURNAMENT_PHASES_2026,
): number {
  if (!isCorrect) return 0;
  const { rewardPoints, editsLocked } = resolvePhase(predictedAt, phases);
  return editsLocked ? 0 : rewardPoints;
}
```

### 4.4 Tipos de dominio — `src/types/index.ts` (append)

```typescript
// Re-export AwardPhase from the canonical config so there is ONE definition.
export type { AwardPhase } from '@/config/tournamentPhases';

// DB row/insert/update types (run `npm run db:types` AFTER the migration applies).
export type TournamentPhase       = TableRow<'tournament_phases'>;
export type TournamentPhaseInsert = TableInsert<'tournament_phases'>;
export type TournamentPhaseUpdate = TableUpdate<'tournament_phases'>;

// ⚠️ DRIFT-RISK (mismo patrón que AwardCategory en Story 6.1):
// `tournament_phases.phase_code` es `text` (CHECK A|B|C|D) → tipa como `string`.
// Narrow explícito al leer (`row.phase_code as AwardPhase`); el CHECK + el contract
// test mantienen la sincronía. Si cambian las fases FR-16, actualizar config Y el
// CHECK de la migración en el MISMO PR.
```

---

## 5. Garantía de integración — el contract test

**Archivo:** `tests/integration/tournament-phases-contract.test.ts` (nombre **no reservado** — evita `rls-policies.test.ts`, `triggers.test.ts`, `special-predictions-rls.test.ts`). Proyecto Vitest `integration`/node.

Dos bloques:
- **`tournament_phases ↔ config`** — corre **siempre** (verde desde hoy). Compara las filas de la tabla (ordenadas por `sort_order`) contra `TOURNAMENT_PHASES_2026`. Garantiza que la migración no diverja del módulo canónico.
- **`tournament_phases ↔ matches`** — se **autoactiva** cuando la tabla `matches` existe (skip por *runtime guard* mientras Story 2.1 esté en BACKLOG, para no bloquear a Cris). Afirma que `Fase B.ends_at === MIN(kickoff)` de partidos de eliminatorias, y `Fase A.ends_at === MIN(kickoff)` global.

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { createServiceRoleClient } from './setup';
import { TOURNAMENT_PHASES_2026 } from '@/config/tournamentPhases';

const svc = createServiceRoleClient();

/** 42P01 = undefined_table → Epic 2 aún no aterriza. */
async function matchesTableExists(): Promise<boolean> {
  const { error } = await svc.from('matches').select('id').limit(1);
  return !(error && error.code === '42P01');
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
    expect(new Date(faseB.endsAt!).toISOString())
      .toBe(new Date(data![0].kickoff_at).toISOString());
  });

  it('Fase A end (inaugural) === MIN(kickoff) of all matches', async () => {
    if (!active) return;
    const faseA = TOURNAMENT_PHASES_2026.find((p) => p.code === 'A')!;
    const { data, error } = await svc
      .from('matches').select('kickoff_at').order('kickoff_at', { ascending: true }).limit(1);
    expect(error).toBeNull();
    expect(new Date(faseA.endsAt!).toISOString())
      .toBe(new Date(data![0].kickoff_at).toISOString());
  });
});
```

---

## 6. Checklist de coordinación

### Cris commitea AHORA (Story 6.2, sin que exista `matches`)
- [ ] `src/config/tournamentPhases.ts` (fechas TBD-CONFIRM; R32→Fase C ya resuelto).
- [ ] `supabase/migrations/<ts>_tournament_phases.sql` vía `supabase migration new tournament_phases`; aplicar local (`supabase db reset`) + `npm run db:types`.
- [ ] `src/utils/awardsScoring.ts` (`resolvePhase` + `scoreAward`, puros).
- [ ] `src/types/index.ts` (`TournamentPhase*` + re-export `AwardPhase` + nota de drift).
- [ ] `tests/integration/tournament-phases-contract.test.ts` (bloque config↔DB verde; bloque ↔matches inerte por guard).
- [ ] **Unit tests de borde** (`tests/unit/`): justo en `INAUGURAL_KICKOFF` → Fase B; un ms antes → Fase A; Fase D → 0 + `editsLocked`; timestamp fuera de rango → throw.
- [ ] Verde: `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`.

### El dev de Epic 2 (Story 2.1) DEBE, cuando `matches` aterrice
- [ ] Derivar el loader de `matches` de `src/config/tournamentPhases.ts` (mismas constantes), **sin** hardcodear fechas paralelas.
- [ ] Alinear los nombres placeholder del contract test (`kickoff_at`, `stage`, `'group'`, etapas de eliminatoria) con el schema real de `matches`, en su PR.
- [ ] Reemplazar las fechas `TBD-CONFIRM` por kickoffs oficiales FIFA en **config Y seed** en el mismo commit (el bloque config↔DB garantiza que no diverjan).
- [ ] Al existir `matches`, el bloque ↔matches se activa solo — si falla, hay divergencia → arreglar antes de mergear.

### Orden de migraciones
- Ninguna tabla referencia a la otra por FK (por diseño, para no acoplar el schema entre épicas). `tournament_phases` se commitea hoy → timestamp anterior → aplica primero. El dev de Epic 2 **no** debe insertar su migración con timestamp anterior al de `tournament_phases`; si un rebase la desordena, renombrar para preservar el orden cronológico.

---

## 7. Resumen en una línea

Las fechas viven en **un solo lugar** (`src/config/tournamentPhases.ts`); la migración las copia (verificado por el bloque *config↔DB*, que corre siempre); Epic 2 las deriva (verificado por el bloque *↔matches*, que se autoactiva). **Cualquier edición unilateral rompe CI.**

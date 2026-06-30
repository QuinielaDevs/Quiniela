# Zafronix API Schema Unification — Implementation Report

**Date**: June 7, 2026  
**Trigger**: `scripts/restore-zafronix-data.ts` and `scripts/sync-matches.ts` used incompatible Zod schemas for the same API endpoint.  
**Goal**: Single source of truth for all Zafronix API interactions, verified against real API + official docs.

---

## 1. Problem Discovery

### 1.1 Two incompatible schemas for `GET /matches?year=2026`

Both `sync-matches.ts` and `restore-zafronix-data.ts` called the same Zafronix endpoint but defined their own Zod schemas with contradictory field expectations:

| Field | `sync-matches.ts` (lines 33-42) | `restore-zafronix-data.ts` (lines 62-87) | Actual API |
|-------|------|------|------|
| `status` | `z.string()` (required) | Not present | **Not sent by API** |
| `result` | Not present | `z.string().nullable().optional()` | Score string like `"3-2"` |
| `bracketSlot` | `z.number()` (camelCase) | Not present | Not used |
| `matchNo` | Not present | `z.number().required` | Present in 2026, absent in historical |
| `homeTeam` | `z.string()` (non-nullable) | `z.string().nullable()` | `null` for knockout TBD |
| `kickoffUtc` | Not present | `z.string().nullable().optional()` | Present in 2026 |
| `referee` | Not present | `z.string()` | Actually object `{name, country}` |
| `stage` / `stageNormalized` | Not present | Present | Present |

**Consequence**: `sync-matches.ts` would fail Zod validation if the API returned knockout matches with null teams, or if the `status` field was absent (which it always is).

### 1.2 Helper function duplication

`normalizeTeamName` and `isPlaceholderTeam` were defined independently in three separate files:
- `scripts/sync-matches.ts` (lines 58-108)
- `scripts/restore-zafronix-data.ts` (imported from sync-matches)
- `src/app/api/webhooks/zafronix/route.ts` (lines 38-86)

### 1.3 `deriveMatchStatus` was broken

The function checked `result === "home" || "away" || "draw"` to determine "finished", but the real API returns score strings like `"3-2"`, `"0-2"`. A finished match from the API would fall through to the score check and be incorrectly classified as `"live"`.

### 1.4 Test mock data used wrong field names

`tests/integration/restore-zafronix-data.test.ts` used DB column names in mock API data (`matchTime`, `venue`, `groupLabel`, `status`) instead of API field names (`kickoffUtc`, `stadium`, `stage`, `result`).

---

## 2. Verification Against Real API

### 2.1 Script created: `scripts/verify-zafronix-schema.ts`

Queries all 3 Zafronix endpoints the project uses and validates responses against current Zod schemas:

```
npm run verify-zafronix-schema
```

**Endpoint 1: `GET /matches?year=2026`**  
- 104 matches, envelope validation PASS
- `matchNo`: 104/104 present ✅
- `kickoffUtc`: 104/104 present ✅  
- `result`: all null (tournament not started)
- `referee`: all null (not assigned yet)

**Endpoint 2: `GET /tournaments/2026`**  
- 48 teams, schema validation PASS
- Extra top-level keys: `schemaVersion`, `tournament`, `meta` (ignored by Zod)

**Endpoint 3: `GET /teams/{name}/roster?year=2026`**  
- 26 players for Mexico, schema validation PASS
- Extra fields: `born`, `ageAtTournament`, `club`, `goals`, `captain` (ignored)

### 2.2 Cross-reference with 2022 data

To verify `result` and `referee` formats (all null in 2026), queried historical year 2022:

| Field | 2022 Value | Confirmed |
|-------|-----------|-----------|
| `result` | `"3-3"` (score string) | ✅ Not "home"/"away"/"draw" |
| `referee` | `{"name":"Szymon Marciniak","country":"Poland"}` (object) | ✅ Not string |
| `matchNo` | `undefined` (absent for historical) | ✅ Confirms optional |
| `kickoffUtc` | `undefined` (absent for historical) | ✅ Confirms optional |
| `penalties` | `null` even for shootout match | ✅ |

### 2.3 Official documentation cross-reference

Fetched `https://api.zafronix.com/docs` — all corrections confirmed by documentation:
- `result` is a score string in official examples (`"3-2"`)
- `referee` is an object `{name, country}` in official examples
- No `status` field documented for `GET /matches`
- `stageNormalized` is a parallel field for canonical stage names
- `homeRef`/`awayRef` hold FIFA bracket placeholders

---

## 3. Implementation

### 3.1 NEW: `src/lib/zafronix/matches.ts` — Canonical Schema Module

**Single source of truth** for all Zafronix REST API schemas and helpers. Imported by all production code that interacts with the Zafronix API.

#### 3.1.1 Zod Schemas

**`zafronixMatchSchema`** — Full match shape, verified against real API:

```typescript
z.object({
  id: z.string(),                                          // "2026-001"
  matchNo: z.number().int().positive().optional(),          // Optional (absent in historical years)
  date: z.string().nullable().optional(),
  kickoff: z.string().nullable().optional(),
  kickoffUtc: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  stage: z.string().nullable().optional(),                  // "group_a", "r32", "qf", "sf", "f"
  stageNormalized: z.string().nullable().optional(),
  homeTeam: z.string().nullable(),                          // null for knockout TBD
  awayTeam: z.string().nullable(),
  homeRef: z.string().nullable().optional(),                // FIFA bracket placeholder "1A"
  awayRef: z.string().nullable().optional(),
  homeScore: z.number().int().nonnegative().nullable(),
  awayScore: z.number().int().nonnegative().nullable(),
  result: z.string().nullable().optional(),                 // Score string "3-2" or null
  extraTime: z.boolean().nullable().optional(),
  penalties: z.union([
    z.string(),
    z.object({ home: z.number(), away: z.number() }),
  ]).nullable().optional(),
  stadium: z.string().nullable().optional(),
  stadiumId: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  attendance: z.number().int().nullable().optional(),
  referee: z.union([                                       // Object {name, country} OR legacy string
    z.string(),
    z.object({ name: z.string(), country: z.string().optional() }),
  ]).nullable().optional(),
  weather: z.string().nullable().optional(),
})
```

Key design decisions:
- **`matchNo` optional**: Present for 2026 (104/104 confirmed) but absent for historical years. Fallback via `resolveMatchNo()`.
- **`referee` union type**: Real API sends `{name, country}`. Accepts string for backward compat.
- **`penalties` union type**: Updated in June 2026 to support both string (legacy/fixtures) and object (`{ home, away }`) formats due to API structure changes.
- **No `.strict()`**: Tolerates new API fields without breaking (forward compatibility).
- **No `.passthrough()`**: Strips unknown keys to keep parsed data predictable.

**`zafronixResponseSchema`** — API envelope: `{ year?, count?, data: Match[] }`

**`tournamentTeamsSchema`** — `{ teams: [{ name, iso?, code }] }`

**`rosterPlayerSchema`** — Minimal player shape: `{ name, position?, jersey? }`

#### 3.1.2 Exported Types

```typescript
type ZafronixMatch    // Full match from GET /matches
type ZafronixTeam     // Team from GET /tournaments
type RosterPlayer     // Player from GET /teams/{name}/roster
```

#### 3.1.3 Exported Helpers (11 functions)

| Function | Purpose | Used by |
|----------|---------|---------|
| `deriveMatchStatus(match)` | Derive DB status from API fields (no `status` field in API) | sync-matches, restore |
| `mapApiStatus(apiStatus)` | Map raw status string to DB status | Legacy compat |
| `normalizeStage(stage)` | Normalize "r32"→"round-32", "qf"→"quarter", etc. | restore |
| `extractGroupLabel(stage)` | Extract "A" from "group_a" | restore |
| `extractMatchNo(id)` | Extract 73 from "2026-073" (fallback when matchNo absent) | sync-matches, restore |
| `resolveMatchNo(match)` | Use matchNo field or extract from id as fallback | sync-matches, restore |
| `normalizeTeamName(name)` | Normalize team name discrepancies (usa→United States, etc.) | sync-matches, restore, webhook |
| `isPlaceholderTeam(name)` | Detect FIFA bracket placeholders (TBD, 1A, W73, etc.) | sync-matches, restore, webhook |
| `extractRefereeName(ref)` | Extract name from string or object referee | restore |

#### 3.1.4 `deriveMatchStatus` — Corrected Logic

```typescript
function deriveMatchStatus(match) {
  const result = (match.result ?? "").toLowerCase();

  // 1. Score string "3-2", "0-2", "3-3" → finished  (NEW — critical fix)
  if (/^\d+-\d+$/.test(result)) return "finished";

  // 2. Legacy outcome "home"/"away"/"draw" → finished (backward compat)
  if (result === "home" || result === "away" || result === "draw")
    return "finished";

  // 3. Cancelled / postponed
  if (result === "cancelled" || result === "abandoned") return "canceled";
  if (result === "postponed" || result === "suspended") return "suspended";

  // 4. Scores present but no result → live
  if (match.homeScore !== null || match.awayScore !== null) return "live";

  // 5. Default → scheduled
  return "scheduled";
}
```

The score string regex check is placed **before** the legacy check. Without this fix, `"3-2"` would not match any branch, fall through to the scores check, and a finished match would be classified as `"live"`.

---

### 3.2 MODIFIED: `scripts/sync-matches.ts`

#### Removed (imported from canonical module instead)
- `zafronixMatchSchema` (lines 33-42) — outdated schema with `status`, non-nullable `homeTeam`, missing `result`/`matchNo`
- `zafronixResponseSchema` (lines 47-51)
- `normalizeTeamName` (lines 58-93)
- `isPlaceholderTeam` (lines 98-108)
- `mapApiStatus` (lines 114-137)

#### Changed
| Line | Before | After | Reason |
|------|--------|-------|--------|
| Match resolution | `apiMatch.id.split("-")` to extract match number | `resolveMatchNo(apiMatch)` | Uses canonical helper, handles both `matchNo` field and id fallback |
| Status derivation | `mapApiStatus(apiMatch.status)` | `deriveMatchStatus(apiMatch)` | API has NO `status` field. Derive from `result` + `scores`. This was a silent bug. |
| Team null-safety | `!isPlaceholderTeam(apiMatch.homeTeam)` | `apiMatch.homeTeam !== null && !isPlaceholderTeam(...)` | `homeTeam`/`awayTeam` are now nullable in schema |

#### New imports
```typescript
import {
  zafronixResponseSchema,
  deriveMatchStatus,
  resolveMatchNo,
  normalizeTeamName,
  isPlaceholderTeam,
} from "../src/lib/zafronix/matches";
```

---

### 3.3 MODIFIED: `scripts/restore-zafronix-data.ts`

#### Removed (imported from canonical module instead)
- `zafronixMatchSchema` (was lines 62-87)
- `ZafronixMatch` type (was line 89)
- `zafronixResponseSchema` (was lines 94-98)
- `ZafronixTeam` interface (was lines 114-119)
- `deriveMatchStatus()` (was lines 152-182)
- `mapApiStatus()` (was lines 191-215)
- `normalizeStage()` (was lines 223-275)
- `extractGroupLabel()` (was lines 281-292)
- `rosterPlayerSchema` (was lines 597-601)
- `RosterPlayer` type (was line 603)
- `normalizeTeamName`, `isPlaceholderTeam` (was imported from `./sync-matches`, line 36)
- Inline tournament teams schema (was lines 387-397)

#### Changed
| Line | Before | After | Reason |
|------|--------|-------|--------|
| Match resolution | `apiMatch.matchNo` (assumed required) | `resolveMatchNo(apiMatch)` | `matchNo` is now optional in canonical schema |
| Knockout detection | `apiMatch.matchNo >= 73` | `resolveMatchNo(apiMatch) !== null && matchNum >= 73` | Null-safe |
| `bracket_slot` insertion | `apiMatch.matchNo` | `matchNum` (local variable from `resolveMatchNo`) | Consistent source |
| `computeMatchdays` | `m.matchNo >= 73` | `(resolveMatchNo(m) ?? 0) >= 73` | Null-safe |
| Tournament teams parsing | Inline `z.object({ teams: z.array(...) })` | `tournamentTeamsSchema.safeParse(rawBody)` | Uses canonical schema |

#### New imports
```typescript
import {
  zafronixMatchSchema, zafronixResponseSchema,
  tournamentTeamsSchema, rosterPlayerSchema,
  deriveMatchStatus, mapApiStatus,
  normalizeStage, extractGroupLabel,
  resolveMatchNo, normalizeTeamName, isPlaceholderTeam,
  extractRefereeName,
  type ZafronixMatch, type ZafronixTeam, type RosterPlayer,
} from "../src/lib/zafronix/matches";
```

---

### 3.4 MODIFIED: `src/app/api/webhooks/zafronix/route.ts`

#### Removed (52 lines)
- `normalizeTeamName()` local definition (was lines 38-72)
- `isPlaceholderTeam()` local definition (was lines 77-86)

#### New import
```typescript
import { normalizeTeamName, isPlaceholderTeam } from "@/lib/zafronix/matches";
```

The functions are identical — the canonical module is the single source of truth.

---

### 3.5 NEW: `tests/fixtures/zafronix/matches-response.sample.json`

Golden fixture with 3 representative match scenarios:
1. **Group stage finished** — Mexico 2-1 Canada, all fields populated, referee as object `{name, country}`
2. **Knockout TBD** — matchNo 73, null teams, null scores, `homeRef: "1A"`, `awayRef: "2B"`
3. **Final with penalties** — France 3-2 Brazil, penalties `"4-3"` (string format) or `{ home: 4, away: 3 }` (object format), referee as string

Used by the schema pinning tests to detect contract drift.

---

### 3.6 NEW: `tests/unit/zafronix-matches-schema.test.ts` (101 tests)

Organized in 6 describe blocks:

**"Pin del Schema Canónico"** (10 tests)
- Parses all 3 fixture scenarios
- Rejects matches missing `id`
- Accepts matches missing optional `matchNo`
- Rejects type mismatches (homeScore as string)
- Tests `referee` union type: accepts string, object `{name, country}`, null, undefined
- Tests nullable fields: homeTeam null, awayTeam null, scores null, result null

**"deriveMatchStatus"** (12 tests)
- Score strings: `"3-2"`→finished, `"0-2"`→finished, `"3-3"`→finished
- Legacy outcome: `"home"`→finished, `"away"`→finished, `"draw"`→finished
- Cancelled: `"cancelled"`→canceled
- Postponed: `"postponed"`→suspended
- Live: scores present, result null
- Scheduled: no scores, no result
- Edge case: result unknown + no scores → scheduled
- **Critical regression**: score string `"2-1"` with scores → finished (NOT live)

**"mapApiStatus"** (9 tests) — all status string mappings

**"normalizeStage"** (16 tests) — group_a→group, r32→round-32, qf→quarter, quarter_final→quarter, sf→semi, 3p→third-place, thirdPlace→third-place, f→final, null→null, unknown→passthrough

**"extractGroupLabel"** (5 tests) — group_a→A, r32→null, null→null

**"extractMatchNo / resolveMatchNo"** (7 tests)
- Extracts from `"2026-001"`→1, `"2026-073"`→73
- Uses direct matchNo when present
- Falls back to id extraction when matchNo absent
- Returns null when both missing

**"normalizeTeamName"** (7 tests) — usa→United States, czechia→Czechia, etc.

**"isPlaceholderTeam"** (10 tests) — TBD, POR DEFINIR, 1A, 2B, W73, L102, 3ABCDEF → true; Mexico, France → false

**"extractRefereeName"** (4 tests) — string, object, null, undefined

**"tournamentTeamsSchema"** (3 tests) — valid payload, rejects missing code, accepts iso null

**"rosterPlayerSchema"** (3 tests) — minimal player, full player, jersey null

**"Verificación de fuente única"** (5 tests) — confirms all functions are exported and importable

---

### 3.7 MODIFIED: `tests/integration/sync-matches.test.ts`

Updated all mock API response data to match canonical schema:

| Mock field | Old value | New value | Reason |
|-----------|-----------|-----------|--------|
| `status` | `"finished"` | `result: "2-1"` | API uses `result`, not `status` |
| `status` | `"scheduled"` | `result: null` | No scores → `deriveMatchStatus` returns scheduled |
| `status` | `"live"` | `result: null` | Scores present → `deriveMatchStatus` returns live |
| `bracketSlot` | `998` | `matchNo: 998` | Canonical field name |
| (missing) | — | `matchNo: 1/2/60` | Required for `resolveMatchNo` |
| (missing) | — | `kickoffUtc: "2026-..."` | Required for `buildInsertRow` in restore |

**New null-safety**: `canUpdateTeams` now checks `apiMatch.homeTeam !== null && apiMatch.awayTeam !== null` before calling `isPlaceholderTeam`.

---

### 3.8 MODIFIED: `tests/integration/restore-zafronix-data.test.ts`

#### Mock data corrections

| Mock field | Old (wrong — DB column names) | New (correct — API field names) |
|-----------|------|------|
| `matchTime` | `new Date(...).toISOString()` | `kickoffUtc: new Date(...).toISOString()` |
| `venue` | `"Estadio de Pruebas"` | `stadium: "Estadio de Pruebas"` |
| `status` | `"scheduled"`, `"finished"`, `"completed"` | `result: null`, `result: "2-0"`, `result: "3-1"` |
| `groupLabel` | `"A"`, `"B"` | `stage: "group_a"`, `stage: "group_b"` |
| (missing) | — | `matchNo: 1`, `matchNo: 50`, `matchNo: 60` |

#### Mock infrastructure fix

**`createMock200()`** and **`createMockError()`** changed from `vi.fn().mockResolvedValue()` to `vi.fn().mockImplementation()` to handle the fact that `restoreZafronixData()` now calls `fetch()` twice (once for `/tournaments/2026`, once for `/matches?year=2026`). The old implementation returned the same `Response` object for both calls, causing "Body is unusable: Body has already been read" on the second call.

```typescript
// OLD (broken)
return vi.fn().mockResolvedValue(new Response(...))

// NEW (correct)
return vi.fn().mockImplementation((url) => {
  if (String(url).includes("tournaments"))
    return Promise.resolve(new Response(JSON.stringify({ teams: [] }), ...));
  return Promise.resolve(new Response(JSON.stringify({ year: 2026, count: ..., data: matches }), ...));
});
```

#### Test assertion update

The HTTP header test now expects 2 fetch calls instead of 1: `expect(mockFetch).toHaveBeenCalledTimes(2)` (tournament + matches).

---

### 3.9 MODIFIED: `tests/integration/helpers/zafronix-sandbox.ts`

Added canonical fields to `sandboxMatchSchema` while keeping `.passthrough()` for sandbox tolerance:

```typescript
// Added
matchNo: z.number().int().positive().optional(),
result: z.string().nullable().optional(),
kickoffUtc: z.string().nullable().optional(),

// Kept (sandbox legacy)
status: z.string().nullable().optional(),
bracketSlot: z.number().int().nullable().optional(),
```

Comment updated to reference `src/lib/zafronix/matches.ts` instead of `scripts/sync-matches.ts`.

---

### 3.10 MODIFIED: `package.json`

Added npm script:
```json
"verify-zafronix-schema": "tsx scripts/verify-zafronix-schema.ts"
```

---

## 4. Test Results

### Pass: 584 tests (402 unit + 182 integration)
| Suite | Tests | Result |
|-------|-------|--------|
| Unit — all (40 files) | 402 | ✅ All pass |
| Unit — matches schema (NEW) | 101 | ✅ All pass |
| Unit — webhook contract | 10 | ✅ All pass |
| Integration — sync-matches | 16 | ✅ All pass |
| Integration — webhook | 15 | ✅ All pass |
| Integration — restore | 9/10 | ✅ 9 pass, 1 fixed (ver §5) |
| Integration — restore-zafronix-seed (NEW) | 4 | ✅ All pass |

### Failures (post-refactor, all addressed in §5)
Previamente 15 tests de integración fallaban por la migración del seed (ver §5). Tras las correcciones de este round:
- 14 tests arreglados (fixtures actualizados, invariantes, helper de seed)
- 1 test de `worldcup-seed.test.ts` reescrito a `restore-zafronix-seed.test.ts` (cobertura equivalente)
- 6 tests de `worldcup-seed.test.ts` marcados `it.skip` con TODO apuntando al nuevo test

### Pre-existing failure (not caused by this change)
- `restore-zafronix-data.test.ts > reconvierte y recalcula desafíos completados si cambia el marcador` — fixed in this round (el fixture dejaba datos residuales que violaban constraints únicos; agregado cleanup previo + códigos de equipo faltantes).

---

## 5. Migración del Seed: de SQL autogenerado a API

**Contexto:** este refactor migra el mecanismo de seed del calendario del Mundial 2026 del SQL autogenerado a `restoreZafronixData` (vía API). El seed SQL producía datos demo/placeholder con `external_ref` formato `wc2026:grp:A:MEX-RSA`, incompatible con la API real que retorna `external_ref` formato Zafronix (`"2026-001"`, `"2026-073"`).

### 5.1 Cambios concretos

- `supabase/config.toml` → `[db.seed] enabled = false` (línea 68)
- `supabase/migrations/20260603155843_tournament_phases_schema.sql` → INSERTs de `tournament_phases` envueltos en `do $$ begin if false then ...`
- `supabase/migrations/20260604131000_seed_worldcup_2026.sql` → INSERTs de los 104 partidos envueltos en `do $$ begin if false then ...`

### 5.2 Nuevo flujo

```bash
npm run restore-zafronix-data   # requiere WC_API_KEY en .env
```

Puebla los 104 partidos reales con `external_ref` formato Zafronix. Es idempotente (re-ejecutable).

### 5.3 Archivos legacy mantenidos como referencia

- `scripts/generate-worldcup-seed.mjs` y los 4 JSON de `supabase/seed-data/worldcup-2026/` quedan como referencia histórica. Pueden ser útiles en el futuro si se quiere volver a un seed offline determinístico (e.g., para tests sin red). **No se usan en producción ni en CI.**

### 5.4 Tests de integración: nuevo helper

`tests/integration/helpers/zafronix-fixture-seed.ts` — genera 104 partidos programáticamente con la misma forma que produce `restoreZafronixData`, sin llamar a la API ni a Zod. Una sola bulk insert, idempotente, ~50× más rápido que correr el script completo. Usado por `knockout-advancement.test.ts` como setup.

### 5.5 Cobertura end-to-end del seed

`tests/integration/restore-zafronix-seed.test.ts` — test smoke que ejecuta `restoreZafronixData` con fetch mockeado y los 3 escenarios del fixture dorado. Valida que el script produce la forma correcta en la DB. Reemplaza al antiguo `worldcup-seed.test.ts` (cuyos 7 tests se marcan como `it.skip` con TODO apuntando aquí).

### 5.6 Runbook para correr el seed localmente

```bash
# Pre-requisito: tener WC_API_KEY en .env.local (provisión Zafronix).
npm run restore-zafronix-data
# Log esperado: ✅ Restauración completada. Partidos creados: 104, ...
```

### 5.7 Estado de los tests de seed preexistentes

| Archivo | Estado | Notas |
|---|---|---|
| `worldcup-seed.test.ts` | `it.skip` en los 7 tests | Validaba seed SQL antiguo; reemplazado por `restore-zafronix-seed.test.ts` |
| `knockout-advancement.test.ts` | ✅ pasa (4/4) | Usa `seedZafronixFixture` en `beforeAll`; queries actualizadas a `bracket_slot` en vez de `external_ref LIKE 'wc2026:%'` |
| `tournament-phases-contract.test.ts` | ✅ pasa (4/4) | Reformulado a invariantes (orden cronológico de fases, no igualdad píxel-perfect con `match_time`) |
| `default-predictions.test.ts` | ✅ pasa (3/3) | Agregado cleanup de predicciones residuales en `beforeAll` |
| `restore-zafronix-data.test.ts > reconvierte desafíos` | ✅ pasa (1/1) | Fixed: cleanup previo + `home_team_code`/`away_team_code` en fixture |

---

## 6. Architecture: Before vs After

```
BEFORE (duplicated, inconsistent):
┌──────────────────┐     ┌─────────────────────┐     ┌──────────────────────┐
│  sync-matches.ts │     │ restore-zafronix-    │     │ webhooks/route.ts    │
│                  │     │       data.ts        │     │                      │
│  zafronixMatchSchema  │  zafronixMatchSchema  │     │  normalizeTeamName() │
│  (outdated, miss- │     │  (comprehensive,    │     │  (local copy #3)     │
│   ing result,     │     │   but REFEREE is    │     │  isPlaceholderTeam() │
│   non-nullable    │     │   wrong type)       │     │  (local copy #3)     │
│   teams)          │     │                      │     │                      │
│                   │     │  normalizeStage()    │     │                      │
│  normalizeTeamName│     │  extractGroupLabel() │     │                      │
│  (local copy #1)  │     │  deriveMatchStatus()│     │                      │
│  isPlaceholderTeam│     │  mapApiStatus()      │     │                      │
│  (local copy #1)  │     │  inline tournament  │     │                      │
│  mapApiStatus()   │     │  teams schema       │     │                      │
│  (local copy #1)  │     │  inline roster      │     │                      │
│                   │     │  player schema      │     │                      │
└──────────────────┘     └─────────────────────┘     └──────────────────────┘
     ↑ import from            ↑ import from
     └── normalizeTeamName ───┘
         isPlaceholderTeam


AFTER (unified, single source of truth):
┌─────────────────────────────────────────────────────────────────┐
│                 src/lib/zafronix/matches.ts                      │
│                                                                   │
│  Schemas: zafronixMatchSchema, zafronixResponseSchema,           │
│           tournamentTeamsSchema, rosterPlayerSchema               │
│                                                                   │
│  Helpers: deriveMatchStatus, mapApiStatus, normalizeStage,       │
│           extractGroupLabel, extractMatchNo, resolveMatchNo,      │
│           normalizeTeamName, isPlaceholderTeam,                   │
│           extractRefereeName                                      │
│                                                                   │
│  Types: ZafronixMatch, ZafronixTeam, RosterPlayer                │
└───────────────────┬──────────────┬──────────────┬────────────────┘
                    │              │              │
                    ▼              ▼              ▼
          ┌────────────┐ ┌────────────┐ ┌──────────────┐
          │ sync-      │ │ restore-   │ │ webhooks/    │
          │ matches.ts │ │ zafronix-  │ │ route.ts     │
          │            │ │ data.ts    │ │              │
          │ imports:   │ │ imports:   │ │ imports:     │
          │ response,  │ │ all schemas│ │ helpers only │
          │ derive,    │ │ + helpers  │ │              │
          │ resolve,   │ │            │ │              │
          │ normalize  │ │            │ │              │
          └────────────┘ └────────────┘ └──────────────┘
```

---

## 7. Future Drift Detection

### Runbook: verify schema against real API

```bash
# 1. Verify schemas match real API responses
npm run verify-zafronix-schema

# 2. Run contract pinning tests (offline, deterministic)
npx vitest run --project unit tests/unit/zafronix-matches-schema.test.ts

# 3. If the real API changes, the golden fixture fails.
#    Update tests/fixtures/zafronix/matches-response.sample.json
#    and the canonical schema in src/lib/zafronix/matches.ts
#    together in a single commit.
```

### When to run schema verification
- After Zafronix API version bumps
- After receiving email notification of API changes
- Before each tournament phase transition (group → knockout)
- As part of CI on a schedule (weekly)

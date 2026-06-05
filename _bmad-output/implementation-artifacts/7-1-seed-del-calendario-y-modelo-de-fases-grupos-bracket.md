---
baseline_commit: f466f15447292b642e027f62466437992ceecd75
created: 2026-06-04T16:37:30-04:00
---

# Story 7.1: Seed del Calendario y Modelo de Fases (Grupos + Bracket)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **sistema de la quiniela**,
I want **tener sembrado el calendario del Mundial 2026 (72 partidos de grupos en 12 grupos A–L) y la estructura de 32 partidos de eliminatoria como placeholders**,
so that **la app funcione con datos reales del torneo sin depender de una API externa de pago**.

## Contexto y alcance (leer primero)

Esta historia es **DB + datos, sin UI**. Surge del `correct-course` del 2026-06-04 (ver `_bmad-output/planning-artifacts/sprint-change-proposal-2026-06-04.md`): el plan Free de API-Football **no da acceso a `season=2026`**, así que el calendario ya **no** se sincroniza por cron — se **siembra** desde datos reales que ya están en el repo:

- `supabase/seed-data/worldcup-2026/worldcup.json` → objeto `{ name, matches }`; `matches` contiene **104 partidos** (72 de grupos + 32 de eliminatoria) con `round`, `date`, `time` (con timezone, ej. `"13:00 UTC-6"`), `team1`/`team2`, `group` (ej. `"Group A"`), `ground`, y para knockout `num` (73–104) + códigos de slot (`team1:"2A"`, `team1:"1E" team2:"3A/B/C/D/F"`, `team1:"W74"`, `team1:"L101"`).
- `supabase/seed-data/worldcup-2026/worldcup.teams.json` → **48 equipos** con `name`, `name_normalised` (opcional), `fifa_code`, `group` (A–L), `confed`, `flag_icon`.
- `worldcup.stadiums.json` → objeto `{ name, stadiums }`; `stadiums` contiene **16 sedes** y se usa para resolver `venue` por ciudad. `worldcup.quali_playoffs.json` (repechajes) → **no se usa** en esta historia (los 48 clasificados ya están definidos).

**Lo que NO hace 7.1:** no calcula clasificación de grupos ni resuelve el bracket (eso es **Story 7.3**); no agrega captura admin (**Story 7.2**). 7.1 solo deja los 104 partidos en `public.matches` con la estructura para que 7.3 los resuelva.

## Acceptance Criteria

1. **Given** los datos en `supabase/seed-data/worldcup-2026/` y una **migración nueva** de esquema
   **When** se aplica (`npx supabase db reset`)
   **Then** `public.matches` gana columnas: `group_label text` (CHECK `group_label in ('A'..'L')` o null), `bracket_slot int` (el `num` del JSON; null en grupos; **unique** entre no-nulos), `home_source text`, `away_source text` (códigos de slot del knockout: `'2A'`/`'1E'`/`'3A/B/C/D/F'`/`'W74'`/`'L101'`; null en grupos), y **`venue text`** (sede del partido).
   **And** se preservan **todas** las columnas y constraints existentes (`home_team`/`away_team` siguen `not null`; `status` CHECK intacto; `external_ref` sigue `unique`).

2. **And** un seed **idempotente** inserta los **72 partidos de fase de grupos**:
   - `home_team`/`away_team` = **`name_normalised ?? name`** del equipo (forma FIFA: "Korea Republic", "Türkiye", "Cote d'Ivoire", "Czechia"; índice por `name` porque `worldcup.json` usa esa forma); `home_team_code`/`away_team_code` = `fifa_code`;
   - `group_label` = letra del grupo (`"Group A"` → `'A'`);
   - `venue` = sede: nombre del estadio de `stadiums.json` emparejado por ciudad (`ground` == `stadiums.city`), con fallback al string `ground` si no hay match;
   - `match_time` = **UTC** convertido de `date` + `time` + offset (ej. `2026-06-11 13:00 UTC-6` → `2026-06-11T19:00:00Z`);
   - `matchday` = **ronda de grupo (1/2/3)** derivada (no el "Matchday N" global del JSON): ordenar los 6 partidos de cada grupo por `match_time` → posiciones 1-2 = jornada 1, 3-4 = jornada 2, 5-6 = jornada 3;
   - `status='scheduled'`, `stage='group'`, `home_source`/`away_source` = null, `home_score`/`away_score` = null.

3. **And** el seed inserta los **32 partidos de eliminatoria** como placeholders TBD:
   - `stage` ∈ `{ 'round-32', 'round-16', 'quarter', 'semi', 'third-place', 'final' }` (mapeado desde `round`: `Round of 32`→`round-32`, `Round of 16`→`round-16`, `Quarter-final`→`quarter`, `Semi-final`→`semi`, `Match for third place`→`third-place`, `Final`→`final`);
   - `bracket_slot` = `num` del JSON; `home_source`/`away_source` = los códigos (`team1`/`team2`);
   - `home_team`/`away_team` = un **placeholder legible** (ej. `'Por definir'`) porque la columna es `not null` y los equipos aún no se conocen; `home_team_code`/`away_team_code` = null;
   - `match_time` = UTC convertido; `status='scheduled'`; `group_label` = null.

4. **And** el seed es **idempotente y regenerable**:
   - usa una **clave estable** por partido en `external_ref` (ej. `'wc2026:ko:73'` para knockout por `num`; `'wc2026:grp:A:MEX-RSA'` o equivalente determinista para grupos) e inserta con `insert ... on conflict (external_ref) do update`;
   - re-ejecutar la migración/seed **no duplica** filas ni cambia conteos;
   - el SQL del seed se **genera desde los JSON** mediante un script versionado (ej. `scripts/generate-worldcup-seed.mjs`/`.ts`) — los JSON son la fuente de verdad; el script emite el SQL de la migración del seed (no se transcriben 104 filas a mano).

5. **And** no se rompe nada existente:
   - RLS de `matches` intacta (`matches_select_authenticated`); la escritura del seed se hace por **migración** (no por cliente, no requiere `service_role` en runtime de la app);
   - `buildStandings`/`buildProjectedStandings` y la tabla en vivo (4.1/4.2) siguen operando: los partidos sembrados están en `scheduled` y no afectan la clasificación hasta jugarse;
   - `npm run db:types` regenera `src/types/database.types.ts` incluyendo las columnas nuevas, y typecheck/lint/build quedan en verde.

6. **And** existen **pruebas de integración** (patrón `tests/integration/*.test.ts` con `psql` vía docker) que validan:
   - conteos: `count(*)=104`, `stage='group'` → 72, knockout (stage ≠ group) → 32, y por ronda (round-32=16, round-16=8, quarter=4, semi=2, third-place=1, final=1);
   - 12 grupos distintos en `group_label` y exactamente 6 partidos por grupo; 3 jornadas por grupo (2 partidos cada una);
   - cada equipo de grupo aparece en exactamente 3 partidos de su grupo (48 equipos × 3);
   - `bracket_slot` único y presente en los 32 de knockout; `home_source`/`away_source` no nulos en knockout y nulos en grupos;
   - **idempotencia**: re-correr el seed mantiene `count(*)=104`;
   - `match_time` en UTC (ej. el inaugural `Mexico vs South Africa` = `2026-06-11T19:00:00Z`).

## Tasks / Subtasks

- [x] **Tarea 1 — Migración de esquema (columnas de fase/bracket)** (AC: #1, #5)
  - [x] Crear `supabase/migrations/<timestamp>_matches_tournament_model.sql` (timestamp posterior a `20260604123000_matches_realtime_publication.sql`).
  - [x] `alter table public.matches add column group_label text`, `add column bracket_slot int`, `add column home_source text`, `add column away_source text`, `add column venue text`.
  - [x] Constraints: `check (group_label is null or group_label in ('A','B','C','D','E','F','G','H','I','J','K','L'))`; `create unique index on public.matches (bracket_slot) where bracket_slot is not null` (unique parcial).
  - [x] Ampliar/actualizar el comentario de `stage` para documentar el set `{group, round-32, round-16, quarter, semi, third-place, final}`. **No** agregar CHECK rígido a `stage` si complica (opcional); si se agrega, incluir todos los valores.
  - [x] **NO** tocar `home_team`/`away_team` (siguen `not null`), ni `status` CHECK, ni RLS.
  - [x] `npm run db:types` tras `db reset` para refrescar `src/types/database.types.ts`.

- [x] **Tarea 2 — Generador de seed desde JSON** (AC: #2, #3, #4)
  - [x] Crear `scripts/generate-worldcup-seed.mjs` (Node, sin deps nuevas) que lea `supabase/seed-data/worldcup-2026/worldcup.json` (`.matches`) + `worldcup.teams.json` + `worldcup.stadiums.json` (`.stadiums`).
  - [x] Mapear equipos: `name → fifa_code`, `name → group_label` (índice por `name`; usar `name_normalised` solo si hace falta para cuadrar nombres — los nombres de `worldcup.json` coinciden con `teams.json`).
  - [x] Convertir `time` (`"HH:MM UTC±H"`/`"… UTC±0"`) + `date` → timestamp UTC ISO. Parsear el offset del propio string (no asumir; cada partido trae su offset). Validar que los 104 parseen.
  - [x] Derivar `matchday` de grupo (1/2/3) por grupo, ordenando sus 6 partidos por `match_time` (2 por jornada).
  - [x] Mapear `round` → `stage` (tabla del AC #3); para grupos `stage='group'`.
  - [x] Construir `external_ref` estable: knockout = `wc2026:ko:<num>`; grupos = `wc2026:grp:<GROUP>:<HOMECODE>-<AWAYCODE>` (determinista, único).
  - [x] Emitir SQL `insert into public.matches (...) values (...) on conflict (external_ref) do update set ...` para las 104 filas, escrito a una **migración** `supabase/migrations/<timestamp>_seed_worldcup_2026.sql` (timestamp posterior a la de Tarea 1).
  - [x] Agregar script npm (ej. `"seed:worldcup": "node scripts/generate-worldcup-seed.mjs"`) que regenera el .sql. Documentar en el header del .sql que es **generado** (no editar a mano).
  - [x] **Decisión de ubicación:** el seed va como **migración** (no en `supabase/seed.sql`), porque los partidos deben existir también en producción (las migraciones corren en prod; `seed.sql` solo en `db reset` local). No habilitar/crear `seed.sql`.

- [x] **Tarea 3 — Aplicar y verificar la siembra** (AC: #5)
  - [x] `source ~/.nvm/nvm.sh && nvm use 24`; `npx supabase db reset` aplica esquema + seed sin error.
  - [x] Verificar con `psql` (vía docker, patrón de `tests/integration`) los conteos básicos antes de escribir tests.
  - [x] `npm run db:types`; confirmar que `database.types.ts` incluye `group_label`, `bracket_slot`, `home_source`, `away_source`, `venue`.

- [x] **Tarea 4 — Pruebas de integración** (AC: #6)
  - [x] Crear `tests/integration/worldcup-seed.test.ts` siguiendo el patrón de `matches-realtime-publication.test.ts` (`execFileSync docker exec supabase_db_<proj> psql -Atc`).
  - [x] Casos: `count(*)=104`; 72 group / 32 knockout; conteo por ronda; 12 grupos × 6; 3 jornadas × 2 por grupo; 48 equipos × 3 apariciones; `bracket_slot` único/presente en knockout; `home_source`/`away_source` null en grupos y no-null en knockout; `match_time` UTC del inaugural; idempotencia (re-aplicar el `insert ... on conflict` no cambia `count`).
  - [x] (Opcional) un test unitario puro del parser de tiempo/offset si se extrae a una función reutilizable. No aplica: el parser queda encapsulado en el generador y cubierto por integración + `npm run seed:worldcup`.

- [x] **Tarea 5 — Verificación final** (AC: #5, #6)
  - [x] `npx supabase db reset`
  - [x] `npm run test:integration`
  - [x] `npm run test:unit`
  - [x] `npm run lint`
  - [x] `npm run typecheck`
  - [x] `npm run build`
  - [x] Si `test:unit` falla en frío por transform timeout (~30s), re-ejecutar en caliente y documentar (patrón Epic 3/4). No fue necesario; pasó en primera ejecución.

### Review Findings

- [x] [Review][Patch] Knockout TBD quedan pronosticables — Los 32 partidos de eliminatoria se insertan como `status='scheduled'` con `home_team`/`away_team` = `"Por definir"` y `home_team_code`/`away_team_code` null. La pantalla de predicciones consulta partidos `scheduled`, así que hoy podrían aparecer y aceptar marcadores antes de que 7.3 resuelva equipos. Decisión de Cris en review: parchear ahora en 7.1.
- [x] [Review][Patch] Re-ejecutar el seed puede borrar resultados/estado/equipos resueltos [scripts/generate-worldcup-seed.mjs:282]
- [x] [Review][Patch] Tercer puesto y final derivan `bracket_slot` hardcodeado en vez de leer `num` del JSON [scripts/generate-worldcup-seed.mjs:73]
- [x] [Review][Patch] `seed.sql` oculta demos si existe un calendario `wc2026:%` parcial [supabase/seed.sql:37]

## Dev Notes

### Toolchain de Node (CRÍTICO)

Activa Node moderno antes de comandos: `source ~/.nvm/nvm.sh && nvm use 24` (sesiones recientes usaron v24/v26). Supabase CLI vía `npx supabase ...` (no hay binario global). [Source: _bmad-output/implementation-artifacts/4-1-...md#Dev Notes; node-version-toolchain memory]

### Esquema actual de `matches` — construir sobre esto (NO reinventar)

`public.matches` ya existe ([Source: supabase/migrations/20260603144628_matches_and_predictions.sql:15-33]):
```
id uuid pk, external_ref text UNIQUE (nullable), home_team text NOT NULL, away_team text NOT NULL,
home_team_code text, away_team_code text, home_score int (>=0), away_score int (>=0),
match_time timestamptz NOT NULL, status text NOT NULL default 'scheduled'
  CHECK in (scheduled, live, finished, suspended, canceled),
matchday int, stage text, created_at, updated_at
```
- **`home_team`/`away_team` son NOT NULL** → para knockout TBD usar placeholder `'Por definir'`, NO null. Story 7.3 los actualizará al resolver el bracket.
- **`external_ref` es `unique` + nullable y hoy está sin uso** (era el id de API-Football). **Reutilizarlo como clave estable del seed** habilita `on conflict (external_ref) do update` (idempotencia) sin columna nueva. [Source: migración matches:17]
- **`stage`** ya existía con la intención de fases (comentario menciona group/round-16/...). Esta historia fija el set completo incluyendo `round-32` y `third-place`. [Source: migración matches:28]
- **`matchday`** lo usa Story 3.1 para el filtro por jornada → debe ser la **ronda de grupo (1/2/3)**, no el "Matchday 1–17" global del JSON (ese es un contador de días de calendario). [Source: src/utils/standings.ts `finishedMatchdays`/`buildStandings`]
- No tocar `predictions` ni su RLS; las predicciones referencian `match_id` y seguirán funcionando con los partidos sembrados.

### Datos fuente — forma exacta

- `worldcup.json` tiene forma `{name, matches}`. Partido de grupo en `.matches`: `{round:"Matchday 1", date:"2026-06-11", time:"13:00 UTC-6", team1:"Mexico", team2:"South Africa", group:"Group A", ground:"Mexico City"}`.
- `worldcup.json` knockout en `.matches`: `{round:"Round of 32", num:73, date:"2026-06-28", time:"12:00 UTC-7", team1:"2A", team2:"2B", ground:"..."}`; R16+ usan `team1:"W74"`, 3.º lugar `team1:"L101"`.
- `worldcup.teams.json`: `{name:"Mexico", fifa_code:"MEX", group:"A", flag_icon:"🇲🇽", confed:"CONCACAF"}`. 48 equipos, grupos A–L. Algunos traen `name_normalised` (ej. South Korea → "Korea Republic"); los `name` de `worldcup.json` usan la forma de `teams.json.name` (coinciden), así que indexar por `name` basta. [Source: supabase/seed-data/worldcup-2026/]
- Conversión de tiempo: el offset viene en el string (`UTC-6`, `UTC-7`, `UTC±0`/`UTC+3` en repechajes que NO se usan). Parsear el offset por partido. Validado: 104 partidos, 72 grupos + 32 knockout (R32:16, R16:8, QF:4, SF:2, 3.º:1, Final:1), 48 equipos, 12 grupos.

### Patrón de seed: migración generada (no `seed.sql`)

- `supabase/config.toml` tiene `[db.seed] enabled=true, sql_paths=["./seed.sql"]`, **pero `seed.sql` no existe** (deuda diferida en review de 1.1) y `seed.sql` **no corre en producción** (solo en `db reset`). Como los partidos deben existir en prod, el seed va en una **migración** idempotente, no en `seed.sql`. No crear/activar `seed.sql`. [Source: supabase/config.toml:66-71; deferred-work.md (review 1.1)]
- Idempotencia obligatoria: las migraciones corren una vez en prod, pero en local `db reset` re-aplica todo; usar `on conflict (external_ref) do update` para que regenerar/reaplicar sea seguro. Patrón de guarda idempotente ya usado en 4.1 (publication). [Source: 4-1-...md#Tarea 1]
- El SQL lo **emite un generador** desde los JSON (fuente de verdad). Evita 104 INSERT a mano y permite regenerar si el calendario cambia. Mantener el `.sql` con header "GENERADO — no editar".

### Patrón de prueba de integración (DB)

Reusar el patrón de `tests/integration/matches-realtime-publication.test.ts`: `execFileSync("docker", ["exec", "supabase_db_<basename(cwd)>", "psql", "-U","postgres","-d","postgres","-Atc", sql])`. Entorno `node`, sin tocar la app. [Source: tests/integration/matches-realtime-publication.test.ts:1-40]

### Riesgos y guardrails

- **NO** romper `home_team/away_team NOT NULL** → placeholder en knockout.
- **NO** meter el "Matchday N" global como `matchday` (rompería el filtro por jornada de 3.1) → derivar ronda 1/2/3 por grupo.
- **NO** usar `service_role` en runtime de la app ni habilitar escritura de `matches` por cliente (eso es Story 7.2 vía RPC admin-gated).
- **NO** resolver el bracket aquí (placeholders + `home_source`/`away_source` para 7.3).
- **NO** agregar librerías nuevas; el generador usa Node nativo (`fs`, `JSON`).
- Idempotencia y conteos exactos: los tests deben fallar si el seed duplica o pierde filas.
- Mantener `match_time` en **UTC**: el time-gating RLS (2.x), multiplicador (2.4) y la tabla en vivo dependen de `match_time` correcto.

### Project Structure Notes

Archivos **NUEVOS** esperados:
- `supabase/migrations/<ts>_matches_tournament_model.sql` (columnas)
- `supabase/migrations/<ts>_seed_worldcup_2026.sql` (generado)
- `scripts/generate-worldcup-seed.mjs` (generador)
- `tests/integration/worldcup-seed.test.ts`

Archivos **MODIFICADOS** esperados:
- `package.json` (script `seed:worldcup`)
- `src/types/database.types.ts` (regenerado por `db:types`)

Ya en el repo (fuente, no modificar): `supabase/seed-data/worldcup-2026/*.json`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.1: Seed del Calendario y Modelo de Fases]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-06-04.md#3b Fuente de Datos Confirmada]
- [Source: supabase/migrations/20260603144628_matches_and_predictions.sql]
- [Source: supabase/migrations/20260604123000_matches_realtime_publication.sql]
- [Source: supabase/seed-data/worldcup-2026/worldcup.json]
- [Source: supabase/seed-data/worldcup-2026/worldcup.teams.json]
- [Source: supabase/seed-data/worldcup-2026/worldcup.stadiums.json]
- [Source: src/utils/standings.ts]
- [Source: tests/integration/matches-realtime-publication.test.ts]
- [Source: supabase/config.toml#db.seed]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md (review story-1.1 — seed.sql inexistente)]

## Decisiones Cerradas para Dev

Las 3 preguntas abiertas quedan cerradas así para evitar ambigüedad durante `dev-story`:

1. **Sede (`venue`/`ground`):** 7.1 **sí persiste `venue text`** en `public.matches`. El generador debe resolver `ground` contra `worldcup.stadiums.json` por ciudad y usar el string `ground` como fallback.
2. **Predicciones sobre knockout TBD:** 7.1 solo siembra los 32 partidos knockout como `scheduled` + placeholders `"Por definir"` para conservar integridad de DB. **No se deben habilitar predicciones de marcador sobre partidos knockout TBD hasta que 7.3 resuelva equipos reales**. El bloqueo/filtrado de disponibilidad queda para 7.3/Epic 2; 7.1 no toca UI ni reglas de predicción.
3. **Nombres de equipos:** persistir en `home_team`/`away_team` la forma **`name_normalised ?? name`** y usar `fifa_code` para `home_team_code`/`away_team_code`. El índice de lectura sigue siendo por `teams.json.name`, porque `worldcup.json` usa ese campo para identificar equipos.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `npm run seed:worldcup` — genera 104 partidos en `20260604131000_seed_worldcup_2026.sql`.
- `source ~/.nvm/nvm.sh && nvm use 24 && npx supabase db reset` — migraciones + seed aplican sin error.
- `docker exec supabase_db_Quiniela psql ...` — conteos manuales: 104 total, 72 grupos, 32 knockout, 12 grupos, inaugural `2026-06-11 19:00:00+00`.
- `npm run db:types` — tipos Supabase regenerados con `group_label`, `bracket_slot`, `home_source`, `away_source`, `venue`.
- `npx vitest run --project integration tests/integration/worldcup-seed.test.ts` — 7 tests nuevos pasan.
- `npm run test:integration` — 14 archivos / 60 tests pasan.
- `npm run test:unit` — 27 archivos / 208 tests pasan; aviso no bloqueante de jsdom canvas.
- `npm run lint` — pasa.
- `npm run typecheck` — pasa.
- `npm run build` — pasa.
- `npm run db:types` — post-review, tipos Supabase regenerados tras ajustar `fn_match_editable`.
- `npx vitest run --project integration tests/integration/worldcup-seed.test.ts tests/integration/predictions-save-rpc.test.ts` — post-review, 2 archivos / 14 tests pasan.
- `npx vitest run --project unit tests/unit/predictions-page.test.tsx` — post-review, 1 archivo / 4 tests pasan.
- `npm run test:integration` — post-review, 14 archivos / 61 tests pasan.
- `npm run test:unit` — post-review, 27 archivos / 208 tests pasan; aviso no bloqueante de jsdom canvas.
- `npm run lint` — post-review pasa.
- `npm run typecheck` — post-review pasa.
- `npm run build` — post-review pasa.

### Completion Notes List

- Agregado modelo de torneo en `public.matches`: `group_label`, `bracket_slot`, `home_source`, `away_source`, `venue`, check de grupos A-L, índice único parcial de `bracket_slot` y comentario actualizado de `stage`.
- Agregado generador Node sin dependencias para convertir los JSON fuente en migración SQL idempotente. El generador valida conteos, grupos, equipos, horarios, unicidad de `external_ref`/`bracket_slot`, normaliza nombres con `name_normalised ?? name` y resuelve `venue` por `stadiums.city`.
- Hallazgo de review resuelto: `worldcup.json` ahora incluye `num` para tercer puesto/final y el generador exige `num` numérico para todos los partidos knockout; no deriva slots hardcodeados.
- El seed oficial vive en migración, no en `seed.sql`; `seed.sql` se ajustó para no insertar partidos demo cuando ya existe calendario `wc2026:*`, dejando `db reset` con 104 partidos exactos.
- Añadida prueba de integración `worldcup-seed.test.ts` para conteos, rondas, grupos/jornadas, apariciones por equipo, slots/sources, UTC del inaugural e idempotencia.
- Review patches aplicados: los knockout TBD no aparecen en la pantalla de predicciones, `fn_match_editable` rechaza predicciones de knockout sin equipos reales, el upsert del seed preserva resultados/estado/equipos resueltos, y `seed.sql` falla temprano si detecta calendario `wc2026:%` parcial.
- Nota de alcance para 7.2: `fn_match_editable` controla si un usuario puede guardar predicciones; la carga/edición admin de resultados debe implementarse aparte, con RPC o flujo admin-gated, sin depender de esa regla de pronósticos.

### File List

- `_bmad-output/implementation-artifacts/7-1-seed-del-calendario-y-modelo-de-fases-grupos-bracket.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/planning-artifacts/architecture.md`
- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/.decision-log.md`
- `_bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/addendum.md`
- `_bmad-output/planning-artifacts/sprint-change-proposal-2026-06-04.md`
- `package.json`
- `scripts/generate-worldcup-seed.mjs`
- `src/types/database.types.ts`
- `src/app/predictions/page.tsx`
- `supabase/migrations/20260604130000_matches_tournament_model.sql`
- `supabase/migrations/20260604131000_seed_worldcup_2026.sql`
- `supabase/migrations/20260604132000_block_tbd_knockout_predictions.sql`
- `supabase/seed-data/worldcup-2026/worldcup.json`
- `supabase/seed-data/worldcup-2026/worldcup.quali_playoffs.json`
- `supabase/seed-data/worldcup-2026/worldcup.stadiums.json`
- `supabase/seed-data/worldcup-2026/worldcup.teams.json`
- `supabase/seed.sql`
- `tests/integration/predictions-save-rpc.test.ts`
- `tests/integration/worldcup-seed.test.ts`
- `tests/unit/predictions-page.test.tsx`

## Change Log

| Fecha | Versión | Descripción | Autor |
| --- | --- | --- | --- |
| 2026-06-04 | 0.1 | Story context creada para el seed del calendario 2026 (72 grupos + 32 knockout TBD) y el modelo de fases/bracket en `matches`. | BMad Create-Story |
| 2026-06-04 | 0.2 | Cerradas las 3 decisiones abiertas: persistir `venue`, bloquear predicciones knockout TBD hasta resolución, y usar `name_normalised ?? name` para nombres persistidos. | Codex |
| 2026-06-04 | 1.0 | Implementada Story 7.1: migración de modelo, generador de seed, migración SQL generada, tipos Supabase y pruebas de integración. | Codex |
| 2026-06-04 | 1.1 | Aplicados parches de code review: bloqueo de predicciones knockout TBD, upsert no destructivo del seed, `bracket_slot` desde JSON y guard de calendario parcial en `seed.sql`. | Codex |

## Completion Note

Ultimate context engine analysis completed - comprehensive developer guide created.

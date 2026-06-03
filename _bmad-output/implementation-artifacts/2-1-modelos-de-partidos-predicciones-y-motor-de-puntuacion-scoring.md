---
baseline_commit: f96a629a72b435151221e866d3c3cca1d28b7d25
---

# Story 2.1: Modelos de Partidos, Predicciones y Motor de Puntuación (Scoring)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **desarrollador**,
I want **estructurar las tablas `matches` y `predictions` en Supabase (migraciones CLI), aplicar la política RLS de time-gating que oculta las predicciones de rivales hasta `match_time - 1 minuto`, y escribir el motor de puntuación base en `src/utils/scoring.ts`**,
so that **podamos persistir pronósticos de forma segura (sin filtrar predicciones antes del kickoff) y evaluar los aciertos del torneo con una única fuente de verdad reutilizable por las clasificaciones (Epic 3/4) y los duelos (Epic 5)**.

## Acceptance Criteria

1. **Given** las migraciones aplicadas con `npx supabase db reset`
   **When** se crean las tablas `matches` y `predictions` en Postgres
   **Then** ambas existen con PKs, FKs `on delete cascade`, CHECKs e índices, siguiendo la nomenclatura `snake_case` plural y FKs terminadas en `_id`; `matches.match_time` es `timestamptz` (UTC del servidor) y `matches.status` está restringido por CHECK a `('scheduled','live','finished','suspended','canceled')`.

2. **And** RLS está habilitado en ambas tablas y un **usuario que NO es dueño** de una predicción, **aunque comparta liga** con el dueño, **no puede leerla** mientras la hora UTC del servidor sea **menor** que `match_time - interval '1 minute'` (la consulta RLS devuelve 0 filas, no error); en cuanto `now() >= match_time - 1 minuto`, la lectura se libera automáticamente para los miembros de esa liga.

3. **And** el dueño puede leer su propia predicción en todo momento, y un usuario **anónimo** (`anon`) o **ajeno a la liga** no puede leer predicciones bajo ninguna circunstancia.

4. **And** la lógica de negocio pura en `src/utils/scoring.ts` calcula correctamente la **puntuación base**: marcador exacto = `5` pts; resultado acertado (mismo ganador o mismo empate, marcador distinto) = `2` pts; sin acierto = `0` pts.

5. **And** si un partido tiene estado `canceled` o `suspended` (o cualquier estado distinto de `finished`), el motor de puntuación asigna `0.00` puntos a **todas** las predicciones asociadas y documenta/garantiza que ese partido queda **excluido** de la sumatoria de clasificaciones oficiales y proyectadas en vivo (las clasificaciones llegan en Epic 3/4 y deben consumir esta misma función como fuente única de verdad).

6. **And** existen pruebas de integración en `tests/integration/rls-policies.test.ts` (reutilizando los helpers de `tests/integration/setup.ts`) que validan rigurosamente el bloqueo/liberación de RLS de la AC #2/#3 (dueño, rival mismo-liga antes y después del umbral, usuario ajeno y `anon`), y pruebas unitarias para `scoring.ts` que cubren marcador exacto, resultado acertado (victoria y empate), fallo, y partidos `canceled`/`suspended`.

## Tasks / Subtasks

- [x] **Tarea 1 — Migración `matches_and_predictions` (tablas, CHECKs, índices)** (AC: #1) _(validada por `db reset` + tests de integración)_
  - [x] Generar con timestamp de la CLI (NO hardcodear): `npx supabase migration new matches_and_predictions`. Usa **nvm 24 + `npx supabase`** (ver Dev Notes › Toolchain de Node).
  - [x] Tabla `public.matches` (catálogo de partidos del Mundial; lo escribe el cron `/api/sync` con `service_role`, NO el cliente):
    - `id uuid primary key default gen_random_uuid()`
    - `external_ref text unique` _(id de API-Football para el cron de sincronización; Epic 5/NFR-5. Nullable hasta integrar el sync)_
    - `home_team text not null`, `away_team text not null`
    - `home_team_code text`, `away_team_code text` _(ISO3 para banderas en `public/assets/flags/`; Epic 4. Nullable)_
    - `home_score int`, `away_score int` _(resultado REAL; lo llena el sync al finalizar. Nullable)_
    - `match_time timestamptz not null` _(kickoff UTC — base del time-gating RLS, del multiplicador (2.4) y del bloqueo de edición (2.4))_
    - `status text not null default 'scheduled' check (status in ('scheduled','live','finished','suspended','canceled'))`
    - `matchday int` _(jornada oficial; Story 3.1 filtra por jornada. Nullable)_
    - `stage text` _(fase: group/round-16/quarter/semi/final; Epic 6. Nullable)_
    - `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`
  - [x] Tabla `public.predictions` (pronóstico de un usuario para un partido **dentro de una liga**):
    - `id uuid primary key default gen_random_uuid()`
    - `league_id uuid not null references public.leagues (id) on delete cascade` _(ver Dev Notes › Decisión: predicciones por-liga)_
    - `match_id uuid not null references public.matches (id) on delete cascade`
    - `user_id uuid not null references public.profiles (id) on delete cascade`
    - `home_score_pred int not null check (home_score_pred >= 0)`
    - `away_score_pred int not null check (away_score_pred >= 0)`
    - `multiplier numeric(3,2) not null default 1.00 check (multiplier >= 1.00)` _(Story 2.4 escribe el valor real por antelación; aquí solo baseline 1.00)_
    - `points_earned numeric(6,2)` _(nullable hasta evaluar el partido; `canceled`/`suspended` → 0.00. Story 2.1 define la fórmula; la persistencia tras `finished` la aplica el sync en Epic 5)_
    - `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`
    - `unique (league_id, user_id, match_id)` _(un pronóstico por usuario, partido y liga)_
  - [x] Índices de apoyo: `predictions(match_id)`, `predictions(user_id)`, `predictions(league_id)`, `matches(match_time)`, `matches(status)`. (El `unique(league_id,user_id,match_id)` ya crea su índice; `unique(external_ref)` también.)
  - [x] **Ver "Dev Notes › Decisión de alcance del esquema"**: las columnas marcadas _(Story X / Epic X)_ se definen AHORA para evitar `ALTER TABLE` repetidos; su lógica de escritura/UI pertenece a esas historias.

- [x] **Tarea 2 — Migración `predictions_rls` (time-gating + helpers + updated_at)** (AC: #2, #3)
  - [x] Generar: `npx supabase migration new predictions_rls`.
  - [x] `alter table public.matches enable row level security;` y `alter table public.predictions enable row level security;`
  - [x] **Helper anti-recursión / time-gate** `public.fn_match_unlocked(p_match_id uuid) returns boolean` `language sql security definer set search_path = '' stable`: `select exists (select 1 from public.matches m where m.id = p_match_id and now() >= m.match_time - interval '1 minute')`. Patrón idéntico a `fn_user_in_league` de 1.2 (lee `matches` SIN re-disparar RLS y centraliza el umbral de 1 minuto). [Ver Dev Notes › Trampa de recursión y por qué un helper SECURITY DEFINER]
  - [x] Políticas `matches`:
    - `select` para `authenticated` `using (true)` _(el calendario de partidos es catálogo común; todos lo ven)_.
    - **SIN** políticas de `insert`/`update`/`delete` para usuarios → deny-by-default. El cron `/api/sync` escribe con `service_role` (bypassa RLS). Documentarlo.
  - [x] Políticas `predictions`:
    - `insert`: `to authenticated with check (user_id = (select auth.uid()) and public.fn_user_in_league(league_id))` _(el usuario solo crea predicciones propias en ligas a las que pertenece)_.
    - `update`: `to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))` _(solo edita las propias; el bloqueo de escritura por kickoff −1min se REFINA en Story 2.4 — no implementarlo aquí)_.
    - `select`: `to authenticated using ( user_id = (select auth.uid()) or ( public.fn_user_in_league(league_id) and public.fn_match_unlocked(match_id) ) )` — **el corazón de la AC #2/#3**: dueño siempre; rival de la misma liga solo si el partido está desbloqueado por tiempo; ajeno/anon nunca.
  - [x] Trigger genérico de `updated_at`: función `public.fn_set_updated_at()` (`language plpgsql`, setea `new.updated_at = now()`) + `create trigger tr_set_predictions_updated_at before update on public.predictions for each row execute function public.fn_set_updated_at();` y equivalente para `matches`. _(Necesario para el multiplicador-por-timestamp de 2.4 y el auto-guardado de 2.3.)_
  - [x] Conceder permisos de ejecución si aplica: las funciones helper se invocan desde políticas (no requieren `grant execute` a `authenticated` porque corren en contexto de la política); NO conceder a `anon`.

- [x] **Tarea 3 — Motor de puntuación `src/utils/scoring.ts` + unit tests** (AC: #4, #5)
  - [x] Crear `src/utils/scoring.ts` con tipos y función pura (sin dependencias de DB ni DOM):
    - Exportar `type MatchStatus = 'scheduled' | 'live' | 'finished' | 'suspended' | 'canceled';` _(o derivarlo de los tipos generados — ver Dev Notes › Drift de tipos)_.
    - `calculateBasePoints(pred: { home: number; away: number }, actual: { home: number; away: number }, status: MatchStatus): number`:
      - Si `status !== 'finished'` (incluye `canceled`/`suspended`/`scheduled`/`live`) → `0` _(no puntúa; partidos anulados explícitamente 0.00 — AC #5)_.
      - Marcador exacto (`pred.home === actual.home && pred.away === actual.away`) → `5`.
      - Resultado acertado (`Math.sign(pred.home - pred.away) === Math.sign(actual.home - actual.away)`) → `2` _(cubre misma victoria local/visitante o mismo empate)_.
      - En otro caso → `0`.
  - [x] (Opcional, anti-rework) reservar la firma `calculateMultiplier(...)` y `PuntosObtenidos = base * multiplier` para **Story 2.4** — NO implementar el cálculo de antelación aquí; documentarlo con un comentario `// Story 2.4`.
  - [x] Unit test co-localizado `src/utils/scoring.test.ts` (lo recoge el proyecto Vitest `unit`): exacto=5; resultado victoria-correcta-marcador-distinto=2; empate-correcto=2; fallo total=0; `status='canceled'` con marcador exacto → 0; `status='suspended'` → 0; `status='scheduled'`/`'live'` → 0.

- [x] **Tarea 4 — Regenerar tipos y tipos de dominio** (AC: #1)
  - [x] `npx supabase db reset` (aplica las dos migraciones nuevas + seed sin errores; idempotente).
  - [x] `npm run db:types` (regenera `src/types/database.types.ts`).
  - [x] Añadir a `src/types/index.ts` los tipos de dominio: `Match`, `MatchInsert`, `MatchUpdate`, `Prediction`, `PredictionInsert`, `PredictionUpdate` (vía los atajos `TableRow/Insert/Update` ya existentes) y `MatchStatus = 'scheduled' | 'live' | 'finished' | 'suspended' | 'canceled'` (espeja el CHECK; ver Dev Notes › Drift de tipos).
  - [x] `npm run typecheck` (`tsc --noEmit`) en verde.

- [x] **Tarea 5 — Pruebas de integración RLS `tests/integration/rls-policies.test.ts`** (AC: #6)
  - [x] **Reutilizar** `tests/integration/setup.ts` (`createServiceRoleClient`, `createAnonClient`, `createAuthedClient`) y el patrón `createAuthedUser()` de `schema-rls.test.ts` (crear usuario con `service_role` → `signInWithPassword` con `anon` → token → `createAuthedClient(token)`). NO recrear helpers ni añadir `jsonwebtoken`.
  - [x] Fixtures con `service_role` (bypassa RLS): crear una liga, insertar a **userA** y **userB** como `league_members` de esa liga, y a **userC** SIN membresía. Insertar dos `matches`: uno **futuro** (`match_time = now() + interval '1 day'`, `status='scheduled'`) y uno **desbloqueado** (`match_time = now() - interval '1 minute'`).
  - [x] userA (cliente autenticado) inserta su predicción para el partido futuro (debe permitirse: dueño + miembro + partido no anulado).
  - [x] **AC #2 (bloqueo):** userB (mismo liga) hace `select` de la predicción de userA en el partido **futuro** → `data` es **array vacío** (RLS oculta filas; NO esperar `error.code`, esperar `data.length === 0`). _Ver Dev Notes › Semántica de RLS en SELECT._
  - [x] **AC #2 (liberación):** mover/usar el partido **desbloqueado** (userA predice en él; o `update match_time = now() - 1min`) → userB **sí** ve la fila (`data.length === 1`).
  - [x] **AC #3:** userA lee su propia predicción del partido futuro → visible. userC (ajeno a la liga) → no ve nada en ningún caso. `anon` → no ve nada.
  - [x] Limpieza en `afterAll`: `auth.admin.deleteUser(id)` de los usuarios creados (las FK `on delete cascade` arrastran predicciones/miembros); borrar liga y matches de fixtures con `service_role`.
  - [x] Nota: este archivo estaba **reservado** para esta story desde 1.2; `triggers.test.ts` sigue reservado para Epic 5 (escrow) — no tocarlo.

- [x] **Tarea 6 — Seed de partidos demo (resuelve deuda de 1.2)** (AC: #1) _(opcional pero recomendado)_
  - [x] Añadir a `supabase/seed.sql` 2-3 partidos demo (uno `scheduled` futuro, uno `finished` con resultado) para desarrollo manual de las stories 2.2/2.3. Story 1.2 dejó anotado "partidos llegan en Story 2.1". Mantener el seed idempotente (`on conflict do nothing` o `insert ... where not exists`).

- [x] **Tarea 7 — Verificación final**
  - [x] `npm run test:unit` y `npm run test:integration` en verde (con Supabase local en marcha y `.env.test.local` generado).
  - [x] `npm run test:ci` en verde de extremo a extremo.
  - [x] `npm run lint` y `npm run typecheck` sin errores.
  - [x] Confirmar idempotencia: `npx supabase db reset` re-aplica todo desde cero sin errores.

## Dev Notes

### Toolchain de Node (CRÍTICO — leer primero)
El Node del shell por defecto es **v12.22.12** (incompatible con el toolchain). Usa **nvm para activar Node 24** antes de cualquier comando, e invoca el CLI de Supabase **siempre vía `npx supabase ...`** (no asumas binario global). [Source: memoria del proyecto `node-version-toolchain`] El stack local de Supabase corre en `http://127.0.0.1:54321`; el puerto 3000 está ocupado por Docker en este entorno (E2E usa 3100). [Source: 1-2 Dev Notes]

### Inteligencia de stories previas (1.2/1.3/1.4 — DONE)
Construye sobre lo ya montado; no lo rompas:
- **Esquema base existente** (`profiles`, `leagues`, `league_members`) con RLS y el helper anti-recursión `public.fn_user_in_league(p_league_id uuid)` (`SECURITY DEFINER set search_path=''`). **Reutilízalo** en la política `insert`/`select` de `predictions`; NO lo redefinas. [Source: supabase/migrations/20260602041455_rls_and_triggers.sql:21-37]
- **Patrón de migraciones**: `npx supabase migration new <nombre>` deja que la CLI genere el timestamp (último actual: `20260603020237`). Una migración para tablas + una para RLS/triggers (paridad con 1.2). [Source: 1-2 Tareas 1-2]
- **Patrón de función SQL `SECURITY DEFINER`**: `set search_path = ''` obligatorio, todo fully-qualified (`public.matches`), `grant execute ... to authenticated` solo si se invoca por RPC directo (las helpers de política no lo necesitan). [Source: supabase/migrations/20260603014645_add_create_league_fn.sql]
- **Tipos**: `src/types/database.types.ts` se regenera con `npm run db:types`; los tipos de dominio van en `src/types/index.ts` con los atajos `TableRow/TableInsert/TableUpdate` ya definidos. [Source: src/types/index.ts:9-29]
- **Tests de integración**: helpers en `tests/integration/setup.ts` (`createServiceRoleClient`/`createAnonClient`/`createAuthedClient`), entorno cargado por `tests/integration/setup-env.ts` desde `.env.test.local` (generado con `npx supabase status -o env`). Patrón `createAuthedUser()` y constante `RLS_VIOLATION = '42501'` en `schema-rls.test.ts` — cópialos. [Source: tests/integration/setup.ts; tests/integration/schema-rls.test.ts:29-55]
- **Vitest** tiene dos proyectos: `unit` (jsdom, incluye `tests/unit/**` y `src/**/*.test.ts`) e `integration` (node, `tests/integration/**`). El co-located `src/utils/scoring.test.ts` cae en `unit` automáticamente. [Source: vitest.config.ts]

### Decisión: predicciones POR-LIGA (no globales) — leer antes de la migración
`predictions` lleva `league_id` y `unique(league_id, user_id, match_id)`. Rationale:
- El time-gating de la AC dice "predicción de otro **miembro**" → la visibilidad se define respecto a los **rivales de la liga**, no globalmente. Con `league_id` la política `select` es limpia: `fn_user_in_league(league_id) and fn_match_unlocked(match_id)`.
- Standings (Epic 3/4) y duelos (Epic 5) son **por-liga**; un mismo usuario en dos ligas compite por separado.
- Coste: un usuario que estuviera en varias ligas pronostica por liga (caso poco común en una quiniela privada entre amigos).
> ⚠️ **Esto es una bifurcación de diseño real.** Si producto prefiere "una predicción global por usuario/partido compartida en todas sus ligas", el esquema y la RLS cambian (la visibilidad sería "comparto AL MENOS una liga con el dueño"). Confirmar con Cris (ver "Preguntas para Cris" al final). La opción por defecto implementada es **por-liga**. [Source: epics.md Story 2.1 AC; architecture.md#Authentication & Security ("predicciones de rivales")]

### Trampa de recursión RLS y por qué un helper SECURITY DEFINER
Igual que en 1.2: una política sobre `predictions` que haga subconsultas a `matches`/`league_members` puede re-disparar RLS y/o complicar el plan. Centraliza el umbral de tiempo en `public.fn_match_unlocked(match_id)` (`SECURITY DEFINER`, lee `matches` sin RLS) y la pertenencia en el ya existente `fn_user_in_league(league_id)`. Esto (a) evita recursión, (b) hace UN solo lugar donde vive la regla "−1 minuto", y (c) usa `now()` del **servidor** (no del cliente) cumpliendo el control horario server-authoritative. [Source: architecture.md#Control del Tiempo Basado en Servidor; 1-2 Dev Notes › Trampa de recursión RLS]

### Semántica de RLS en SELECT vs INSERT (evita un falso positivo de test)
- Un `INSERT`/`UPDATE` denegado por RLS devuelve **error** con `code === '42501'` (así se afirma en `schema-rls.test.ts`).
- Un `SELECT` filtrado por RLS **NO da error**: simplemente devuelve **0 filas**. La prueba de bloqueo de la AC #2 debe afirmar `data.length === 0` (y `error` null), NO un código de error. Afirmar un error aquí haría que el test nunca pase o dé un falso negativo. [Source: supabase RLS docs; patrón de `schema-rls.test.ts`]

### Drift de tipos (CHECK vs TypeScript)
Los tipos generados (`database.types.ts`) tipan `status` como `string` (no enum). Definir `MatchStatus` a mano en `src/types/index.ts` espeja el CHECK pero puede divergir (mismo riesgo ya anotado para `LeagueRole`/`PaymentStatus`). Mantén `MatchStatus` y el CHECK de la migración **sincronizados a mano** y deja un comentario cruzado. El motor `scoring.ts` debe tipar su parámetro `status` con `MatchStatus`. [Source: deferred-work.md (drift de `LeagueRole`/`PaymentStatus`)]

### Fuente única de verdad del scoring (anti-duplicación)
`scoring.ts` (TS) es la fórmula canónica y se usará en cliente para la **tabla proyectada en vivo** (Epic 4). La clasificación **oficial** se calcula/persiste en Postgres al pasar el partido a `finished` (Epic 3/5.3). Si más adelante se implementa una versión SQL de la fórmula, **debe espejar exactamente** `scoring.ts` y compartir el mismo vector de pruebas para evitar drift. No dupliques la fórmula en esta story: solo entrega la versión TS unit-testeada. [Source: architecture.md#Requirements to Structure Mapping (scoring.ts); #Separación de Standings; #Areas for Future Enhancement]

### Convenciones obligatorias
- **DB**: tablas `snake_case` plural; FKs `_id`; **funciones `fn_`, triggers `tr_`**. [Source: architecture.md#Naming Patterns]
- **Fechas/horas**: `timestamptz`, ISO 8601 UTC; el control horario usa `now()` del servidor. [Source: architecture.md#Data Exchange Formats]
- **Código**: componentes `PascalCase`, funciones/variables `camelCase` (`calculateBasePoints`). [Source: architecture.md#Code Naming Conventions]
- **Migraciones como código**: `supabase/migrations/`, aplicadas con `supabase db reset`. [Source: architecture.md#Data Architecture]

### Restricciones NFR
- **NFR-3 (Seguridad RLS)**: esta story implementa el time-gating real de `predictions` (el corazón del "anti-trampa" del producto). [Source: epics.md NFR-3]
- **Coste Cero (NFR-1)**: nada externo; todo en Supabase Free Tier. [Source: epics.md NFR-1]
- **NFR-5 (Límite API)**: `matches.external_ref` se define para el futuro cron Pull-and-Cache; NO se implementa el sync aquí. [Source: epics.md NFR-5]

### Alcance — qué NO hacer en esta historia
- NO implementar el **multiplicador por antelación** ni su recálculo (Story 2.4) — solo dejar la columna `multiplier` con default 1.00 y reservar la firma en `scoring.ts`.
- NO implementar el **bloqueo de escritura por kickoff −1min** (Story 2.4) — esta story solo gatea la **lectura** vía RLS `select`.
- NO construir el **GoalPicker** ni `MatchCard` ni el auto-guardado/UI (Stories 2.2, 2.3).
- NO crear el endpoint `/api/sync` ni el cron (Epic 5/infra) — solo la columna `external_ref` que lo soportará.
- NO persistir/aplicar `points_earned` mediante cron/trigger al finalizar (Epic 5.3) — esta story entrega la **fórmula** y su prueba.
- NO tocar `triggers.test.ts` (reservado a Epic 5 — escrow).

### Project Structure Notes
- Archivos NUEVOS: `supabase/migrations/<ts>_matches_and_predictions.sql`, `supabase/migrations/<ts>_predictions_rls.sql`, `src/utils/scoring.ts`, `src/utils/scoring.test.ts`, `tests/integration/rls-policies.test.ts`.
- Archivos MODIFICADOS: `src/types/database.types.ts` (regenerado), `src/types/index.ts` (tipos de dominio `Match`/`Prediction`/`MatchStatus`), `supabase/seed.sql` (partidos demo).
- Alineado con el árbol de la arquitectura (`src/utils/scoring.ts` ya estaba previsto). Sin conflictos con 1.1–1.4.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.1: Modelos de Partidos, Predicciones y Motor de Puntuación (Scoring)]
- [Source: _bmad-output/planning-artifacts/epics.md#FR-7 / FR-9 / FR-11 / FR-22 / NFR-3]
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security]
- [Source: _bmad-output/planning-artifacts/architecture.md#Control del Tiempo Basado en Servidor]
- [Source: _bmad-output/planning-artifacts/architecture.md#Requirements to Structure Mapping]
- [Source: _bmad-output/planning-artifacts/architecture.md#Naming Patterns / #Format Patterns]
- [Source: _bmad-output/implementation-artifacts/1-2-esquema-relacional-de-base-de-datos-y-autenticacion-google-oauth.md#Dev Notes]
- [Source: supabase/migrations/20260602041455_rls_and_triggers.sql (fn_user_in_league, patrón de políticas)]
- [Source: supabase/migrations/20260603014645_add_create_league_fn.sql (patrón SECURITY DEFINER)]
- [Source: tests/integration/schema-rls.test.ts (patrón createAuthedUser + RLS_VIOLATION)]
- Web: RLS — https://supabase.com/docs/guides/database/postgres/row-level-security
- Web: Supabase CLI config / migrations — https://supabase.com/docs/guides/local-development

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Opus 4.8)

### Debug Log References

- `npx supabase db reset`: aplica las 7 migraciones + seed sin errores (idempotente, re-ejecutado en verde varias veces).
- `npm run test:unit`: 37/37 (incluye los 11 nuevos de `scoring.test.ts`).
- `npm run test:integration`: 24/24 (incluye los 5 nuevos de `rls-policies.test.ts`).
- `npm run test:e2e`: 2/2.
- `npm run test:ci`: verde de extremo a extremo (unit 37 · integration 24 · e2e 2).
- `npm run lint` y `npm run typecheck`: 0 errores (tras añadir non-null assertions en accesos por índice del test, por `noUncheckedIndexedAccess`).
- Seed verificado vía `service_role`: 3 partidos demo (`demo-001/002` scheduled, `demo-003` finished).
- Toolchain: nvm Node 24 + `npx supabase` (el Node del shell por defecto es v12).

### Completion Notes List

- **Esquema (Tarea 1)** — `20260603144628_matches_and_predictions.sql`: tablas `matches` y `predictions` con PKs, FKs `on delete cascade`, CHECKs (`status`, `home/away_score_pred >= 0`, `multiplier >= 1.00`), `unique(league_id,user_id,match_id)`, `unique(external_ref)` e índices de apoyo. Columnas de Epics futuros (`external_ref`, `home/away_team_code`, `home/away_score`, `matchday`, `stage`, `multiplier`, `points_earned`) definidas por adelantado (anti-retrabajo), sin lógica de escritura.
- **RLS + time-gating (Tarea 2)** — `20260603144630_predictions_rls.sql`: RLS habilitado en ambas tablas. Helper `fn_match_unlocked(match_id)` (`SECURITY DEFINER set search_path=''`) centraliza el umbral `now() >= match_time - 1min` con la hora del SERVIDOR y lee `matches` sin recursión de RLS. Políticas: `matches` (select authenticated; sin write → lo hace el cron con service_role), `predictions` (insert/update solo propias y miembro de la liga; **select gated**: dueño siempre, rival de la liga solo si el partido está desbloqueado, ajeno/anon nunca). Trigger genérico `fn_set_updated_at` en ambas tablas (lo consumen Stories 2.3/2.4).
- **Motor de puntuación (Tarea 3)** — `src/utils/scoring.ts`: función pura `calculateBasePoints(pred, actual, status)` → exacto=5, resultado acertado=2, fallo=0; cualquier `status !== 'finished'` (incluye `canceled`/`suspended`) → 0 (AC #5: anulación + exclusión de standings). Multiplicador reservado para Story 2.4. 11 unit tests co-localizados (`scoring.test.ts`), desarrollados con TDD (rojo→verde).
- **Tipos (Tarea 4)**: `src/types/database.types.ts` regenerado con `matches`/`predictions`; añadidos a `src/types/index.ts` los tipos de dominio `Match`/`Prediction` (+ Insert/Update) y `MatchStatus` (espeja el CHECK; comentario de sincronización con la migración y `scoring.ts`).
- **Tests de integración (Tarea 5)** — `tests/integration/rls-policies.test.ts` (archivo reservado para esta story desde 1.2): reutiliza los helpers de `setup.ts` y el patrón `createAuthedUser()`. Cubre AC #2/#3: rival mismo-liga bloqueado antes del umbral (afirma `data.length === 0`, no error — semántica correcta de SELECT bajo RLS), liberado tras el umbral, dueño siempre ve la suya, ajeno a la liga nunca, anon nunca. Limpieza en `afterAll`.
- **Seed (Tarea 6)**: 3 partidos demo idempotentes (`on conflict (external_ref) do nothing`) en `supabase/seed.sql` para desarrollo manual de 2.2/2.3 — resuelve la nota "partidos llegan en Story 2.1" de 1.2.
- **Alcance respetado**: NO se implementó el multiplicador por antelación ni el bloqueo de escritura por kickoff (Story 2.4), ni el GoalPicker/UI (2.2/2.3), ni el cron `/api/sync` (Epic 5), ni la persistencia de `points_earned` (Epic 5.3). `triggers.test.ts` intacto (reservado a Epic 5).
- **Decisión de diseño implementada**: predicciones **por-liga** (`predictions.league_id` + `unique(league_id,user_id,match_id)`). Pendiente de confirmación de producto (alternativa: predicción global compartida entre ligas) — ver Dev Notes › Decisión.

### File List

**Migraciones / DB (nuevos):**
- `supabase/migrations/20260603144628_matches_and_predictions.sql`
- `supabase/migrations/20260603144630_predictions_rls.sql`

**Código (nuevo):**
- `src/utils/scoring.ts`
- `src/utils/scoring.test.ts`

**Tipos (modificados):**
- `src/types/database.types.ts` (regenerado)
- `src/types/index.ts` (tipos `Match`/`Prediction`/`MatchStatus`)

**Tests (nuevo):**
- `tests/integration/rls-policies.test.ts`

**Configuración / datos (modificado):**
- `supabase/seed.sql` (partidos demo)

## Change Log

| Fecha       | Versión | Descripción                                                                                                                                                                          | Autor        |
| ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| 2026-06-03  | 0.1     | Tablas `matches`/`predictions` con RLS de time-gating (`fn_match_unlocked`), motor de puntuación base `scoring.ts`, tipos de dominio, tests de integración RLS y unit de scoring, seed de partidos demo. Story completada — lista para review. | Amelia (Dev) |
| 2026-06-03  | 0.2     | Code review: 6 patches aplicados — cierre de huecos de escritura en `predictions` (with_check con `fn_user_in_league` + protección de columnas `points_earned`/`multiplier` por privilegios), CHECK `>= 0` en marcadores reales, guarda de scoring para marcadores inválidos, `search_path` en `fn_set_updated_at`, y tests de denegación de escritura. 2 ítems diferidos (bloqueo de escritura por kickoff → 2.4; drift de `MatchStatus`). Story aprobada — done. | Amelia (Dev) |

## Review Findings

> Revisión adversarial (Blind Hunter + Edge Case Hunter + Acceptance Auditor) — 2026-06-03. Historia sensible a seguridad (RLS / SECURITY DEFINER). Las 6 ACs se cumplen (Auditor: la política `select` es correcta y los tests afirman `data.length`, no error). El hueco load-bearing convergente: la ruta **UPDATE** de `predictions` no replica la guarda de pertenencia/columnas que sí tiene INSERT. Triage: 0 decisiones, 6 patches, 2 diferidos, ~5 descartados.

### Patches (aplicados 2026-06-03)

> Los 6 patches se aplicaron y validaron. Verificación: lint + typecheck limpios, unit **40/40** (+3 guardas de scoring), integration **30/30** (+6 tests de denegación de escritura), e2e 2/2; `db reset` idempotente.
> - **Patch 1+2 (huecos de escritura, los críticos):** `predictions_update_own` ahora exige `fn_user_in_league(league_id)` en el `with check`; y se revocó el privilegio de tabla INSERT/UPDATE a `authenticated`, reconcediendo solo las columnas que el cliente escribe (`league_id`,`match_id`,`user_id`,`home_score_pred`,`away_score_pred` en insert; `home_score_pred`,`away_score_pred` en update). Resultado: `points_earned`/`multiplier` ya no son escribibles por el cliente, y `league_id` es inmutable tras la creación (doble defensa con el with_check). Tests nuevos prueban la denegación (42501) y que la ruta válida del dueño sigue funcionando.
> - **Patch 3:** CHECK `>= 0` en `matches.home_score`/`away_score`.
> - **Patch 4:** guarda en `calculateBasePoints` para marcadores no enteros/null/NaN → 0 (con 3 unit tests).
> - **Patch 5:** `fn_set_updated_at` con `set search_path = ''`.
> - **Patch 6:** tests de denegación de escritura en `rls-policies.test.ts` (no-miembro insert, anon insert, reubicación de liga, tampering de `points_earned`/`multiplier`, y la ruta válida del dueño).

- [x] [Review][Patch] `predictions_update_own` sin `fn_user_in_league(league_id)` en `with check` → un usuario puede reubicar su predicción a una liga ajena (INSERT sí lo valida, UPDATE no) [supabase/migrations/20260603144630_predictions_rls.sql]
- [x] [Review][Patch] `points_earned`/`multiplier` escribibles por el cliente (auto-asignación de puntos / tampering) → revocar `update`/`insert` de esas columnas a `authenticated` (solo service_role / funciones DEFINER las escriben) [supabase/migrations/20260603144630_predictions_rls.sql]
- [x] [Review][Patch] `matches.home_score`/`away_score` sin CHECK `>= 0` (asimetría con `predictions`; un sync con bug podría persistir goles negativos que alimentan el scoring) [supabase/migrations/20260603144628_matches_and_predictions.sql]
- [x] [Review][Patch] `calculateBasePoints` sin guarda para marcadores no finitos/null: un partido `finished` con `home_score`/`away_score` null daría 5 (null===null) [src/utils/scoring.ts]
- [x] [Review][Patch] `fn_set_updated_at` sin `set search_path = ''` (lint Supabase `function_search_path_mutable`; el resto del proyecto fija search_path) [supabase/migrations/20260603144630_predictions_rls.sql]
- [x] [Review][Patch] Faltan tests de denegación de ESCRITURA: reubicación de liga vía UPDATE, tampering de `points_earned`, e INSERT de no-miembro/anon (la suite solo cubre la ruta segura SELECT) [tests/integration/rls-policies.test.ts]

### Deferred
- [x] [Review][Defer] Sin bloqueo de escritura por kickoff −1min en INSERT/UPDATE → ventana de edición post-kickoff mientras la lectura ya está gateada [supabase/migrations/20260603144630_predictions_rls.sql] — deferred: asignado a Story 2.4 por el spec (exposición práctica nula hasta que existan GoalPicker/autosave en 2.2-2.3)
- [x] [Review][Defer] `MatchStatus` duplicado (CHECK de BD + literal en `index.ts` + literal en `scoring.ts`) sin fuente única — riesgo de drift [src/types/index.ts; src/utils/scoring.ts] — deferred: mismo patrón ya diferido para `LeagueRole`/`PaymentStatus` en 1.2

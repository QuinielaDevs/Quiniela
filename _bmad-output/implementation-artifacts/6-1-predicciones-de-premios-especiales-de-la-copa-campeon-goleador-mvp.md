---
baseline_commit: ed6ff77
---

# Story 6.1: Predicciones de Premios Especiales de la Copa (Campeón, Goleador, MVP)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **jugador de la quiniela**,
I want **registrar mis predicciones de largo plazo para los tres galardones del Mundial (Campeón, Máximo Goleador y MVP) mediante un selector de favoritos de un solo tap, persistiéndose con una marca de tiempo controlada por el servidor**,
so that **aspirar a puntos masivos al final del torneo de forma ágil desde el móvil, dejando lista la estructura que la Story 6.2 usará para la puntuación decreciente y el cierre por semifinales**.

## Acceptance Criteria

1. **Given** la base de datos de Supabase local en marcha
   **When** ejecuto las migraciones (`supabase db reset`) para crear las tablas `award_candidates` y `special_predictions`
   **Then** ambas tablas existen siguiendo la nomenclatura `snake_case` plural con FKs `_id` y `on delete cascade`, con: `award_candidates(id, category, name, team_name?, flag_code?, image_url?, display_order, is_active, created_at)` y `special_predictions(id, user_id→profiles, category, candidate_id→award_candidates, predicted_at, created_at)`, restricción `unique (user_id, category)` y un CHECK de `category in ('champion','top_scorer','mvp')` en ambas tablas.

2. **And** existe garantía de integridad de que un `special_predictions.candidate_id` pertenece a la misma `category` que la predicción (vía FK compuesta `(candidate_id, category) → award_candidates(id, category)`), de modo que es imposible pronosticar p. ej. un goleador como "campeón".

3. **And** se habilita RLS en ambas tablas con políticas que: (a) permiten a cualquier usuario `authenticated` **leer** `award_candidates` (lista de favoritos); (b) **NO** permiten a usuarios (`anon`/`authenticated`) escribir en `award_candidates` (los carga el administrador de plataforma vía `service_role`/seed); (c) permiten a un usuario `authenticated` `insert`/`update`/`select` **solo sus propias** filas de `special_predictions` (`user_id = auth.uid()`), y NO leer las de otros usuarios.

4. **And** la marca de tiempo `predicted_at` es **controlada por el servidor** (`default now()`, nunca provista por el cliente) y se **refresca a `now()` cuando el usuario cambia su candidato** (vía trigger `tr_touch_special_prediction → fn_touch_special_prediction`, `SECURITY DEFINER set search_path=''`), para que la Story 6.2 calcule la fase de registro a partir del último cambio efectivo.

5. **And** existe la sección **"Premios Especiales"** (`/awards`, ruta protegida) que, para cada uno de los tres galardones, muestra un listado ordenado (`display_order`) de candidatos activos leídos de `award_candidates`, permite seleccionar uno **con un solo tap** (área táctil ≥ `48x48px`, tokens del sistema **Championship Gold**, contenedor `max-w-md`), y al seleccionarlo persiste mediante una Server Action que retorna `ServerActionResult<T>` haciendo **upsert** en `special_predictions` (crea o actualiza la predicción del usuario para esa categoría), mostrando feedback de éxito (destello/`✓` verde turf `#10B981`).

6. **And** se generan los tipos TypeScript (`npm run db:types`) reflejando las dos tablas nuevas, se exportan los tipos de dominio en `src/types/index.ts` (incluyendo el tipo canónico `ServerActionResult<T>`), y existen pruebas de integración en `tests/integration/special-predictions-rls.test.ts` (reutilizando los helpers de `tests/integration/setup.ts`) que validan: (a) `authenticated` lee candidatos pero **no** puede escribirlos (`42501`); (b) un usuario hace upsert de su predicción y **no** puede leer/escribir la de otro usuario; (c) la FK compuesta rechaza un candidato de categoría incorrecta; (d) `predicted_at` se refresca al cambiar de candidato.

## Tasks / Subtasks

- [x] **Tarea 1 — Migración del esquema de premios especiales** (AC: #1, #2, #3, #4)
  - [x] Generar la migración con timestamp **autogenerado por la CLI** (NO hardcodear): `npx supabase migration new special_awards_schema`.
  - [x] Tabla `award_candidates` (catálogo precargado por el admin de plataforma):
    - `id uuid primary key default gen_random_uuid()`
    - `category text not null check (category in ('champion','top_scorer','mvp'))`
    - `name text not null` _(nombre del equipo nacional para `champion`; nombre del jugador para `top_scorer`/`mvp`)_
    - `team_name text` _(selección nacional del jugador; null para `champion`)_
    - `flag_code text` _(código de bandera para `public/assets/flags/`, opcional)_
    - `image_url text` _(opcional; foto/escudo)_
    - `display_order int not null default 0` _(orden del listado de favoritos)_
    - `is_active boolean not null default true` _(permite ocultar candidatos sin borrarlos)_
    - `created_at timestamptz not null default now()`
    - **CONSTRAINT clave para la FK compuesta:** `unique (id, category)` _(habilita la integridad referencial compuesta de la Tarea, ver AC #2)_.
  - [x] Tabla `special_predictions`:
    - `id uuid primary key default gen_random_uuid()`
    - `user_id uuid not null references public.profiles(id) on delete cascade`
    - `category text not null check (category in ('champion','top_scorer','mvp'))`
    - `candidate_id uuid not null`
    - `predicted_at timestamptz not null default now()` _(server-side; refrescado por trigger en cambios — Story 6.2 calcula la fase con esto)_
    - `created_at timestamptz not null default now()`
    - `unique (user_id, category)` _(una predicción por galardón por usuario; clave para el upsert `on conflict`)_
    - **FK compuesta:** `foreign key (candidate_id, category) references public.award_candidates(id, category) on delete restrict` _(garantiza que el candidato pertenece a la categoría pronosticada — AC #2; `restrict` evita borrar un candidato con predicciones)_.
  - [x] Índices de apoyo: `idx_special_predictions_user_id (user_id)`, `idx_award_candidates_category (category)`. _(`unique(user_id,category)` y `unique(id,category)` ya crean sus índices.)_
  - [x] `comment on table` en ambas tablas describiendo su propósito y a qué story pertenece la lógica de puntuación (6.2).

- [x] **Tarea 2 — RLS, trigger de timestamp y feed de candidatos** (AC: #3, #4)
  - [x] En la **misma migración** (o una segunda `special_awards_rls` si prefieres separar como en 1.2): `alter table ... enable row level security` en `award_candidates` y `special_predictions`.
  - [x] Políticas `award_candidates`: **solo** `select` para `authenticated` (`using (is_active = true)` para no exponer candidatos desactivados). **Sin** políticas `insert/update/delete` → deny-by-default: el catálogo lo gestiona `service_role`/seed, nunca el cliente.
  - [x] Políticas `special_predictions`: `insert` `with check (user_id = (select auth.uid()))`; `select` `using (user_id = (select auth.uid()))`; `update` `using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))`. **Sin** `select` cruzado (la predicción es privada; la visibilidad para rivales se decide en una historia futura — fuera de alcance). Usar `(select auth.uid())` (patrón ya usado en 1.2 para que el planner cachee el valor).
  - [x] Trigger de refresco de `predicted_at` (snippet canónico abajo): función `public.fn_touch_special_prediction()` `SECURITY DEFINER set search_path=''`, `before update on public.special_predictions`; si `new.candidate_id is distinct from old.candidate_id` ⇒ `new.predicted_at = now()`. Trigger `tr_touch_special_prediction`.
  - [x] **Sembrar candidatos demo** en `supabase/seed.sql` (append; el archivo ya existe y está intencionadamente mínimo). Insertar un pequeño set ilustrativo por categoría (p. ej. 4-5 selecciones para `champion`; 4-5 jugadores para `top_scorer` y `mvp`) con `display_order`. Marcar con comentario que en producción los carga el admin de plataforma vía `service_role`. **No** sembrar usuarios ni predicciones.

- [x] **Tarea 3 — `ServerActionResult` y Server Action de upsert** (AC: #5)
  - [x] Definir el tipo canónico `ServerActionResult<T>` en `src/types/index.ts` (es la **primera** Server Action del proyecto; este tipo es reutilizable por 1.3/1.4/2.x/5.x):
    ```typescript
    export type ServerActionResult<T> = {
      success: boolean;
      data: T | null;
      error: string | null;
    };
    ```
  - [x] Crear `src/app/actions/special-predictions.actions.ts` con `"use server"`. Exportar `saveSpecialPrediction(category: AwardCategory, candidateId: string): Promise<ServerActionResult<SpecialPrediction>>`:
    - Obtener cliente SSR con `createClient()` de `src/utils/supabase/server.ts` (NO el de browser).
    - `const { data: { user } } = await supabase.auth.getUser()`; si no hay usuario ⇒ `{ success:false, data:null, error:'No autenticado' }`.
    - `upsert({ user_id: user.id, category, candidate_id: candidateId }, { onConflict: 'user_id,category' })` sobre `special_predictions`, `.select().single()`. **NO** enviar `predicted_at` (lo controla el servidor; el trigger lo refresca en cambios).
    - Envolver en `try/catch`; en error retornar `{ success:false, data:null, error: error.message }`. En éxito `{ success:true, data, error:null }`.
    - `revalidatePath('/awards')` tras un upsert exitoso.
  - [x] Exportar en `src/types/index.ts` los tipos de dominio nuevos: `AwardCandidate`, `SpecialPrediction` (+ `Insert`/`Update`) y `AwardCategory = 'champion' | 'top_scorer' | 'mvp'` (espeja el CHECK; documentar el riesgo de drift como en 1.2).

- [x] **Tarea 4 — UI "Premios Especiales" (`/awards`)** (AC: #5)
  - [x] Crear `src/app/awards/page.tsx` como **Server Component protegido** (mismo patrón que `src/app/protected/page.tsx`): obtener usuario con el cliente SSR y `redirect('/auth/login')` si no hay sesión. Cargar `award_candidates` activos (ordenados por `category, display_order`) y las `special_predictions` del usuario; pasar ambos al componente cliente.
  - [x] Crear `src/components/awards/AwardsBoard.tsx` (`"use client"`): recibe candidatos agrupados por categoría y las selecciones actuales. Renderiza tres bloques (Campeón / Goleador / MVP). Al tap en un candidato: marca selección optimista, llama `saveSpecialPrediction` dentro de `useTransition` (deshabilitando taps mientras corre), y muestra el indicador de éxito verde turf `✓` al resolver; si `result.success === false`, revierte y muestra el error.
  - [x] Crear `src/components/awards/CandidatePicker.tsx` (presentacional): lista de candidatos de una categoría; cada item es un control táctil ≥ `48x48px`, resalta el seleccionado con borde `accent` (`#E9C46A`), usa tipografía Outfit para el nombre y muestra bandera/`team_name` cuando exista.
  - [x] Aplicar tokens **Championship Gold**: contenedor `max-w-md`, fondo `#0D1B2A`, tarjetas `#1B263B`, acento dorado `#E9C46A` solo para selección/puntos, éxito `#10B981`. Reutilizar primitivos `shadcn/ui` existentes (`card`, `button`, `badge`) — NO reinventar. `aria-label` descriptivos por candidato.
  - [x] Empty state si una categoría no tiene candidatos activos: *"Aún no hay favoritos disponibles."*
  - [x] Añadir un punto de entrada navegable hacia `/awards` desde una superficie existente (p. ej. enlace en `src/app/protected/page.tsx` o en el dashboard). **NO** rediseñar la bottom-nav (llega en historias de navegación/Mi Cuenta).

- [x] **Tarea 5 — Tipos, pruebas de integración y verificación** (AC: #6)
  - [x] `npx supabase db reset` (aplica migraciones + seed sin errores, idempotente) y `npm run db:types` (regenerar `src/types/database.types.ts`).
  - [x] `tests/integration/special-predictions-rls.test.ts` (proyecto Vitest `integration`, node), reutilizando `createServiceRoleClient/createAnonClient/createAuthedClient` y el patrón `createAuthedUser()` de `schema-rls.test.ts` (NO recrear helpers):
    - `authenticated` puede `select` candidatos activos; un `insert`/`update` de candidato por `authenticated` falla con `42501`.
    - Un usuario hace `upsert` de su predicción (`champion`) y la lee; **no** puede leer la predicción de otro usuario (0 filas) ni insertar con `user_id` ajeno (`42501`).
    - Insertar `special_predictions` con un `candidate_id` cuya `category` NO coincide ⇒ falla por la FK compuesta (violación de FK, **no** `42501`).
    - Cambiar el `candidate_id` de una predicción existente ⇒ `predicted_at` cambia a un valor posterior (trigger). _(Para observar el cambio, sembrar/crear candidatos vía `service_role`.)_
  - [x] (Opcional) Unit test puro en `tests/unit/` o co-localizado para una utilidad de agrupar candidatos por categoría, si extraes una.
  - [x] Verde de extremo a extremo: `npm run test:integration`, `npm run test:unit`, `npm run lint`, `npm run typecheck`. Idealmente `npm run test:ci` con Supabase local arriba.

### Review Findings

- [x] [Review][Decision] Contradicción en el borrado físico de candidatos — El criterio de aceptación 1 define que ambas tablas deben usar `on delete cascade`, pero la migración implementa `on delete restrict` sobre la FK compuesta del candidato en `special_predictions` para evitar dejar apuestas huérfanas. (Decisión: Mantener ON DELETE RESTRICT por integridad de negocio)
- [x] [Review][Patch] Vulnerabilidad de alteración/suplantación de `predicted_at` [supabase/migrations/20260603015739_special_awards_schema.sql] (Resuelto)
- [x] [Review][Patch] Riesgo de error Postgres en trigger por registro `OLD` no definido en INSERT [supabase/migrations/20260603015757_special_awards_rls.sql] (Resuelto)
- [x] [Review][Patch] Caída de UI y RLS restrictivo con candidatos inactivos [supabase/migrations/20260603015757_special_awards_rls.sql] (Resuelto)
- [x] [Review][Patch] Falta de efecto visual de "destello" (glow/flash) en el feedback de éxito de la UI [src/components/awards/CandidatePicker.tsx] (Resuelto)
- [x] [Review][Patch] Caída potencial por `RangeError` al registrar fecha inválida en `resolvePhase` [src/utils/awardsScoring.ts] (Resuelto)
- [x] [Review][Patch] Falta de validación y sanitización en la Server Action `saveSpecialPrediction` [src/app/actions/special-predictions.actions.ts] (Resuelto)
- [x] [Review][Defer] Fuga de datos de predicciones tras abandonar una liga [supabase/migrations/20260603015757_special_awards_rls.sql:1439-1460] — deferred, pre-existing
- [x] [Review][Defer] Parseo repetitivo e ineficiente de fechas en `resolvePhase` [src/utils/awardsScoring.ts:454-467] — deferred, pre-existing

### Trigger de refresco de `predicted_at` (snippet canónico — usar tal cual, adaptando)

```sql
create or replace function public.fn_touch_special_prediction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Solo refrescamos la marca de tiempo si el usuario realmente cambió de candidato.
  -- Story 6.2 calcula la fase de recompensa (50/25/10/0 pts) a partir de predicted_at.
  if new.candidate_id is distinct from old.candidate_id then
    new.predicted_at = now();
  end if;
  return new;
end;
$$;

create trigger tr_touch_special_prediction
  before update on public.special_predictions
  for each row execute function public.fn_touch_special_prediction();
```

## Dev Notes

### ❓ Decisiones clave a confirmar antes/durante la implementación
1. **Ámbito de la predicción: por PERFIL (global), NO por liga.** El epic y FR-15 dicen *"asociando la predicción a su perfil de usuario"* → `special_predictions` se modela contra `profiles(id)` **sin** `league_id`: un usuario tiene UN set (Campeón/Goleador/MVP) que aplica a todas sus ligas. La distribución de los puntos resultantes a cada liga es problema de la Story 6.2. **Si Cris prefiere predicciones por-liga, hay que añadir `league_id` y cambiar el `unique` a `(user_id, league_id, category)`** — confírmalo antes de migrar. [Source: epics.md Story 6.1; prd.md#FR-15]
2. **`predicted_at` "inalterable" = inalterable por el CLIENTE, no inmutable en el tiempo.** Se interpreta como marca server-side a prueba de manipulación que se **refresca al cambiar de candidato** (cambiar tu pick más tarde = registrarte más tarde = menor recompensa en 6.2). Es coherente con FR-16 (*"más temprano… los haya registrado"*). El trigger de la Tarea 2 implementa esto. Confírmalo; si se quisiera congelar la primera selección, se elimina el trigger y se documenta. [Source: epics.md Story 6.1 AC; Story 6.2; architecture.md#Control del Tiempo Basado en Servidor]

### Alcance — qué SÍ y qué NO hacer en esta historia
**SÍ (6.1):** esquema `award_candidates`+`special_predictions`, RLS, FK de integridad de categoría, trigger de `predicted_at`, seed demo, `ServerActionResult`, Server Action de upsert, pantalla `/awards` con selección de un tap y feedback de guardado, tipos y tests de integración.

**NO (pertenece a Story 6.2 — NO implementar aquí):**
- Lógica de **puntuación decreciente** (50/25/10/0 pts) y su cálculo. [6.2]
- **Cierre/bloqueo por semifinales** (Fase D): deshabilitar edición y retornar 0 pts a partir del kickoff de la primera semifinal. La UI de 6.1 **no** bloquea por fase (aún no existe la tabla `matches` ni las fechas de fase). El esquema sí queda listo para soportarlo. [6.2]
- Tabla de **ganadores oficiales** / resultados del torneo. [6.2]
- Cualquier dependencia de la tabla `matches` (la crea Story 2.1, en backlog) — 6.1 **no** la necesita.
- Visibilidad de predicciones de premios entre rivales (privadas por ahora).

### Inteligencia de historias previas (1.1 y 1.2 — DONE)
Lee esto para no romper ni duplicar lo montado: [Source: 1-2-...-google-oauth.md#Dev Agent Record; 1-1-...-vitest.md#Dev Agent Record]
- **Stack real instalado:** Next.js **16.2.7** + React **19.2.7**, `@supabase/ssr` + `@supabase/supabase-js` 2.x, Vitest **4.1.8** (proyectos `unit`/jsdom e `integration`/node), Playwright (chromium), TypeScript estricto. **Todo el código bajo `src/`**, alias `@/* → ./src/*`.
- **Next 16 usa `src/proxy.ts`** (no `middleware.ts`) como archivo raíz del framework — no lo toques.
- **Clientes Supabase ya existen:** `src/utils/supabase/{client,server,middleware}.ts`. Para Server Actions usa **`server.ts`** (`createClient()` SSR por cookies); para componentes cliente con realtime, `client.ts`. NO crear nuevos clientes.
- **Esquema vigente (migraciones de 1.2):** `profiles`, `leagues`, `league_members` con RLS. `special_predictions.user_id` referencia **`public.profiles(id)`** (no `auth.users` directo), consistente con `league_members.user_id`.
- **Patrón RLS establecido:** habilitar RLS = denegar por defecto; políticas `to authenticated`; usar `(select auth.uid())`; funciones de seguridad con `SECURITY DEFINER set search_path = ''` y referencias fully-qualified (`public.*`, `auth.*`). El helper `public.fn_user_in_league(uuid)` ya existe (no lo necesitas aquí, pero respeta el estilo). [Source: supabase/migrations/20260602041455_rls_and_triggers.sql]
- **Nomenclatura DB obligatoria:** tablas `snake_case` plural, FKs `_id`, **funciones `fn_`, triggers `tr_`**. [Source: architecture.md#Naming Patterns]
- **Tipos:** `src/types/database.types.ts` autogenerado (`npm run db:types`); tipos de dominio en `src/types/index.ts` (patrón `TableRow/TableInsert/TableUpdate`). [Source: src/types/index.ts]
- **Testing de integración ya montado:** `tests/integration/setup.ts` exporta `createServiceRoleClient()` (bypassa RLS), `createAnonClient()` (respeta RLS), `createAuthedClient(jwt)`. `setup-env.ts` carga credenciales de `.env.test.local`. El patrón para obtener un cliente autenticado real está en `schema-rls.test.ts` (`createAuthedUser()`: `admin.auth.admin.createUser` + `signInWithPassword`). **REUTILIZAR**, no recrear. Afirmar `error.code === '42501'` para probar bloqueo por RLS (no por FK). [Source: tests/integration/setup.ts; tests/integration/schema-rls.test.ts]
- **Nombres de test reservados:** `tests/integration/rls-policies.test.ts` (Story 2.1) y `triggers.test.ts` (escrow, Epic 5) — NO usarlos. Usa `special-predictions-rls.test.ts`.
- **Deuda heredada irrelevante para 6.1** pero a tener presente: `profiles.email` es PII legible por autenticados (no afecta premios). [Source: deferred-work.md]

### Patrones obligatorios de código y UI
- **Server Actions:** retornar SIEMPRE `ServerActionResult<T>` (`{success,data,error}`), `try/catch`, sin propagar excepciones al cliente. Estados de carga con `useTransition` deshabilitando controles. [Source: architecture.md#Format Patterns / Process Patterns]
- **Estructura de archivos:** rutas en `src/app/<kebab>/page.tsx`; Server Actions en `src/app/actions/*.actions.ts`; componentes de feature en `src/components/awards/`; primitivos en `src/components/ui/`. [Source: architecture.md#Structure Patterns; #Complete Project Directory Structure]
  - **Variación de estructura (menor, aceptada):** el árbol del architecture no lista `awards/` (la define este feature); `EXPERIENCE.md` ubica "Premios Especiales" en *Profile area / Dashboard sub-pane*. Ruta propuesta `src/app/awards/page.tsx`, consistente con la convención `kebab-case` de rutas (`standings`, `live`, `duels`, `account`). Si Mi Cuenta (Story 3.2) prefiere anidarla, se reubica luego sin cambiar el esquema/acción.
- **Design System Championship Gold:** mobile-first `max-w-md` (480px), dark-mode; oro `#E9C46A` SOLO para selección/puntos/trofeo; éxito `#10B981` solo para confirmaciones; áreas táctiles ≥ 48px; tipografía Outfit (títulos/nombres) + Inter (cuerpo). Banderas opcionales desde `public/assets/flags/`. [Source: DESIGN.md; EXPERIENCE.md]
- **Microcopy (tono pique, directo):** títulos cortos por galardón ("Campeón del Mundo", "Máximo Goleador", "MVP"); confirmación tipo "Guardado ✓". [Source: EXPERIENCE.md#Voice and Tone]
- **Fechas/horas:** `timestamptz` ISO 8601 UTC; el control temporal de fases (6.2) se basará en `now()` del servidor — 6.1 solo siembra `predicted_at`/`created_at`. [Source: architecture.md#Data Exchange Formats]
- **Coste Cero:** nada fuera de Supabase Free Tier; banderas/imagen como assets estáticos locales, no servicios externos. [Source: epics.md NFR-1]

### Restricciones NFR
- **NFR-3 (RLS):** activo en ambas tablas nuevas; `special_predictions` privada por usuario; `award_candidates` de solo lectura para usuarios. [Source: epics.md NFR-3]
- **NFR-4 (Integridad transaccional):** trigger `SECURITY DEFINER` para `predicted_at`; integridad de categoría por FK compuesta a nivel de BD (no confiar en JS). [Source: epics.md NFR-4; architecture.md#Enforcement Guidelines]

### Project Structure Notes
- **Archivos NUEVOS:** `supabase/migrations/<ts>_special_awards_schema.sql` (+ opcional `<ts>_special_awards_rls.sql`), `src/app/awards/page.tsx`, `src/app/actions/special-predictions.actions.ts`, `src/components/awards/AwardsBoard.tsx`, `src/components/awards/CandidatePicker.tsx`, `tests/integration/special-predictions-rls.test.ts`. Opcional: assets de banderas en `public/assets/flags/`.
- **Archivos MODIFICADOS:** `supabase/seed.sql` (candidatos demo), `src/types/index.ts` (`ServerActionResult`, `AwardCandidate`, `SpecialPrediction`, `AwardCategory`), `src/types/database.types.ts` (regenerado), y una superficie existente para enlazar `/awards` (p. ej. `src/app/protected/page.tsx`).
- Sin conflictos con 1.1/1.2. Mantener todo bajo `src/` y la nomenclatura del sistema.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 6: Premios Especiales de la Copa (Largo Plazo)]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.1: Predicciones de Premios Especiales de la Copa (Campeón, Goleador, MVP)]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.2 (alcance que NO se implementa aquí) / FR-15 / FR-16 / NFR-1 / NFR-3 / NFR-4]
- [Source: _bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/prd.md#4.7 Predicciones de Premios de la Copa (FR-15, FR-16)]
- [Source: _bmad-output/planning-artifacts/architecture.md#Naming Patterns / Structure Patterns / Format Patterns / Process Patterns / Enforcement Guidelines]
- [Source: _bmad-output/planning-artifacts/architecture.md#Complete Project Directory Structure / Authentication & Security / Data Exchange Formats]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/DESIGN.md (Championship Gold tokens)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/EXPERIENCE.md#Information Architecture (Premios Especiales) / State Patterns (Premios Bloqueados)]
- [Source: _bmad-output/implementation-artifacts/1-2-...-google-oauth.md#Dev Agent Record / Dev Notes (patrones RLS, trigger, tipos, tests)]
- [Source: supabase/migrations/20260602041410_init_schema.sql; 20260602041455_rls_and_triggers.sql; src/types/index.ts; tests/integration/setup.ts; tests/integration/schema-rls.test.ts]
- Web: Supabase RLS — https://supabase.com/docs/guides/database/postgres/row-level-security
- Web: Supabase upsert / onConflict — https://supabase.com/docs/reference/javascript/upsert
- Web: Next.js Server Actions & revalidatePath — https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Opus 4.8, 1M context) — bmad-dev-story workflow

### Debug Log References

- `npx supabase db reset` → migraciones + seed aplicadas sin errores (idempotente).
- `npm run test:unit` → 6 tests verdes (incl. 4 de groupCandidatesByCategory).
- `npm run test:integration` → 17 tests verdes (8 nuevos de premios + 9 previos).
- `npm run typecheck` y `npm run lint` → sin errores.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- ✅ Esquema, RLS, trigger, seed, tipos, Server Action, UI `/awards` y tests implementados y verdes.
- **DESVIACIÓN confirmada con el dueño del producto — predicciones POR LIGA (no globales por perfil):**
  - `special_predictions` añade `league_id uuid not null references public.leagues(id) on delete cascade`.
  - La clave única es `(user_id, league_id, category)` y el upsert usa `onConflict: 'user_id,league_id,category'`.
  - La Server Action es `saveSpecialPrediction(leagueId, category, candidateId)`.
  - La página `/awards` resuelve la liga activa (searchParam `?league=`, default = primera liga) y muestra un selector de liga cuando el usuario pertenece a varias; empty state si no pertenece a ninguna.
  - **RLS de escritura reforzada:** además de `user_id = auth.uid()`, `insert`/`update` exigen `public.fn_user_in_league(league_id)` (helper de 1.2) para impedir pronosticar en ligas ajenas. El `select` sigue siendo solo de filas propias.
- **predicted_at:** se mantiene el trigger `tr_touch_special_prediction` (refresca a `now()` al cambiar de candidato), opción recomendada y confirmada.
- **Índices:** se añadió `idx_special_predictions_league_id`; se omitió `idx_special_predictions_user_id` por ser redundante (el índice de `unique(user_id, league_id, category)` ya cubre las búsquedas con prefijo `user_id`). `idx_award_candidates_category` creado.
- **Decisiones de entorno (no afectan al código de producción):**
  - El repo no tenía `node_modules` ni `.env.test.local`; se ejecutó `npm install` y se generó `.env.test.local` (gitignored) desde `npx supabase status -o env`.
  - El script `db:types` invoca `supabase` (no en PATH); los tipos se regeneraron con `npx supabase gen types typescript --local` (contenido idéntico). Considerar cambiar el script a `npx supabase` en una historia futura.
- Tests de integración cubren AC #6: (a) lectura de candidatos por authenticated y bloqueo de escritura (42501); (b) upsert propio + aislamiento entre usuarios + bloqueo de user_id ajeno (42501); (c) rechazo por FK compuesta de categoría incorrecta (23503, NO 42501); (d) refresco de `predicted_at` por el trigger.

### File List

**Nuevos:**
- `supabase/migrations/20260603015739_special_awards_schema.sql`
- `supabase/migrations/20260603015757_special_awards_rls.sql`
- `src/app/awards/page.tsx`
- `src/app/actions/special-predictions.actions.ts`
- `src/components/awards/AwardsBoard.tsx`
- `src/components/awards/CandidatePicker.tsx`
- `src/utils/awards.ts`
- `tests/integration/special-predictions-rls.test.ts`
- `tests/unit/awards.test.ts`
- `.env.test.local` _(gitignored; credenciales del Supabase local para tests)_

**Modificados:**
- `supabase/seed.sql` _(catálogo demo de candidatos)_
- `src/types/index.ts` _(ServerActionResult, AwardCandidate, SpecialPrediction (+Insert/Update), AwardCategory)_
- `src/types/database.types.ts` _(regenerado: award_candidates, special_predictions)_
- `src/app/protected/page.tsx` _(enlace de entrada a /awards)_
- `_bmad-output/implementation-artifacts/sprint-status.yaml` _(estado 6.1 → review)_

## Change Log

| Fecha | Cambio |
| --- | --- |
| 2026-06-02 | Story 6.1 implementada: esquema de premios especiales (por liga), RLS + trigger predicted_at, seed, ServerActionResult + Server Action de upsert, UI `/awards` con selección de un tap y selector de liga, tipos y tests (8 integración + 4 unit). Status → review. |

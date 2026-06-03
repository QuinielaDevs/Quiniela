---
baseline_commit: ba9707d575059c57279196d416422555df6e8aac
---

# Story 1.2: Esquema Relacional de Base de Datos y Autenticación Google OAuth

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **desarrollador**,
I want **definir las tablas de perfiles, ligas y miembros en PostgreSQL (con migraciones de Supabase CLI), habilitar RLS, crear el trigger que materializa el perfil tras el alta, y conectar la autenticación basada en cookies con Google OAuth**,
so that **los usuarios tengan identidades únicas y persistencia segura desde su primer inicio de sesión, con la base relacional lista para que las demás historias del backlog construyan sobre ella sin re-trabajo**.

## Acceptance Criteria

1. **Given** la base de datos de Supabase local en marcha
   **When** ejecuto las migraciones (`supabase db reset`) para crear las tablas `profiles`, `leagues` y `league_members`
   **Then** las tres tablas existen con sus claves primarias, foráneas (`on delete cascade`), restricciones de unicidad e índices, siguiendo la nomenclatura `snake_case` plural y FKs terminadas en `_id`.

2. **And** se habilitan políticas de Row Level Security (RLS) en las tres tablas que **impiden a usuarios no autenticados (rol `anon`) escribir** en la base de datos, y se definen políticas base de lectura/escritura para usuarios autenticados.

3. **And** al darse de alta un usuario en `auth.users` (vía Google OAuth o vía `auth.admin.createUser`), un trigger SQL (`tr_on_auth_user_created` → función `fn_handle_new_user`, `SECURITY DEFINER`) inserta automáticamente su registro en `public.profiles`.

4. **And** si la metadata de Google retorna campos nulos o vacíos para nombre o avatar, el trigger aplica valores por defecto: `display_name = 'Jugador Anónimo'` y `avatar_url = '/assets/avatars/default-player.svg'`.

5. **And** Google OAuth queda configurado como proveedor en `supabase/config.toml` (vía `env()`) y existe un punto de entrada de inicio de sesión "Continuar con Google" funcional que dispara el flujo `signInWithOAuth` con el callback de cookies SSR de la plantilla.

6. **And** se generan los tipos TypeScript de la base de datos en `src/types/database.types.ts` (`supabase gen types --local`) y existen pruebas de integración (reutilizando los helpers de `tests/integration/setup.ts`) que validan: (a) el trigger crea el perfil con metadata completa, (b) aplica defaults con metadata nula, y (c) el rol `anon` no puede escribir en las tablas.

## Tasks / Subtasks

- [x] **Tarea 1 — Migración `init_schema` (tablas y relaciones)** (AC: #1) _(validada por `db reset` + tests de integración)_
  - [x] Generar la migración con timestamp: `npx supabase migration new init_schema` (NO hardcodear timestamps; deja que la CLI los genere). _(`20260602041410_init_schema.sql`)_
  - [x] Tabla `profiles` (espeja `auth.users`):
    - `id uuid primary key references auth.users(id) on delete cascade`
    - `email text`
    - `display_name text not null default 'Jugador Anónimo'`
    - `avatar_url text not null default '/assets/avatars/default-player.svg'`
    - `created_at timestamptz not null default now()`
  - [x] Tabla `leagues`:
    - `id uuid primary key default gen_random_uuid()`
    - `name text not null`
    - `created_by uuid not null references public.profiles(id) on delete cascade`
    - `invite_code text not null unique` _(usado por Story 1.4 `/join/[invite_code]`)_
    - `requires_payment boolean not null default false` _(Story 1.3 / FR-5)_
    - `payment_amount numeric(10,2)` _(Story 1.3)_
    - `payment_instructions text` _(Story 1.3 — Bizum/Zelle)_
    - `rules jsonb not null default '{}'::jsonb` _(Story 1.3 — modo de predicción)_
    - `created_at timestamptz not null default now()`
  - [x] Tabla `league_members`:
    - `id uuid primary key default gen_random_uuid()`
    - `league_id uuid not null references public.leagues(id) on delete cascade`
    - `user_id uuid not null references public.profiles(id) on delete cascade`
    - `role text not null default 'member' check (role in ('admin','member'))` _(Story 1.3 — admin)_
    - `payment_status text not null default 'pending' check (payment_status in ('pending','paid'))` _(FR-5 / Story 3.3)_
    - `joined_at timestamptz not null default now()` _(Story 3.1 — criterio de desempate)_
    - `unique (league_id, user_id)`
  - [x] Índices: `league_members(user_id)`, `league_members(league_id)`, `leagues(created_by)` (el `unique` en `invite_code` y `(league_id,user_id)` ya crean índices).
  - [x] **Ver "Dev Notes › Decisión de alcance del esquema"**: las columnas marcadas con _(Story X)_ se definen AHORA para evitar `ALTER TABLE` repetidos; su lógica de escritura/UI pertenece a esas historias.

- [x] **Tarea 2 — Migración `rls_and_triggers` (seguridad y trigger)** (AC: #2, #3, #4)
  - [x] Generar: `npx supabase migration new rls_and_triggers`.
  - [x] `alter table ... enable row level security` en `profiles`, `leagues`, `league_members`.
  - [x] **Función helper anti-recursión** `public.fn_user_in_league(p_league_id uuid) returns boolean` con `SECURITY DEFINER set search_path = ''` que consulta `league_members` sin re-disparar RLS (ver "Dev Notes › Trampa de recursión RLS"). Usarla en las políticas de `select` de `leagues` y `league_members`.
  - [x] Políticas `profiles`: `select` para `authenticated` (`using (true)` — necesario para clasificaciones/avatares de rivales); `update` solo propio (`using (auth.uid() = id) with check (auth.uid() = id)`). **Sin** política de `insert` para usuarios (lo hace el trigger `SECURITY DEFINER`) → así `anon`/`authenticated` no pueden insertar manualmente.
  - [x] Políticas `leagues`: `insert` para `authenticated` `with check (created_by = auth.uid())`; `select` `using (created_by = auth.uid() or public.fn_user_in_league(id))`; `update` baseline `using (created_by = auth.uid())` _(Story 1.3 refinará admin)_.
  - [x] Políticas `league_members`: `insert` `with check (user_id = auth.uid())` _(Story 1.4 refinará alta vía invitación)_; `select` `using (user_id = auth.uid() or public.fn_user_in_league(league_id))`.
  - [x] Trigger de perfil (usar el snippet canónico de "Dev Notes › Trigger de perfil"): función `public.fn_handle_new_user()` `SECURITY DEFINER set search_path = ''`, fully-qualified `public.profiles` / `auth.users`, fallbacks con `coalesce(nullif(trim(...), ''), default)` leyendo `full_name`→`name` y `avatar_url`→`picture` de `new.raw_user_meta_data`. Trigger `tr_on_auth_user_created after insert on auth.users for each row`.
  - [x] Añadir el asset por defecto `public/assets/avatars/default-player.svg` (avatar deportivo genérico; SVG ligero, coste cero).

- [x] **Tarea 3 — Configurar Google OAuth** (AC: #5)
  - [x] En `supabase/config.toml`, añadir `[auth.external.google]` con `enabled = true`, `client_id = "env(GOOGLE_CLIENT_ID)"`, `secret = "env(GOOGLE_CLIENT_SECRET)"`, `redirect_uri = "http://127.0.0.1:54321/auth/v1/callback"`, `skip_nonce_check = false`.
  - [x] Documentar `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` en `.env.example`; cargarlos desde un `.env` raíz (gitignored) que `env()` lee. **No** versionar credenciales reales.
  - [x] Añadir el botón/acción "Continuar con Google" en la UI de login (reutilizar páginas de auth de la plantilla bajo `src/app/auth/`): `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: \`${origin}/auth/callback\` } })`. Verificar que el route handler de callback de la plantilla (`src/app/auth/callback/route.ts`) intercambia el código por sesión por cookies.
  - [x] Reiniciar el stack tras editar config: `supabase stop && supabase start` (los cambios de `config.toml` no se aplican en caliente).
  - [x] **Limitación conocida** (documentar): el flujo OAuth real de Google no se puede ejercitar localmente sin credenciales reales → la validación automatizada del trigger se hace vía `auth.admin.createUser` (ver Tarea 5). El botón se valida manualmente o con un E2E opcional protegido por credenciales reales.

- [x] **Tarea 4 — Generar tipos y aplicar esquema** (AC: #1, #6)
  - [x] `npx supabase db reset` para aplicar ambas migraciones + seed en local; confirmar que corre sin errores.
  - [x] Crear `supabase/seed.sql` (mínimo, aunque sea con comentarios) para resolver el `[db.seed] enabled=true → ./seed.sql` que quedó colgando en Story 1.1, evitando warnings en `db reset`. _(Opcional: 1-2 ligas demo para desarrollo local; sin datos de partidos, que llegan en Story 2.1.)_
  - [x] `npx supabase gen types typescript --local > src/types/database.types.ts`. Añadir script npm `"db:types"` para regenerar.
  - [x] Crear/poblar `src/types/index.ts` con los tipos de dominio derivados (p. ej. `type Profile = Database['public']['Tables']['profiles']['Row']`), exportables para reutilizar en el código.
  - [x] `npx tsc --noEmit` en verde tras la generación de tipos.

- [x] **Tarea 5 — Pruebas de integración** (AC: #6)
  - [x] **Reutilizar** `tests/integration/setup.ts` (`createServiceRoleClient`, `createAnonClient`, `createAuthedClient`) — NO recrear helpers (ya existen desde Story 1.1).
  - [x] `tests/integration/auth-profile-trigger.test.ts`:
    - Con `service_role`, `auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name, avatar_url } })` → assert que aparece una fila en `profiles` con `display_name`/`avatar_url` esperados.
    - Crear usuario **sin** metadata (o con strings vacíos) → assert defaults `'Jugador Anónimo'` y `/assets/avatars/default-player.svg`.
    - Limpieza: `auth.admin.deleteUser(id)` al final (la FK `on delete cascade` elimina el perfil); aislar cada test.
  - [x] `tests/integration/schema-rls.test.ts`:
    - `anon` intenta `insert` en `leagues` y en `profiles` → assert que **falla/bloqueado** por RLS.
    - Usuario autenticado: crear vía `service_role`, autenticar (ver "Dev Notes › Obtener un cliente autenticado") y assertar que puede insertar una liga con `created_by = auth.uid()` pero **no** con `created_by` de otro usuario.
  - [x] Estos archivos pertenecen al proyecto Vitest `integration` (node). El archivo `tests/integration/rls-policies.test.ts` está **reservado para Story 2.1** (time-gating de predicciones) — usar nombres distintos aquí.

- [x] **Tarea 6 — Verificación final**
  - [x] `npm run test:integration` y `npm run test:unit` en verde.
  - [x] `npm run test:ci` en verde de extremo a extremo (con Supabase local en marcha).
  - [x] `npm run lint` y `npm run typecheck` sin errores.
  - [x] Confirmar que las migraciones son idempotentes vía `supabase db reset` (re-aplicables desde cero).

## Dev Notes

### Inteligencia de la historia previa (Story 1.1 — DONE)
Lee esto antes de empezar; evita romper lo que ya quedó montado: [Source: 1-1-...-playwright-y-vitest.md#Dev Agent Record]
- **Stack instalado real**: Next.js **16.2.7** + React **19.2.7**, `@supabase/ssr` + `@supabase/supabase-js` 2.x, Vitest **4.1.8** (jsdom 29), Playwright (chromium), Node 22 en CI.
- **Estructura**: TODO el código bajo `src/`. Clientes Supabase en `src/utils/supabase/{client,server,middleware}.ts`. **Next 16 usa `src/proxy.ts`** (no `middleware.ts`) como archivo raíz del framework — no lo toques salvo necesidad. Alias `@/* → ./src/*`.
- **Auth de la plantilla**: ya existe UI/flows de auth (email/password) bajo `src/app/auth/**` y `src/app/protected/**`, con callback SSR por cookies. **Esta historia AÑADE Google OAuth encima**, no reemplaza el cableado de cookies.
- **Testing de integración YA montado**:
  - `tests/integration/setup.ts` exporta `createServiceRoleClient()`, `createAnonClient()`, `createAuthedClient(jwt)` — todos con `{ auth: { persistSession: false, autoRefreshToken: false } }`. **REUTILIZAR**.
  - `tests/integration/setup-env.ts` carga credenciales desde `.env.test.local` (gitignored) generado con `supabase status -o env` (vars `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`).
  - Vitest tiene dos proyectos: `unit` (jsdom) e `integration` (node), corribles con `--project`.
- **Supabase local**: `supabase/config.toml` y `supabase/migrations/` ya existen (migrations sólo con `.gitkeep` — **esta historia lo llena**). El stack local corre en `http://127.0.0.1:54321`. En este entorno el **puerto 3000 está ocupado por Docker** (E2E usa 3100).
- **Deuda heredada relevante**: el review de 1.1 dejó `[db.seed] enabled=true` apuntando a `supabase/seed.sql` **inexistente** → resolver en Tarea 4. Y `eslint-config-next` está en 15.3.1 (no bloquea; no hace falta tocarlo aquí).

### Trigger de perfil (snippet canónico — usar tal cual, adaptando)
`SECURITY DEFINER` + `set search_path = ''` es **obligatorio**: el rol `supabase_auth_admin` que dispara el trigger no tiene permisos fuera del schema `auth`; la función definer (propiedad de `postgres`) sí. Referencias fully-qualified siempre. Si el trigger falla, **bloquea el alta de usuarios** → mantenerlo defensivo. [Source: web — supabase.com/docs/guides/auth/managing-user-data]
```sql
create or replace function public.fn_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      'Jugador Anónimo'
    ),
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'picture'), ''),
      '/assets/avatars/default-player.svg'
    )
  );
  return new;
end;
$$;

create trigger tr_on_auth_user_created
  after insert on auth.users
  for each row execute function public.fn_handle_new_user();
```
> Google OAuth deposita en `raw_user_meta_data` las claves `full_name`/`name`, `avatar_url`/`picture` y `email`. Por eso el `coalesce` cubre ambos nombres de clave. [Source: epics.md Story 1.2; FR-1; architecture.md#Gestión de Robustez de Auth]

### Trampa de recursión RLS (prevención de desastre)
Una política de `select` sobre `league_members` que haga `... in (select league_id from league_members where user_id = auth.uid())` **re-dispara RLS sobre la misma tabla → recursión infinita** (`infinite recursion detected in policy`). Mitigación estándar: encapsular la pertenencia en una función `SECURITY DEFINER` (`public.fn_user_in_league`) que consulta sin RLS. Aplica igual a la política `select` de `leagues` que referencia `league_members`. [Source: web — supabase RLS best practices; architecture.md#Authentication & Security]

### Obtener un cliente autenticado en los tests
Para validar políticas del rol `authenticated` sin minar JWTs a mano: crea el usuario con `service_role` (`auth.admin.createUser({ email, password, email_confirm: true })`), luego con un **`createAnonClient()`** haz `signInWithPassword({ email, password })`, toma `data.session.access_token` y pásalo a `createAuthedClient(accessToken)`. Evita añadir `jsonwebtoken` como dependencia. [Source: 1-1 setup helpers; web — supabase local testing]

### Decisión de alcance del esquema (anti re-trabajo)
La arquitectura modela **una** migración fundacional (`init_schema` + `rls_and_triggers`) que cubre el esquema relacional. Por eso definimos AHORA las columnas que historias posteriores necesitan (`invite_code`, `requires_payment`, `payment_amount`, `payment_instructions`, `rules`, `role`, `payment_status`, `joined_at`), evitando `ALTER TABLE` dispersos. **Su lógica de escritura/UI NO se implementa aquí** — solo existen como estructura. Si el dev/arquitecto prefiere migraciones aditivas por historia, es aceptable, pero la opción por defecto es definirlas ya. [Source: architecture.md#Complete Project Directory Structure → supabase/migrations; epics.md Stories 1.3/1.4/3.1/3.3]

### Convenciones obligatorias
- **DB**: tablas `snake_case` plural; FKs `_id`; **funciones `fn_`, triggers `tr_`** (¡cumplir nomenclatura!). [Source: architecture.md#Naming Patterns]
- **Fechas/horas**: `timestamptz`, ISO 8601 UTC; el control horario futuro (kickoff −1 min) se basará en `now()` del servidor — esta historia solo sienta `created_at`/`joined_at`. [Source: architecture.md#Data Exchange Formats; #Control del Tiempo Basado en Servidor]
- **Migraciones como código**: `supabase/migrations/`, aplicadas con `supabase db reset`; desplegadas vía Git en stories de infra. [Source: architecture.md#Data Architecture]
- **Tipos**: `src/types/database.types.ts` autogenerado; tipos de dominio en `src/types/index.ts`. [Source: architecture.md#Complete Project Directory Structure]

### Restricciones NFR
- **NFR-3 (Seguridad RLS)**: RLS activo en todas las tablas con datos de usuario; esta historia establece el baseline (bloqueo de escritura anónima). El time-gating de `predictions` es Story 2.1. [Source: epics.md NFR-3]
- **NFR-4 (Integridad transaccional)**: triggers/funciones `SECURITY DEFINER` para lógica de servidor; aquí aplica al trigger de perfil. El escrow llega en Epic 5. [Source: epics.md NFR-4]
- **Coste Cero**: nada que exceda Supabase Free Tier; avatar por defecto como asset estático local (no servicio externo). [Source: epics.md NFR-1]

### Alcance — qué NO hacer en esta historia
- NO crear tablas `matches`, `predictions`, `challenges`, etc. (Stories 2.1, 5.x, 6.x).
- NO implementar el formulario de creación de liga ni la UI de invitación (Stories 1.3, 1.4) — solo el esquema que las soporta.
- NO escribir `tests/integration/rls-policies.test.ts` (reservado para Story 2.1) ni `triggers.test.ts` (escrow, Epic 5).
- NO refinar RLS de admin/expulsión (Stories 1.3/3.3).

### Project Structure Notes
- Archivos NUEVOS de esta historia: `supabase/migrations/<ts>_init_schema.sql`, `supabase/migrations/<ts>_rls_and_triggers.sql`, `supabase/seed.sql`, `src/types/database.types.ts`, `src/types/index.ts`, `public/assets/avatars/default-player.svg`, `tests/integration/auth-profile-trigger.test.ts`, `tests/integration/schema-rls.test.ts`.
- Archivos MODIFICADOS: `supabase/config.toml` (proveedor Google), `.env.example` (vars Google), `package.json` (script `db:types`), UI de login bajo `src/app/auth/**` (botón Google).
- Sin conflictos detectados con la estructura de 1.1. Mantener todo bajo `src/` y la nomenclatura del sistema.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.2: Esquema Relacional de Base de Datos y Autenticación Google OAuth]
- [Source: _bmad-output/planning-artifacts/epics.md#FR-1 / Requirements Inventory / NFR-3 / NFR-4]
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security]
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Naming Patterns / Implementation Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Complete Project Directory Structure]
- [Source: _bmad-output/implementation-artifacts/1-1-inicializacion-del-boilerplate-y-configuracion-del-entorno-de-testing-playwright-y-vitest.md#Dev Agent Record]
- Web: Managing user data / triggers — https://supabase.com/docs/guides/auth/managing-user-data
- Web: Login with Google — https://supabase.com/docs/guides/auth/social-login/auth-google
- Web: CLI config (auth.external) — https://supabase.com/docs/guides/local-development/cli/config
- Web: RLS — https://supabase.com/docs/guides/database/postgres/row-level-security

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Opus 4.8)

### Debug Log References

- `npx supabase db reset`: aplica `init_schema` + `rls_and_triggers` + `seed.sql` sin errores (idempotente, re-ejecutado en verde).
- `npm run test:integration`: 7/7 (db-connection 1, auth-profile-trigger 2, schema-rls 4).
- `npm run test:ci`: unit 2/2 · integration 7/7 · e2e 1/1 — verde de extremo a extremo.
- `npx tsc --noEmit` y `npx eslint .`: 0 errores.
- Verificación CI: `supabase start` tolera `env(GOOGLE_*)` ausente (no falla); aun así se añaden placeholders a `ci.yml` por robustez.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- **Esquema (Tarea 1)**: tablas `profiles`, `leagues`, `league_members` con PKs, FKs `on delete cascade`, `unique(invite_code)`, `unique(league_id,user_id)`, CHECKs de `role`/`payment_status` e índices de apoyo. Se definieron por adelantado las columnas que consumen stories 1.3/1.4/3.1/3.3 (anti re-trabajo), sin lógica de escritura.
- **RLS + trigger (Tarea 2)**: RLS habilitado en las 3 tablas. Helper `fn_user_in_league` (`SECURITY DEFINER`) para evitar la recursión infinita de políticas. Políticas: `profiles` (select authenticated, update propio, sin insert manual), `leagues` (insert/select/update por creador o miembro), `league_members` (insert propio, select misma liga). Trigger `tr_on_auth_user_created → fn_handle_new_user` (`SECURITY DEFINER set search_path=''`) con fallbacks `full_name→name` y `avatar_url→picture`. Asset `default-player.svg` añadido.
- **Google OAuth (Tarea 3)**: `[auth.external.google]` en `config.toml` vía `env()`; vars documentadas en `.env.example` y leídas de `.env` raíz (gitignored). Botón reutilizable `GoogleSignInButton` añadido al login. Como la plantilla NO traía `callback/route.ts` (solo `confirm/route.ts` para email OTP), se **creó** `src/app/auth/callback/route.ts` que hace `exchangeCodeForSession`. Stack reiniciado para aplicar config. **Limitación documentada**: el flujo OAuth real de Google no se ejercita en local/CI sin credenciales reales → el trigger se valida vía `auth.admin.createUser`.
- **Tipos (Tarea 4)**: `src/types/database.types.ts` autogenerado; `src/types/index.ts` con tipos de dominio (`Profile`, `League`, `LeagueMember`, etc.); script npm `db:types`; `seed.sql` mínimo (resuelve la deuda heredada del `[db.seed]`).
- **Tests (Tarea 5)**: reutilizan los helpers de `tests/integration/setup.ts` (sin recrearlos). `auth-profile-trigger.test.ts` (metadata completa + defaults) y `schema-rls.test.ts` (anon bloqueado; `with_check` de creador). Cliente autenticado obtenido vía `signInWithPassword` + `createAuthedClient` (sin añadir `jsonwebtoken`).
- **Alcance respetado**: NO se crearon tablas de stories futuras, ni UI de liga/invitación, ni `rls-policies.test.ts`/`triggers.test.ts` (reservados).

### File List

**Migraciones / DB (nuevos):**
- `supabase/migrations/20260602041410_init_schema.sql`
- `supabase/migrations/20260602041455_rls_and_triggers.sql`
- `supabase/seed.sql`
- `supabase/migrations/.gitkeep` (eliminado — ya hay migraciones reales)

**Tipos (nuevos):**
- `src/types/database.types.ts` (autogenerado)
- `src/types/index.ts`

**App / Auth:**
- `src/components/google-signin-button.tsx` (nuevo)
- `src/app/auth/callback/route.ts` (nuevo — intercambio de código OAuth)
- `src/components/login-form.tsx` (modificado — botón Google)

**Assets (nuevo):**
- `public/assets/avatars/default-player.svg`

**Tests (nuevos):**
- `tests/integration/auth-profile-trigger.test.ts`
- `tests/integration/schema-rls.test.ts`

**Configuración (modificados):**
- `supabase/config.toml` (proveedor `[auth.external.google]`)
- `.env.example` (vars `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`)
- `package.json` (script `db:types`)
- `.github/workflows/ci.yml` (placeholders Google a nivel de job)

> Nota: `.env` raíz se crea localmente con credenciales/placeholders y está gitignored (no versionado).

## Change Log

| Fecha       | Versión | Descripción                                                                                                                                              | Autor        |
| ----------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 2026-06-02  | 0.1     | Esquema relacional (profiles/leagues/league_members) con RLS y trigger de perfil, Google OAuth (config + botón + callback), tipos generados y tests de integración. Story completada — lista para review. | Amelia (Dev) |

## Review Findings

> Revisión adversarial (Blind Hunter + Edge Case Hunter + Acceptance Auditor) — 2026-06-02. Historia sensible a seguridad (RLS / SECURITY DEFINER / OAuth). Triage: 2 decisiones, 2 patches, 4 diferidos, ~4 descartados. Las 6 ACs se cumplen (Auditor) y las convenciones obligatorias (`fn_`/`tr_`, `search_path=''`, anti-recursión vía `fn_user_in_league`) son correctas. Falso positivo notable descartado: **open-redirect en el callback** — el prefijo `${origin}` (esquema+host) hace que `next=//evil.com` quede como ruta del propio host; no es explotable (el Edge Hunter se retractó tras verificarlo).

### Decision Needed (resueltas)
- [x] [Review][Decision] `league_members_insert_self` permite auto-promoción a `role='admin'` — RESUELTO (2026-06-02): **endurecer ahora** → reclasificado a Patch (añadir `and role = 'member'` al `with check` + test de denegación).
- [x] [Review][Decision] `profiles.email` legible por cualquier autenticado (PII) — RESUELTO (2026-06-02): **diferir con nota de hardening** → movido a Deferred / deferred-work.md.

### Patches (aplicados)
- [x] [Review][Patch] `league_members_insert_self` auto-promoción a admin — APLICADO: añadido `and role = 'member'` al `with check` [rls_and_triggers.sql:90-97]. Validado con test nuevo (RLS rechaza `role='admin'` con 42501; `member` permitido). Gating por invitación sigue diferido a 1.4.
- [x] [Review][Patch] Trigger `fn_handle_new_user` sin `on conflict` — APLICADO: añadido `on conflict (id) do nothing` [rls_and_triggers.sql:134] para que una colisión de perfil no aborte el signup. Validado vía `db reset` + tests de trigger en verde.
- [x] [Review][Patch] Tests RLS de denegación débiles — APLICADO: las pruebas anon ahora afirman `error.code === '42501'` (prueban RLS, no FK) y se añadió cobertura de `league_members` (member OK / admin bloqueado) [tests/integration/schema-rls.test.ts]. Suite de integración: 9/9 verde.

### Deferred
- [x] [Review][Defer] `profiles.email` legible por cualquier usuario autenticado (PII) [supabase/migrations/20260602041455_rls_and_triggers.sql:49] — deferred (decisión del usuario): restringir antes de producción (vista pública sin email o sacar `email` de la tabla)
- [x] [Review][Defer] Sin políticas UPDATE/DELETE en `league_members` y sin DELETE en `leagues` — deny-by-default: abandonar liga / cambiar `payment_status` / borrar liga quedan bloqueados vía cliente. Las añaden Stories 1.3/1.4/3.3. [supabase/migrations/20260602041455_rls_and_triggers.sql] — deferred, fuera de alcance
- [x] [Review][Defer] `profiles.email` nunca se re-sincroniza (trigger solo `AFTER INSERT`) — queda obsoleto si cambia el email en `auth.users` [supabase/migrations/20260602041455_rls_and_triggers.sql:139] — deferred, fuera de alcance
- [x] [Review][Defer] `payment_amount numeric(10,2)` sin `check (>= 0)` ni coherencia con `requires_payment` — lógica de pago es Story 1.3 [supabase/migrations/20260602041410_init_schema.sql] — deferred, fuera de alcance
- [x] [Review][Defer] `LeagueRole`/`PaymentStatus` en `src/types/index.ts` duplican manualmente los CHECK de la BD (riesgo de drift; `database.types.ts` los tipa como `string`) [src/types/index.ts] — deferred

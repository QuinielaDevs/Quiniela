---
baseline_commit: 57ead0b
created: 2026-06-04T20:40:00-04:00
---

# Story 7.2: Captura y Edición de Resultados por el Administrador

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **administrador de la liga**,
I want **capturar y editar el marcador y el estado de cada partido (`scheduled→live→finished`, además de `suspended`/`canceled`) desde el panel de administración**,
so that **la clasificación, la tabla en vivo y el scoring se actualicen con resultados reales sin depender de una API externa**.

## Contexto y alcance (leer primero)

Esta historia es **RPC admin-gated + UI admin**, la continuación natural de Story 7.1 (seed del calendario) y la pieza que sustituye al cron `/api/sync` de API-Football (inviable en plan Free, ver `sprint-change-proposal-2026-06-04.md`). 7.1 dejó los 104 partidos sembrados en `public.matches`; **7.2 le da al admin el control manual de marcadores y estados**.

**Hecho clave (NO reinventar):** la tabla `public.matches` ya **reacciona en vivo** y la clasificación oficial ya se calcula **on-the-fly** desde partidos `finished`. Esta historia NO crea infraestructura nueva de standings ni de Realtime — **solo escribe en `matches` por un RPC seguro**, y todo lo demás reacciona solo:

- **Tabla en vivo (Epic 4):** `LiveStandingsBoard` ya está suscrito a `postgres_changes` `UPDATE` sobre `public.matches` ([Source: src/components/live/LiveStandingsBoard.tsx:405-412]). Cuando el RPC haga `UPDATE`, Realtime emite el evento → reordenamiento + toast "Impacto de Gol" **sin tocar código de Epic 4**. ✅
- **Clasificación oficial (Epic 3):** `/standings` consulta `matches` con `status=finished` y arma la tabla con `buildStandings` en cada render ([Source: src/app/standings/page.tsx:65-74; src/utils/standings.ts:69-137]). Marcar un partido `finished` lo **incorpora automáticamente** ("consolidación on-the-fly"). 7.2 NO persiste `predictions.points_earned` (eso es Epic 5.3, diferido) — solo basta `revalidatePath('/standings')`.
- **Scoring (Epic 2.1):** `scoring.ts` ya define puntos base + multiplicador; standings los aplica al leer. 7.2 NO toca scoring. Un partido `canceled`/`suspended` queda **excluido** de la clasificación porque `buildStandings` solo cuenta `finished` ([Source: src/utils/standings.ts:76-80]).

**Lo que NO hace 7.2:** no resuelve el bracket ni avanza fases (eso es **Story 7.3** vía `home_source`/`away_source`); no habilita predicciones sobre knockout TBD (sigue bloqueado por `fn_match_editable`, 7.1); no escribe `points_earned`; no toca el código de la tabla en vivo ni de scoring.

## Decisión arquitectónica resuelta (CRÍTICA — leer antes de codificar)

`public.matches` es un **catálogo GLOBAL del torneo**, no datos por-liga ([Source: supabase/migrations/...matches_and_predictions.sql:11-33 — "Es catálogo común"]). Hay **un solo Mundial 2026** compartido por todas las ligas. Por tanto:

- **El gating del RPC es "admin de AL MENOS una liga"**, no "admin de la liga X". Editar un marcador afecta a **todas** las ligas simultáneamente (es el resultado real del partido), así que no tiene sentido parametrizar por `league_id`. Se crea un helper `fn_user_is_any_league_admin()` (espeja `fn_user_is_league_admin` de 3.3 pero sin parámetro de liga: `exists(... role='admin')`).
- La **UI** vive en el hub admin `/standings/manage`, que ya exige rol admin server-side para la liga activa del usuario ([Source: src/app/standings/manage/page.tsx:63-65]). Ese gate de página es suficiente para mostrar el panel; el RPC re-valida de forma independiente (defensa en profundidad, patrón 3.3).
- **Por qué no `service_role`:** la escritura debe venir de un usuario admin autenticado, no de un secreto de cron (ya no hay cron). El patrón correcto es **RPC `SECURITY DEFINER` admin-gated**, idéntico a `fn_set_member_payment_status` / `fn_remove_member` de Story 3.3.

> ✅ **Decisión confirmada por Cris (2026-06-04):** gating = "admin de cualquier liga" (`fn_user_is_any_league_admin()`). Cerrada — implementar tal cual.

## Acceptance Criteria

1. **Given** un admin autenticado en `/standings/manage`
   **When** abre la gestión de partidos
   **Then** ve un listado de partidos (al menos los de la jornada/fase activa: grupos con equipos reales; los knockout TBD `"Por definir"` se ocultan o se muestran deshabilitados hasta 7.3) mobile-first (`max-w-md`, tokens **Championship Gold**, tap targets ≥48px) con: equipos/banderas, `match_time` local, marcador actual y estado.

2. **And** puede fijar `home_score`, `away_score` y `status` de un partido mediante un **RPC `SECURITY DEFINER` admin-gated** (`fn_admin_set_match_result`, patrón Story 3.3) que: (a) exige sesión (`auth.uid()` no nula → `42501`), (b) exige rol admin de **alguna** liga (`fn_user_is_any_league_admin()` → `42501` si no), (c) valida marcadores `>= 0` (`22023` si negativos), (d) valida la **transición de `status`** contra la matriz definida en Dev Notes (`22023`/`P0001` si inválida), (e) valida la **regla marcador↔estado** (Dev Notes). **No** hay escritura directa a `matches` desde el cliente (la RLS de `matches` no tiene política `UPDATE` → denegada por defecto).

3. **And** al pasar un partido a `live` o `finished` con marcador, la **tabla en vivo (Epic 4)** reacciona vía Realtime (reordenamiento + toast) **sin trabajo adicional** en su código; y al marcar `finished`, la **clasificación oficial** (`buildStandings`) lo incorpora on-the-fly tras `revalidatePath('/standings')`.

4. **And** la Server Action que envuelve el RPC retorna `ServerActionResult<T>` (nunca lanza), mapea `42501` → "No autorizado" y otros errores → mensaje genérico seguro (patrón `toAdminError` de 3.3), y revalida `/standings` y `/standings/manage`. La UI es optimista con `useTransition` (patrón `MemberAdminList`), maneja error/permiso y bloquea al no-admin.

5. **And** existen pruebas: **integración** del RPC (`tests/integration/admin-match-results.test.ts`, patrón `member-admin-management.test.ts` con clientes `service_role`/`authed`/`anon`) cubriendo admin sí / no-admin no / anon no / marcador negativo / transición inválida / regla marcador↔estado / efecto del `UPDATE`; y **unit** del componente de UI (patrón `standings-manage-page.test.tsx`/`MemberAdminList`). `lint`, `typecheck`, `build`, `test:unit`, `test:integration` en verde.

## Tasks / Subtasks

- [x] **Tarea 1 — Migración: helper + RPC `fn_admin_set_match_result`** (AC: #2, #3)
  - [x] Crear `supabase/migrations/<ts>_admin_match_results_rpc.sql` (timestamp **posterior** a `20260604132000_block_tbd_knockout_predictions.sql`).
  - [x] `create or replace function public.fn_user_is_any_league_admin() returns boolean language sql security definer set search_path = '' stable` → `select exists(select 1 from public.league_members lm where lm.user_id = (select auth.uid()) and lm.role = 'admin')`. (Espeja `fn_user_is_league_admin` sin parámetro; [Source: migración member_admin_management:21-35].)
  - [x] `create or replace function public.fn_admin_set_match_result(p_match_id uuid, p_home_score int, p_away_score int, p_status text) returns public.matches language plpgsql security definer set search_path = ''`:
    - `auth.uid()` null → `raise exception ... using errcode='42501'`.
    - `not public.fn_user_is_any_league_admin()` → `42501`.
    - cargar el partido actual (`select * into v_match from public.matches where id = p_match_id`); si null → `P0002`.
    - validar `p_status in ('scheduled','live','finished','suspended','canceled')` (espeja el CHECK) → si no, `22023`.
    - validar **transición** `v_match.status → p_status` contra la matriz (Dev Notes) → inválida = `raise exception ... using errcode='22023'` (o `P0001`).
    - validar **regla marcador↔estado** (Dev Notes): normaliza scores (los que se persisten) según el estado destino.
    - `update public.matches set home_score=..., away_score=..., status=p_status, updated_at=now() where id=p_match_id returning * into v_match;` (no hay trigger de `updated_at` → setearlo explícito).
    - `return v_match;`
  - [x] `grant execute on function public.fn_user_is_any_league_admin() to authenticated;` y `grant execute on function public.fn_admin_set_match_result(uuid,int,int,text) to authenticated;`
  - [x] **NO** abrir políticas `UPDATE`/`DELETE` sobre `matches`; **NO** tocar la RLS de `matches`, su CHECK de `status`, ni la publicación Realtime.
  - [x] `source ~/.nvm/nvm.sh && nvm use 24 && npx supabase db reset` y `npm run db:types` para regenerar `src/types/database.types.ts` con la nueva función.

- [x] **Tarea 2 — Server Action + schema** (AC: #2, #4)
  - [x] Crear `src/app/actions/matches.schema.ts`: `setMatchResultSchema` (zod) con `matchId: uuid`, `homeScore`/`awayScore`: `int >= 0` nullable, `status`: enum de los 5 estados.
  - [x] Crear `src/app/actions/matches.actions.ts` (`"use server"`): `setMatchResult(input): Promise<ServerActionResult<Match>>` que valida con el schema, llama `supabase.rpc("fn_admin_set_match_result", { p_match_id, p_home_score, p_away_score, p_status }).single()`, mapea errores con el patrón `toAdminError` (reutilizar `ADMIN_NOT_AUTHORIZED_ERROR`/`ADMIN_SAVE_ERROR` de `leagues.constants.ts`; `42501` → no autorizado), y `revalidatePath("/standings")` + `revalidatePath("/standings/manage")`. **Nunca** propaga excepciones. [Source: src/app/actions/leagues.actions.ts:161-205]
  - [x] Añadir el tipo `Match` a `src/types/index.ts` si no existe (derivado de `Database["public"]["Tables"]["matches"]["Row"]`).

- [x] **Tarea 3 — UI admin de partidos en `/standings/manage`** (AC: #1, #4)
  - [x] Extender `src/app/standings/manage/page.tsx` (`ManageBoard`): tras validar admin, cargar partidos relevantes vía cliente SSR autenticado (RLS `matches_select_authenticated` ya autoriza la lectura) — p. ej. `stage='group'` con equipos reales, ordenados por `match_time`; excluir/deshabilitar knockout TBD (`home_team='Por definir'` o `bracket_slot not null and home_team_code is null`). Mapear a una vista cliente.
  - [x] Crear `src/components/standings/MatchAdminList.tsx` (`"use client"`): lista mobile-first de partidos; por fila, editor de marcador (botones +/- ≥48px, reutilizar el estilo de `GoalPicker` si aplica, sin teclado nativo) y selector de estado; envío optimista con `useTransition` que llama `setMatchResult` y hace `router.refresh()`; reconcilia con props tras la transición (patrón `MemberAdminList.tsx:53-105`). Mostrar error/permiso con `role="status"`.
  - [x] (Opcional, recomendado) Presentar "Miembros" y "Partidos" como dos secciones o un Tab Bar nivel-2 (UX-DR-7) dentro de `/standings/manage`. El requisito esencial: gestionar partidos **desde el área admin**.
  - [x] Tokens Championship Gold, fuentes Outfit/Inter, `aria-label` descriptivos (UX-DR-2/3/10).

- [x] **Tarea 4 — Pruebas de integración del RPC** (AC: #5)
  - [x] Crear `tests/integration/admin-match-results.test.ts` siguiendo `member-admin-management.test.ts` (helpers `createServiceRoleClient`/`createAuthedClient`/`createAnonClient`, `createAuthedUser`, `seedLeague`; sembrar un partido con `service_role`).
  - [x] Casos: admin de alguna liga fija marcador+`finished` (ok, fila actualizada); no-admin (`member`) → `42501`; anon → error; marcador negativo → `22023`; transición inválida (p. ej. `finished`→`scheduled` si la matriz lo prohíbe) → `22023`/`P0001`; regla marcador↔estado (p. ej. `finished` sin scores → error); partido inexistente → `P0002`; idempotencia (re-fijar el mismo resultado no falla). Limpieza de partidos en `afterAll` (no cuelgan de usuario por FK; ver patrón existente).

- [x] **Tarea 5 — Pruebas unitarias de UI** (AC: #5)
  - [x] Crear `tests/unit/match-admin-list.test.tsx` (o extender `standings-manage-page.test.tsx`): render del listado, interacción +/- y cambio de estado, estado optimista, manejo de error, no-admin sin controles. Mockear `setMatchResult` (patrón `predictions-page.test.tsx`/`MemberAdminList` tests).

- [x] **Tarea 6 — Verificación final** (AC: #5)
  - [x] `source ~/.nvm/nvm.sh && nvm use 24`
  - [x] `npx supabase db reset`
  - [x] `npm run db:types` (confirmar que `fn_admin_set_match_result` aparece en los tipos)
  - [x] `npm run lint && npm run typecheck && npm run build`
  - [x] `npm run test:unit && npm run test:integration`
  - [x] Si `test:unit` falla en frío por transform timeout (~30s), re-ejecutar en caliente y documentar (patrón Epic 3/4/7.1).

### Review Findings

Code review (2026-06-04, 3 capas adversariales: Blind Hunter / Edge Case Hunter / Acceptance Auditor). 0 decision-needed · 4 patch · 3 defer · 12 descartados. Sin violaciones de AC (las 5 ACs satisfechas; matriz de transiciones idéntica al spec; guardrails de Dev Notes intactos).

**Patches:**

- [x] [Review][Patch] Concurrencia: agregar `for update` al SELECT del partido en el RPC para serializar ediciones simultáneas y evitar lost-update sobre el catálogo global [supabase/migrations/20260604140000_admin_match_results_rpc.sql:610]
- [x] [Review][Patch] Acotar marcador: `.max(99)` en `setMatchResultSchema` y `max={99}` en los GoalPicker (evita valores absurdos / overflow de `int`) [src/app/actions/matches.schema.ts:101; src/components/standings/MatchAdminList.tsx:397]
- [x] [Review][Patch] Orden determinista: clave secundaria en el `order` de la query de partidos para evitar reshuffle entre refreshes con `match_time` iguales [src/app/standings/manage/page.tsx:189]
- [x] [Review][Patch] Hora local hydration-safe: `suppressHydrationWarning` en el nodo de hora (SSR en UTC vs cliente en TZ local) [src/components/standings/MatchAdminList.tsx:385]

**Diferidos (fuera de alcance / pre-existentes):**

- [x] [Review][Defer] Granularidad de errores P0002/22023 + logging en el `catch` de la Server Action — diferido, sigue el patrón compartido `toAdminError`/Story 3.3; mejorar repo-wide [src/app/actions/matches.actions.ts:26]
- [x] [Review][Defer] Surface de captura de resultados de knockout una vez resueltos los equipos — diferido, alcance de Story 7.3 [src/app/standings/manage/page.tsx:185]
- [x] [Review][Defer] Confirmación UX para transiciones destructivas (finished→live / →canceled) — diferido, la matriz es by-design; mejora de UX futura [src/components/standings/MatchAdminList.tsx]

## Dev Notes

### Toolchain de Node (CRÍTICO)

Activa Node moderno antes de comandos Supabase/tests: `source ~/.nvm/nvm.sh && nvm use 24`. Supabase CLI solo vía `npx supabase ...` (no hay binario global). [Source: 7-1-...md#Dev Notes; memoria node-version-toolchain]

### Esquema de `matches` — leer antes de tocar (estado actual)

`public.matches` (Story 2.1 + columnas de 7.1) [Source: src/types/database.types.ts:123-144]:
```
id uuid pk, external_ref text unique, home_team text NOT NULL, away_team text NOT NULL,
home_team_code text, away_team_code text, home_score int (>=0), away_score int (>=0),
match_time timestamptz NOT NULL, status text NOT NULL default 'scheduled'
  CHECK in (scheduled, live, finished, suspended, canceled),
matchday int, stage text, created_at, updated_at,
group_label text (A..L), bracket_slot int (unique parcial), home_source text, away_source text, venue text
```
- **RLS:** `matches` solo tiene `matches_select_authenticated` (lectura). **No hay política UPDATE** → cualquier `UPDATE` desde cliente autenticado está **denegado** por defecto. Por eso el RPC `SECURITY DEFINER` es obligatorio (patrón idéntico a 3.3). NO añadir política UPDATE.
- **`updated_at`** tiene `default now()` pero **no** hay trigger que lo refresque en update → el RPC debe `set updated_at = now()` explícito.
- **Realtime:** `matches` ya está en la publicación `supabase_realtime` (7.1/4.1). El RPC `UPDATE` se propaga solo. No tocar `20260604123000_matches_realtime_publication.sql`.
- **Knockout TBD:** los 32 partidos de eliminatoria están como `'Por definir'` + `home_team_code` null hasta 7.3. NO permitir capturar resultados sobre ellos en la UI (no son partidos reales todavía). Filtrar por equipos resueltos / `stage='group'` para el MVP de 7.2.

### Matriz de transiciones de `status` (recomendada — cerrarla aquí evita ambigüedad)

Estados: `scheduled`, `live`, `finished`, `suspended`, `canceled`. Reglas (origen → destinos permitidos), pensadas para un admin de confianza que también necesita **corregir errores**:

| Origen ↓ | scheduled | live | finished | suspended | canceled |
|---|---|---|---|---|---|
| **scheduled** | ✓ (idemp.) | ✓ | ✓ | ✓ | ✓ |
| **live** | ✓ (revertir) | ✓ (idemp./editar) | ✓ | ✓ | ✓ |
| **finished** | ✗ | ✓ (corregir) | ✓ (editar marcador) | ✗ | ✗ |
| **suspended** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **canceled** | ✓ | ✗ | ✗ | ✗ | ✓ |

- "idemp./editar" = mismo estado permitido (corregir un marcador ya guardado).
- Transición no listada como ✓ → `raise exception 'Transición de estado inválida' using errcode='22023'`.

### Regla marcador ↔ estado (recomendada)

- `status in ('live','finished')`: **scores requeridos** (`p_home_score`/`p_away_score` not null, `>= 0`). Null → `22023`.
- `status = 'scheduled'`: **forzar scores a null** al persistir (un partido por jugar no tiene marcador).
- `status in ('suspended','canceled')`: **persistir scores a null** (la clasificación los excluye; `scoring.ts` trata estos estados como 0). El partido sale de standings automáticamente porque `buildStandings` solo cuenta `finished`.

### Por qué NO persistir puntos en 7.2

La clasificación es **on-the-fly**: `standings.ts` NO lee `predictions.points_earned`; recalcula desde `matches.finished` + `predictions` en cada render. Persistir `points_earned` es trabajo de **Epic 5.3 (diferido)**. 7.2 solo escribe el marcador/estado del partido; standings y la tabla en vivo se actualizan solos. [Source: src/utils/standings.ts:1-10, 76-103]

### Patrón Server Action (obligatorio)

Todas las Server Actions retornan `ServerActionResult<T> = { success, data, error }` y **nunca** lanzan al cliente. Mapear errores del RPC con `toAdminError` (código `42501` → `ADMIN_NOT_AUTHORIZED_ERROR`; resto → `ADMIN_SAVE_ERROR`) y `revalidatePath`. Reutilizar las constantes de `src/app/actions/leagues.constants.ts`. [Source: src/app/actions/leagues.actions.ts:161-205; architecture.md#Format Patterns]

### Patrón UI cliente (obligatorio)

Espejar `MemberAdminList.tsx`: estado local sembrado de props, mutación optimista, `useTransition`, `router.refresh()` al terminar, y **reconciliación** `useEffect(() => { if (!isPending) setRows(props) }, [props, isPending])` para no pisar estado en vuelo. Botones ≥48px, `disabled` durante la transición, `aria-label` y `role="status"` para errores. [Source: src/components/standings/MemberAdminList.tsx:33-205]

### Patrón de prueba de integración (DB)

Reutilizar `tests/integration/setup.ts` (`createServiceRoleClient`/`createAuthedClient`/`createAnonClient`) y los helpers de `member-admin-management.test.ts` (`createAuthedUser`, `seedLeague`). Sembrar partidos con `service_role` (bypassa RLS), invocar el RPC con el cliente autenticado del rol bajo prueba, y verificar con `service_role`. Limpiar `matches` creados en `afterAll`. [Source: tests/integration/member-admin-management.test.ts:1-152]

### Riesgos y guardrails

- **NO** abrir políticas UPDATE/DELETE sobre `matches` ni usar `service_role` en runtime → siempre vía RPC admin-gated.
- **NO** parametrizar el RPC por `league_id` (matches es global; gating = admin de alguna liga). Ver decisión arquitectónica arriba.
- **NO** tocar el código de la tabla en vivo (Epic 4) ni de `scoring.ts`/`standings.ts` — reaccionan solos.
- **NO** habilitar captura sobre knockout TBD (sin equipos reales hasta 7.3).
- **NO** persistir `points_earned` (Epic 5.3).
- **NO** añadir `set search_path` faltante en funciones `SECURITY DEFINER` (obligatorio: `set search_path = ''` + todo fully-qualified).
- Mantener `match_time` y la lógica horaria intactos: el time-gating RLS (2.x), multiplicador (2.4) y la tabla en vivo dependen de él. 7.2 NO modifica `match_time`.

### Project Structure Notes

Archivos **NUEVOS** esperados:
- `supabase/migrations/<ts>_admin_match_results_rpc.sql`
- `src/app/actions/matches.actions.ts`
- `src/app/actions/matches.schema.ts`
- `src/components/standings/MatchAdminList.tsx` (y, si se separa el editor, `MatchResultDialog.tsx`)
- `tests/integration/admin-match-results.test.ts`
- `tests/unit/match-admin-list.test.tsx`

Archivos **MODIFICADOS** esperados:
- `src/app/standings/manage/page.tsx` (cargar partidos + render del panel de partidos)
- `src/types/database.types.ts` (regenerado por `db:types`)
- `src/types/index.ts` (tipo `Match`, si falta)
- (posible) `src/app/actions/leagues.constants.ts` solo si se factorizan las constantes admin a un módulo compartido — preferir **reutilizarlas** sin moverlas.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.2: Captura y Edición de Resultados por el Administrador]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-06-04.md]
- [Source: _bmad-output/implementation-artifacts/7-1-seed-del-calendario-y-modelo-de-fases-grupos-bracket.md#Completion Notes (nota de alcance para 7.2)]
- [Source: supabase/migrations/20260604120000_member_admin_management.sql (patrón RPC admin-gated 3.3)]
- [Source: supabase/migrations/20260603144628_matches_and_predictions.sql (esquema matches)]
- [Source: supabase/migrations/20260604123000_matches_realtime_publication.sql]
- [Source: supabase/migrations/20260604132000_block_tbd_knockout_predictions.sql (fn_match_editable — NO depende de él)]
- [Source: src/app/actions/leagues.actions.ts (ServerActionResult + toAdminError + revalidatePath)]
- [Source: src/app/standings/manage/page.tsx (hub admin + gate server-side)]
- [Source: src/components/standings/MemberAdminList.tsx (UI optimista useTransition)]
- [Source: src/app/standings/page.tsx + src/utils/standings.ts (standings on-the-fly)]
- [Source: src/components/live/LiveStandingsBoard.tsx:405-412 (suscripción Realtime a matches)]
- [Source: tests/integration/member-admin-management.test.ts (patrón de prueba RPC)]
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security; #Format Patterns; #Naming Patterns]

## Git Intelligence (commits recientes relevantes)

- `57ead0b` Implement World Cup 2026 calendar seed (Story 7.1) — base directa de esta historia (`matches` con modelo de fases).
- `f466f15` notificaciones "Impacto de Gol" en vivo (4.2) — la UI que reacciona al `UPDATE` de matches que produce 7.2.
- `e396b98` add live projected standings (4.1) — suscripción Realtime a `matches`.
- `babb4f3` panel de administración y control de pagos (3.3) — **patrón canónico a copiar** (RPC SECURITY DEFINER admin-gated + UI optimista).

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (claude-opus-4-8)

### Debug Log References

- `npx supabase db reset` — aplica las 15 migraciones incluyendo `20260604140000_admin_match_results_rpc.sql` sin error.
- `npm run db:types` — tipos regenerados; `fn_admin_set_match_result` (línea 384) y `fn_user_is_any_league_admin` (línea 529) presentes en `database.types.ts`.
- `npx vitest run --project integration tests/integration/admin-match-results.test.ts` — 12 tests nuevos pasan.
- `npm run lint` — pasa.
- `npm run typecheck` — pasa.
- `npm run build` — pasa (ruta `/standings/manage` compila).
- `npm run test:unit` — 29 archivos / 221 tests pasan (aviso no bloqueante de jsdom canvas).
- `npm run test:integration` — 15 archivos / 73 tests pasan.

### Completion Notes List

- **RPC admin-gated (AC #2):** `fn_admin_set_match_result(uuid,int,int,text)` `SECURITY DEFINER` con `set search_path=''`. Gating "admin de cualquier liga" vía nuevo helper `fn_user_is_any_league_admin()` (matches es catálogo GLOBAL — decisión confirmada por Cris). Valida sesión (42501), admin (42501), partido existente (P0002), estado en el enum, transición de estado (matriz 7.2 → 22023), guarda de knockout TBD (22023) y regla marcador↔estado: `live`/`finished` exigen marcador ≥0; `scheduled`/`suspended`/`canceled` persisten marcador NULL. Bump explícito de `updated_at` (no hay trigger).
- **Reactividad sin trabajo extra (AC #3):** verificado que `LiveStandingsBoard` ya se suscribe a `postgres_changes UPDATE` sobre `matches` → el `UPDATE` del RPC se propaga solo. La clasificación oficial (`buildStandings`) incorpora los `finished` on-the-fly; la Server Action solo hace `revalidatePath('/standings')`. NO se persiste `points_earned` (Epic 5.3).
- **Server Action (AC #4):** `setMatchResult` retorna `ServerActionResult<Match>`, nunca lanza, mapea 42501 → "No autorizado" (patrón `toAdminError` reusado de 3.3) y revalida `/standings` + `/standings/manage`. Coacciona `null→0` al invocar el RPC (que tipa los scores como `number`); el RPC los anula para estados sin marcador y el schema garantiza marcador en `live`/`finished`.
- **UI (AC #1):** `MatchAdminList` (client) renderizado en una nueva sección "Resultados de partidos" de `/standings/manage` (junto a la sección "Miembros"). Mobile-first, tokens Championship Gold, GoalPicker reutilizado (+/- ≥48px sin teclado), selector de estado que solo ofrece transiciones válidas del estado de origen, guardado optimista con `useTransition` + `router.refresh()` y reconciliación con props. La página carga solo partidos de grupo con equipos reales (los knockout TBD se omiten hasta 7.3). Defensa server-side: la página ya redirige a `/standings` al no-admin.
- **Decisión de UI:** se optó por secciones apiladas (Miembros / Resultados) en lugar de Tab Bar nivel-2 para mantener `/standings/manage` como server component y minimizar riesgo; el Tab Bar queda como mejora futura opcional (estaba marcado "opcional, recomendado" en la historia).
- **Pruebas:** integración del RPC (admin sí / no-admin / sin-liga / anon / negativo / nulo en finished / transición inválida / limpieza de marcador / knockout TBD / inexistente / idempotencia); unit del componente (`MatchAdminList`) y del schema (`matches-schema`); test de la página manage extendido para el nuevo panel.

### File List

- `_bmad-output/implementation-artifacts/7-2-captura-y-edicion-de-resultados-por-el-administrador.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `supabase/migrations/20260604140000_admin_match_results_rpc.sql`
- `src/types/database.types.ts`
- `src/app/actions/matches.actions.ts`
- `src/app/actions/matches.schema.ts`
- `src/components/standings/MatchAdminList.tsx`
- `src/app/standings/manage/page.tsx`
- `tests/integration/admin-match-results.test.ts`
- `tests/unit/match-admin-list.test.tsx`
- `tests/unit/matches-schema.test.ts`
- `tests/unit/standings-manage-page.test.tsx`

## Change Log

| Fecha | Versión | Descripción | Autor |
| --- | --- | --- | --- |
| 2026-06-04 | 0.1 | Story context creada: RPC admin-gated `fn_admin_set_match_result` + UI de captura de resultados en `/standings/manage`, reusando el patrón 3.3 y la reactividad de Epic 3/4. | BMad Create-Story |
| 2026-06-04 | 1.0 | Implementada Story 7.2: migración RPC + helper admin global, Server Action + schema, UI `MatchAdminList` en `/standings/manage`, y pruebas (12 integración + unit). lint/typecheck/build/unit(221)/integration(73) en verde. | Claude Opus 4.8 |
| 2026-06-04 | 1.1 | Code review (3 capas): aplicados 4 patches — `for update` en el RPC (concurrencia), `.max(99)` en marcador (schema+GoalPicker), orden secundario por `id` en la query de partidos, y `suppressHydrationWarning` en la hora local. 3 diferidos, 12 descartados. Suites verdes. Status → done. | Claude Opus 4.8 |

## Completion Note

Ultimate context engine analysis completed - comprehensive developer guide created.

---
baseline_commit: ea34970dbd4fb5b3af73bdfe098c6a44f52331ca
---

# Story 3.3: Panel Rápido de Administración y Control de Pagos

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **administrador de la liga**,
I want **marcar a los miembros como pagados o pendientes de pago y expulsar de forma definitiva a miembros inactivos desde un panel rápido**,
so that **gestionar la administración logística del torneo de manera transparente, ejerciendo presión social del pago sin bloquear el juego**.

## Acceptance Criteria

1. **Given** un usuario con `league_members.role = 'admin'` en su liga activa, viendo la pestaña **Posiciones** (`/standings`)
   **When** se renderiza la cabecera
   **Then** ve un **icono de engranaje** (lucide `Settings`/`Cog`, tap target ≥48px) que **solo** aparece para administradores; un miembro normal **no** ve el engranaje y no puede llegar al panel (la ruta de gestión lo rechaza server-side).

2. **And** al tocar el engranaje accede a un **panel de gestión** (ruta `/standings/manage`) mobile-first (`max-w-md`, tokens Championship Gold) que lista **todos los miembros** de la liga con avatar, nombre, su rol y su **badge de pago** actual. El panel exige sesión (redirige a `/auth/login` si no hay) y exige rol admin en la liga activa (redirige a `/standings` si el usuario no es admin). Sin liga → `EmptyState` igual que `/standings`.

3. **And** el administrador puede **tocar el badge de pago** de cualquier miembro para **alternar** su estado entre `paid` (badge verde `success`, "Pagado") y `pending` (badge rojo `destructive`, "Pendiente"). El cambio se persiste vía Server Action → RPC `SECURITY DEFINER` (`fn_set_member_payment_status`) que valida que el llamante es admin de esa liga; la UI refleja el nuevo estado tras confirmarse (optimista con reconciliación o `router.refresh()`), y un fallo muestra el mensaje *"No pudimos guardar los cambios. Por favor revisa tu conexión e inténtalo de nuevo."* (EXPERIENCE › Error Administrativo) sin dejar la UI en estado inconsistente.

4. **And** el administrador puede **expulsar** a un miembro: al presionar **"Baja"** se abre un **diálogo de confirmación** (`src/components/ui/dialog.tsx`) con el nombre del miembro y la advertencia *"Se anularán de forma permanente todos sus pronósticos y duelos activos. Esta acción no se puede deshacer."*. Al confirmar, una Server Action → RPC `SECURITY DEFINER` (`fn_remove_member`, admin-gated) **elimina** la fila de `league_members` de ese usuario en esa liga; un **trigger SQL** `AFTER DELETE on league_members` (`tr_cleanup_on_member_removed` → `fn_cleanup_on_member_removed`) **elimina sus predicciones** de esa liga (`predictions.league_id = league_id AND user_id = user_id`) y deja el **seam documentado** para cancelar sus duelos 1v1 activos y reembolsar el escrow a los rivales (Epic 5 — tablas `challenges`/`challenge_participants`/`point_transactions` aún no existen). Tras la baja, el miembro desaparece del panel y de la clasificación (`/standings`) inmediatamente.

5. **And** se aplican **guardas de seguridad** del lado servidor (no solo UI): (a) un **no-admin** que invoque cualquiera de los RPCs recibe error de privilegio (`42501`) y no muta nada; (b) un admin **no puede expulsarse a sí mismo** ni dejar la liga sin ningún admin (se rechaza con un error claro); (c) las operaciones son por la **liga del propio admin** (no puede tocar miembros de otra liga); (d) `anon` no puede invocar los RPCs.

6. **And** existen pruebas: **integración DB/RLS** (`tests/integration/`) que validen el toggle de pago por un admin, el rechazo a no-admin/anon, la expulsión por admin con **borrado en cascada de las predicciones** del expulsado, el rechazo de auto-expulsión / quedarse sin admin, y el aislamiento entre ligas; **unit/componente** para el panel de miembros (render de filas, toggle de badge dispara la acción, flujo de confirmación de baja) y para la **visibilidad del engranaje solo-admin**; **page test** de `/standings/manage` (redirect sin sesión, redirect de no-admin, render para admin). `npm run test:unit`, `npm run test:integration`, `npm run lint`, `npm run typecheck` y `npm run build` quedan en verde.

7. **And** se respeta el **alcance**: NO se editan las reglas de la liga (modo de predicción, monto, instrucciones de cobro) en esta historia — eso es del formulario de creación (Story 1.3); NO se implementan duelos/escrow reales (Epic 5, solo seam); NO se persiste `predictions.points_earned` ni cron (Epic 5.3); NO se toca `tests/integration/triggers.test.ts` (reservado Epic 5); el `PaymentStatusBadge` público de `/standings` sigue siendo **solo display** (el toggle vive en el panel admin).

## Tasks / Subtasks

- [x] **Tarea 1 — Migración: helper admin + RPCs de gestión + trigger de cascada** (AC: #3, #4, #5, #6)
  - [x] Crear `supabase/migrations/<timestamp>_member_admin_management.sql` (usar timestamp posterior a `20260604000100`; generar con la convención `YYYYMMDDHHMMSS`).
  - [x] **Helper anti-recursión** `public.fn_user_is_league_admin(p_league_id uuid) returns boolean` `language sql security definer set search_path = '' stable`, espejando `fn_user_in_league` (migración `20260602041455_rls_and_triggers.sql:21`):
    ```sql
    select exists (
      select 1 from public.league_members lm
      where lm.league_id = p_league_id
        and lm.user_id = (select auth.uid())
        and lm.role = 'admin'
    );
    ```
  - [x] **RPC** `public.fn_set_member_payment_status(p_league_id uuid, p_user_id uuid, p_status text) returns public.league_members` `language plpgsql security definer set search_path = ''`:
    - Si `auth.uid()` es null → `raise exception 'No autenticado' using errcode = '42501'`.
    - Si `p_status not in ('pending','paid')` → `raise exception ... using errcode = '22023'`.
    - Si `not public.fn_user_is_league_admin(p_league_id)` → `raise exception 'No autorizado' using errcode = '42501'`.
    - `update public.league_members set payment_status = p_status where league_id = p_league_id and user_id = p_user_id returning * into v_member;` Si no afectó filas (`v_member is null`) → `raise exception 'Miembro no encontrado' using errcode = 'P0002'`.
    - `return v_member;`
  - [x] **RPC** `public.fn_remove_member(p_league_id uuid, p_user_id uuid) returns void` `language plpgsql security definer set search_path = ''`:
    - Auth check (`42501`) + admin check (`42501`) como arriba.
    - **Guarda auto-expulsión:** si `p_user_id = auth.uid()` → `raise exception 'Un admin no puede expulsarse a sí mismo' using errcode = '42501'`.
    - **Guarda último admin:** si el target es admin y es el único admin de la liga, rechazar (`raise ... using errcode = '42501'`). (Una baja normal de un `member` no aplica esta guarda.)
    - `delete from public.league_members where league_id = p_league_id and user_id = p_user_id;` (el trigger `AFTER DELETE` hace la limpieza).
  - [x] **Trigger de cascada** `public.fn_cleanup_on_member_removed() returns trigger` `language plpgsql security definer set search_path = ''` + `create trigger tr_cleanup_on_member_removed after delete on public.league_members for each row execute function public.fn_cleanup_on_member_removed();`:
    - `delete from public.predictions where league_id = OLD.league_id and user_id = OLD.user_id;`
    - **SEAM Epic 5 (documentar con comentario, NO implementar):** aquí irá la cancelación de `challenges`/`challenge_participants` del expulsado en esta liga y el reembolso de `point_transactions` (escrow) a los rivales. Dejar comentario explícito para que Epic 5.x extienda esta función sin reescribir el trigger.
    - `return OLD;`
  - [x] `grant execute on function public.fn_set_member_payment_status(uuid, uuid, text) to authenticated;` y `grant execute on function public.fn_remove_member(uuid, uuid) to authenticated;`. (Los `grant` a `anon` NO se otorgan.)
  - [x] Comentarios `comment on function ...` explicando el porqué del `SECURITY DEFINER` (saltar la ausencia de políticas update/delete en `league_members` + atomicidad + admin-gating), igual estilo que `fn_create_league` (`20260603014645_add_create_league_fn.sql:56`).
  - [x] Activar Node 24 y ejecutar `npx supabase db reset` + `npm run db:types` para regenerar `src/types/database.types.ts` (los nuevos RPCs aparecen en `Database["public"]["Functions"]`).

- [x] **Tarea 2 — Server Actions de administración** (AC: #3, #4, #5)
  - [x] Añadir a `src/app/actions/leagues.actions.ts` (módulo `"use server"` existente):
    - `setMemberPaymentStatus(input: { leagueId: string; userId: string; status: PaymentStatus }): Promise<ServerActionResult<LeagueMember>>` → valida con zod, `supabase.rpc("fn_set_member_payment_status", {...}).single()`, mapea error a `ServerActionResult`, `revalidatePath("/standings")` y `revalidatePath("/standings/manage")` en éxito.
    - `removeMember(input: { leagueId: string; userId: string }): Promise<ServerActionResult<null>>` → valida, `supabase.rpc("fn_remove_member", {...})`, mapea errores (auth/privilegio `42501` → mensaje genérico de no autorizado; resto → mensaje administrativo), revalida ambas rutas.
  - [x] Crear los esquemas zod en `src/app/actions/leagues.schema.ts` (no en el módulo `"use server"`): `setMemberPaymentStatusSchema` (uuid, uuid, enum `['pending','paid']`) y `removeMemberSchema` (uuid, uuid). Exportar los tipos `*Input`.
  - [x] Reutilizar el patrón try/catch + `ServerActionResult` ya presente en `createLeague`/`joinLeagueByInvite`. NUNCA propagar excepciones. Mensaje de error de UI para fallos no-privilegio: usar la copy de EXPERIENCE › Error Administrativo.
  - [x] (Opcional) extraer una constante de mensaje admin a un `leagues.constants.ts` espejando `predictions.constants.ts`.

- [x] **Tarea 3 — Ruta del panel admin `src/app/standings/manage/page.tsx`** (AC: #1, #2)
  - [x] **Server Component** espejando `src/app/standings/page.tsx`: `createClient()` → `auth.getClaims()` → sin sesión `redirect("/auth/login")`. Accesos dinámicos dentro de `<Suspense>` (`cacheComponents: true`).
  - [x] Resolver liga activa igual que `/standings`: `league_members` del usuario, la más reciente por `joined_at`. Sin liga → `EmptyState` (CTA `/leagues/new`).
  - [x] Cargar el registro del usuario en esa liga con `role`. Si `role !== 'admin'` → `redirect("/standings")` (defensa server-side de AC #1/#2).
  - [x] Cargar miembros: `league_members` de la liga con `user_id, role, payment_status, joined_at, profiles(display_name, avatar_url)` (mismo patrón de embed que `standings/page.tsx:61`). Mapear snake_case→camelCase.
  - [x] Renderizar header (eyebrow "PIJA Quiniela" + `<h1>` "Gestión de liga" + chip "ADMIN" con tokens `primary`) y `<MemberAdminList ... currentUserId leagueId />`. Montar `<BottomNavbar />` + `pb-24` como en `/standings`.
  - [x] Incluir `BoardSkeleton`/`EmptyState` locales (duplicación mínima del patrón de `standings/page.tsx`).

- [x] **Tarea 4 — Engranaje admin en la cabecera de Posiciones** (AC: #1)
  - [x] En `src/app/standings/page.tsx` (`StandingsBoard`): añadido `role` al `select` de `league_members`, `isAdmin = currentMember?.role === 'admin'`, y el engranaje se renderiza dentro del board como `Link` a `/standings/manage` visible solo si `isAdmin`, con `aria-label="Gestionar liga"`, icono `Settings`, tap target ≥48px.
  - [x] No se rompió `tests/unit/standings-page.test.tsx`; se añadió `role` al mock y dos casos de visibilidad del engranaje.

- [x] **Tarea 5 — Componentes del panel (cliente)** (AC: #3, #4)
  - [x] `src/components/standings/MemberAdminList.tsx` (`"use client"`): recibe `members: AdminMemberView[]`, `currentUserId`, `leagueId`. Estado local de la lista (para reflejar toggles/bajas) + `useTransition`. Por cada miembro:
    - Avatar + nombre + etiqueta de rol.
    - **Toggle de pago:** `<button>` interactivo con `aria-pressed`/`aria-label`, tap target ≥48px, estética success/destructive, que llama `setMemberPaymentStatus(...)`. Optimista con rollback en error; mensaje admin en fallo.
    - **Baja:** botón con icono `UserMinus` (`destructive`) que abre el diálogo de confirmación.
  - [x] `src/components/standings/ExpelMemberDialog.tsx` (`"use client"`): modal accesible **custom** (overlay controlado, `role="dialog"`, `aria-modal`, Escape, foco en confirmar) — NO se usó `src/components/ui/dialog.tsx` porque **no existe** en el repo y la story prohíbe añadir `@radix-ui/react-dialog`. Título "¿Expulsar miembro?", advertencia de borrado permanente, botones "Cancelar"/"Dar de baja" (`destructive`). Al confirmar `removeMember(...)` con `useTransition`; éxito → quita la fila + `router.refresh()`; error → copy admin sin quitar la fila.
  - [x] El botón "Baja" se oculta para la fila del propio `currentUserId` (la guarda dura vive en el RPC; "último admin" se confía al error del servidor).
  - [x] Accesibilidad: foco gestionado en el modal, `aria-label`s, tap targets ≥48px. Tokens (`bg-card`, `border-border`, `text-destructive`, `bg-success`), sin hex hardcodeado, `shadow-none`.

- [x] **Tarea 6 — Tests** (AC: #6)
  - [x] **Integración** `tests/integration/member-admin-management.test.ts` (helpers de `tests/integration/setup.ts`; patrón `createAuthedUser()`): toggle de pago por admin (pending↔paid), estado inválido (22023), no-admin/anon rechazados, aislamiento entre ligas, expulsión por admin con **cascada de borrado de predicciones** (trigger), no-admin no expulsa, auto-expulsión bloqueada, y guarda de único admin. **9/9 verde**. `triggers.test.ts` intacto.
  - [x] **Unit/componente:**
    - `src/components/standings/MemberAdminList.test.tsx`: render de filas; toggle dispara `setMemberPaymentStatus`; baja abre diálogo y confirma `removeMember`; la fila del propio admin no ofrece "Baja"; error admin revierte el toggle. **5/5 verde**.
    - Cobertura del **engranaje solo-admin** en `tests/unit/standings-page.test.tsx`: gear visible con admin, oculto con member.
  - [x] **Page test** `tests/unit/standings-manage-page.test.tsx`: redirect sin sesión, empty sin liga, redirect de no-admin a `/standings`, render para admin. **4/4 verde**.

- [x] **Tarea 7 — Verificación final** (AC: #6)
  - [x] Node 24+ ya activo en el shell (v26.2.0); CLI vía `npx supabase`.
  - [x] Migración nueva aplicada: `npx supabase db reset` + `npm run db:types` (nuevos RPCs presentes en los tipos).
  - [x] `npm run test:unit` → **162/162**.
  - [x] `npm run test:integration` con Supabase local activo → **52/52** (incluye los 9 nuevos de `member-admin-management`).
  - [x] `npm run lint` (limpio), `npm run typecheck` (limpio), `npm run build` (verde; `/standings/manage` = Partial Prerender).
  - [x] Smoke: el flujo de admin (gating server-side, toggle de pago, expulsión + cascada) está cubierto por integración (RPCs contra Postgres real) y por los page tests de gating/visibilidad del engranaje; el build confirma que ambas rutas compilan. No se ejecutó una sesión de navegador manual en este entorno.

### Review Findings

> Revisión adversarial (Blind Hunter + Edge Case Hunter + Acceptance Auditor) — 2026-06-04. Las 3 capas corrieron sin fallos. Las 7 ACs se cumplen. Triage: 1 decisión, 3 patches, 3 diferidos, 5 descartados como ruido. La desviación documentada del modal custom (sin `ui/dialog.tsx`) se validó como **aceptable** por la restricción "no añadir dependencias".

- [x] [Review][Patch] La expulsión deja huérfanas las filas de `member_badges` y `member_game_profiles` del expulsado — el trigger `fn_cleanup_on_member_removed` solo borra `predictions`. **Decisión (Cris, 2026-06-04): purgar también medallas/perfil** en esa liga para cumplir la "baja permanente" y no dejar datos de un no-miembro. Añadir los dos `delete` al trigger + cobertura en el test de cascada [supabase/migrations/20260604120000_member_admin_management.sql]
- [x] [Review][Patch] Estado derivado de props sin reconciliar: `MemberAdminList` siembra `useState(members)` una sola vez y `router.refresh()` no re-sincroniza la lista con la verdad del servidor (desync ante cambios concurrentes; un toggle sobre una fila ya eliminada por otro admin devuelve `P0002` → mensaje genérico engañoso) [src/components/standings/MemberAdminList.tsx]
- [x] [Review][Patch] Guarda de "último admin" no es segura ante concurrencia: el `count(*) admin` + `delete` es read-then-write sin bloqueo → dos admins expulsándose mutuamente en paralelo pueden dejar la liga con 0 admins (viola el invariante de AC #5b). Añadir `for update` sobre las filas admin de la liga antes de contar [supabase/migrations/20260604120000_member_admin_management.sql]
- [x] [Review][Patch] El test "no se puede dar de baja al único admin" en realidad ejercita la guarda de auto-expulsión (target = caller), no la rama `v_admin_count <= 1`; clarificar/reforzar para cubrir el invariante real (la liga conserva ≥1 admin) [tests/integration/member-admin-management.test.ts]
- [x] [Review][Defer] Admin de una liga que NO es su membresía más reciente no puede gestionarla (sin selector multi-liga) [src/app/standings/manage/page.tsx] — deferred, pre-existing: mismo patrón de "liga más reciente" que `/standings` y `/predictions`; el selector multi-liga es trabajo futuro de toda la app.
- [x] [Review][Defer] Fidelidad de mensajes de error: `P0002` (miembro no encontrado), auto-expulsión y único-admin colapsan a mensajes genéricos (`ADMIN_SAVE_ERROR` / `ADMIN_NOT_AUTHORIZED_ERROR`) [src/app/actions/leagues.actions.ts] — deferred, polish de UX de bajo impacto; las guardas funcionan, solo el copy es genérico.
- [x] [Review][Defer] `isPending` compartido acopla el toggle de pago y el diálogo de baja (una operación en vuelo deshabilita la otra) [src/components/standings/MemberAdminList.tsx] — deferred, tradeoff aceptable a esta escala móvil; separar transiciones es polish.

> **Ronda 2 (re-review enfocado en los 4 patches) — 2026-06-04.** Capa adversarial sobre el delta. Patches 1, 2 y 4 confirmados sólidos. 1 MED corregido + 2 LOW diferidos.

- [x] [Review][Patch] El `useEffect([members])` de reconciliación podía pisar el estado optimista en vuelo: la página reconstruye `members` con `.map()` en cada render (identidad nueva siempre), así que un re-render concurrente durante la transición disparaba `setRows(members)` revirtiendo el optimismo — **corregido** gateando en `!isPending` [src/components/standings/MemberAdminList.tsx]
- [x] [Review][Patch] Test de cascada: faltaba afirmar que el perfil de juego de OTRO miembro queda intacto — **corregido** añadiendo la aserción `otherProfiles` [tests/integration/member-admin-management.test.ts]
- [x] [Review][Defer] `FOR UPDATE` sobre filas admin no serializa contra un futuro flujo de promote-to-admin / cambio de rol (hoy inexistente) [supabase/migrations/20260604120000_member_admin_management.sql] — deferred: documentado como supuesto; revisar el bloqueo cuando Epic futuro añada promoción de admins.
- [x] [Review][Defer] El test de "último admin" valida el invariante (≥1 admin) pero no ejercita la rama concurrente `count<=1`+`FOR UPDATE` (requiere un test de dos transacciones) [tests/integration/member-admin-management.test.ts] — deferred: la carrera es difícil de provocar en integración; el invariante secuencial sí queda cubierto.

## Dev Notes

### Toolchain de Node (CRÍTICO — leer primero)
El Node del shell por defecto es **v12** (incompatible). Activa **Node 24 con nvm** antes de cualquier comando: `source ~/.nvm/nvm.sh && nvm use 24`. Invoca la CLI de Supabase **siempre vía `npx supabase ...`**. El stack local corre en `http://127.0.0.1:54321`. [Source: memoria del proyecto `node-version-toolchain`; 3-1 Dev Notes; 3-2 Dev Notes]

### Estado actual heredado (Stories 1.2–3.2 DONE) — construir sobre esto, no romperlo
- **Esquema:** `league_members(id, league_id, user_id, role['admin'|'member'], payment_status['pending'|'paid'], joined_at)` con `unique(league_id,user_id)` y `on delete cascade` hacia `leagues`/`profiles`. [Source: supabase/migrations/20260602041410_init_schema.sql:43]
- **RLS de `league_members` (CLAVE):** hoy SOLO existen políticas de **insert** (`league_members_insert_self`, fuerza `role='member'`) y **select** (`league_members_select_same_league`). **NO hay políticas de UPDATE ni DELETE** → con RLS activo, cualquier update/delete desde un cliente autenticado está **denegado por defecto**. Por eso esta historia usa **RPCs `SECURITY DEFINER`** (que evalúan SIN RLS) con admin-gating interno, en lugar de añadir políticas update/delete. Este es el patrón establecido del repo (`fn_create_league`, `fn_join_league_by_invite`, `fn_save_prediction`). [Source: supabase/migrations/20260602041455_rls_and_triggers.sql:90; 20260603014645_add_create_league_fn.sql]
- **El admin es el creador:** `fn_create_league` inserta al creador como `role='admin'`. El marcador canónico de admin es `league_members.role='admin'` (no `leagues.created_by`, aunque coincidan hoy). Usa el rol. [Source: supabase/migrations/20260603014645_add_create_league_fn.sql:49]
- **`/standings`** ya resuelve la liga activa (membresía más reciente por `joined_at`), embebe `profiles(display_name, avatar_url)` y calcula la tabla on-the-fly. Copia ese patrón para `/standings/manage`. [Source: src/app/standings/page.tsx]
- **`PaymentStatusBadge`** es **solo display** (no interactivo) y su comentario ya anticipa que el toggle es Story 3.3. NO lo conviertas en interactivo: crea un control interactivo aparte en el panel admin. [Source: src/components/standings/PaymentStatusBadge.tsx:5]
- **`BottomNavbar`** ya tiene `/standings` y `/account` activos; no lo modifiques salvo necesidad. [Source: src/components/layout/BottomNavbar.tsx]
- **Tipos de dominio** en `src/types/index.ts`: usa `LeagueMember`, `PaymentStatus`, `LeagueRole`, `ServerActionResult`. No redefinas; importa de `@/types`. [Source: src/types/index.ts]

### Por qué RPC + trigger (no RLS update/delete suelto)
El AC #4 exige explícitamente *"un trigger SQL elimina sus predicciones locales y cancela en cascada sus retos 1v1 activos devolviendo los puntos de escrow"*. La cascada es intrínsecamente multi-paso y atómica → un **trigger `AFTER DELETE on league_members`** es la forma canónica (y la arquitectura lo nombra "Cascada de Expulsión en Postgres"). La eliminación de la fila la dispara un **RPC admin-gated** (`fn_remove_member`). El toggle de pago va por **RPC** por simetría y para centralizar el admin-check server-side (no confiar en el cliente). [Source: architecture.md#Authentication & Security "Cascada de Expulsión"; epics.md Story 3.3 AC]

### Cascada: qué borra el trigger y qué NO (seam Epic 5)
`predictions` referencia `profiles(id)` y `leagues(id)`, **NO** `league_members` → borrar una fila de `league_members` **no** propaga a `predictions` por FK. El trigger debe borrar **explícitamente** `predictions where league_id = OLD.league_id and user_id = OLD.user_id`. Las tablas de duelos (`challenges`, `challenge_participants`, `point_transactions`) **no existen todavía** (Epic 5). Deja un **comentario-seam** claro en `fn_cleanup_on_member_removed` para que Epic 5.x añada ahí la cancelación de duelos + reembolso de escrow sin reescribir el trigger. NO crees esas tablas ni lógica de escrow en esta historia. [Source: supabase/migrations/20260603144628_matches_and_predictions.sql:41; epics.md Epic 5]

### Guardas de seguridad obligatorias (server-side, AC #5)
- **Admin-gating** en TODOS los RPCs vía `fn_user_is_league_admin(league_id)` (no confiar en que la UI oculte botones).
- **Auto-expulsión bloqueada:** un admin no puede borrarse a sí mismo (dejaría la liga potencialmente huérfana y rompe la sesión). 
- **Último admin protegido:** no permitir quedarse sin ningún admin.
- **Aislamiento por liga:** las mutaciones operan solo sobre `p_league_id` y el admin-check es sobre esa misma liga.
- Códigos de error coherentes con el repo: `42501` (no autorizado/no autenticado), `22023` (input inválido), `P0002` (no encontrado). Las Server Actions traducen estos a `ServerActionResult` con mensajes amables; el detalle de privilegio NO se filtra como mensaje técnico al usuario. [Source: src/app/actions/leagues.actions.ts; src/app/actions/predictions.actions.ts]

### `cacheComponents` / Suspense (Next 16)
`next.config.ts` tiene `cacheComponents: true`. Las lecturas dinámicas de cookies/auth en Server Components deben vivir dentro de `<Suspense>`, igual que `/standings`, `/account` y `/predictions`. La nueva ruta `/standings/manage` debe seguir ese patrón o el prerender estático falla con "Uncached data accessed outside <Suspense>". [Source: src/app/standings/page.tsx:186; src/app/leagues/new/page.tsx]

### Revalidación tras mutaciones
Tras `setMemberPaymentStatus`/`removeMember`, revalida `/standings` y `/standings/manage` (`revalidatePath`) para que el badge público y la tabla reflejen el cambio. En cliente, complementar con `router.refresh()` tras la baja para refrescar la lista del panel. [Source: patrón Next App Router; src/app/actions/*]

### UI/UX (Championship Gold) — reglas duras
- Mobile-first `max-w-md`, paleta Championship Gold de `globals.css`, **sin** light mode, **sin** hex hardcodeado: usa clases de token (`bg-card`, `border-border`, `text-accent`, `bg-success`, `text-success-foreground`, `bg-destructive`/`text-destructive`, `text-muted-foreground`).
- **Verde (`success`) solo afirmativo** ("Pagado"); **carmesí (`destructive`/`primary`) para pendiente y acciones destructivas** (Baja/Expulsar). Dorado (`accent`) solo para títulos/acentos. [Source: DESIGN.md#do/dont; 3-1/3-2 Dev Notes]
- Chip "ADMIN" con realce `primary` (fondo translúcido + borde), como en el mockup. [Source: mockup admin-settings.html:67]
- Iconos **lucide-react** ya en uso (`Settings`/`Cog`, `Trash2`/`UserMinus`, `X`); NO añadir librerías de iconos.
- Tap targets ≥48px (UX-DR-10). Evitar sombras nuevas (el `Card` base trae `shadow`; si se usa, `shadow-none`).
- Componentes UI base disponibles: `dialog.tsx`, `button.tsx`, `card.tsx`, `badge.tsx`, `switch.tsx`, `dropdown-menu.tsx` (Radix). Reutilízalos antes de crear nuevos. [Source: src/components/ui/]
- El mockup muestra el toggle de pago **tocando el badge** del miembro (no un switch separado por miembro); el switch grande del mockup es el global "Requiere Pago" que pertenece a Story 1.3, **fuera de alcance** aquí. [Source: mockup admin-settings.html:431-462; EXPERIENCE.md:54-55]

### Convenciones obligatorias
- **DB:** `snake_case` plural; funciones `fn_`, triggers `tr_`; `SECURITY DEFINER` + `set search_path = ''` + referencias fully-qualified. [Source: architecture.md#Naming Patterns; migraciones existentes]
- **Código:** componentes `PascalCase` (`MemberAdminList.tsx`, `ExpelMemberDialog.tsx`); funciones/variables `camelCase`; rutas `kebab-case` (`/standings/manage`). [Source: architecture.md#Code/API Naming]
- **Server Actions:** retornar SIEMPRE `ServerActionResult<T>`; try/catch; nunca propagar excepciones. [Source: architecture.md#Format/Error Handling; src/types/index.ts:92]
- **Tests de integración:** helpers `createServiceRoleClient/createAnonClient/createAuthedClient` (`tests/integration/setup.ts`) y patrón `createAuthedUser()` (copiar de `standings-read.test.ts`). Entorno desde `.env.test.local` (`npx supabase status -o env`). [Source: tests/integration/setup.ts; tests/integration/standings-read.test.ts:33]
- **Tests de componente:** Vitest proyecto `unit` (jsdom + Testing Library), espejar `StandingsTable.test.tsx`/`MatchCard.test.tsx`. [Source: vitest.config.ts; src/components/standings/StandingsTable.test.tsx]

### Alcance — NO hacer
- **NO** editar reglas de liga (modo de predicción, monto, instrucciones de cobro) post-creación → eso es Story 1.3 (`LeagueCreateForm`); aquí solo gestión de miembros.
- **NO** implementar duelos/escrow reales (Epic 5) — solo el seam comentado en el trigger.
- **NO** persistir `predictions.points_earned` ni cron/sync (Epic 5.3).
- **NO** convertir `PaymentStatusBadge` (display público en `/standings`) en interactivo.
- **NO** añadir políticas RLS update/delete a `league_members` (se usa RPC `SECURITY DEFINER`); si por diseño se prefiriera RLS, ver "Preguntas para Cris".
- **NO** tocar `tests/integration/triggers.test.ts` (reservado Epic 5).
- **NO** añadir librerías nuevas (iconos, modales): Radix `dialog` y lucide ya están.

### Project Structure Notes

Archivos **NUEVOS** esperados:
- `supabase/migrations/<timestamp>_member_admin_management.sql`
- `src/app/standings/manage/page.tsx`
- `src/components/standings/MemberAdminList.tsx`
- `src/components/standings/MemberAdminList.test.tsx`
- `src/components/standings/ExpelMemberDialog.tsx` (o inline en MemberAdminList si resulta más simple y testeable)
- `tests/integration/member-admin-management.test.ts`
- `tests/unit/standings-manage-page.test.tsx`

Archivos **MODIFICADOS** esperados:
- `src/app/actions/leagues.actions.ts` (añadir `setMemberPaymentStatus`, `removeMember`)
- `src/app/actions/leagues.schema.ts` (añadir esquemas zod)
- `src/app/standings/page.tsx` (añadir `role` al select; gear admin-only en el board)
- `src/types/database.types.ts` (regenerado por `npm run db:types`)
- `tests/unit/standings-page.test.tsx` (ajustar mock del select si incluye `role`)
- (opcional) `src/app/actions/leagues.constants.ts` (mensaje admin)

Todo alineado con el árbol de la arquitectura (`standings/`, `components/standings/`, `app/actions/leagues.actions.ts`, `supabase/migrations/`). Sin conflictos con 1.1–3.2.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3: Panel Rápido de Administración y Control de Pagos]
- [Source: _bmad-output/planning-artifacts/epics.md#FR-5 / FR-6 / UX-DR-6 / UX-DR-10]
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security (Cascada de Expulsión en Postgres)]
- [Source: _bmad-output/planning-artifacts/architecture.md#Complete Project Directory Structure / #Naming Patterns / #Format Patterns]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/EXPERIENCE.md (Ajustes de Liga Admin; paid/unpaid badge toggle; Error Administrativo)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/mockups/admin-settings.html (member list, payment badge toggle, confirm modal de baja)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/DESIGN.md (tokens, do/dont de color)]
- [Source: _bmad-output/implementation-artifacts/3-1-tabla-de-posiciones-clasica-acumulada-y-filtro-por-jornada.md (patrón de página, badge solo-display, scope 3.3)]
- [Source: _bmad-output/implementation-artifacts/3-2-insignias-humoristicas-y-perfiles-psicologicos-de-juego.md (patrón RPC/RLS, Suspense, toolchain)]
- [Source: supabase/migrations/20260602041410_init_schema.sql (league_members: role, payment_status, joined_at)]
- [Source: supabase/migrations/20260602041455_rls_and_triggers.sql (fn_user_in_league; RLS league_members SOLO insert/select)]
- [Source: supabase/migrations/20260603014645_add_create_league_fn.sql (patrón RPC SECURITY DEFINER admin)]
- [Source: supabase/migrations/20260603015457_add_join_league_by_invite_fn.sql (patrón RPC + errcodes)]
- [Source: supabase/migrations/20260603144628_matches_and_predictions.sql (predictions FK → profiles/leagues, no league_members)]
- [Source: supabase/migrations/20260603144630_predictions_rls.sql (trigger updated_at; protección de columnas)]
- [Source: src/app/standings/page.tsx (resolución de liga, embed profiles, Suspense, BottomNavbar)]
- [Source: src/components/standings/PaymentStatusBadge.tsx (display público; toggle es 3.3)]
- [Source: src/app/actions/leagues.actions.ts; src/app/actions/leagues.schema.ts (patrón Server Action + zod + ServerActionResult)]
- [Source: src/components/ui/dialog.tsx (modal de confirmación)]
- [Source: tests/integration/setup.ts; tests/integration/standings-read.test.ts (helpers + createAuthedUser)]
- [Source: src/types/index.ts (LeagueMember, PaymentStatus, LeagueRole, ServerActionResult)]

## Preguntas para Cris

1. **RPC vs RLS para gestión de miembros.** Implementé el toggle de pago y la expulsión con **RPCs `SECURITY DEFINER` admin-gated** (consistente con `fn_create_league`/`fn_join_league_by_invite`, y porque `league_members` no tiene políticas update/delete). La alternativa sería añadir políticas RLS de update/delete para admins. ¿Confirmas el enfoque RPC?
2. **Edición de reglas de liga en el panel.** El mockup de "Ajustes de Liga" incluye también editar modo de predicción, monto e instrucciones de cobro. Esos campos se crean en Story 1.3 (alta de liga). Dejé su **edición post-creación fuera de alcance** de 3.3 (solo gestión de miembros). ¿Lo dejamos así o quieres la edición de reglas aquí?
3. **Guarda de "último admin".** Bloqueo que un admin se expulse a sí mismo y que la liga quede sin admin. ¿Quieres además permitir **transferir el rol admin** a otro miembro (promover a admin) en esta historia, o lo dejamos para una futura?
4. **Seam de duelos en el trigger.** La cancelación de duelos 1v1 + reembolso de escrow al expulsar queda como **seam documentado** (Epic 5 aún no tiene esas tablas). El trigger hoy solo borra predicciones del expulsado. ¿OK para MVP?

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Opus 4.8)

### Debug Log References

- `npx supabase db reset`: aplica `20260604120000_member_admin_management.sql` correctamente (10 migraciones en orden).
- `npm run db:types`: regenera `src/types/database.types.ts`; aparecen `fn_user_is_league_admin`, `fn_set_member_payment_status`, `fn_remove_member`.
- `npm run test:integration -- tests/integration/member-admin-management.test.ts`: **9/9 verde** (toggle pago, 22023, no-admin/anon 42501, aislamiento, expulsión + cascada de predicciones, auto-expulsión 42501, único admin 42501).
- `npm run test:unit -- src/components/standings/MemberAdminList.test.tsx`: **5/5 verde** (tras acotar el botón de confirmar al `within(dialog)` por colisión de texto "Dar de baja").
- `npm run test:unit -- tests/unit/standings-page.test.tsx`: **6/6 verde** (incluye gear visible/oculto por rol).
- `npm run test:unit -- tests/unit/standings-manage-page.test.tsx`: **4/4 verde** (redirect sin sesión, empty sin liga, redirect no-admin, render admin).
- `npm run test:unit`: **162/162**. (Un primer run completo en frío reportó 8 fallos transitorios por contención del transform a 32 s; re-ejecutado en caliente quedó estable 162/162 de forma reproducible.)
- `npm run test:integration`: **52/52**. `tests/integration/triggers.test.ts` intacto.
- `npm run lint`: verde (tras quitar import `beforeEach` no usado en el test de integración).
- `npm run typecheck`: verde.
- `npm run build`: verde; `/standings` y `/standings/manage` compilan como Partial Prerender.

### Completion Notes List

- **Tarea 1** — Migración `member_admin_management.sql`: `fn_user_is_league_admin` (helper admin anti-recursión), `fn_set_member_payment_status` y `fn_remove_member` (RPCs SECURITY DEFINER admin-gated, errcodes 42501/22023/P0002, guardas de auto-expulsión y único admin), y trigger `tr_cleanup_on_member_removed` que borra las predicciones del expulsado en esa liga (seam comentado para duelos/escrow de Epic 5). Grants solo a `authenticated`.
- **Tarea 2** — `setMemberPaymentStatus` y `removeMember` en `leagues.actions.ts` (patrón `ServerActionResult`, try/catch, `revalidatePath` de `/standings` y `/standings/manage`); esquemas zod en `leagues.schema.ts`; mensajes en `leagues.constants.ts` (copy admin de EXPERIENCE + mensaje de no autorizado).
- **Tarea 3** — Ruta `/standings/manage`: Server Component bajo `<Suspense>`, sesión obligatoria, liga activa, **gating server-side de admin** (redirect a `/standings` si no es admin), empty state sin liga, render de `MemberAdminList`. Header con chip "ADMIN" + `BottomNavbar`.
- **Tarea 4** — Engranaje admin-only en `StandingsBoard`: `role` añadido al select, `isAdmin` calculado, `Link` a `/standings/manage` con `Settings` solo para admin.
- **Tarea 5** — `MemberAdminList` (toggle de pago optimista con rollback + baja con confirmación, `useTransition`, `router.refresh`, "Baja" oculta en la propia fila) y `ExpelMemberDialog` (modal accesible custom; **no** se usó `ui/dialog.tsx` porque no existe y la story prohíbe nuevas dependencias).
- **Tarea 6** — Cobertura: integración RPC/cascada (9), componente (5), page gating (4) + gear visibility (2 en standings-page). `triggers.test.ts` no tocado.
- **Tarea 7** — Verificación final completa en verde (unit, integración, lint, typecheck, build).
- **Desviación documentada vs story-context**: la story asumió `src/components/ui/dialog.tsx`; ese archivo no existe en el repo y no hay `@radix-ui/react-dialog`. Se implementó un modal de confirmación custom accesible sin añadir dependencias.
- **Alcance respetado**: NO edición de reglas de liga (Story 1.3); NO duelos/escrow reales (Epic 5, solo seam); NO `points_earned`/cron (Epic 5.3); `PaymentStatusBadge` público sigue solo-display; sin librerías nuevas.

### File List

**Código (nuevo):**
- `supabase/migrations/20260604120000_member_admin_management.sql`
- `src/app/actions/leagues.constants.ts`
- `src/app/standings/manage/page.tsx`
- `src/components/standings/MemberAdminList.tsx`
- `src/components/standings/MemberAdminList.test.tsx`
- `src/components/standings/ExpelMemberDialog.tsx`
- `tests/integration/member-admin-management.test.ts`
- `tests/unit/standings-manage-page.test.tsx`

**Código (modificado):**
- `src/app/actions/leagues.actions.ts` (acciones `setMemberPaymentStatus`, `removeMember`)
- `src/app/actions/leagues.schema.ts` (esquemas zod admin)
- `src/app/standings/page.tsx` (`role` en select + engranaje admin-only)
- `src/types/database.types.ts` (regenerado)
- `tests/unit/standings-page.test.tsx` (mock con `role` + cobertura del engranaje)

## Change Log

| Fecha       | Versión | Descripción                                                                                          | Autor |
| ----------- | ------- | ---------------------------------------------------------------------------------------------------- | ----- |
| 2026-06-04  | 0.1     | Story context creada para el panel rápido de administración (toggle de pago + expulsión con cascada). | BMad Create-Story |
| 2026-06-04  | 1.0     | Implementado panel admin `/standings/manage`, RPCs SECURITY DEFINER + trigger de cascada, toggle de pago y expulsión, engranaje admin-only, y cobertura unit/componente/página/integración. Verificación final en verde. Story lista para review. | Amelia (Dev) |
| 2026-06-04  | 1.1     | Code review adversarial (3 capas): 4 patches aplicados — trigger purga también medallas/perfil del expulsado (decisión de producto), reconciliación de estado con props tras refresh, `FOR UPDATE` en la guarda de último admin (carrera concurrente), y test de cascada/único-admin reforzado. 3 diferidos registrados. Verificación re-corrida en verde. Story cerrada en `done`. | Code Review |
| 2026-06-04  | 1.2     | Re-review enfocado en el delta (1 capa): patches 1/2/4 confirmados sólidos. Corregido 1 MED — el `useEffect` de reconciliación podía pisar estado optimista (gate `!isPending`) — y añadida aserción `otherProfiles` al test. 2 LOW diferidos. Unit 162/162, integración 9/9, lint/typecheck/build en verde. Sigue en `done`. | Code Review |

## Completion Note

Ultimate context engine analysis completed - comprehensive developer guide created.

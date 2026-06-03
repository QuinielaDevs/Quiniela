---
baseline_commit: ed6ff778e3609523ba07eba0a44fd19123e0108b
---

# Story 1.4: Enlaces de Invitación Inteligentes y Registro Express (Smart Deep-Linking)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **usuario invitado**,
I want **abrir un enlace de invitación a una liga, ver sus detalles y registrarme con Google en un solo toque**,
so that **unirme al torneo sin copiar códigos, sin pasos redundantes y viendo desde el primer contacto las condiciones de pago si aplican**.

## Acceptance Criteria

1. **Given** un usuario que abre `/join/[invite_code]`
   **When** el código corresponde a una liga existente
   **Then** la landing renderiza nombre de liga, nombre/avatar del creador si existe, estado de pago requerido, monto e instrucciones de cobro si aplica, usando la estética **Championship Gold** (`#0D1B2A`, Outfit, mobile-first `max-w-md`).

2. **And** si el `invite_code` no existe, la ruta muestra un estado de error mobile-first con copy claro y sin filtrar datos internos ni romper el render SSR.

3. **And** si el visitante no está autenticado, la landing ofrece **"Continuar con Google"** y preserva el destino `/join/[invite_code]` durante el flujo OAuth SSR, usando el callback actual `src/app/auth/callback/route.ts` y su parámetro `next`.

4. **And** tras autenticarse, el sistema une automáticamente al usuario a la liga como `role = 'member'` y `payment_status = 'pending'`, de forma idempotente: abrir el mismo enlace más de una vez no crea membresías duplicadas ni muestra fallo por `unique (league_id, user_id)`.

5. **And** si el usuario ya está autenticado al abrir `/join/[invite_code]`, puede unirse directamente desde la landing sin pasar por login.

6. **And** al completarse la adhesión, el usuario es redirigido a la pantalla principal autenticada de la liga con feedback de éxito: *"¡Te has unido con éxito! Ya puedes registrar tus pronósticos."*

7. **And** el flujo respeta RLS y no permite auto-promoción: el usuario invitado solo puede insertarse como `member`; no puede elegir `role`, `payment_status`, `league_id` arbitrario ni unirse usando un código inexistente.

8. **And** se agregan pruebas de integración para la función/RPC de unión e, idealmente, una prueba E2E o de componente que cubra la landing `/join/[invite_code]` con código válido e inválido.

## Tasks / Subtasks

- [x] **Tarea 1 - Asegurar precondiciones de Story 1.3** (AC: #1, #4, #6)
  - [x] Confirmar que `leagues.invite_code` se genera desde el flujo de creación de liga de Story 1.3 y que `fn_create_league`/`createLeague` ya existen si esta story se implementa después de 1.3.
  - [x] Si 1.3 no está implementada todavía, no recrear su formulario ni sus componentes; limitarse a consumir la tabla `leagues` existente y crear fixtures de test con `service_role`.
  - [x] Verificar que `src/types/database.types.ts` está actualizado tras cualquier RPC nueva (`npm run db:types`).

- [x] **Tarea 2 - RPC idempotente para unirse por invitación** (AC: #4, #7, #8)
  - [x] Crear migración `npx supabase migration new add_join_league_by_invite_fn`.
  - [x] Implementar `public.fn_join_league_by_invite(p_invite_code text) returns public.league_members` con `language plpgsql`, `security definer`, `set search_path = ''`.
  - [x] Dentro de la función: validar `auth.uid()` no nulo (`42501`), buscar la liga por `invite_code`, lanzar error controlado si no existe, insertar en `public.league_members` con `role = 'member'` y `payment_status = 'pending'`.
  - [x] Hacer la función idempotente con `on conflict (league_id, user_id) do update set user_id = excluded.user_id returning *` o `do nothing` seguido de `select`; no debe generar error si el usuario ya era miembro.
  - [x] `grant execute on function public.fn_join_league_by_invite(text) to authenticated;`
  - [x] No añadir política amplia de insert que permita roles arbitrarios; la política actual `league_members_insert_self` ya limita `role = 'member'`, pero la RPC debe ser la ruta principal de alta por invitación.

- [x] **Tarea 3 - Server Action `joinLeagueByInvite`** (AC: #2, #4, #5, #6, #7)
  - [x] En `src/app/actions/leagues.actions.ts`, añadir o extender `"use server"` con `joinLeagueByInvite(inviteCode): Promise<ServerActionResult<LeagueMember>>`.
  - [x] Usar `const supabase = await createClient()` de `src/utils/supabase/server.ts`.
  - [x] Validar formato básico del código en servidor: trim, uppercase si el generador de Story 1.3 normaliza así, longitud razonable, caracteres permitidos del alfabeto sin ambiguos.
  - [x] Llamar `supabase.rpc("fn_join_league_by_invite", { p_invite_code: inviteCode })`.
  - [x] Retornar siempre `ServerActionResult<T>`; no lanzar excepciones al cliente. Mapear "no autenticado" a mensaje de UI y "código inválido" a estado de landing.
  - [x] Si `src/types/index.ts` aún no tiene `ServerActionResult`, `PredictionMode` o `LeagueRules`, añadirlos allí (tal como pide Story 1.3) en vez de duplicarlos.

- [x] **Tarea 4 - Landing SSR `/join/[invite_code]`** (AC: #1, #2, #3, #5, #6)
  - [x] Crear `src/app/join/[invite_code]/page.tsx`.
  - [x] Leer `params.invite_code`, consultar la liga por `invite_code` con `created_by`, `requires_payment`, `payment_amount`, `payment_instructions`, `profiles(display_name, avatar_url)` si el join de Supabase lo permite bajo RLS.
  - [x] Si la liga existe pero el usuario no es miembro, considerar que RLS puede impedir leerla desde cliente autenticado/anon. Si ocurre, usar una RPC segura de lectura pública mínima (`fn_get_invite_landing(p_invite_code)`) que devuelva solo datos de bienvenida permitidos: nombre de liga, creador display/avatar, pago requerido, monto e instrucciones. No exponer emails.
  - [x] Renderizar con `max-w-md`, dark-mode-first, fondo Indigo `#0D1B2A`, tarjetas Navy `#1B263B`, títulos Outfit y CTA táctil mínimo `48px`.
  - [x] Para no autenticados, renderizar `GoogleSignInButton` con `next={`/join/${inviteCode}`}`. Reutilizar el botón existente; no crear otro flujo OAuth paralelo.
  - [x] Para autenticados, renderizar CTA "Unirme a la liga" que invoque un client component pequeño o una server action desde un formulario.
  - [x] En éxito, redirigir a la ruta principal de liga. Si todavía no existe dashboard por liga, usar `/protected?joined=1&league=<id>` como fallback documentado y preparar el copy de éxito.

- [x] **Tarea 5 - Preservar deep-link en Auth** (AC: #3, #6)
  - [x] Revisar `src/components/google-signin-button.tsx`: ya acepta `next` y construye `redirectTo = /auth/callback?next=...`; reutilizarlo.
  - [x] Revisar `src/app/auth/callback/route.ts`: ya intercambia el `code` con `exchangeCodeForSession` y redirige a `next`; mantener el prefijo `${origin}` para evitar open redirect.
  - [x] Si el login por email/password se mantiene visible, actualizar `LoginForm` para aceptar o leer `next` desde search params y empujar a esa ruta tras `signInWithPassword`; esta story se centra en Google, pero no debe romper el destino si el usuario usa email.
  - [x] Evitar localStorage para el invite como mecanismo principal. El `next` en OAuth + landing idempotente cubre SSR y refreshes; si se usa cookie, debe ser corta, httpOnly si se escribe desde servidor y solo para fallback.

- [x] **Tarea 6 - OpenGraph básico para WhatsApp/Telegram** (AC: #1)
  - [x] Añadir `generateMetadata` en `src/app/join/[invite_code]/page.tsx`.
  - [x] Construir `title` y `description` con nombre de liga/creador si el invite existe, sin datos sensibles.
  - [x] Añadir `openGraph` con título, descripción y URL canónica `/join/[invite_code]`. Imagen dinámica puede diferirse si no existe infraestructura de OG image, pero dejar metadata textual funcionando.
  - [x] Para invite inválido, usar metadata genérica de PIJA Quiniela sin confirmar existencia de códigos cercanos.

- [x] **Tarea 7 - Pruebas** (AC: #2, #4, #7, #8)
  - [x] Integración `tests/integration/join-league-by-invite.test.ts`: crear usuario/liga con `service_role`, autenticar con `createAuthedClient`, llamar `rpc("fn_join_league_by_invite")`, assert miembro `role = 'member'`, `payment_status = 'pending'`.
  - [x] Test de idempotencia: llamar dos veces con el mismo usuario/código y assert que hay una sola fila en `league_members`.
  - [x] Test de código inválido: assert error controlado y cero filas nuevas.
  - [x] Test de anónimo: `anon.rpc(...)` falla con `42501`.
  - [x] Test anti-promoción indirecta: la RPC no acepta `role`; intentar insert directo `role='admin'` sigue fallando por RLS (puede reutilizar cobertura de Story 1.2).
  - [x] E2E o component test: `/join/<code>` muestra nombre de liga y CTA Google; `/join/nope` muestra estado inválido. Si OAuth real no tiene credenciales locales, no automatizar Google completo.
  - [x] Ejecutar `npm run test:integration`, `npm run test:unit`, `npm run lint`, `npm run typecheck`; `npm run test:e2e` si la prueba E2E fue agregada.

### Review Findings

- [x] [Review][Patch] Sanitizar `next` antes de pasarlo a `router.push` y OAuth [src/app/auth/login/page.tsx:10]
- [x] [Review][Patch] Ejecutar la adhesión automáticamente al volver autenticado desde OAuth [src/app/join/[invite_code]/page.tsx:114]
- [x] [Review][Patch] Mostrar el feedback de éxito requerido en la pantalla autenticada [src/app/protected/page.tsx:19]
- [x] [Review][Patch] Evitar que `next/image` rompa con avatares remotos de Google/Supabase [src/components/join/JoinLeagueCard.tsx:70]
- [x] [Review][Patch] Mapear errores de `joinLeagueByInvite` a mensajes seguros de UI [src/app/actions/leagues.actions.ts:125]
- [x] [Review][Patch] Cubrir el flujo autenticado de join y redirección en tests [tests/unit/join-page.test.tsx:27]

## Dev Notes

### Dependencia crítica de Story 1.3
Story 1.4 consume `invite_code` generado por el flujo de creación de liga. En `sprint-status.yaml`, Story 1.3 está `ready-for-dev`, no `done`; si el dev ejecuta 1.4 antes de 1.3, debe usar fixtures directos en DB para tests y no implementar el formulario de creación. La landing debe funcionar con filas existentes en `leagues`, pero la generación real del código pertenece a 1.3. [Source: `_bmad-output/implementation-artifacts/sprint-status.yaml`; `_bmad-output/implementation-artifacts/1-3-formulario-de-creacion-y-configuracion-de-liga-admin.md`]

### Inteligencia de historias previas
- **Story 1.2 ya creó el esquema base**: `leagues.invite_code text not null unique`, `requires_payment`, `payment_amount`, `payment_instructions`, `rules`, y `league_members` con `unique (league_id, user_id)`. No volver a migrar esas columnas. [Source: `supabase/migrations/20260602041410_init_schema.sql`]
- **RLS actual**: `league_members_insert_self` permite insertarse solo si `user_id = auth.uid()` y `role = 'member'`; esto evita auto-promoción. Mantener ese guardrail. [Source: `supabase/migrations/20260602041455_rls_and_triggers.sql`]
- **Anti-recursión**: `fn_user_in_league(uuid)` existe como helper `SECURITY DEFINER` para políticas que consultan membresía sin recursión RLS. Reutilizar el patrón si se añade una RPC pública mínima de landing. [Source: `supabase/migrations/20260602041455_rls_and_triggers.sql`]
- **OAuth actual**: `GoogleSignInButton` acepta `next`, llama `signInWithOAuth({ provider: "google", options: { redirectTo } })`, y `src/app/auth/callback/route.ts` intercambia el código por cookies SSR con `exchangeCodeForSession`. [Source: `src/components/google-signin-button.tsx`; `src/app/auth/callback/route.ts`]
- **Review de 1.2**: se descartó open redirect en callback porque se redirige con `${origin}${next}`; aun así no cambiar a `NextResponse.redirect(next)` crudo. [Source: `_bmad-output/implementation-artifacts/1-2-esquema-relacional-de-base-de-datos-y-autenticacion-google-oauth.md#Review Findings`]

### Por qué una RPC para unirse
La ruta de unión debe ser idempotente y no confiar en datos enviados por cliente. Aunque la política RLS permite insert propio como `member`, una RPC `SECURITY DEFINER` permite: validar el `invite_code`, resolver `league_id` en servidor, aplicar `payment_status = 'pending'`, manejar conflicto `(league_id,user_id)` sin error visible y devolver una forma estable para la UI. No aceptar `role`, `payment_status` ni `league_id` como input público.

Snippet orientativo:

```sql
create or replace function public.fn_join_league_by_invite(p_invite_code text)
returns public.league_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_league_id uuid;
  v_member public.league_members;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  select l.id
    into v_league_id
  from public.leagues l
  where l.invite_code = upper(trim(p_invite_code));

  if v_league_id is null then
    raise exception 'Invitación inválida' using errcode = 'P0002';
  end if;

  insert into public.league_members (league_id, user_id, role, payment_status)
  values (v_league_id, v_uid, 'member', 'pending')
  on conflict (league_id, user_id) do update
    set user_id = excluded.user_id
  returning * into v_member;

  return v_member;
end;
$$;

grant execute on function public.fn_join_league_by_invite(text) to authenticated;
```

### Lectura segura de landing
El AC pide mostrar datos de liga antes de pertenecer a ella. La política actual de `leagues_select_member_or_owner` solo deja leer a creador o miembro, así que la landing anónima puede necesitar una RPC separada `fn_get_invite_landing(p_invite_code text)` que devuelva una tabla/JSON con datos mínimos. Esta función debe ser cuidadosa: no devolver `created_by`, emails, IDs internos si no son necesarios, ni permitir enumeración rica. Devuelve solo lo que WhatsApp/landing necesita.

Datos mínimos recomendados:
- `league_name`
- `creator_display_name`
- `creator_avatar_url`
- `requires_payment`
- `payment_amount`
- `payment_instructions`
- `invite_code`

Si preocupa enumeración de códigos, mantener códigos largos/no ambiguos de Story 1.3 (6-8 chars puede ser aceptable para grupos pequeños; 8+ mejora margen) y no añadir endpoints de búsqueda.

### UX obligatoria
- Contenedor `max-w-md` (480px), columna única, gutter 16px, gap 12px. [Source: `EXPERIENCE.md#Foundation`; `DESIGN.md#Layout & Spacing`]
- Dark-mode-first con fondo `#0D1B2A`, cards `#1B263B`, borde `#415A77`, acento dorado `#E9C46A`, éxito `#10B981`, acción/pendiente `#E63946`. [Source: `DESIGN.md#Colors`]
- Outfit para títulos/hero de invitación; Inter para labels, instrucciones y botones. [Source: `DESIGN.md#Typography`]
- Targets táctiles mínimo `48x48px` y `aria-label` descriptivo para el CTA de Google/unión. [Source: `EXPERIENCE.md#Accessibility Floor`]
- Microcopy recomendado: "Cris te invita a la liga La Pija Quiniela", "Tarifa de inscripción: $10 USD", "Regístrate con Google para jugar", "¡Te has unido con éxito! Ya puedes registrar tus pronósticos." [Source: `EXPERIENCE.md#Voice and Tone`; `EXPERIENCE.md#Flow 1`]

### OpenGraph y redirect OAuth actualizados
Supabase documenta que, en SSR/PKCE, `signInWithOAuth` debe usar `redirectTo` hacia una ruta callback que intercambia el auth code por sesión; el proyecto ya sigue ese patrón. La URL usada en `redirectTo` debe estar permitida en Supabase Auth Redirect URLs. Para desarrollo local, verificar que el allow-list incluya el host/puerto real del dev server. [Source: Supabase docs, "Login with Google"; Supabase docs, "Redirect URLs"]

Next.js App Router permite definir metadata por ruta con `generateMetadata`; úsalo para OpenGraph textual de `/join/[invite_code]`. Si se usa `NextResponse` para redirigir o cookies en route handlers, seguir APIs de App Router y no mezclar Pages Router. [Source: Next.js docs, `NextResponse`; Next.js App Router docs]

### Alcance - qué NO hacer en esta historia
- NO implementar el formulario de creación/edición de liga, modo de predicción, switches de pago ni `fn_create_league`: eso es Story 1.3.
- NO implementar dashboard de pronósticos completo ni `GoalPicker`: eso empieza en Epic 2.
- NO implementar badges públicos de pago en standings ni panel de cobros: eso es Epic 3.
- NO cambiar la autenticación a un flujo distinto de Supabase SSR/cookies.
- NO exponer `profiles.email` en la landing; hay deuda explícita de PII diferida desde review de Story 1.2.

### Project Structure Notes
- **NUEVOS probables**: `src/app/join/[invite_code]/page.tsx`, `src/components/join/JoinLeagueCard.tsx` o `JoinLeagueForm.tsx`, `supabase/migrations/<ts>_add_join_league_by_invite_fn.sql`, `tests/integration/join-league-by-invite.test.ts`.
- **MODIFICADOS probables**: `src/app/actions/leagues.actions.ts` (si ya fue creado por Story 1.3), `src/types/database.types.ts` (regenerado), `src/types/index.ts` (si faltan tipos compartidos), `src/components/login-form.tsx` (solo si se preserva `next` para email/password).
- Mantener carpetas de ruta en `kebab-case`, componentes `PascalCase`, acciones en `*.actions.ts`, funciones SQL `fn_`, triggers `tr_`. [Source: `architecture.md#Naming Patterns`; `architecture.md#Structure Patterns`]

### Testing Notes
- Reutilizar `tests/integration/setup.ts`: `createServiceRoleClient`, `createAnonClient`, `createAuthedClient`. No añadir `jsonwebtoken`. [Source: `tests/integration/setup.ts`; Story 1.2 Dev Notes]
- Fixtures: crear usuarios con `service_role`, confirmar email, hacer `signInWithPassword` con anon y pasar `access_token` a `createAuthedClient`.
- Para landing SSR, si RLS impide leer liga por select normal, el test debe cubrir la RPC de landing mínima.
- OAuth real de Google no se automatiza en CI sin credenciales reales; validar el wiring del `next` y el render del botón.

### Latest Technical Context
- Supabase SSR/Auth sigue recomendando `@supabase/ssr` para sesiones en cookies y flujo PKCE con callback que intercambia el code por sesión. El proyecto ya usa `@supabase/ssr` y `exchangeCodeForSession`; continuar ese patrón.
- Supabase Google OAuth requiere configurar el proveedor en el dashboard/config y que `redirectTo` esté en la lista de Redirect URLs permitidas.
- Next.js App Router route handlers deben usar `NextResponse.redirect(new URL(...))` o URLs seguras basadas en `request.url`; para este repo, conservar `${origin}${next}` y evitar redirects absolutos controlados por usuario.

### References
- [Source: `_bmad-output/planning-artifacts/epics.md#Story 1.4: Enlaces de Invitación Inteligentes y Registro Express (Smart Deep-Linking)`]
- [Source: `_bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/prd.md#4.2 Enlaces de Invitación Inteligentes (Smart Deep-Linking)`]
- [Source: `_bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/prd.md#UJ-1: Invitación y Registro Instantáneo (Smart Deep-Linking)`]
- [Source: `_bmad-output/planning-artifacts/architecture.md#Requirements to Structure Mapping`]
- [Source: `_bmad-output/planning-artifacts/architecture.md#API & Communication Patterns`]
- [Source: `_bmad-output/planning-artifacts/architecture.md#Format Patterns`]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/DESIGN.md`]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/EXPERIENCE.md#Flow 1 - Invitación y Registro Express (Pedro, primer contacto)`]
- [Source: `_bmad-output/implementation-artifacts/1-2-esquema-relacional-de-base-de-datos-y-autenticacion-google-oauth.md#Review Findings`]
- [Source: `supabase/migrations/20260602041410_init_schema.sql`]
- [Source: `supabase/migrations/20260602041455_rls_and_triggers.sql`]
- Web: Supabase Login with Google - https://supabase.com/docs/guides/auth/social-login/auth-google
- Web: Supabase Redirect URLs - https://supabase.com/docs/guides/auth/redirect-urls
- Web: Supabase Next.js Auth quickstart - https://supabase.com/docs/guides/auth/quickstarts/nextjs
- Web: Next.js NextResponse - https://nextjs.org/docs/app/api-reference/functions/next-response

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

- Tarea 1 preflight: `supabase/migrations/20260603014645_add_create_league_fn.sql` existe con `public.fn_create_league`; `src/app/actions/leagues.actions.ts`/`createLeague` aún no existen y `database.types.ts` todavía no refleja `fn_create_league`, así que Story 1.4 se implementa sin recrear formulario y con regeneración de tipos tras sus RPC.
- RED Tarea 2: `npm run test:integration -- tests/integration/join-league-by-invite.test.ts` falló 4/4 por `PGRST202` (RPC inexistente), después de alinear Supabase local con `npx supabase db reset`.
- GREEN Tarea 2: `npx supabase db reset && npx supabase gen types typescript --local > src/types/database.types.ts && npm run test:integration -- tests/integration/join-league-by-invite.test.ts` pasó 4/4.
- RED Tarea 3: `npm run test:unit -- tests/unit/leagues-actions.test.ts` falló 3/3 porque `joinLeagueByInvite` no estaba exportada.
- GREEN Tarea 3: `npm run test:unit -- tests/unit/leagues-actions.test.ts` pasó 3/3.
- RED Tarea 4: `npm run test:integration -- tests/integration/invite-landing.test.ts` falló 2/2 por `PGRST202` (RPC pública mínima inexistente).
- GREEN Tarea 4: `npm run test:integration -- tests/integration/invite-landing.test.ts tests/integration/join-league-by-invite.test.ts` pasó 6/6; `npm run test:unit -- tests/unit/leagues-actions.test.ts` pasó 3/3; `npm run typecheck` pasó.
- RED Tarea 5: `npm run test:unit -- tests/unit/login-form.test.tsx` falló porque `LoginForm` redirigía a `/protected` y pasaba Google next `/protected`.
- GREEN Tarea 5: `npm run test:unit -- tests/unit/login-form.test.tsx` pasó 1/1; `npm run typecheck` pasó.
- RED Tarea 6: `npm run test:unit -- tests/unit/join-page-metadata.test.ts` falló porque `generateMetadata` no existía.
- GREEN Tarea 6: `npm run test:unit -- tests/unit/join-page-metadata.test.ts` pasó 2/2; `npm run typecheck` pasó.
- Tarea 7 enfoque: `npm run test:unit -- tests/unit/join-page.test.tsx tests/unit/join-page-metadata.test.ts tests/unit/login-form.test.tsx tests/unit/leagues-actions.test.ts` pasó 8/8; `npm run test:integration -- tests/integration/invite-landing.test.ts tests/integration/join-league-by-invite.test.ts` pasó 6/6.
- Tarea 7 full: `npm run test:ci` pasó unit 23/23, integration 19/19, e2e 2/2. `npm run lint && npm run typecheck` pasó sin errores.
- Cierre final: `npm run db:types` pasó tras ajustar el script a `npx supabase ...`; `npm run typecheck`, `npm run lint` y `npm run test:ci` pasaron nuevamente.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Tarea 1 completada: se confirmó que Story 1.3 está en progreso, con migración parcial de `fn_create_league`; Story 1.4 consumirá filas existentes/fixtures y no duplicará el flujo de creación de liga.
- Tarea 2 completada: se añadió `fn_join_league_by_invite`, idempotente, `SECURITY DEFINER`, con alta forzada como `member/pending`, bloqueo anónimo y error estándar `22023` para invitación inválida.
- Tarea 3 completada: se extendió `leagues.actions.ts` con `joinLeagueByInvite`, validación del alfabeto real de `invite_code`, normalización a uppercase y retorno `ServerActionResult<LeagueMember>`.
- Tarea 4 completada: se añadió `fn_get_invite_landing` para datos públicos mínimos, la ruta SSR `/join/[invite_code]`, el componente `JoinLeagueCard` y CTA autenticado/no autenticado con fallback a `/protected?joined=1&league=<id>`.
- Tarea 5 completada: `LoginForm` y `/auth/login` preservan `next` para email/password y Google; `GoogleSignInButton` mantiene el callback SSR existente y ahora usa botón `xl` para target táctil.
- Tarea 6 completada: `/join/[invite_code]` ahora genera metadata/OpenGraph textual con datos públicos de liga y fallback genérico para invitaciones inválidas.
- Tarea 7 completada: se añadió cobertura de integración, Server Action, metadata, login deep-link y render de la ruta `/join/[invite_code]`; no se automatizó OAuth real por ausencia de credenciales Google locales, pero se validó el wiring de `next`.
- Ajuste adicional: `package.json` ahora ejecuta `db:types` con `npx supabase`, evitando depender de un binario global.

### File List

- `supabase/migrations/20260603015457_add_join_league_by_invite_fn.sql`
- `tests/integration/join-league-by-invite.test.ts`
- `tests/unit/leagues-actions.test.ts`
- `tests/integration/invite-landing.test.ts`
- `src/app/actions/leagues.actions.ts`
- `src/app/join/[invite_code]/page.tsx`
- `src/app/auth/login/page.tsx`
- `src/components/join/JoinLeagueCard.tsx`
- `src/components/google-signin-button.tsx`
- `src/components/login-form.tsx`
- `supabase/migrations/20260603020237_add_invite_landing_fn.sql`
- `tests/unit/login-form.test.tsx`
- `tests/unit/join-page-metadata.test.ts`
- `tests/unit/join-page.test.tsx`
- `src/types/database.types.ts`
- `package.json`

## Change Log

| Fecha | Versión | Descripción | Autor |
| --- | --- | --- | --- |
| 2026-06-02 | 0.1 | Implementado flujo `/join/[invite_code]`: RPC pública mínima de landing, RPC idempotente de unión, Server Action, landing mobile-first, preservación de deep-link auth, OpenGraph textual y cobertura completa de pruebas. | Codex |

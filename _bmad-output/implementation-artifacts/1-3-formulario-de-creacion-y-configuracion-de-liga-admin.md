---
baseline_commit: ed6ff778e3609523ba07eba0a44fd19123e0108b
---

# Story 1.3: Formulario de Creación y Configuración de Liga (Admin)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **administrador de una quiniela**,
I want **configurar una liga privada mediante un formulario mobile-first especificando si requiere pago de inscripción, instrucciones de cobro y modo de predicción**,
so that **establecer las reglas logísticas de mi grupo y quedar registrado como su administrador desde la creación**.

## Acceptance Criteria

1. **Given** un administrador autenticado en la app móvil (contenedor `max-w-md`)
   **When** ingresa al panel de creación de liga
   **Then** el formulario le permite ingresar el **nombre de la liga** y seleccionar el **"Modo de Predicción"** (guardado dentro de la columna `rules` JSONB de `leagues`).

2. **And** si activa el toggle **"Requiere Pago"**, el formulario revela y **obliga** a ingresar el **monto de inscripción** (numérico ≥ 0) e **instrucciones de cobro** (Bizum/Zelle/efectivo); si está desactivado, esos campos quedan ocultos y opcionales.

3. **And** al guardar el formulario, una **Server Action** estructurada bajo la firma `ServerActionResult<T>` persiste la liga en `leagues` y asocia al creador como **miembro administrador** (`role = 'admin'`) en `league_members`, de forma **atómica** (todo o nada).

4. **And** se genera un `invite_code` **único** para la liga (la columna es `not null unique`), listo para ser consumido por la Story 1.4 (`/join/[invite_code]`).

5. **And** la UI aplica el sistema de diseño **Championship Gold**: dark-mode-first, tipografías **Outfit** (títulos) e **Inter** (cuerpo/botones), tokens HSL de color, y **todos los controles táctiles (botones/toggle) miden ≥ 48×48px** (UX-DR-1/2/3/10).

6. **And** ante errores (validación, red, fallo de BD) la Server Action retorna `{ success: false, error }` y la UI muestra el mensaje sin romper; ante éxito redirige al usuario con feedback de confirmación.

## Tasks / Subtasks

- [x] **Tarea 1 — Fundamentar el sistema de diseño "Championship Gold"** (AC: #5) — _primera historia de UI: deja la base que reutilizarán todas las demás_
  - [x] En `src/app/globals.css`, reemplazar los tokens HSL neutros por defecto por la paleta Championship Gold (ver "Dev Notes › Tokens HSL"). Aplicar al bloque dark-first.
  - [x] Añadir tokens nuevos que el sistema usa pero shadcn no trae: `--success` / `--success-foreground` (turf green `#10B981`).
  - [x] En `tailwind.config.ts`, añadir `success: { DEFAULT: "hsl(var(--success))", foreground: "hsl(var(--success-foreground))" }` y `fontFamily: { display: ["var(--font-outfit)"], sans: ["var(--font-inter)"] }`. Ajustar `borderRadius` si hace falta para reflejar 6/10/16px.
  - [x] En `src/app/layout.tsx`: importar **Outfit** e **Inter** de `next/font/google` con `variable: "--font-outfit"` / `"--font-inter"`; aplicar Inter como fuente base del `<body>` y exponer ambas variables. Reemplazar la fuente Geist actual.
  - [x] Forzar **dark-mode-first**: en `ThemeProvider` usar `defaultTheme="dark"` (y `forcedTheme="dark"` salvo que se requiera toggle); DESIGN.md prohíbe layout en light-mode.
  - [x] (Opcional) Actualizar `metadata` (title/description) de "Next.js and Supabase Starter Kit" a la marca PIJA Quiniela.

- [x] **Tarea 2 — Componentes UI base que faltan** (AC: #1, #2, #5)
  - [x] Añadir los componentes shadcn ausentes necesarios para el formulario: `switch` (toggle de pago, `@radix-ui/react-switch`), `select` (modo de predicción, `@radix-ui/react-select`) y `textarea`. Colocarlos en `src/components/ui/`. (Vía `npx shadcn add switch select textarea` o creación manual; ver nota de `components.json` en "Inteligencia previa".)
  - [x] Verificar que `button`, `input`, `label`, `card` ya existentes respetan ≥48px de altura para targets táctiles; si no, ajustar tamaño/variant. → añadida size `xl` (h-12) a Button; inputs del formulario se renderizan con `h-12`; SelectTrigger e items con h-12.

- [x] **Tarea 3 — Migración: función RPC atómica de creación** (AC: #3, #4) — **CRÍTICO, leer "Dev Notes › Por qué un RPC"**
  - [x] `npx supabase migration new add_create_league_fn`.
  - [x] Crear `public.fn_create_league(...)` `SECURITY DEFINER set search_path = ''` que: valida `auth.uid()` (no nulo, si no `raise exception ... errcode '42501'`), inserta la liga (`created_by = auth.uid()`), inserta la membresía del creador con `role = 'admin'`, y **retorna** la fila de la liga. Todo en una sola transacción de función (atómico). Nomenclatura `fn_`. → params de pago con `default null` para que los tipos generados los marquen opcionales.
  - [x] `grant execute on function public.fn_create_league(...) to authenticated;`
  - [x] `npx supabase db reset` (idempotente) y `npm run db:types` para regenerar `src/types/database.types.ts` (incluirá la firma del RPC y el tipo `Functions`). → regenerado vía `npx supabase gen types` (el script `db:types` invoca `supabase` directamente, no `npx`).

- [x] **Tarea 4 — Server Action `createLeague`** (AC: #3, #4, #6)
  - [x] Crear `src/app/actions/leagues.actions.ts` con `"use server"`. Exportar `createLeague(input): Promise<ServerActionResult<League>>`.
  - [x] Definir/usar el tipo `ServerActionResult<T>` (ver "Dev Notes › ServerActionResult"): primer uso en el proyecto → ubicarlo en `src/types/index.ts` para reutilización global. → también `PredictionMode` y `LeagueRules`.
  - [x] Validar el input (recomendado con `zod`): `name` no vacío; `predictionMode` ∈ enum; si `requiresPayment` → `paymentAmount` numérico ≥ 0 e `instructions` no vacías; si no, esos campos opcionales/ignorados. → `createLeagueSchema` exportado (testeable) con `superRefine`.
  - [x] Generar `invite_code` único (ver "Dev Notes › Generación de invite_code"): alfabeto sin caracteres ambiguos, reintento ante violación `unique` (`23505`). → `src/utils/invite-code.ts` + bucle de reintento (5) en la acción.
  - [x] Llamar `const supabase = await createClient()` (de `src/utils/supabase/server.ts`) y `await supabase.rpc('fn_create_league', { ... })`. Construir `rules` JSONB con `{ predictionMode }`. Mapear `paymentAmount`/`paymentInstructions` (null si no requiere pago). → el `rules` JSONB lo construye el propio RPC con `jsonb_build_object('predictionMode', ...)`.
  - [x] Envolver en `try/catch`; retornar siempre `ServerActionResult` (nunca lanzar al cliente). En éxito, devolver la liga (con su `invite_code`).

- [x] **Tarea 5 — Ruta y formulario** (AC: #1, #2, #5, #6)
  - [x] Crear la página servidor `src/app/leagues/new/page.tsx` (carpeta `kebab-case`): verifica usuario autenticado (server client `getClaims`/`getUser`; si no, `redirect("/auth/login")`); renderiza el formulario dentro de un contenedor `max-w-md` centrado.
  - [x] Crear el client component `src/components/leagues/LeagueCreateForm.tsx` (`PascalCase`, bajo carpeta de feature `leagues/`):
    - Estado local para el toggle "Requiere Pago" que muestra/oculta los campos condicionales (réplica del comportamiento del mockup `admin-settings.html`).
    - Modo de predicción como `<Select>` con las 3 opciones del mockup (ver "Dev Notes › Modo de predicción").
    - Envío con `useTransition`: deshabilita el botón durante el guardado (patrón de loading de la arquitectura) y llama a la Server Action.
    - Render del error (`result.error`) y, en éxito, `router.push` al dashboard/home con feedback (toast/destello verde turf). → destello turf + `router.push("/protected")`.
  - [x] Botón "Crear Liga" con estilo Championship Gold (fondo accent dorado, texto `accent-foreground`), ancho completo, ≥48px de alto.

- [x] **Tarea 6 — Pruebas** (AC: #3, #4, #6)
  - [x] **Integración** `tests/integration/create-league-fn.test.ts` (proyecto `integration`, reutiliza helpers de `tests/integration/setup.ts`):
    - Usuario autenticado (vía `signInWithPassword` + `createAuthedClient`, patrón de Story 1.2) llama `rpc('fn_create_league', ...)` → assert: liga creada con `created_by = uid` y `invite_code` presente; existe `league_members` con ese `user_id`, `role = 'admin'`.
    - `anon` llamando al RPC → bloqueado/anónimo (no crea fila).
    - Atomicidad: forzar un fallo (p. ej. `invite_code` duplicado) → assert que **no** queda liga huérfana ni membresía.
    - (+) caso extra: campos de pago `null` cuando no requiere pago.
  - [x] **Unit** (proyecto `unit`): el generador de `invite_code` (longitud/alfabeto correctos, sin ambiguos) y, si se usa zod, el esquema de validación (rechaza monto negativo / instrucciones vacías cuando `requiresPayment`). → `tests/unit/invite-code.test.ts` y `tests/unit/create-league-schema.test.ts`.
  - [x] (Opcional) E2E móvil `tests/e2e/create-league.spec.ts`: cargar `/leagues/new`, rellenar y enviar (requiere sesión; puede quedar como smoke de render del formulario si el login no es trivial en E2E). → smoke de guardia de sesión (redirige a `/auth/login` sin sesión).
  - [x] `npm run test:ci`, `npm run lint`, `npm run typecheck` en verde. → 1.3 + baseline en verde (typecheck + lint limpios). NOTA: hay trabajo paralelo en curso de **Story 1.4** (archivos untracked: `invite-landing.test.ts`, `join-league-by-invite.test.ts`, migración `add_invite_landing_fn`) que comparte `leagues.actions.ts`; su test `invite-landing.test.ts` falla por su propio RPC (devuelve array vs objeto) — ajeno a 1.3.

### Review Findings

_Revisión adversarial BMad (3 capas: Blind Hunter, Edge Case Hunter, Acceptance Auditor) — 2026-06-03. Alcance: solo Story 1.3._

- [x] [Review][Patch] Redirección de éxito (AC #6) — quitar el banner de éxito inalcanzable y el estado `success`, y redirigir directamente tras crear (decisión de Cris: redirección inmediata, sin destello). [src/components/leagues/LeagueCreateForm.tsx] (blind+edge+auditor)
- [Review][Dismiss] `paymentAmount` permite 0 con `requiresPayment=true` — descartado por decisión de Cris: el pago se maneja de forma interna, no se añade regla de mínimo. (edge)
- [Review][Dismiss] Toggle "Requiere Pago" color/target — descartado por decisión de Cris: se acepta como está (verde ON + target táctil en la fila contenedora ≥48px). (blind+auditor)
- [x] [Review][Patch] Acotar `createLeagueSchema`: añadir `name.max(80)` para evitar nombres ilimitados (el ajuste de `paymentAmount` se omite por la decisión anterior). [src/app/actions/leagues.schema.ts:21] (blind+edge)
- [x] [Review][Patch] Banner de error con contraste/semántica inconsistente: usa `text-destructive-foreground` (blanco) sobre `bg-destructive/10`; el bloque de éxito usa correctamente `text-success` sobre `bg-success/15`. Cambiar a `text-destructive` [src/components/leagues/LeagueCreateForm.tsx:174] (blind)
- [x] [Review][Patch] Test no determinista: la aserción de unicidad del generador usa `toBe(50)` (colisión improbable pero posible → CI intermitente). Usar `toBeGreaterThanOrEqual` o tolerancia [tests/unit/invite-code.test.ts:44] (blind)
- [x] [Review][Defer] Validación a nivel de BD ausente en `fn_create_league` (sin `CHECK payment_amount >= 0`, sin validar `prediction_mode`/`name`); un usuario autenticado que invoque el RPC directo por PostgREST salta zod [supabase/migrations/20260603014645_add_create_league_fn.sql] — deferred, deuda documentada de 1.2 (la Server Action sí valida)
- [x] [Review][Defer] La guardia de sesión no maneja un usuario sin fila en `profiles` → el INSERT del RPC viola la FK (23503) y muestra un error crudo [src/app/leagues/new/page.tsx:11] — deferred, caso raro (depende de fallo del trigger `fn_handle_new_user`)
- [x] [Review][Defer] Código de Story 1.4 mezclado en `leagues.actions.ts` (`joinLeagueByInvite`/`normalizeInviteCode`) y RPCs 1.4 en `database.types.ts`; auditar la superficie anon de `fn_get_invite_landing` (posible enumeración de ligas) bajo 1.4 [src/app/actions/leagues.actions.ts] — deferred, pertenece a Story 1.4

## Dev Notes

### Inteligencia de las historias previas (1.1 y 1.2 — DONE)
- **Stack real**: Next.js **16.2.7** + React **19.2.7**, Tailwind **v3** (config en `tailwind.config.ts`, colores vía `hsl(var(--token))`), shadcn/ui, `@supabase/ssr`. Todo el código bajo `src/`; alias `@/* → ./src/*`. [Source: 1-1 / 1-2 Dev Agent Record]
- **Estado del diseño**: `globals.css` tiene **tokens neutros por defecto** (NO Championship Gold) y `layout.tsx` usa **Geist** (NO Outfit/Inter). Por eso la Tarea 1 monta la base de diseño aquí. [Source: lectura directa de `src/app/globals.css` y `src/app/layout.tsx`]
- **Componentes UI presentes**: `badge, button, card, checkbox, dropdown-menu, input, label`. **Faltan** `switch`, `select`, `textarea` (Tarea 2). [Source: `src/components/ui/`]
- **🔴 GUARDARRAÍL CRÍTICO heredado de 1.2**: la política `league_members_insert_self` fue **endurecida** y ahora exige `with check (user_id = auth.uid() AND role = 'member')`. **Insertar al creador como `role = 'admin'` con el cliente autenticado FALLA con RLS `42501`.** Por eso la creación DEBE ir por una función `SECURITY DEFINER` (`fn_create_league`). No intentes dos inserts desde el cliente. [Source: 1-2 Review Findings → Patch `league_members_insert_self`]
- **Patrón de cliente autenticado en tests** (reutilizar): crear usuario con `service_role`, `signInWithPassword` con `createAnonClient()`, tomar `access_token` y pasarlo a `createAuthedClient(token)`. Sin `jsonwebtoken`. [Source: 1-2 Dev Notes]
- **Tipos**: `src/types/index.ts` ya exporta `League`, `LeagueInsert`, `LeagueMember`, `LeagueRole`, `PaymentStatus`. Añade aquí `LeagueRules`/`PredictionMode` y `ServerActionResult`. Regenera `database.types.ts` con `npm run db:types` tras la migración. [Source: lectura directa de `src/types/index.ts`]
- **Server client**: `createClient()` de `src/utils/supabase/server.ts` es `async` (usa `await cookies()`) → `const supabase = await createClient()`. Usa `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. [Source: lectura directa]
- **Deuda relevante**: `payment_amount numeric(10,2)` **no** tiene `CHECK (>= 0)` (diferido en 1.2) → validar el monto en la Server Action/zod. Y `email` PII queda legible por autenticados (diferido) — no afecta a 1.3. [Source: 1-2 Review → Deferred]

### Por qué un RPC `fn_create_league` (no dos inserts)
La creación toca dos tablas y debe ser **atómica** (AC #3). Además, por el endurecimiento RLS de 1.2, el cliente no puede insertar una membresía `admin`. Una función `SECURITY DEFINER` resuelve ambas cosas: corre en una sola transacción y baja al rol propietario para escribir el `role='admin'`, mientras usa `auth.uid()` para atar la liga al llamante real. Patrón alineado con la arquitectura (transaccionalidad vía funciones SQL). [Source: architecture.md#Authentication & Security / #API & Communication Patterns; 1-2 Review]
```sql
create or replace function public.fn_create_league(
  p_name text,
  p_invite_code text,
  p_prediction_mode text,
  p_requires_payment boolean,
  p_payment_amount numeric,
  p_payment_instructions text
) returns public.leagues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_league public.leagues;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  insert into public.leagues
    (name, created_by, invite_code, requires_payment, payment_amount, payment_instructions, rules)
  values
    (p_name, v_uid, p_invite_code, coalesce(p_requires_payment, false),
     p_payment_amount, p_payment_instructions,
     jsonb_build_object('predictionMode', p_prediction_mode))
  returning * into v_league;

  insert into public.league_members (league_id, user_id, role, payment_status)
  values (v_league.id, v_uid, 'admin', 'pending');

  return v_league;
end;
$$;

grant execute on function public.fn_create_league(text, text, text, boolean, numeric, text) to authenticated;
```
> **Decisión de producto menor**: el `payment_status` del creador-admin se inserta como `'pending'` (coherente con FR-5 "los nuevos entran como Pendiente"). Si el producto prefiere que el admin nazca `'paid'`, ajustar — anotar en la PR. [Source: epics.md FR-5]

### Generación de `invite_code`
La columna `invite_code` es `not null unique` → la app DEBE generarlo (no hay default). Recomendado **sin dependencias nuevas**: generar con `crypto.randomInt` un código de 6–8 chars de un alfabeto sin ambiguos (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`, sin `O/0/I/1/L`). Reintentar (3–5 veces) si el RPC devuelve violación `unique` (Postgres `23505`) regenerando el código. Alternativa: `nanoid` v5 (ESM-only) con alfabeto custom. [Source: schema 1-2; epics.md FR-3 ejemplo `/join/LIGA123`]

### `ServerActionResult` (primer uso en el proyecto)
La arquitectura exige que **toda** Server Action retorne esta forma tipada; nunca propagar excepciones al cliente. Definir en `src/types/index.ts`:
```ts
export type ServerActionResult<T> = {
  success: boolean;
  data: T | null;
  error: string | null;
};
```
La acción atrapa con `try/catch` y retorna `{ success:false, data:null, error: e.message }` ante fallo. [Source: architecture.md#Format Patterns / #Error Handling Patterns / #Enforcement Guidelines]

### Modo de predicción (opciones del mockup)
El `<Select>` ofrece las 3 opciones de `admin-settings.html` (guardar una clave estable en `rules.predictionMode`, no el label):
1. **Modo Dual (Anticipado + Jornada con Bonos)** → `dual`
2. **Jornada a Jornada (Dinamismo semanal)** → `jornada`
3. **Fase de Grupos Completa (Pronóstico inicial)** → `grupos`

Añadir a `src/types/index.ts`:
```ts
export type PredictionMode = "dual" | "jornada" | "grupos";
export type LeagueRules = { predictionMode: PredictionMode };
```
[Source: mockups/admin-settings.html (sección "Reglas e Inscripción"); epics.md Story 1.3]

### Tokens HSL — Championship Gold (calculados desde los hex de DESIGN.md)
Aplicar al bloque dark de `globals.css`. **Valida contraste 7:1 (UX-DR-10)** y ajusta `--muted` (fondo) vs `--muted-foreground` (texto secundario `#8D99AE`) según necesidad:
```css
--background: 211 53% 11%;        /* #0D1B2A Indigo profundo */
--foreground: 105 50% 96%;        /* #F1FAEE texto casi-blanco */
--card: 217 37% 17%;              /* #1B263B navy mate */
--card-foreground: 105 50% 96%;
--popover: 217 37% 17%;
--popover-foreground: 105 50% 96%;
--primary: 355 78% 56%;           /* #E63946 carmesí acción */
--primary-foreground: 0 0% 100%;
--accent: 43 74% 66%;             /* #E9C46A dorado campeonato */
--accent-foreground: 34 53% 7%;   /* #1A1208 marrón muy oscuro */
--success: 160 84% 39%;           /* #10B981 turf green */
--success-foreground: 0 0% 100%;
--border: 212 29% 36%;            /* #415A77 slate */
--input: 212 29% 36%;
--muted: 217 30% 22%;             /* fondo muted (navy más claro) */
--muted-foreground: 218 17% 62%;  /* #8D99AE azul-gris */
--destructive: 355 78% 56%;       /* #E63946 (igual a primary, per DESIGN) */
--destructive-foreground: 0 0% 100%;
--ring: 43 74% 66%;               /* foco dorado */
--radius: 0.625rem;               /* 10px base (md); sm≈6px, lg≈16px */
```
Reglas de uso (DESIGN.md "Do's/Don'ts"): el **dorado** se reserva a puntos/ranking/trofeos y al CTA de esta pantalla; el **turf green** solo para estados afirmativos (éxito de guardado, "Pagado"); el **carmesí** para acciones/headers/pendiente. Sin sombras de elevación; profundidad por tono + borde slate. [Source: DESIGN.md]

### Restricciones de UX (obligatorias)
- **Mobile-first**: contenedor `max-w-md` (480px), columna única, gutter 16px, gap 12px. [Source: UX-DR-1; DESIGN.md#Layout]
- **Targets táctiles ≥ 48×48px** y `aria-label` descriptivos. [Source: UX-DR-10]
- **Tipografía**: Outfit (títulos/headers de sección), Inter (labels/inputs/botones). [Source: UX-DR-3; DESIGN.md#Typography]
- El toggle de pago replica el patrón del mockup: ON revela `Monto` + `Instrucciones`; OFF los oculta. [Source: admin-settings.html `togglePaymentFields()`]

### Alcance — qué NO hacer en esta historia
- **NO** implementar la lista de miembros, el badge de pago alternable ni "Expulsar Miembro" — eso es **Story 3.3** (aunque el mockup `admin-settings.html` los muestre en la misma pantalla). [Source: epics.md Story 3.3]
- **NO** implementar la **edición** de ajustes de una liga existente (requiere política/RPC de UPDATE, diferida en 1.2). 1.3 es **creación**. Si se necesita editar, es trabajo de follow-up (Story 3.3 / admin panel). [Source: 1-2 Review → Deferred UPDATE/DELETE]
- **NO** construir la pantalla de invitación `/join/[invite_code]` ni el deep-linking — es **Story 1.4**. Aquí solo se genera el `invite_code`. [Source: epics.md Story 1.4]
- **NO** tocar el esquema base de las tablas (ya existe); solo se añade la función RPC.

### Project Structure Notes
- **NUEVOS**: `src/app/actions/leagues.actions.ts`, `src/app/leagues/new/page.tsx`, `src/components/leagues/LeagueCreateForm.tsx`, `src/components/ui/{switch,select,textarea}.tsx`, `supabase/migrations/<ts>_add_create_league_fn.sql`, `tests/integration/create-league-fn.test.ts`, (unit del generador/validación), (E2E opcional).
- **MODIFICADOS**: `src/app/globals.css` (tokens), `tailwind.config.ts` (success + fonts), `src/app/layout.tsx` (Outfit/Inter + dark), `src/types/index.ts` (`ServerActionResult`, `PredictionMode`, `LeagueRules`), `src/types/database.types.ts` (regenerado), `package.json` (deps `@radix-ui/react-switch`, `@radix-ui/react-select`, opcional `zod`/`nanoid`).
- Respeta nomenclatura: carpetas `kebab-case`, componentes `PascalCase`, Server Actions en `*.actions.ts`, funciones SQL `fn_`. [Source: architecture.md#Naming/Structure Patterns]

### Notas de versiones (último contexto)
- `zod` (validación) y, si se opta, `nanoid` v5 — **ESM-only** (Next 16/Node 22 lo soportan). Ambas son micro-deps compatibles con "Coste Cero". Alternativa sin deps: validación manual + `crypto.randomInt`. [Source: NFR-1]

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.3: Formulario de Creación y Configuración de Liga (Admin)]
- [Source: _bmad-output/planning-artifacts/epics.md#FR-24 / FR-5 / FR-3]
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Format Patterns / Error Handling / Loading State Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Naming Patterns / Structure Patterns]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/DESIGN.md]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/mockups/admin-settings.html]
- [Source: _bmad-output/implementation-artifacts/1-2-esquema-relacional-de-base-de-datos-y-autenticacion-google-oauth.md#Review Findings]
- [Source: src/app/globals.css, src/app/layout.tsx, tailwind.config.ts, src/types/index.ts, src/utils/supabase/server.ts (estado actual del repo)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Opus 4.8)

### Debug Log References

- Toolchain: el Node por defecto del shell es v12 (incompatible con Next 16); se usó `~/.nvm/versions/node/v24.13.0` para typecheck/tests/migraciones.
- `gen types` devolvía esquema `public` vacío si se ejecutaba mientras los contenedores reiniciaban tras `db reset`; se regeneró una vez estabilizados.
- TS2306 "is not a module" intermitente sobre `database.types.ts` (race de FS al escribir/leer); desaparece al re-ejecutar `tsc` con el archivo estable.
- `.rpc(...).single()` infiere `data` como `{}`; en el test de integración se castea a `League`.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- **Sistema de diseño Championship Gold** montado como base reutilizable: tokens HSL dark-first en `globals.css`, `success`/fuentes `Outfit`+`Inter` en `tailwind.config.ts`, `layout.tsx` con dark-mode forzado y metadata de marca.
- **Creación atómica** vía RPC `fn_create_league` (`SECURITY DEFINER`): crea liga + membresía `role='admin'` en una transacción, sorteando la RLS endurecida de 1.2 que impide auto-asignar admin. Params de pago con `default null` → opcionales en los tipos generados.
- **Server Action `createLeague`** retorna siempre `ServerActionResult<League>` (try/catch, nunca lanza al cliente); valida con `zod` (`createLeagueSchema`, extraído a `leagues.schema.ts` porque un módulo `"use server"` solo exporta funciones async); genera `invite_code` sin caracteres ambiguos con reintento ante `23505`.
- **UI mobile-first** (`max-w-md`): página servidor con guardia de sesión + `LeagueCreateForm` (toggle de pago que revela campos condicionales, `Select` de modo de predicción, `useTransition` para loading, error inline y destello turf + redirección en éxito). Controles táctiles ≥48px (Button `xl`, inputs `h-12`, SelectTrigger/items `h-12`).
- **Pruebas verdes (1.3 + baseline):** unit (invite_code, esquema zod), integración (RPC atómico: éxito, pago null, anon bloqueado, atomicidad ante invite_code duplicado), e2e smoke de la guardia de ruta. `lint` y `typecheck` limpios.
- ⚠️ **Trabajo paralelo de Story 1.4 en el árbol (untracked):** otro proceso añadió `joinLeagueByInvite`/`normalizeInviteCode` a `leagues.actions.ts` y archivos propios (`leagues-actions.test.ts`, `join-league-by-invite.test.ts`, `invite-landing.test.ts`, migraciones `add_join_league_by_invite_fn`/`add_invite_landing_fn`). Su `invite-landing.test.ts` falla por su propio RPC (devuelve array vs objeto esperado); es ajeno a 1.3 y no se tocó. `db reset` aplica esas migraciones 1.4 porque comparten carpeta.

### File List

**Nuevos (Story 1.3):**
- `src/components/ui/switch.tsx`
- `src/components/ui/select.tsx`
- `src/components/ui/textarea.tsx`
- `src/utils/invite-code.ts`
- `src/app/actions/leagues.schema.ts`
- `src/app/actions/leagues.actions.ts` (función `createLeague`; `joinLeagueByInvite` fue añadida después por el trabajo paralelo de 1.4)
- `src/app/leagues/new/page.tsx`
- `src/components/leagues/LeagueCreateForm.tsx`
- `supabase/migrations/20260603014645_add_create_league_fn.sql`
- `tests/integration/create-league-fn.test.ts`
- `tests/unit/invite-code.test.ts`
- `tests/unit/create-league-schema.test.ts`
- `tests/e2e/create-league.spec.ts`

**Modificados (Story 1.3):**
- `src/app/globals.css` (tokens Championship Gold)
- `tailwind.config.ts` (color `success`, fuentes display/sans, borderRadius)
- `src/app/layout.tsx` (Outfit/Inter + dark-mode forzado + metadata)
- `src/components/ui/button.tsx` (size `xl` táctil ≥48px)
- `src/types/index.ts` (`ServerActionResult`, `PredictionMode`, `LeagueRules`)
- `src/types/database.types.ts` (regenerado: incluye `fn_create_league`)
- `package.json` / `package-lock.json` (`@radix-ui/react-switch`, `@radix-ui/react-select`, `zod`)

**Ajenos a 1.3 (trabajo paralelo de Story 1.4, untracked — no listados como entregables de esta historia):** `supabase/migrations/20260603015457_add_join_league_by_invite_fn.sql`, `supabase/migrations/20260603020237_add_invite_landing_fn.sql`, `tests/integration/join-league-by-invite.test.ts`, `tests/integration/invite-landing.test.ts`, `tests/unit/leagues-actions.test.ts`.

## Change Log

| Fecha | Versión | Descripción | Autor |
|-------|---------|-------------|-------|
| 2026-06-02 | 1.0 | Implementación completa de Story 1.3: sistema de diseño Championship Gold, RPC atómico `fn_create_league`, Server Action `createLeague`, ruta `/leagues/new` + `LeagueCreateForm`, y pruebas unit/integración/e2e. Estado → review. | Amelia (claude-opus-4-8) |

---
baseline_commit: ddac1392eed5c634287ef2ca52ca1ad0cea3de6f
---

# Story 3.1: Tabla de Posiciones Clásica (Acumulada) y Filtro por Jornada

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **jugador de la liga**,
I want **visualizar la tabla de posiciones oficial ordenada por puntos totales y poder filtrarla por jornada individual, viendo quién va pagado/pendiente y con el banner de cobro si me toca**,
so that **conocer mi rendimiento acumulado y por etapa del torneo y sentir la presión social del pago**.

## Acceptance Criteria

1. **Given** un usuario miembro de una liga que entra a la pestaña **Posiciones** (`/standings`)
   **When** carga la página
   **Then** se renderiza una tabla **mobile-first** (`max-w-md`, tokens Championship Gold) con **una fila por miembro** de la liga mostrando: posición (rank), avatar (`profiles.avatar_url`), nombre (`profiles.display_name`), su **badge de pago** (Pagado/Pendiente) y sus **puntos totales acumulados**, ordenada de **mayor a menor** por puntos. Los miembros sin predicciones evaluadas aparecen con `0` puntos (no se omiten).

2. **And** los **puntos totales** de cada miembro se calculan como la suma, sobre **todos los partidos `finished`**, de `PuntosObtenidos = PuntosBase × Multiplicador`, reutilizando **exclusivamente** `src/utils/scoring.ts` (`calculateBasePoints` + `calculatePredictionPoints`) como fuente única de verdad — **sin** reimplementar la fórmula y **sin** depender de la columna `predictions.points_earned` (que todavía no la persiste nadie; ver Dev Notes › Cálculo on-the-fly). Los partidos `scheduled`/`live`/`suspended`/`canceled` **no** suman.

3. **And** existe un control superior de pestañas (**Tab Bar nivel-2 desplazable**: `overflow-x` con scrollbar oculto, fades laterales y chevrons que aparecen/ocultan según `scrollLeft`, con centrado del tab activo vía `scrollIntoView`) con una pestaña **"General"** (acumulada, vista por defecto) y **una pestaña por cada jornada** (`matches.matchday` distinta presente en los partidos). Al seleccionar una jornada, la tabla recalcula y muestra **solo** los puntos obtenidos por cada miembro en los partidos `finished` **de esa jornada**, re-ordenando en consecuencia.

4. **And** si el usuario actual tiene `league_members.payment_status = 'pending'` **y** la liga tiene `requires_payment = true`, se muestra un **banner superior persistente** (sticky) con las instrucciones de cobro del admin (`leagues.payment_instructions` y `leagues.payment_amount`). El banner es **descartable** y permanece oculto el resto de la sesión tras descartarlo. Si el usuario está `paid` o la liga no requiere pago, **no** se muestra banner.

5. **And** ante **empate de puntos** entre dos o más miembros, la clasificación se desempata jerárquicamente por: **(1)** mayor cantidad de **marcadores exactos** (predicciones con puntos base = `5`) en el alcance vigente (acumulado o jornada), **(2)** puntos en **duelos directos 1v1** entre ellos *(Epic 5 — todavía no existe; degrada a `0` para todos, dejando el "seam" documentado, ver Dev Notes › Desempate y conflicto FR-20)*, **(3)** **fecha de registro** en la liga (`league_members.joined_at` ascendente: el que entró antes va primero).

6. **And** estados borde resueltos: liga **sin partidos `finished`** → tabla con todos los miembros a `0` ordenados solo por desempate (exactos=0 → `joined_at`); liga con **un solo miembro** → tabla de una fila; jornada **sin partidos `finished`** → todos a `0` en esa pestaña. La página exige sesión (redirige a `/auth/login` si no hay) y muestra un **empty state** si el usuario no pertenece a ninguna liga (espejando el patrón de `/predictions`).

7. **And** existen pruebas: **unitarias** para la lógica pura de armado/orden/desempate de la tabla (`src/utils/standings.ts`) cubriendo acumulado, filtro por jornada, exclusión de no-`finished`, miembros sin predicción, y los tres niveles de desempate; pruebas de **componente** para `StandingsTable`/Tab Bar/Payment banner (render de filas, cambio de pestaña, badge de pago, banner solo a deudores y su descarte); y una prueba de **integración** que confirme que un miembro autenticado puede leer (vía RLS) las predicciones de sus rivales para partidos `finished` y construir la tabla. `npm run test:unit`, `npm run test:integration`, `npm run lint`, `npm run typecheck` y `npm run build` quedan en verde.

## Tasks / Subtasks

- [x] **Tarea 1 — Motor puro de standings `src/utils/standings.ts` + unit tests** (AC: #2, #5, #6, #7)
  - [x] Crear `src/utils/standings.ts` con función(es) **puras** (sin DB ni DOM), que reciban estructuras ya cargadas y devuelvan filas ordenadas. Firma sugerida:
    - Entrada: `members: { userId, displayName, avatarUrl, paymentStatus, joinedAt }[]`, `matches: { id, status, matchday, homeScore, awayScore }[]`, `predictions: { userId, matchId, homeScorePred, awayScorePred, multiplier }[]`, y un filtro opcional `matchday?: number` (undefined = acumulado/General).
    - Salida: `StandingRow[]` con `{ rank, userId, displayName, avatarUrl, paymentStatus, totalPoints, exactCount }` ya ordenadas y con `rank` asignado (1-based; empates totales tras desempate reciben ranks consecutivos distintos — decisión simple, documentar).
  - [x] Filtrar partidos al alcance: solo `status === 'finished'`; si `matchday` está definido, además `m.matchday === matchday`.
  - [x] Por cada `(member, matchInScope)`: buscar su predicción; si existe, `base = calculateBasePoints({home,away}=pred, {home,away}=actual, 'finished')` y `pts = calculatePredictionPoints(base, multiplier)`; acumular `totalPoints += pts` y `exactCount += (base === 5 ? 1 : 0)`. Miembro sin predicción para ese partido → suma `0`.
  - [x] **Reutilizar `src/utils/scoring.ts`** (`calculateBasePoints`, `calculatePredictionPoints`); NO reimplementar puntos ni multiplicador. Importar `POINTS_EXACT` si conviene en vez de hardcodear `5`.
  - [x] Ordenar por: `totalPoints` desc → `exactCount` desc → `duelPoints` desc *(constante `0` por ahora; dejar parámetro/columna para Epic 5)* → `joinedAt` asc (ISO string compare o `Date`). Ver Dev Notes › Desempate.
  - [x] Unit tests co-localizados `src/utils/standings.test.ts` (caen en el proyecto Vitest `unit`): acumulado básico (orden por puntos), aplicación de multiplicador (un exacto con multiplier 2.0 = 10 pts), exclusión de partidos no-`finished` y de marcadores null, miembro sin predicción = 0, filtro por jornada aísla puntos de esa jornada, desempate por exactos, desempate final por `joined_at`, liga vacía de finished = todos 0.

- [x] **Tarea 2 — Página servidor `src/app/standings/page.tsx`** (AC: #1, #2, #4, #6)
  - [x] **Server Component** (espejar el patrón de `src/app/predictions/page.tsx`): `createClient()` de `@/utils/supabase/server`, `getClaims()` → `userId`; sin sesión → `redirect("/auth/login")`. Accesos dinámicos a cookies dentro de `<Suspense>` (proyecto usa `cacheComponents: true`).
  - [x] Resolver la liga del usuario igual que `/predictions`: `league_members` del usuario, la más reciente por `joined_at` (selector multi-liga es trabajo futuro). Sin liga → `EmptyState` ("Aún no perteneces a una liga", CTA a `/leagues/new").
  - [x] Cargar en paralelo (la RLS ya autoriza estas lecturas para un miembro — ver Dev Notes › RLS, no se requieren políticas nuevas):
    - `league_members` de la liga → join/lookup a `profiles` (`display_name`, `avatar_url`) por `user_id`; traer `payment_status`, `joined_at`, `role`, `user_id`.
    - `matches` con `status = 'finished'` (campos `id, matchday, home_score, away_score, status`). *(No filtrar por liga: `matches` es catálogo común.)*
    - `predictions` de la liga (`.eq('league_id', leagueId)`) de partidos `finished` (campos `user_id, match_id, home_score_pred, away_score_pred, multiplier`).
    - `leagues` (la fila de la liga) para `requires_payment`, `payment_amount`, `payment_instructions`, `name`.
  - [x] Construir el modelo y pasar a `StandingsTable` (client) las filas ya calculadas para "General" **y** los datos crudos necesarios para recalcular por jornada en cliente (o calcular server-side por jornada y pasar un mapa `matchday → rows`; preferible calcular en cliente con `standings.ts` para que el cambio de pestaña sea instantáneo sin round-trip). Decisión recomendada: pasar `members/matches/predictions` serializados + lista de `matchdays` y que `StandingsTable` invoque `buildStandings(...)` por alcance.
  - [x] Determinar `showPaymentBanner = currentMember.payment_status === 'pending' && league.requires_payment === true` y pasar `payment_amount`/`payment_instructions` al banner.
  - [x] Header de página igual al de `/predictions` (eyebrow "PIJA Quiniela" + `<h1>` "Posiciones", `font-display`). Empty states con el mismo componente/estilo.

- [x] **Tarea 3 — `StandingsTable.tsx` + Tab Bar de jornadas (cliente)** (AC: #1, #2, #3, #5)
  - [x] Crear `src/components/standings/StandingsTable.tsx` (`"use client"`): recibe los datos crudos + `matchdays: number[]`, mantiene estado `activeTab` (`"general"` | número de jornada), y deriva las filas con `buildStandings(members, matches, predictions, activeTab === 'general' ? undefined : activeTab)`.
  - [x] Renderizar la **Tab Bar nivel-2 desplazable** (UX-DR-7 / EXPERIENCE `tab-bar-container`): contenedor `overflow-x-auto` con scrollbar oculto, **fades** laterales por gradiente y **chevrons** (`ChevronLeft/Right` de `lucide-react`) que se muestran/ocultan según `scrollLeft`/`scrollWidth`; al activar un tab, centrarlo con `el.scrollIntoView({ inline: 'center', block: 'nearest' })`. Tab activo con estilo `active-badge` (fondo `accent`, texto `accent-foreground`). Labels: "General" + `Jornada {n}` (para knockout, labels compactos quedan para cuando exista `stage`; por ahora jornada numérica). Mínimo de área táctil 48px de alto.
  - [x] Filas: posición a la izquierda (rank; el #1 puede destacarse en dorado `text-accent`/borde `accent` como en el mockup), avatar circular, nombre (`Inter`), badge de pago, y **puntos** a la derecha en `font-display` dorado (`text-accent`). Usar 1 decimal para puntos (p. ej. `44.0`) como el mockup.
  - [x] Avatares: usar `next/image` o `<img>` con fallback a `/assets/avatars/default-player.svg` si `avatar_url` viniera vacío (el default ya lo garantiza la BD, pero defender el render).
  - [x] Accesibilidad: `aria-label` en tabs y en valores de puntos; contraste alto (DESIGN exige 7:1 en texto legible). Tap targets ≥ 48px.

- [x] **Tarea 4 — `PaymentStatusBadge.tsx` y `PaymentBanner.tsx`** (AC: #1, #4)
  - [x] `src/components/standings/PaymentStatusBadge.tsx` (puede ser server/stateless): props `status: PaymentStatus`. `paid` → token `paid-badge` (fondo `success`, texto blanco, "Pagado"); `pending` → token `unpaid-badge` (fondo `destructive`, texto blanco, "Pendiente"). Radio `rounded-full`. Reutilizar `src/components/ui/badge.tsx` si encaja; si no, componente propio mínimo. **Solo display** en esta story (el toggle por el admin es Story 3.3 — NO implementar interacción).
  - [x] `src/components/standings/PaymentBanner.tsx` (`"use client"`): sticky arriba, fondo/realce de aviso (borde `primary`/`destructive`, no verde), muestra monto + instrucciones de cobro y un botón de cierre (`X`). Al cerrar, ocultar y **recordar el descarte durante la sesión** con `sessionStorage` (clave por liga, p. ej. `pq:payBannerDismissed:{leagueId}`); en SSR no acceder a `sessionStorage` (efecto en `useEffect`). EXPERIENCE › payment-banner: "Dismissing hides it until next session".

- [x] **Tarea 5 — Navegación a Posiciones (Bottom Nav mínima)** (AC: #1) _(necesaria: sin esto la página queda huérfana)_
  - [x] Crear `src/components/layout/BottomNavbar.tsx` (`"use client"`, usa `usePathname`) con las 4 entradas del EXPERIENCE: `Pronósticos` (`/predictions`), `Posiciones` (`/standings`), `Duelos` (`/duels` — placeholder, puede apuntar a `#`/deshabilitado), `Mi Cuenta` (`/account` — placeholder). Resaltar la activa. Barra inferior fija (`fixed bottom-0`), `max-w-md` centrada, ≥48px de alto, iconos `lucide-react`.
  - [x] Montarla en **ambas** vistas `/standings` y `/predictions` (añadir `<BottomNavbar/>` y un `pb-*` al contenedor para que no tape contenido). Mantener el cambio en `/predictions` mínimo y no romper sus tests existentes (`tests/unit/predictions-page.test.tsx`).
  - [x] Las rutas placeholder NO requieren páginas reales en esta story; si Next falla al navegar a una ruta inexistente, dejarlas deshabilitadas/no-clickeables hasta sus epics (Duelos = Epic 5, Mi Cuenta/perfil = Story 3.2).

- [x] **Tarea 6 — Tests de componente y de integración** (AC: #7)
  - [x] `src/components/standings/StandingsTable.test.tsx` (Vitest `unit`, jsdom + Testing Library, espejar `MatchCard.test.tsx`): render de N filas en orden correcto; click en pestaña de jornada cambia los puntos mostrados; badge "Pagado"/"Pendiente" según status; #1 destacado.
  - [x] Test del `PaymentBanner`: visible solo cuando se le pasa que el usuario debe; al hacer click en cerrar desaparece y setea `sessionStorage`.
  - [x] Integración `tests/integration/standings-read.test.ts` (reutilizar helpers de `tests/integration/setup.ts` y patrón `createAuthedUser()`): con `service_role` crear liga + 2 miembros (A,B) + un `match` `finished` con resultado + predicciones de ambos; autenticado como A, hacer el mismo `select` de `predictions` que la página y afirmar que A **ve la predicción de B** (partido finished → desbloqueado por RLS) y que `buildStandings(...)` produce el orden esperado. Limpieza en `afterAll` con `auth.admin.deleteUser`. **NO** tocar `tests/integration/triggers.test.ts` (reservado Epic 5).
  - [x] (Opcional) ampliar el seed `supabase/seed.sql` con 1–2 partidos `finished` adicionales de otra jornada para probar manualmente el filtro por jornada (idempotente, `on conflict (external_ref) do nothing`).

- [x] **Tarea 7 — Verificación final** (AC: #7)
  - [x] Activar Node 24: `source ~/.nvm/nvm.sh && nvm use 24` (el Node del shell por defecto es v12 — ver Dev Notes › Toolchain).
  - [x] `npm run test:unit` y `npm run test:integration` (con Supabase local en marcha) en verde.
  - [x] `npm run lint`, `npm run typecheck`, `npm run build` sin errores.
  - [x] Smoke manual: `/standings` carga, ordena por puntos, cambia por jornada, muestra badges y banner solo a un deudor; navegación inferior alterna con `/pronósticos`.

## Dev Notes

### Toolchain de Node (CRÍTICO — leer primero)
El Node del shell por defecto es **v12.22.12** (incompatible). Activa **Node 24 con nvm** antes de cualquier comando (`source ~/.nvm/nvm.sh && nvm use 24`) e invoca la CLI de Supabase **siempre vía `npx supabase ...`**. El stack local corre en `http://127.0.0.1:54321`; el puerto 3000 está ocupado (E2E usa 3100). [Source: memoria del proyecto `node-version-toolchain`; 2-1 Dev Notes]

### Cálculo on-the-fly de la clasificación (DECISIÓN CENTRAL — no la rompas)
`predictions.points_earned` **existe como columna pero nadie la persiste todavía**: la persistencia oficial al pasar un partido a `finished` es trabajo del cron/sync de **Epic 5.3**, aún no implementado. Por tanto, **esta story NO debe leer `points_earned`**; debe **calcular la clasificación en el momento** leyendo los partidos `finished` + las predicciones y aplicando `src/utils/scoring.ts`:
`PuntosObtenidos = calculatePredictionPoints(calculateBasePoints(pred, actual, 'finished'), pred.multiplier)`.
Esto cumple el principio "fuente única de verdad del scoring" de 2.1: la fórmula vive solo en `scoring.ts`; standings (cliente/servidor) y la futura proyección en vivo (Epic 4) la consumen. **No** dupliques la fórmula en SQL ni en `standings.ts`. Cuando Epic 5.3 persista `points_earned`, esta vista podrá migrar a leerla, pero `standings.ts` (orden + desempate) seguirá siendo útil. [Source: 2-1 Dev Notes › Fuente única de verdad del scoring; epics.md "Separación de Standings"; architecture.md#Separación de Clasificación]
- `calculateBasePoints` ya **blinda** marcadores null/no-finitos → `0` (un `finished` con `home_score`/`away_score` null no rompe). [Source: src/utils/scoring.ts; 2-1 Review Patch 4]
- `calculatePredictionPoints(base, multiplier)` redondea a 2 decimales. Para visualizar usa 1 decimal como el mockup (`44.0`). [Source: src/utils/scoring.ts:138]

### RLS — qué puede leer un miembro (NO se necesitan políticas nuevas)
El esquema actual ya autoriza todo lo que la tabla necesita; **no crear migraciones de RLS en esta story**:
- `league_members_select_same_league`: un miembro lee **todas** las filas de `league_members` de su liga (rivales incluidos) → fuente de la lista de participantes, `payment_status` y `joined_at`. [Source: supabase/migrations/20260602041455_rls_and_triggers.sql]
- `profiles_select_authenticated using (true)`: cualquier autenticado lee `display_name`/`avatar_url` de los rivales. [Source: ídem]
- `predictions` select gated: el dueño ve siempre las suyas; **los rivales de la liga solo si el partido está desbloqueado** (`now() >= match_time - 1min`). Como la tabla suma **solo partidos `finished`**, todos están desbloqueados → el miembro autenticado puede leer las predicciones de rivales necesarias. La query `.eq('league_id', leagueId)` filtrada a finished funciona bajo la sesión del usuario. [Source: supabase/migrations/20260603144630_predictions_rls.sql; 2-1 AC #2/#3]
- `leagues_select_member_or_owner`: el miembro lee la fila de su liga (`requires_payment`, `payment_*`). [Source: rls_and_triggers.sql]
> Implicación: **haz las lecturas con el cliente de servidor autenticado del usuario** (`@/utils/supabase/server`), NO con `service_role`. La RLS es justamente la que garantiza que solo cuentan partidos visibles.

### Desempate y CONFLICTO FR-20 vs Story 3.1 AC (decisión tomada)
Hay una discrepancia real en los documentos fuente sobre el **orden** de los criterios de desempate:
- **Story 3.1 (epics.md)** ordena: (1) **marcadores exactos**, (2) **duelos 1v1**, (3) `joined_at`.
- **FR-20 (epics.md Requirements / architecture)** ordena: (1) **duelos 1v1**, (2) marcadores exactos, (3) fecha de registro.
**Decisión para esta story: seguir el AC de la Story 3.1** (exactos → duelos → `joined_at`), porque es la especificación directa de la historia. Como **Epic 5 (duelos) aún no existe** (no hay tablas `challenges`/`challenge_participants`/`point_transactions`), el criterio (2) **degrada a `0` para todos** y queda inerte por ahora → en la práctica el desempate efectivo es **exactos → `joined_at`**. Implementa `standings.ts` con el `duelPoints` como parámetro/columna explícita (constante `0`) para que Epic 5 lo conecte sin reescribir el orden. **Marca este conflicto en "Preguntas para Cris".** [Source: epics.md Story 3.1 AC; epics.md FR-20; architecture.md "criterios estructurados de desempate"]

### Insignias por jornada → NO en esta story (es 3.2)
El AC #2 del epic menciona "los puntos **e insignias** obtenidos en la jornada". La tabla `member_badges` y la lógica de medallas/perfil psicológico son **Story 3.2**. En 3.1 renderiza **solo puntos** por jornada y deja el "seam" para insignias (un slot/columna vacía o nada). No crees `member_badges` ni inventes insignias aquí. [Source: epics.md Story 3.2; epics.md Story 3.1 AC #2]

### Alcance — qué NO hacer en esta historia
- **NO** persistir `points_earned` ni crear cron/trigger de evaluación al `finished` (Epic 5.3).
- **NO** implementar la **tabla en vivo / WebSockets** ni proyección reactiva (Epic 4 / `/live`).
- **NO** implementar **insignias** (`member_badges`), perfil psicológico ni compartir (Story 3.2).
- **NO** implementar el **toggle de pago del admin** ni la **expulsión** de miembros (Story 3.3). El `PaymentStatusBadge` es **solo display**; el banner es **solo informativo + descarte local**.
- **NO** computar duelos 1v1 reales en el desempate (Epic 5) — dejar `duelPoints = 0` documentado.
- **NO** crear migraciones de RLS/SQL nuevas: las lecturas ya están autorizadas (ver Dev Notes › RLS). No tocar `predictions`/`matches`/`league_members` en el esquema.
- **NO** tocar `tests/integration/triggers.test.ts` (reservado a Epic 5).

### Convenciones obligatorias
- **Código**: componentes `PascalCase` (`StandingsTable.tsx`, `PaymentStatusBadge.tsx`, `PaymentBanner.tsx`, `BottomNavbar.tsx`); funciones/variables `camelCase` (`buildStandings`, `totalPoints`). [Source: architecture.md#Code Naming Conventions]
- **Estructura**: vistas en `src/app/standings/page.tsx`; componentes de feature en `src/components/standings/`; layout en `src/components/layout/`; lógica pura en `src/utils/standings.ts`. [Source: architecture.md#Structure Patterns / #Complete Project Directory Structure]
- **UI/diseño**: `max-w-md`, tokens HSL Championship Gold de `globals.css` (NO hardcodear hex; usar clases `bg-card`, `text-accent`, `bg-success`, `bg-destructive`, `border-border`, `text-muted-foreground`). Dorado (`accent`) **solo** para puntos/rank/trofeo; verde (`success`) **solo** para estados afirmativos ("Pagado"). Sin sombras de elevación. Fuentes: `font-display` (Outfit) para puntos/rank/títulos, Inter para nombres/metadata. [Source: DESIGN.md; globals.css]
- **Tab bar**: tokens `tab-bar-container` (fondo `card`, borde inferior `border`), fades + chevrons + `scrollIntoView` centrado. [Source: DESIGN.md#components; EXPERIENCE.md tab-bar-container]
- **Fechas**: `joined_at`/`match_time` son `timestamptz` ISO UTC; el orden por `joined_at` compara timestamps (string ISO ordena lexicográficamente bien, o usa `Date`). [Source: architecture.md#Data Exchange Formats]

### Inteligencia de stories previas (1.2–2.4 — DONE)
Construye sobre lo montado; no lo rompas:
- **Patrón de página servidor + Suspense + EmptyState**: copia la estructura de `src/app/predictions/page.tsx` (getClaims → liga más reciente → empty states → `max-w-md` header). [Source: src/app/predictions/page.tsx]
- **Tipos de dominio** en `src/types/index.ts`: usa `Profile`, `LeagueMember`, `League`, `Match`, `Prediction`, `PaymentStatus`. No redefinas tipos; importa de `@/types`. [Source: src/types/index.ts]
- **scoring.ts** ya exporta `calculateBasePoints`, `calculatePredictionPoints`, `calculatePredictionMultiplier`, `POINTS_EXACT=5`. Reutiliza. [Source: src/utils/scoring.ts]
- **Tests de integración**: helpers `createServiceRoleClient/createAnonClient/createAuthedClient` en `tests/integration/setup.ts`; patrón `createAuthedUser()` y constante `RLS_VIOLATION='42501'` en `schema-rls.test.ts`/`rls-policies.test.ts`. Copia, no recrees. Entorno desde `.env.test.local` (`npx supabase status -o env`). [Source: tests/integration/setup.ts; tests/integration/rls-policies.test.ts]
- **Tests de componente**: Vitest proyecto `unit` (jsdom) recoge `src/**/*.test.tsx`. Espejar `src/components/predictions/MatchCard.test.tsx` (Testing Library, `vi.fn()` para acciones). [Source: vitest.config.ts; src/components/predictions/MatchCard.test.tsx]
- **UI base disponible**: `src/components/ui/badge.tsx`, `button.tsx`, `card.tsx`. Reutilízalos antes de crear nuevos. [Source: src/components/ui/]
- **lucide-react** ya está en uso (`Lock` en MatchCard) → usa sus iconos (`ChevronLeft/Right`, `X`, iconos de nav). No añadas librerías de iconos nuevas. [Source: 2-4 Tarea 4]

### Datos demo para probar (seed)
El seed actual trae `demo-003` Brasil 3–1 Ecuador `finished` (jornada 1) y dos `scheduled`. Para ver puntos reales necesitas **predicciones** de usuarios reales en una liga (el seed no crea usuarios/ligas — los crea el trigger desde `auth.users`). Para smoke manual: crea una liga, únete con 1–2 cuentas, registra predicciones para `demo-003` y cámbialo a `finished` (ya lo está). Para probar el **filtro por jornada** con datos, considera ampliar el seed con un `finished` de jornada 2. [Source: supabase/seed.sql]

### Project Structure Notes
- Archivos **NUEVOS**: `src/app/standings/page.tsx`, `src/components/standings/StandingsTable.tsx`, `src/components/standings/PaymentStatusBadge.tsx`, `src/components/standings/PaymentBanner.tsx`, `src/components/layout/BottomNavbar.tsx`, `src/utils/standings.ts`, `src/utils/standings.test.ts`, `src/components/standings/StandingsTable.test.tsx`, `tests/integration/standings-read.test.ts`.
- Archivos **MODIFICADOS**: `src/app/predictions/page.tsx` (montar `<BottomNavbar/>` + padding inferior; cambio mínimo, no romper sus tests), opcionalmente `supabase/seed.sql` (partido finished de otra jornada).
- Todo alineado con el árbol de la arquitectura (`standings/`, `components/standings/`, `components/layout/BottomNavbar.tsx`, `utils/standings.ts` previstos). Sin conflictos con 1.1–2.4.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1: Tabla de Posiciones Clásica (Acumulada) y Filtro por Jornada]
- [Source: _bmad-output/planning-artifacts/epics.md#FR-5 / FR-18 / FR-20 / UX-DR-6 / UX-DR-7 / UX-DR-10]
- [Source: _bmad-output/planning-artifacts/architecture.md#Separación de Clasificación (Visual vs. Oficial)]
- [Source: _bmad-output/planning-artifacts/architecture.md#Complete Project Directory Structure / #Requirements to Structure Mapping]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/DESIGN.md (tokens, components, tab-bar-container, paid/unpaid badges)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/EXPERIENCE.md (Tabla de Posiciones, payment-banner, tab-bar-container, Bottom Nav, Cero Miembros)]
- [Source: src/utils/scoring.ts (calculateBasePoints, calculatePredictionPoints, POINTS_EXACT)]
- [Source: src/app/predictions/page.tsx (patrón Server Component + Suspense + EmptyState + resolución de liga)]
- [Source: supabase/migrations/20260602041455_rls_and_triggers.sql (RLS league_members/profiles/leagues)]
- [Source: supabase/migrations/20260603144630_predictions_rls.sql (select gated de predictions)]
- [Source: supabase/migrations/20260602041410_init_schema.sql (columnas league_members.payment_status/joined_at, leagues.payment_*)]
- [Source: tests/integration/rls-policies.test.ts; tests/integration/setup.ts (helpers de integración)]

## Preguntas para Cris (resolver antes/durante dev)

1. **Conflicto de desempate (FR-20 vs Story 3.1 AC).** El AC de 3.1 ordena los criterios como **exactos → duelos 1v1 → `joined_at`**, pero FR-20 los ordena **duelos 1v1 → exactos → registro**. Implementé siguiendo el **AC de la Story 3.1**. ¿Confirmas ese orden, o el canónico es FR-20? (Hoy es inerte porque los duelos llegan en Epic 5; afecta solo cuando exista escrow.)
2. **Predicciones por-liga.** Recordatorio de la bifurcación abierta en 2.1: las predicciones son **por-liga** (`predictions.league_id`). La tabla suma puntos **dentro de la liga seleccionada**, coherente con esa decisión. ¿Confirmas "una clasificación independiente por liga"?
3. **Alcance de "puntos por jornada".** En la vista por jornada muestro **solo puntos** (las insignias son Story 3.2). ¿OK dejar el slot de insignias vacío hasta 3.2?
4. **Bottom Nav ahora.** Para que `/standings` sea alcanzable agrego una **barra inferior mínima** (Pronósticos/Posiciones activas; Duelos/Mi Cuenta como placeholders deshabilitados hasta sus epics). ¿Prefieres eso, o un simple link temporal desde `/predictions`?

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Opus 4.8)

### Debug Log References

- `npm run test:unit`: **121/121** (incluye 20 nuevos: 9 `standings.test.ts`, 7 `StandingsTable.test.tsx`, 4 `standings-page.test.tsx`).
- `npm run test:integration`: **37/37** (incluye 1 nuevo `standings-read.test.ts`), con Supabase local activo.
- `npm run lint` y `npm run typecheck`: 0 errores.
- `npm run build`: en verde; ruta `/standings` compilada (PPR).
- `npx supabase db reset`: idempotente con el seed ampliado (demo-004 finished J2).
- Toolchain: nvm Node 24 + `npx supabase` (el Node del shell por defecto es v12).

### Completion Notes List

- **Motor puro (Tarea 1)** — `src/utils/standings.ts`: `buildStandings(members, matches, predictions, matchday?)` calcula la tabla **on-the-fly** reutilizando SOLO `scoring.ts` (`calculateBasePoints` + `calculatePredictionPoints` + `POINTS_EXACT`). NO lee `predictions.points_earned` (Epic 5.3 aún no la persiste). Solo cuentan partidos `finished`; filtro por jornada opcional. Desempate: puntos desc → exactos desc → `duelPoints` (0, seam Epic 5) → `joined_at` asc. Helper `finishedMatchdays()` para las pestañas. Suma redondeada a 2 decimales. Desarrollado TDD (rojo→verde, 9 unit).
- **Página servidor (Tarea 2)** — `src/app/standings/page.tsx`: Server Component espejando `/predictions` (getClaims→liga más reciente→empty states, `max-w-md`, header). Lecturas con la **sesión del usuario** (no `service_role`): `league_members` + `profiles(...)` embebido, `matches` `finished`, `predictions` de la liga acotadas a finished (`.in(match_id)`), y la fila `leagues`. `showPaymentBanner = requires_payment && currentMember.payment_status==='pending'`. Mapea snake_case→camelCase para `StandingMatch`.
- **Tabla + Tab Bar (Tarea 3)** — `src/components/standings/StandingsTable.tsx` (cliente): estado `activeKey`, deriva filas con `buildStandings`. Tab Bar nivel-2 desplazable (UX-DR-7): `overflow-x` con scrollbar oculto, fades por gradiente + chevrons que aparecen según `scrollLeft`/`scrollWidth`, centrado del tab activo con `scrollIntoView({inline:'center'})`. Filas: rank (líder en dorado `accent`), avatar, nombre, `PaymentStatusBadge`, puntos en `font-display` dorado (1 decimal). Empty state "Aún no hay participantes" (EXPERIENCE). Tap targets ≥48px, `aria-label` en rank/puntos/tabs.
- **Badge + Banner (Tarea 4)** — `PaymentStatusBadge.tsx` (solo display: verde `success` "Pagado" / carmesí `destructive` "Pendiente", `rounded-full`); `PaymentBanner.tsx` (cliente, sticky, descartable con `sessionStorage` por liga, arranca oculto para evitar flash en hidratación).
- **Bottom Nav (Tarea 5)** — `src/components/layout/BottomNavbar.tsx`: Pronósticos/Posiciones activas; Duelos (Epic 5) y Mi Cuenta (3.2) como placeholders deshabilitados (`aria-disabled`, sin Link). Montada en `/standings` y `/predictions` (default export, con `pb-24`). El test existente de `/predictions` apunta a `PredictionsBoard` → no afectado.
- **Tests (Tarea 6)** — componentes (`StandingsTable.test.tsx`: orden de filas, líder, badges, cambio de pestaña recalcula, empty state; `PaymentBanner`: muestra/descarta/persiste), página (`standings-page.test.tsx`: redirect sin sesión, empty sin liga, banner solo a deudor con pago requerido), e integración (`standings-read.test.ts`: un miembro lee predicciones de rivales en finished vía RLS y `buildStandings` ordena bien).
- **Seed (Tarea 6 opc.)**: `demo-004` Francia 2–0 Croacia `finished` jornada 2 para probar el filtro por jornada manualmente (idempotente).
- **Alcance respetado**: NO se persistió `points_earned` ni cron/trigger (Epic 5.3); NO live/WebSockets (Epic 4); NO insignias/perfil (3.2); NO toggle de pago/expulsión (3.3, badge solo display); duelos en desempate inertes (`0`, seam Epic 5); **sin migraciones nuevas** (la RLS de 1.2/2.1 ya autoriza las lecturas). `triggers.test.ts` intacto.
- **Decisión de desempate**: implementado por el AC de la Story 3.1 (exactos → duelos → `joined_at`). **Conflicto con FR-20** (duelos → exactos → registro) registrado en "Preguntas para Cris" #1; hoy inerte porque los duelos llegan en Epic 5.

### File List

**Código (nuevo):**
- `src/utils/standings.ts`
- `src/utils/standings.test.ts`
- `src/app/standings/page.tsx`
- `src/components/standings/StandingsTable.tsx`
- `src/components/standings/StandingsTable.test.tsx`
- `src/components/standings/PaymentStatusBadge.tsx`
- `src/components/standings/PaymentBanner.tsx`
- `src/components/layout/BottomNavbar.tsx`
- `tests/unit/standings-page.test.tsx`
- `tests/integration/standings-read.test.ts`

**Código (modificado):**
- `src/app/predictions/page.tsx` (monta `<BottomNavbar/>` + `pb-24`)
- `supabase/seed.sql` (partido `demo-004` finished jornada 2)

## Change Log

| Fecha       | Versión | Descripción                                                                                                                                                                                                 | Autor        |
| ----------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 2026-06-03  | 0.1     | Tabla de posiciones clásica + filtro por jornada (Tab Bar desplazable), badges de pago públicos, banner de cobro descartable, bottom nav y motor puro `standings.ts` (cálculo on-the-fly vía `scoring.ts`). Tests unit/componente/página/integración en verde. Story implementada — lista para review. | Amelia (Dev) |

## Review Findings

> Revisión adversarial (Blind Hunter + Edge Case Hunter + Acceptance Auditor) — 2026-06-03. Triage: 0 decisiones, 4 patches, 3 diferidos, ~14 descartados. **Dos hallazgos HIGH del Edge Case Hunter (numeric de Postgres llegaría como string → `multiplier` rompe scoring a 0; `payment_amount.toFixed` crashea) se verificaron EMPÍRICAMENTE como FALSOS POSITIVOS**: contra el Postgres local, `numeric` se serializa como **number** (multiplier 2.5, payment_amount 20) y el embed `profiles` como **objeto** (no array). Las 7 ACs se cumplen; sin violaciones de scope.

### Patches (aplicados 2026-06-03)

> Los 4 patches se aplicaron y validaron. Verificación: lint + typecheck limpios, unit **123/123** (+2 tests: guarda null no-0-0 y desempate determinista por `userId`), integration 37/37.

- [x] [Review][Patch] Desempate no determinista ante empate total (puntos+exactos+joined_at idénticos): falta una clave final estable → añadir `userId` como último criterio de orden [src/utils/standings.ts]
- [x] [Review][Patch] `PaymentBanner` usa `role="alert"` (live region assertiva, re-anuncia en cada montaje) para contenido persistente → cambiar a `role="status"` [src/components/standings/PaymentBanner.tsx]
- [x] [Review][Patch] `PaymentStatusBadge` "Pagado" usa `text-primary-foreground` en vez del token correcto `text-success-foreground` (ambos blancos; corrección de token) [src/components/standings/PaymentStatusBadge.tsx]
- [x] [Review][Patch] Hueco de cobertura: la única prueba de "finished con marcadores null → 0" usa predicción 0-0 (valor invariante al bug); añadir caso con predicción ≠ 0-0 vs null/null → 0 [src/utils/standings.test.ts]

### Deferred

- [x] [Review][Defer] Tabs por `matchday` no contemplan `matchday` null ni jornadas duplicadas entre fases (knockout): un finished sin jornada cuenta en General pero no tiene pestaña (General ≠ Σ jornadas) y dos fases con el mismo número colapsan en una pestaña [src/utils/standings.ts] — deferred: la story ya difirió las labels por `stage`/knockout a futuro; los datos reales (seed/sync) siempre fijan `matchday`
- [x] [Review][Defer] Sin paginación: los selects de `predictions`/`matches`/`league_members` no acotan filas; el tope por defecto de PostgREST (~1000) puede truncar silenciosamente las predicciones en un Mundial completo (p. ej. 15 miembros × >66 finished > 1000) → puntajes subestimados sin error [src/app/standings/page.tsx] — deferred: solapa con la persistencia oficial de standings (Epic 5.3) que reemplazará esta query on-the-fly
- [x] [Review][Defer] Items deshabilitados de `BottomNavbar` (Duelos/Mi Cuenta): `aria-disabled` sobre `<span>` no enfocable y contraste `text-muted-foreground/40` (placeholder) [src/components/layout/BottomNavbar.tsx] — deferred: placeholders temporales; se reemplazan por destinos reales al aterrizar Epic 5 y Story 3.2

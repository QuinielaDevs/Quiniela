---
baseline_commit: 787e22692bfe331d3cb722ea4ed8798c9f8b4df2
---

# Story 3.2: Insignias Humorísticas y Perfiles Psicológicos de Juego

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **jugador de la liga**,
I want **que el sistema me otorgue insignias humorísticas y defina mi perfil psicológico de juego al cierre de cada jornada**,
so that **presumir o bromear con mis amigos en WhatsApp/redes sin perder el tono competitivo de la quiniela**.

## Acceptance Criteria

1. **Given** un usuario autenticado que pertenece a una liga y existe al menos una jornada cerrada
   **When** entra a **Mi Cuenta** (`/account`)
   **Then** se renderiza una vista mobile-first (`max-w-md`, Championship Gold) con su avatar, nombre, liga activa, perfil psicológico vigente y las medallas obtenidas por jornada.

2. **And** existe la tabla `member_badges` para registrar el historial de medallas por liga, usuario, jornada y tipo de insignia. La tabla usa RLS: un miembro de la liga puede leer insignias de esa liga, pero solo puede insertar/actualizar sus propias insignias; usuarios ajenos/anon no pueden leer ni escribir.

3. **And** existe la tabla `member_game_profiles` para persistir el perfil psicológico por liga, usuario y jornada. La vista muestra el perfil más reciente por `matchday` cerrado: **Optimista**, **Conservador** o **Cazador de Sorpresas**.

4. **And** al cargar `/account`, el servidor materializa de forma **idempotente** las insignias y perfil del usuario actual para cada jornada cerrada que aún no tenga registros, reutilizando `src/utils/scoring.ts` y los mismos datos base de 3.1 (`matches` `finished` + predicciones propias). La operación no usa `service_role` en la página y no calcula premios de otros usuarios.

5. **And** se asignan medallas con reglas deterministas:
   - **Nostradamus**: al menos un marcador exacto difícil en la jornada. Difícil v1 = marcador exacto con total real de goles `>= 4`, margen real `>= 3`, o algún equipo con `>= 3` goles.
   - **El Salado**: el usuario hizo al menos una predicción en la jornada y terminó con `0` puntos en todos los partidos `finished` evaluados. No se otorga por ausencia total de predicciones.
   - **El Tibio**: más de la mitad de sus predicciones de la jornada fueron empates (`home_score_pred === away_score_pred`).

6. **And** el perfil psicológico se asigna con reglas deterministas v1:
   - **Conservador**: mayoría de predicciones ajustadas (`0-0`, `1-0`, `0-1`, `1-1`, o total de goles predicho `<= 2` con diferencia `<= 1`).
   - **Optimista**: promedio de goles predichos por partido `>= 3.5` y no cae en Conservador.
   - **Cazador de Sorpresas**: si no cae en los anteriores y predice victoria visitante en `>= 40%` de sus predicciones de la jornada. Esto es un proxy temporal porque el esquema aún no guarda cuotas/favoritos por partido.
   - Empate de heurísticas: `Conservador` gana sobre `Optimista`, y `Optimista` sobre `Cazador de Sorpresas`; si no hay señales suficientes, usar `Conservador` como default explícito.

7. **And** el botón **Compartir Perfil** se dispara por interacción del usuario y genera una tarjeta visual/texto de pique con nombre, liga, perfil vigente y hasta 3 medallas recientes. Si el navegador soporta Web Share con archivos, comparte un PNG generado por canvas; si no, comparte texto/URL con `navigator.share`; si tampoco está disponible, abre `https://wa.me/?text=...`. La UI no falla en escritorio ni en navegadores sin Web Share API.

8. **And** se activa **Mi Cuenta** en `BottomNavbar` y se mantiene `Duelos` deshabilitado hasta Epic 5. La nueva ruta `/account` exige sesión, redirige a `/auth/login` si no hay usuario, muestra empty state si el usuario no pertenece a una liga y conserva el padding inferior para la navegación.

9. **And** existen pruebas: unitarias para el evaluador de insignias/perfil, tests de componente para la tarjeta y share fallback, tests de página para `/account`, e integración DB/RLS para `member_badges` y `member_game_profiles`. `npm run test:unit`, `npm run test:integration`, `npm run lint`, `npm run typecheck` y `npm run build` quedan en verde.

## Tasks / Subtasks

- [x] **Tarea 1 - Migración de premios por jornada + RLS** (AC: #2, #3, #9)
  - [x] Crear migración `supabase/migrations/<timestamp>_member_badges_and_profiles.sql`.
  - [x] Crear `public.member_badges`:
    - `id uuid primary key default gen_random_uuid()`
    - `league_id uuid not null references public.leagues(id) on delete cascade`
    - `user_id uuid not null references public.profiles(id) on delete cascade`
    - `matchday int not null check (matchday > 0)`
    - `badge_type text not null check (badge_type in ('nostradamus','el_salado','el_tibio'))`
    - `badge_label text not null`
    - `reason text not null`
    - `points numeric(6,2) not null default 0`
    - `earned_at timestamptz not null default now()`
    - `created_at timestamptz not null default now()`
    - `unique (league_id, user_id, matchday, badge_type)`
  - [x] Crear `public.member_game_profiles`:
    - `id uuid primary key default gen_random_uuid()`
    - `league_id uuid not null references public.leagues(id) on delete cascade`
    - `user_id uuid not null references public.profiles(id) on delete cascade`
    - `matchday int not null check (matchday > 0)`
    - `profile_type text not null check (profile_type in ('optimista','conservador','cazador_sorpresas'))`
    - `profile_label text not null`
    - `summary text not null`
    - `computed_at timestamptz not null default now()`
    - `created_at timestamptz not null default now()`
    - `unique (league_id, user_id, matchday)`
  - [x] Añadir índices: `member_badges(league_id,user_id,matchday desc)`, `member_badges(league_id,matchday)`, `member_game_profiles(league_id,user_id,matchday desc)`.
  - [x] Habilitar RLS en ambas tablas.
  - [x] Políticas RLS:
    - `select`: `public.fn_user_in_league(league_id)` para miembros de la liga.
    - `insert/update`: `user_id = auth.uid()` y `public.fn_user_in_league(league_id)`.
    - No `delete` para usuarios.
  - [x] Conceder permisos de columna a `authenticated` si se revoca algo a nivel tabla. Mantener el patrón de grants de `predictions` si se necesita granularidad.
  - [x] Ejecutar `npm run db:types` con Node 24 para regenerar `src/types/database.types.ts`.
  - [x] Actualizar `src/types/index.ts` exportando `MemberBadge`, `MemberBadgeInsert`, `MemberGameProfile`, `MemberGameProfileInsert` y unions `BadgeType` / `GameProfileType`.

- [x] **Tarea 2 - Motor puro de insignias/perfil** (AC: #4, #5, #6, #9)
  - [x] Crear `src/utils/member-awards.ts` sin dependencias de DB/DOM.
  - [x] Tipos sugeridos:
    - `AwardMatch = { id, matchday, status, homeScore, awayScore }`
    - `AwardPrediction = { matchId, homeScorePred, awayScorePred, multiplier }`
    - `DerivedBadge = { badgeType, badgeLabel, reason, points }`
    - `DerivedGameProfile = { profileType, profileLabel, summary }`
  - [x] Implementar `closedMatchdays(matches)`: jornada cerrada = todos sus partidos están en `finished | suspended | canceled` y tiene al menos un partido `finished`.
  - [x] Implementar `deriveAwardsForMatchday(matches, predictions, matchday)`:
    - Filtrar solo partidos `finished` de la jornada.
    - Reutilizar `calculateBasePoints`, `calculatePredictionPoints` y `POINTS_EXACT` de `src/utils/scoring.ts`.
    - Calcular `predictedCount`, `totalPoints`, `exactDifficultCount`, `drawPredictedCount`, `tightPredictionCount`, `awayWinPredictedCount`, `averagePredictedGoals`.
    - Devolver 0..3 badges; permitir varias medallas en una misma jornada si cumple varias reglas.
    - Devolver siempre un perfil si `predictedCount > 0`; si `predictedCount === 0`, devolver perfil null y no crear registros.
  - [x] No leer ni depender de `predictions.points_earned`. Sigue nullable y su persistencia oficial es Epic 5.3.
  - [x] Tests unitarios `src/utils/member-awards.test.ts`: Nostradamus difícil, exacto no difícil no otorga Nostradamus, Salado con predicciones cero, no Salado por ausencia, Tibio mayoría empates, Conservador, Optimista, Cazador de Sorpresas, prioridad de perfil, jornadas cerradas vs abiertas/suspended/canceled.

- [x] **Tarea 3 - Materialización idempotente en servidor** (AC: #1, #4, #9)
  - [x] Crear helper server-only `src/app/account/account-awards.ts` o equivalente local a la ruta.
  - [x] `materializeCurrentMemberAwards({ supabase, leagueId, userId })`:
    - Cargar `matches` con `matchday not null` y estados necesarios.
    - Cargar predicciones **propias** del usuario en la liga (`predictions.user_id = userId`); el dueño siempre las puede leer por RLS.
    - Cargar registros existentes de `member_badges` y `member_game_profiles` para `(leagueId,userId)`.
    - Para cada jornada cerrada sin registros, derivar awards y upsert con `.upsert(..., { onConflict: 'league_id,user_id,matchday,badge_type' })` para badges y `league_id,user_id,matchday` para profile.
  - [x] La página usa el cliente SSR autenticado (`@/utils/supabase/server`), nunca `service_role`.
  - [x] Manejar errores de upsert sin romper la página: mostrar los registros ya existentes y loguear una nota corta en servidor si la materialización falla.
  - [x] No crear cron, Edge Function ni endpoint público en esta historia. La materialización lazy es intencional para coste cero; futuro cron puede reutilizar el motor puro.

- [x] **Tarea 4 - Página `/account` (Mi Cuenta)** (AC: #1, #7, #8)
  - [x] Crear `src/app/account/page.tsx` como Server Component con `<Suspense>` igual que `/standings` y `/predictions` (`cacheComponents: true`).
  - [x] Flujo:
    - `createClient()` -> `auth.getClaims()` -> sin sesión `redirect('/auth/login')`.
    - Resolver liga activa igual que `/standings`: membresía más reciente por `joined_at`.
    - Sin liga -> `EmptyState` con CTA a `/leagues/new`.
    - Cargar `profiles`, `leagues`, `member_badges`, `member_game_profiles`.
    - Llamar la materialización idempotente antes de leer/mostrar, o leer de nuevo después si se insertaron registros.
  - [x] Layout:
    - `main` con `min-h-svh bg-background px-4 py-6 pb-24 text-foreground`.
    - Contenedor `mx-auto max-w-md`.
    - Header: eyebrow `PIJA Quiniela`, h1 `Mi Cuenta`.
    - Tarjeta de perfil con avatar, nombre, liga, perfil vigente y resumen.
    - Grid/lista de medallas recientes por jornada, usando tokens `bg-card`, `border-border`, `text-accent`, `text-muted-foreground`.
  - [x] Estados:
    - Sin jornadas cerradas -> mensaje: "Todavía no hay jornadas cerradas para perfilar tu juego."
    - Sin medallas pero con perfil -> mostrar perfil y empty state de medallas: "Aún no cae una medalla, pero el torneo es largo."
    - Sin predicciones en jornadas cerradas -> no crear perfil; mostrar mensaje claro sin culpar al usuario.
  - [x] Accesibilidad: tap targets 48px, `aria-label` para avatar/card share, texto no debe solaparse en 320px.

- [x] **Tarea 5 - Componentes de cuenta y compartir** (AC: #1, #7, #9)
  - [x] Crear `src/components/account/ProfileSummaryCard.tsx`.
  - [x] Crear `src/components/account/BadgeHistory.tsx`.
  - [x] Crear `src/components/account/ShareProfileButton.tsx` (`"use client"`).
  - [x] Crear `src/utils/share-profile.ts` con helpers puros:
    - `buildProfileShareText({ displayName, leagueName, profileLabel, badges })`
    - `buildWhatsAppShareUrl(text)`
  - [x] En `ShareProfileButton`:
    - Generar PNG con Canvas API en el click del usuario. No añadir `html2canvas`, `dom-to-image` ni otra dependencia salvo necesidad real.
    - Si `navigator.canShare?.({ files: [file] })`, llamar `navigator.share({ title, text, files: [file] })`.
    - Si no comparte archivos pero `navigator.share` existe, compartir `{ title, text, url: window.location.href }`.
    - Si falla con `AbortError`, no mostrar error.
    - Si falla por soporte/permisos, abrir WhatsApp fallback con `window.open(waUrl, '_blank', 'noopener,noreferrer')`.
  - [x] Microcopy sugerido para share: `Mi perfil en La Pija Quiniela: {perfil}. Medallas: {badges}. ¿Quién me baja de ahí?`
  - [x] No usar emoji en UI crítica si rompe consistencia; iconos lucide (`Share2`, `Medal`, `Sparkles`, `ShieldQuestion`) son preferibles.

- [x] **Tarea 6 - Activar navegación** (AC: #8)
  - [x] Modificar `src/components/layout/BottomNavbar.tsx`: `/account` pasa a `enabled: true`.
  - [x] Mantener `/duels` deshabilitado hasta Epic 5.
  - [x] Actualizar comentarios que todavía digan que Mi Cuenta está pendiente.
  - [x] Añadir/actualizar test de navegación si existe cobertura del componente; si no, cubrirlo indirectamente en los tests de página.

- [x] **Tarea 7 - Tests de página, componentes e integración** (AC: #2, #3, #7, #9)
  - [x] Unit/component:
    - `src/components/account/ProfileSummaryCard.test.tsx`: renderiza perfil, medallas y empty states.
    - `src/components/account/ShareProfileButton.test.tsx`: `navigator.share` con texto, `navigator.canShare` con archivo, fallback WhatsApp, y `AbortError` silencioso.
    - `tests/unit/account-page.test.tsx`: redirect sin sesión, empty sin liga, carga de cuenta con perfil/medallas, materialización llamada.
  - [x] Integration:
    - `tests/integration/member-awards-rls.test.ts`: anon no lee; miembro de la liga lee badges/profiles de la liga; ajeno no lee; usuario solo inserta sus propios registros; no puede insertar para otro `user_id`.
    - `tests/integration/account-awards-materialization.test.ts`: con service_role preparar usuario/liga/partido finished/predicción; con cliente autenticado llamar helper o replicar queries y confirmar upsert idempotente.
  - [x] No tocar `tests/integration/triggers.test.ts` (reservado Epic 5).

- [x] **Tarea 8 - Verificación final** (AC: #9)
  - [x] Activar Node 24 antes de comandos: `source ~/.nvm/nvm.sh && nvm use 24`.
  - [x] Si hay migración nueva: `npx supabase db reset` y luego `npm run db:types`.
  - [x] `npm run test:unit`.
  - [x] `npm run test:integration` con Supabase local activo.
  - [x] `npm run lint`.
  - [x] `npm run typecheck`.
  - [x] `npm run build`.
  - [x] Smoke manual: `/account` con usuario sin liga, con liga sin jornadas cerradas, y con una jornada finished + predicción que otorgue al menos una medalla.

### Review Findings

- [x] [Review][Decision] Decidir modelo de escritura de premios — Decisión aceptada para MVP: mantener el modelo literal del AC actual (`insert, update` propios con RLS por usuario + pertenencia a liga) y documentar que un flujo/RPC validado puede endurecerse en una story futura si estos premios dejan de ser solo banter. Evidencia: `supabase/migrations/20260604000100_member_badges_and_profiles.sql:75`, `supabase/migrations/20260604000100_member_badges_and_profiles.sql:83`, `supabase/migrations/20260604000100_member_badges_and_profiles.sql:100`, `supabase/migrations/20260604000100_member_badges_and_profiles.sql:108`.
- [x] [Review][Patch] Distinguir jornada cerrada sin predicciones del estado sin jornadas cerradas [`src/components/account/ProfileSummaryCard.tsx:55`]
- [x] [Review][Patch] Filtrar perfil/medallas renderizados a matchdays realmente cerrados [`src/app/account/page.tsx:81`]
- [x] [Review][Patch] No tratar partidos `finished` sin marcador real como evaluables [`src/utils/member-awards.ts:117`]
- [x] [Review][Patch] Manejar errores de queries de cuenta sin convertirlos en estados vacíos o placeholders [`src/app/account/page.tsx:33`]
- [x] [Review][Patch] Hacer robusto el fallback de share cuando falla la generación de canvas [`src/components/account/ShareProfileButton.tsx:35`]
- [x] [Review][Patch] Evitar clipping en el PNG compartido con nombres/medallas largas [`src/components/account/ShareProfileButton.tsx:96`]
- [x] [Review][Patch] Corregir fixture flaky que asume orden estable entre partidos de la misma jornada [`tests/integration/account-awards-materialization.test.ts:72`]
- [x] [Review][Patch] Cubrir RLS de update/insert simétricamente para badges y profiles [`tests/integration/member-awards-rls.test.ts:164`]
- [x] [Review][Patch] Corregir semántica accesible del avatar (`alt=""` con `aria-label`) [`src/components/account/ProfileSummaryCard.tsx:30`]

## Dev Notes

### Toolchain de Node (CRÍTICO)
El Node del shell por defecto ha sido v12 en historias previas. Activa **Node 24** antes de cualquier comando: `source ~/.nvm/nvm.sh && nvm use 24`. Usa la CLI de Supabase vía `npx supabase ...`. [Source: 3-1 Dev Notes; package.json]

### Estado actual desde Story 3.1
Ya existen:
- `/standings`, `StandingsTable`, `PaymentBanner`, `PaymentStatusBadge`, `BottomNavbar`.
- `src/utils/standings.ts`, que calcula puntos on-the-fly desde `matches finished` + `predictions`, reutilizando `src/utils/scoring.ts`.
- `/account` aparece en `BottomNavbar` pero está deshabilitado explícitamente esperando Story 3.2.

No reescribas ni dupliques scoring. Para insignias y perfiles usa `src/utils/scoring.ts` como fuente única de verdad para puntos base/multiplicador.

### Cálculo de jornada cerrada
Para esta story, una jornada cerrada es una `matchday` donde:
- existe al menos un partido con `status = 'finished'`;
- todos los partidos con esa `matchday` están en estado terminal: `finished`, `suspended` o `canceled`;
- las medallas solo cuentan partidos `finished`; `suspended/canceled` no suman y no generan exactos.

No basta con mirar solo los `finished`, porque una jornada con partidos pendientes podría materializar premios demasiado pronto.

### Datos y RLS
`member_badges` y `member_game_profiles` son datos de banter/perfil dentro de una liga, no predicciones secretas. La lectura puede ser visible a miembros de la misma liga usando `public.fn_user_in_league(league_id)`, igual que la lectura de `league_members`/`leagues`.

La materialización desde `/account` debe escribir **solo para el usuario actual** con el cliente SSR autenticado. No uses `service_role` en la app. Service role queda para fixtures/tests, como en `tests/integration/standings-read.test.ts`.

### Por qué existe `member_game_profiles`
El AC nombra explícitamente `member_badges`, pero el perfil psicológico también es un resultado por jornada/liga. Guardarlo en `profiles` sería incorrecto porque:
- un usuario puede pertenecer a varias ligas;
- el perfil cambia por jornada;
- `profiles` es identidad global de Google, no historial competitivo.

Por eso se crea `member_game_profiles` con unique `(league_id,user_id,matchday)`.

### Reglas de medallas v1
Estas reglas concretan el PRD/epics para que el dev agent no invente criterios:
- **Nostradamus**: marcador exacto difícil. Como no hay cuotas ni probabilidad externa en el esquema, dificultad v1 se define por rareza del marcador real: total de goles `>= 4`, margen `>= 3`, o algún equipo `>= 3`.
- **El Salado**: cero puntos tras haber jugado al menos un partido. No premiar la ausencia.
- **El Tibio**: mayoría de empates pronosticados.

Permite múltiples medallas por jornada. Ejemplo: alguien puede ser "El Tibio" y "El Salado" si apostó muchos empates y ninguno le dio puntos.

### Reglas de perfil psicológico v1
La PRD menciona favoritos/cuotas para "Cazador de Sorpresas", pero el esquema actual no guarda odds ni favorito por partido. No añadas una integración de odds ni columnas de cuotas en esta story. Usa el proxy documentado:
- Conservador = mayoría de predicciones ajustadas.
- Optimista = promedio de goles predichos alto.
- Cazador de Sorpresas = frecuencia alta de victorias visitantes predichas.

Registra esta limitación en el comentario/summary del perfil o en `Questions for Cris`; una futura story puede reemplazar el proxy cuando exista metadata de favoritos.

### Compartir perfil: Web Share API
Información actual (verificada en docs oficiales):
- Web Share API requiere secure context y no está disponible de forma uniforme en todos los navegadores; debe haber fallback. [Source: MDN Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API)
- `navigator.share()` debe ejecutarse por activación del usuario y puede lanzar errores por permisos, falta de soporte o cancelación. [Source: MDN navigator.share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)
- Para compartir archivos, primero validar con `navigator.canShare({ files })`; si retorna false, compartir texto/URL o abrir WhatsApp. [Source: MDN navigator.canShare](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/canShare)

### Next.js / cacheComponents
`next.config.ts` tiene `cacheComponents: true`. Las lecturas dinámicas de cookies/auth en Server Components deben vivir dentro de `<Suspense>` o seguir el patrón ya aplicado en `/standings`. [Source: Next.js cacheComponents docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents)

### Supabase RLS
Supabase recomienda habilitar RLS en tablas del schema `public` expuesto y definir políticas explícitas por rol. Esta story debe habilitar RLS para las dos tablas nuevas y cubrirlo con integración. [Source: Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security)

### UI/UX
- Mobile-first `max-w-md`, paleta Championship Gold, sin light mode.
- Dorado (`text-accent`) para perfil destacado, medallas, puntos/ranking.
- Verde solo para afirmativos; carmesí para acciones/destructivo/pendiente.
- Evitar sombras nuevas: `Card` base trae `shadow`; si se usa, sobrescribir con `shadow-none` para respetar el sistema.
- Usar lucide icons; no añadir librerías de iconos.
- No crear una landing o explicación de feature: `/account` debe ser la experiencia usable.

### Alcance - NO hacer
- NO implementar Duelos ni activar `/duels`.
- NO implementar control de pagos/expulsión (Story 3.3).
- NO crear cron de sync ni endpoint público para premios.
- NO integrar APIs de cuotas/favoritos.
- NO persistir `predictions.points_earned` ni cambiar el motor oficial de puntos (Epic 5.3).
- NO usar `service_role` desde una página/app route visible a usuario.
- NO tocar `tests/integration/triggers.test.ts`.

### Project Structure Notes

Archivos **NUEVOS** esperados:
- `supabase/migrations/<timestamp>_member_badges_and_profiles.sql`
- `src/utils/member-awards.ts`
- `src/utils/member-awards.test.ts`
- `src/app/account/page.tsx`
- `src/app/account/account-awards.ts`
- `src/components/account/ProfileSummaryCard.tsx`
- `src/components/account/ProfileSummaryCard.test.tsx`
- `src/components/account/BadgeHistory.tsx`
- `src/components/account/ShareProfileButton.tsx`
- `src/components/account/ShareProfileButton.test.tsx`
- `src/utils/share-profile.ts`
- `tests/unit/account-page.test.tsx`
- `tests/integration/member-awards-rls.test.ts`
- `tests/integration/account-awards-materialization.test.ts`

Archivos **MODIFICADOS** esperados:
- `src/components/layout/BottomNavbar.tsx`
- `src/types/database.types.ts` (generado)
- `src/types/index.ts`

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2: Insignias Humorísticas y Perfiles Psicológicos de Juego]
- [Source: _bmad-output/planning-artifacts/epics.md#FR-19 / FR-21]
- [Source: _bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/prd.md#4.9 Tablas por Jornada y Medallas Humorísticas]
- [Source: _bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/prd.md#4.10 Desempates por Rivalidad Directa y Tarjeta Psicológica]
- [Source: _bmad-output/planning-artifacts/architecture.md#Complete Project Directory Structure]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/DESIGN.md]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/EXPERIENCE.md]
- [Source: _bmad-output/implementation-artifacts/3-1-tabla-de-posiciones-clasica-acumulada-y-filtro-por-jornada.md]
- [Source: src/utils/scoring.ts]
- [Source: src/utils/standings.ts]
- [Source: src/app/standings/page.tsx]
- [Source: src/components/layout/BottomNavbar.tsx]
- [Source: supabase/migrations/20260602041455_rls_and_triggers.sql]
- [Source: supabase/migrations/20260603144630_predictions_rls.sql]
- [Source: tests/integration/standings-read.test.ts]
- [Source: MDN Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API)
- [Source: MDN navigator.share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)
- [Source: MDN navigator.canShare](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/canShare)
- [Source: Next.js cacheComponents](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents)
- [Source: Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)

## Preguntas para Cris

1. **Proxy de Cazador de Sorpresas.** Hoy no hay odds/favoritos por partido. Propuse un proxy v1 basado en victorias visitantes predichas. ¿Lo aceptas para MVP o prefieres agregar metadata manual de favoritos por partido en una story futura?
2. **Materialización lazy.** Para coste cero, `/account` materializa premios solo del usuario actual cuando entra. ¿Te sirve para MVP o quieres un job/admin flow que compute todos los miembros al cerrar jornada?
3. **Compartir PNG.** La implementación debe compartir PNG cuando el navegador soporte archivos; en desktop/fallback puede compartir texto + URL. ¿OK o quieres forzar descarga de la imagen aunque no haya Web Share?

## Dev Agent Record

### Agent Model Used

Codex GPT-5

### Debug Log References

- `npm run test:integration -- tests/integration/member-awards-rls.test.ts`: rojo inicial esperado (`public.member_badges` inexistente), luego verde **4/4** tras migración.
- `npx supabase db reset`: aplica `20260604000100_member_badges_and_profiles.sql` correctamente.
- `npm run db:types`: regenera `src/types/database.types.ts` desde Supabase local.
- `npm run test:unit -- src/utils/member-awards.test.ts`: rojo por módulo inexistente, luego verde **11/11** tras implementar `member-awards.ts`.
- `npm run test:integration -- tests/integration/account-awards-materialization.test.ts`: rojo por helper inexistente, luego verde **1/1** tras implementar materialización idempotente.
- `npm run test:unit -- tests/unit/account-page.test.tsx`: rojo por ruta inexistente, luego verde **3/3** tras implementar `/account`.
- `npm run test:unit -- src/components/account/ProfileSummaryCard.test.tsx src/components/account/ShareProfileButton.test.tsx tests/unit/account-page.test.tsx`: rojo por componentes inexistentes, luego verde **11/11**.
- `npm run test:unit -- src/components/layout/BottomNavbar.test.tsx`: rojo con `/account` deshabilitado, luego verde **1/1** tras activar Mi Cuenta.
- `npm run test:unit -- src/utils/member-awards.test.ts src/components/account/ProfileSummaryCard.test.tsx src/components/account/ShareProfileButton.test.tsx src/components/layout/BottomNavbar.test.tsx tests/unit/account-page.test.tsx`: verde **23/23**.
- `npm run test:integration -- tests/integration/member-awards-rls.test.ts tests/integration/account-awards-materialization.test.ts`: verde **5/5**.
- Smoke `/account` con Playwright + Supabase local: redirect anónimo a `/auth/login`, empty state usuario sin liga, empty state liga sin jornadas cerradas, y materialización/render de `Nostradamus` + `Conservador` para jornada finished.
- `npx supabase db reset && npm run db:types`: verde. Tras el reset, Kong quedó apuntando al upstream anterior de Auth; se resolvió con `docker restart supabase_kong_Quiniela`.
- `npm run test:unit`: verde **146/146**. Vitest/jsdom emite warning conocido de `HTMLCanvasElement.getContext` en el test de canvas, sin fallos.
- `npm run test:integration`: verde **42/42** tras refrescar Kong.
- `npm run lint`: verde.
- `npm run typecheck`: verde.
- `npm run build`: verde; `/account` compila como Partial Prerender.
- `npm run test:unit`: verde **151/151** tras patches de review.
- `npm run test:integration`: verde **43/43** tras patches de review.
- `npm run lint`: verde tras patches de review.
- `npm run typecheck`: verde tras patches de review.
- `npm run build`: verde tras patches de review; `/account` sigue como Partial Prerender.

### Completion Notes List

- **Tarea 1** — Creada migración `member_badges`/`member_game_profiles` con constraints, índices, RLS y grants explícitos. Regenerados tipos Supabase y exportados tipos de dominio para insignias/perfiles. Cobertura RLS inicial en verde.
- **Tarea 2** — Implementado motor puro `member-awards.ts` para detectar jornadas cerradas, derivar medallas y asignar perfil psicológico v1 sin DB/DOM y reutilizando `scoring.ts`. Cobertura unitaria en verde para reglas y edge cases.
- **Tarea 3** — Implementado `materializeCurrentMemberAwards` con lecturas RLS bajo el usuario, derivación por jornadas cerradas y upserts idempotentes de badges/perfiles. Validado contra Supabase local.
- **Tarea 4** — Implementada ruta `/account` con Server Component bajo Suspense, sesión obligatoria, liga activa, materialización lazy, empty state y render mobile-first de perfil/medallas.
- **Tarea 5** — Creados componentes `ProfileSummaryCard`, `BadgeHistory`, `ShareProfileButton` y helpers `share-profile`. El share intenta PNG por Web Share con archivos, luego texto/URL y finalmente WhatsApp fallback; `AbortError` se ignora correctamente.
- **Tarea 6** — Activada navegación a `/account` en `BottomNavbar` y agregado test para asegurar que `Duelos` sigue deshabilitado hasta Epic 5.
- **Tarea 7** — Añadida y consolidada cobertura unit/component/page/integration para motor de premios, `/account`, componentes de cuenta, share fallback, navegación y RLS/materialización DB. `triggers.test.ts` quedó intacto.
- **Tarea 8** — Verificación final completada con reset DB/tipos, unit, integración, lint, typecheck, build y smoke manual automatizado de los tres estados clave de `/account`.
- **Code Review Patches** — Resueltos los patch findings accionables: estados de cuenta diferenciados, filtro a jornadas cerradas, guardas de marcador real, errores recuperables, share/canvas robusto, accesibilidad de avatar, fixture estable y cobertura RLS extendida.
- **Cierre de Review** — Aceptado mantener el modelo de escritura propio definido por el AC para MVP. Story cerrada en `done` con unit, integración, lint, typecheck y build en verde.

### File List

- `supabase/migrations/20260604000100_member_badges_and_profiles.sql`
- `src/types/database.types.ts`
- `src/types/index.ts`
- `tests/integration/member-awards-rls.test.ts`
- `src/utils/member-awards.ts`
- `src/utils/member-awards.test.ts`
- `src/app/account/account-awards.ts`
- `tests/integration/account-awards-materialization.test.ts`
- `src/app/account/page.tsx`
- `tests/unit/account-page.test.tsx`
- `src/components/account/ProfileSummaryCard.tsx`
- `src/components/account/ProfileSummaryCard.test.tsx`
- `src/components/account/BadgeHistory.tsx`
- `src/components/account/ShareProfileButton.tsx`
- `src/components/account/ShareProfileButton.test.tsx`
- `src/utils/share-profile.ts`
- `src/components/layout/BottomNavbar.tsx`
- `src/components/layout/BottomNavbar.test.tsx`
- `_bmad-output/implementation-artifacts/3-2-insignias-humoristicas-y-perfiles-psicologicos-de-juego.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Change Log

| Fecha       | Versión | Descripción                                                                 | Autor |
| ----------- | ------- | --------------------------------------------------------------------------- | ----- |
| 2026-06-03  | 0.1     | Story context creada para insignias humorísticas, perfil psicológico y `/account`. | Codex |
| 2026-06-04  | 1.0     | Implementadas insignias/perfiles, `/account`, compartir perfil, navegación, RLS y verificación final. | Codex |
| 2026-06-04  | 1.1     | Aplicados patches de code review; queda pendiente decisión de modelo de escritura de premios. | Codex |
| 2026-06-04  | 1.2     | Cerrada decisión de review y story marcada como done. | Codex |

## Completion Note

Ultimate context engine analysis completed - comprehensive developer guide created.

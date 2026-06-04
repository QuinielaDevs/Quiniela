---
baseline_commit: 024a56fbfde33527aa9ade904888230e837e4291
created: 2026-06-04T11:19:37-04:00
---

# Story 4.1: Conexion WebSocket y Tabla Proyectada en Vivo (JS Client Side)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **espectador del Mundial**,
I want **ver como se reordena la tabla de posiciones en vivo segun los marcadores en tiempo real de los partidos en desarrollo**,
so that **usar la app como pantalla complementaria de la transmision de TV**.

## Acceptance Criteria

1. **Given** un usuario autenticado y miembro de una liga, en la vista **Tabla en Vivo** (`/live`)
   **When** la pagina se renderiza
   **Then** carga la liga activa con el mismo criterio actual del repo (membresia mas reciente por `joined_at`), lista miembros, partidos `finished` + `live`, y predicciones visibles de esa liga para calcular una tabla proyectada mobile-first (`max-w-md`) sin usar `service_role`.

2. **And** la vista se suscribe en cliente a Supabase Realtime sobre cambios `UPDATE` de `public.matches`
   **When** llega un payload con marcador de un partido en estado `live`
   **Then** actualiza en memoria el marcador momentaneo, recalcula los puntos proyectados de todos los jugadores de la liga usando la formula existente de `src/utils/scoring.ts`, y reordena la tabla sin recargar la pagina.

3. **And** el calculo proyectado respeta la separacion oficial vs. visual:
   - la clasificacion oficial existente (`/standings`, `buildStandings`) sigue contando **solo** partidos `finished`;
   - la tabla en vivo suma partidos `finished` como puntos consolidados y partidos `live` como puntos virtuales, tratando el marcador vivo como si fuera resultado final **solo para la proyeccion**;
   - `scheduled`, `canceled`, `suspended`, partidos live con marcador `null`, y predicciones ausentes aportan `0`.

4. **And** la tabla se reordena con transicion suave y estado visual claro:
   - muestra badge/indicador de conexion `En vivo`, `Reconectando...` o `Polling`;
   - usa tokens Championship Gold (`bg-card`, `border-border`, `text-accent`, `text-success`, `text-destructive`, `text-muted-foreground`) sin hex hardcodeado;
   - respeta tap targets de 48px para cualquier control, contraste alto y `prefers-reduced-motion`.

5. **And** si el WebSocket se desconecta, entra en modo degradado:
   **When** Supabase devuelve `CHANNEL_ERROR`, `TIMED_OUT` o `CLOSED`, o el canal deja de estar suscrito
   **Then** la UI muestra un indicador amarillo/dorado de **"Reconectando..."**, intenta recuperar la suscripcion, y activa polling HTTP/browser Supabase cada 60 segundos hasta recuperar el socket, sin abrir canales duplicados ni dejar intervalos vivos al desmontar.

6. **And** el uso de Realtime no rompe el presupuesto gratuito:
   - la suscripcion existe **solo** dentro de `/live` mientras la pantalla esta montada;
   - no se suscriben `predictions` ni `league_members`;
   - no se recalcula en servidor por cada gol;
   - el cliente solo procesa actualizaciones de `matches` y filtra localmente los estados relevantes.

7. **And** la navegacion queda accesible sin alterar el bottom nav principal del MVP:
   - `/standings` ofrece un enlace visible a `/live` (ej. boton con icono lucide `Radio`/`Activity`, tap target >=48px);
   - `/live` incluye `<BottomNavbar />` y conserva el layout `min-h-svh bg-background px-4 py-6 pb-24`.
   - No se habilita `Duelos` ni se agrega una quinta opcion al bottom nav.

8. **And** existen pruebas:
   - unitarias para el calculo proyectado (`finished + live`, exclusion de `scheduled/canceled/suspended`, multiplicadores, desempates y preservacion de `buildStandings` oficial);
   - componente/cliente para recibir un payload Realtime y reordenar filas, mostrar estados de conexion, activar polling con fake timers y limpiar `removeChannel`/intervalos;
   - page test de `/live` para redirect sin sesion, empty state sin liga y render con liga;
   - integracion DB que valida que `public.matches` esta agregado a la publicacion `supabase_realtime`;
   - `npm run test:unit`, `npm run test:integration`, `npm run lint`, `npm run typecheck` y `npm run build` quedan en verde.

## Tasks / Subtasks

- [x] **Tarea 1 - Realtime en base de datos** (AC: #2, #5, #6, #8)
  - [x] Crear migracion `supabase/migrations/<timestamp>_matches_realtime_publication.sql` posterior a `20260604120000_member_admin_management.sql`.
  - [x] Agregar **solo** `public.matches` a la publicacion de Realtime:
    ```sql
    alter publication supabase_realtime add table public.matches;
    ```
    Si el reset local falla por tabla ya agregada, envolverlo en una guarda idempotente usando `pg_publication_tables`.
  - [x] No agregar `predictions`, `league_members`, `profiles` ni tablas de duelos futuras a Realtime en esta historia.
  - [x] Mantener RLS de `matches`: select para `authenticated`; el cron/sync seguira escribiendo con `service_role`.
  - [x] Agregar prueba de integracion que consulte `pg_publication_tables` y confirme `schemaname='public' and tablename='matches'`.
  - [x] Ejecutar `npx supabase db reset` y `npm run db:types` si la CLI cambia tipos visibles.

- [x] **Tarea 2 - Motor puro de standings proyectado** (AC: #2, #3, #8)
  - [x] Extender `src/utils/standings.ts` con `buildProjectedStandings(...)` o funcion equivalente, sin cambiar la semantica de `buildStandings`.
  - [x] Reutilizar `calculateBasePoints` y `calculatePredictionPoints` de `src/utils/scoring.ts`. Para partidos `live`, pasar el marcador momentaneo como `actual` y calcular con estado `"finished"` **solo dentro de la funcion proyectada**; no modificar `calculateBasePoints` para que `live` puntue oficialmente.
  - [x] La suma proyectada debe incluir partidos `finished` + `live`; los `finished` mantienen puntos consolidados on-the-fly y los `live` son virtuales.
  - [x] Mantener desempate canonico decidido el 2026-06-04: puntos desc -> exactos desc -> duelos 1v1 inertes (=0) -> `joined_at` asc -> `userId` estable.
  - [x] Considerar `homeScore`/`awayScore` null o no enteros como `0` puntos para evitar falsos exactos.
  - [x] Agregar tests en `src/utils/standings.test.ts` o archivo nuevo co-localizado que prueben: live exacto proyecta puntos, scheduled/live-null no suma, canceled/suspended excluyen, multiplicador se aplica, tie-break queda estable, `buildStandings` sigue excluyendo live.

- [x] **Tarea 3 - Ruta `/live` server shell + datos iniciales** (AC: #1, #4, #7, #8)
  - [x] Crear `src/app/live/page.tsx` siguiendo el patron de `src/app/standings/page.tsx` y `src/app/predictions/page.tsx`: `main min-h-svh bg-background px-4 py-6 pb-24`, header, `<Suspense fallback={<BoardSkeleton />}>`, `BottomNavbar`.
  - [x] `LiveBoard` (Server Component) debe:
    - crear cliente SSR con `createClient()`;
    - exigir sesion con `auth.getClaims()` y redirigir a `/auth/login` si no hay `sub`;
    - resolver liga activa por membresia mas reciente (`league_members` del usuario order `joined_at desc limit 1`);
    - renderizar `EmptyState` si no hay liga;
    - cargar miembros de esa liga con `profiles(display_name, avatar_url)` y `payment_status`, igual que `/standings`;
    - cargar `matches` con `status in ('finished','live')`, columnas `id,status,matchday,home_team,away_team,home_team_code,away_team_code,home_score,away_score,match_time`;
    - cargar predicciones de esa liga solo para los match IDs cargados: `user_id, match_id, home_score_pred, away_score_pred, multiplier`;
    - mapear snake_case -> camelCase usando tipos de `@/types` y `@/utils/standings`.
  - [x] Si no hay partidos `live`, mostrar la tabla proyectada con puntos consolidados y un estado claro "No hay partidos en vivo ahora" sin ocultar la tabla.
  - [x] No usar `service_role` en la app. Las predicciones de rivales para partidos `live` ya deben estar desbloqueadas por `fn_match_unlocked` al estar despues del kickoff.

- [x] **Tarea 4 - Componente cliente Realtime** (AC: #2, #4, #5, #6, #8)
  - [x] Crear `src/components/live/LiveStandingsBoard.tsx` (`"use client"`) o nombre equivalente.
  - [x] Recibir `leagueId`, `members`, `initialMatches`, `initialPredictions`.
  - [x] Instanciar browser Supabase con `src/utils/supabase/client.ts`.
  - [x] Crear **un solo canal** con nombre estable que no sea `"realtime"` (ej. `live-matches:${leagueId}`) y suscribirse a:
    ```ts
    supabase
      .channel(`live-matches:${leagueId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "matches",
      }, handleMatchUpdate)
      .subscribe(handleStatus)
    ```
  - [x] En `handleMatchUpdate`, ignorar payloads que no sean de estados relevantes; actualizar solo el match afectado en estado local y recalcular filas via `buildProjectedStandings`.
  - [x] En cleanup de `useEffect`, llamar `supabase.removeChannel(channel)` y limpiar cualquier `setInterval`.
  - [x] Estados de conexion esperados:
    - `SUBSCRIBED` -> `En vivo`, detener polling;
    - `CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED` -> `Reconectando...`, activar polling 60s;
    - polling activo -> mostrar `Polling` o `Reconectando...` segun copy final.
  - [x] Implementar polling cada 60s con el **browser Supabase client**, no con una API REST nueva: recargar `matches` `finished/live` y predicciones visibles para esos IDs bajo la sesion del usuario; reemplazar snapshot de forma atomica.
  - [x] Evitar loops y canales duplicados: dependencias estables, refs para interval/channel, y tests con fake timers.
  - [x] Respetar `prefers-reduced-motion`: transiciones simples de opacidad si el usuario reduce motion.

- [x] **Tarea 5 - UI de tabla proyectada y acceso desde standings** (AC: #4, #7)
  - [x] Renderizar filas parecidas a `StandingsTable`, pero diferenciando `totalPoints` oficial/proyectado si es util (`Puntos proyectados`, badge `+live` o marcador "Virtual").
  - [x] Usar avatar fallback `/assets/avatars/default-player.svg`, `PaymentStatusBadge` display-only y puntos en `text-accent`.
  - [x] Aplicar reordenamiento suave con CSS transition/FLIP ligero o animacion de transform/opacity; no usar librerias nuevas.
  - [x] Agregar en `/standings` un enlace a `/live` en la cabecera o dentro de `StandingsBoard`, con icono lucide (`Radio`, `Activity` o similar), `aria-label="Ver tabla en vivo"` y altura minima 48px.
  - [x] No modificar `BottomNavbar` para habilitar `Duelos` ni para agregar una quinta opcion; la IA oficial mantiene bottom nav con 4 items.

- [x] **Tarea 6 - Tests y verificacion final** (AC: #8)
  - [x] Unit: `buildProjectedStandings` y regresiones de `buildStandings`.
  - [x] Component: mock de `@/utils/supabase/client`, payload UPDATE que cambia `home_score/away_score`, assert de reordenamiento, indicadores de conexion, fake timers para polling, cleanup de `removeChannel`.
  - [x] Page test: `tests/unit/live-page.test.tsx` con redirect sin sesion, empty sin liga y render con liga/datos.
  - [x] Integration: `tests/integration/matches-realtime-publication.test.ts` o agregar caso especifico en suite existente.
  - [x] Ejecutar verificacion final:
    - `source ~/.nvm/nvm.sh && nvm use 24`
    - `npx supabase db reset`
    - `npm run test:unit`
    - `npm run test:integration`
    - `npm run lint`
    - `npm run typecheck`
    - `npm run build`
  - [x] Si `test:unit` falla en frio por transform timeout (~30s), re-ejecutar en caliente y documentar si queda estable, como en Epic 3.

### Review Findings

- [x] [Review][Patch] Cargar predicciones cuando Realtime agrega un partido nuevo en vivo [src/components/live/LiveStandingsBoard.tsx:158]
- [x] [Review][Patch] Reintentar la suscripcion WebSocket tras `CHANNEL_ERROR`, `TIMED_OUT` o `CLOSED` [src/components/live/LiveStandingsBoard.tsx:174]
- [x] [Review][Patch] Preservar el ultimo snapshot valido si falla una consulta del polling [src/components/live/LiveStandingsBoard.tsx:94]
- [x] [Review][Patch] Reemplazar matches y predicciones del polling de forma atomica para evitar renders inconsistentes o snapshots viejos [src/components/live/LiveStandingsBoard.tsx:107]
- [x] [Review][Patch] Implementar una transicion de reordenamiento efectiva en vez de una clase `transition-transform` sin cambio de transform [src/components/live/LiveStandingsBoard.tsx:220]
- [x] [Review][Patch] Ampliar la prueba de cleanup para validar que el intervalo de polling se limpia al desmontar [src/components/live/LiveStandingsBoard.test.tsx:199]

## Dev Notes

### Toolchain de Node (CRITICO)

Activa Node moderno antes de comandos: `source ~/.nvm/nvm.sh && nvm use 24`. El repo ha usado Node v26.2.0 en sesiones recientes; el Node del shell historicamente podia ser viejo. Usa la CLI de Supabase via `npx supabase ...`. [Source: _bmad-output/implementation-artifacts/3-3-panel-rapido-de-administracion-y-control-de-pagos.md#Dev Notes]

### Estado actual heredado - construir sobre esto

- `src/utils/scoring.ts` es la fuente unica de verdad de puntos base y multiplicador. Hoy `calculateBasePoints(..., "live")` devuelve 0 por diseno oficial; **no cambiarlo**. La proyeccion debe tratar el marcador live como resultado final solo dentro del helper proyectado. [Source: src/utils/scoring.ts]
- `src/utils/standings.ts` calcula la clasificacion oficial on-the-fly desde partidos `finished` + predicciones, no desde `predictions.points_earned`. `buildStandings` excluye `live`; preservarlo. [Source: src/utils/standings.ts]
- `src/app/standings/page.tsx` ya resuelve sesion, liga activa, miembros, partidos finished, predicciones y banner de pago bajo RLS. Copiar su patron para `/live`. [Source: src/app/standings/page.tsx]
- `src/components/standings/StandingsTable.tsx` ya tiene patron visual de filas, tabs de jornada, `PaymentStatusBadge`, avatares fallback y puntos en dorado. Reusar estilo, no duplicar formulas. [Source: src/components/standings/StandingsTable.tsx]
- `src/components/layout/BottomNavbar.tsx` mantiene 4 items: Pronosticos, Posiciones, Duelos deshabilitado, Mi Cuenta. La experiencia oficial dice que Tabla en Vivo se alcanza desde standings/header, no como quinto item principal. [Source: src/components/layout/BottomNavbar.tsx; EXPERIENCE.md#Information Architecture]
- `next.config.ts` tiene `cacheComponents: true`; cualquier lectura dinamica de cookies/auth o datos por request debe estar bajo `<Suspense>` igual que las rutas existentes. [Source: next.config.ts; src/app/standings/page.tsx]
- No hay `project-context.md` en el repo al crear esta historia; se usaron epics, PRD, arquitectura, UX, historias previas y retrospectiva Epic 3 como fuentes.

### Datos y RLS relevantes

- `matches`: `id, external_ref, home_team, away_team, home_team_code, away_team_code, home_score, away_score, match_time, status, matchday, stage`. Status valido: `scheduled`, `live`, `finished`, `suspended`, `canceled`. [Source: supabase/migrations/20260603144628_matches_and_predictions.sql]
- `predictions` es por liga (`league_id,user_id,match_id`) y RLS permite leer predicciones de rivales solo si `fn_match_unlocked(match_id)` es true (`now() >= match_time - interval '1 minute'`). Para un partido `live`, deberia estar desbloqueado. [Source: supabase/migrations/20260603144630_predictions_rls.sql]
- `league_members` contiene `role`, `payment_status`, `joined_at`; el desempate final usa `joined_at` ascendente. [Source: supabase/migrations/20260602041410_init_schema.sql]
- `predictions.points_earned` sigue sin persistirse oficialmente; no introducir dependencia sobre esa columna. [Source: epic-3-retro-2026-06-04.md#Donde batallamos]

### Realtime - informacion tecnica actual

- Supabase Realtime Postgres Changes se consume con `.channel(name).on("postgres_changes", { event, schema, table }, callback).subscribe()`. El nombre del canal puede ser cualquier string excepto `"realtime"`. [Source: https://supabase.com/docs/guides/realtime/postgres-changes]
- Para recibir cambios de tablas Postgres hay que habilitar la tabla en la publicacion de Realtime; los docs oficiales muestran que las tablas deseadas deben agregarse a `supabase_realtime`. [Source: https://supabase.com/docs/guides/realtime/subscribing-to-database-changes]
- La cuota Free de Supabase Realtime mantiene limite de **200 conexiones pico concurrentes**; por eso esta historia suscribe solo cuando `/live` esta montada y evita canales por fila/partido. [Source: https://supabase.com/docs/guides/realtime/reports; https://supabase.com/docs/guides/platform/billing-on-supabase]
- Next Cache Components requiere que componentes con data dinamica por request se envuelvan en `<Suspense>` o se cacheen con `"use cache"`; runtime data como cookies/searchParams no se cachea y debe estar dentro de Suspense. [Source: https://nextjs.org/docs/app/getting-started/cache-components; https://nextjs.org/docs/messages/blocking-route]

### Riesgos y guardrails especificos

- **No romper standings oficial:** si `buildStandings` empieza a contar `live`, se rompe Story 3.1. Agregar funcion nueva y tests de regresion.
- **No duplicar formulas:** evitar una formula ad hoc de puntos en el componente cliente. Todo debe pasar por `scoring.ts`.
- **No crear canales duplicados:** con React 19 + Cache Components/Activity, la navegacion puede preservar estado; el efecto debe limpiar y recrear correctamente. Usar refs y cleanup explicito.
- **No abrir Realtime global innecesario:** un canal por pantalla `/live`, no por match ni por liga en rutas ocultas.
- **No agregar API REST cliente:** la arquitectura reserva REST para `/api/sync`; polling puede usar browser Supabase client bajo RLS.
- **No exponer predicciones prematuras:** no suscribirse a `predictions`; leer predicciones con RLS solo para partidos `finished/live` y liga activa.
- **No implementar Story 4.2:** toasts de "Impacto de Gol" con swipe y copy detallado quedan para la siguiente historia. En 4.1 puede haber indicador de movimiento/reordenamiento, pero no construir el sistema completo de toasts.

### Project Structure Notes

Archivos **NUEVOS** esperados:
- `supabase/migrations/<timestamp>_matches_realtime_publication.sql`
- `src/app/live/page.tsx`
- `src/components/live/LiveStandingsBoard.tsx`
- `src/components/live/LiveStandingsBoard.test.tsx`
- `tests/unit/live-page.test.tsx`
- `tests/integration/matches-realtime-publication.test.ts`

Archivos **MODIFICADOS** esperados:
- `src/utils/standings.ts` (agregar helper proyectado; preservar `buildStandings`)
- `src/utils/standings.test.ts` (o suite nueva de util)
- `src/app/standings/page.tsx` (enlace a `/live`)
- `tests/unit/standings-page.test.tsx` (cobertura del enlace si se modifica la pagina)
- `src/types/database.types.ts` solo si `npm run db:types` cambia salida por la migracion

### Previous Story Intelligence

- Story 3.3 demostro que los story-context deben verificar archivos antes de pedirlos: no asumir componentes inexistentes. Para 4.1, verificar que cualquier archivo prescrito exista o crear uno con alcance claro. [Source: _bmad-output/implementation-artifacts/3-3-panel-rapido-de-administracion-y-control-de-pagos.md#Completion Notes]
- Flujos optimistas y estado derivado de props fueron bugs reales en review. En `LiveStandingsBoard`, evitar que polling/props/payload Realtime se pisen: aplicar reemplazos atomicos y tests con timers. [Source: epic-3-retro-2026-06-04.md#Donde batallamos]
- Las decisiones de Cris del 2026-06-04 cierran dudas de standings: desempate canonico exactos -> duelos -> `joined_at`; clasificacion independiente por liga (`predictions.league_id`). [Source: epic-3-retro-2026-06-04.md#Decisiones de la mini-sesion]

### Git Intelligence Summary

Ultimos commits relevantes:
- `024a56f docs: retrospectiva Epic 3 + decisiones de standings/admin`
- `babb4f3 feat: panel de administracion y control de pagos (Story 3.3)`
- `ea34970 feat: add account awards and profiles`
- `787e226 feat: tabla de posiciones y filtro por jornada (Story 3.1)`
- `ddac139 docs: review completo de Story 2.4 (3 capas) + diferidos`

Patron observado: cada story reciente deja pruebas unitarias + integracion cuando toca DB/RLS, usa Server Components con Suspense para paginas autenticadas, y conserva seams explicitos para epics futuros. Mantener ese estilo.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1: Conexion WebSocket y Tabla Proyectada en Vivo]
- [Source: _bmad-output/planning-artifacts/epics.md#FR-17 / NFR-2 / UX-DR-9]
- [Source: _bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/prd.md#4.8 Proyeccion de Clasificaciones en Vivo]
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Tabla en Vivo Reactiva]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/DESIGN.md]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/EXPERIENCE.md#Flow 4]
- [Source: _bmad-output/implementation-artifacts/epic-3-retro-2026-06-04.md#Preview Epic 4]
- [Source: src/utils/scoring.ts]
- [Source: src/utils/standings.ts]
- [Source: src/app/standings/page.tsx]
- [Source: src/components/standings/StandingsTable.tsx]
- [Source: src/components/layout/BottomNavbar.tsx]
- [Source: supabase/migrations/20260603144628_matches_and_predictions.sql]
- [Source: supabase/migrations/20260603144630_predictions_rls.sql]
- [Source: https://supabase.com/docs/guides/realtime/postgres-changes]
- [Source: https://supabase.com/docs/guides/realtime/subscribing-to-database-changes]
- [Source: https://nextjs.org/docs/app/getting-started/cache-components]

## Preguntas para Cris

Sin preguntas bloqueantes para implementar 4.1. Dos decisiones quedan registradas como supuestos de esta historia:

1. La entrada a Tabla en Vivo sera `/live` enlazada desde `/standings`, sin cambiar el bottom nav principal de 4 items.
2. El fallback a polling usara browser Supabase client bajo RLS, no una ruta REST nueva, para respetar la arquitectura existente.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `npm run test:integration -- tests/integration/matches-realtime-publication.test.ts` (red): fallo esperado `0 !== 1` antes de la migracion.
- `npx supabase db reset`: aplica `20260604123000_matches_realtime_publication.sql` correctamente.
- `npm run test:integration -- tests/integration/matches-realtime-publication.test.ts` (green): **1/1**.
- `npm run test:unit -- src/utils/standings.test.ts` (red): fallo esperado `buildProjectedStandings is not a function`.
- `npm run test:unit -- src/utils/standings.test.ts` (green): **15/15** tras helper proyectado y refactor.
- `npm run test:unit -- tests/unit/live-page.test.tsx` (red): fallo esperado al no existir `src/app/live/page.tsx`.
- `npm run test:unit -- tests/unit/live-page.test.tsx` (green): **3/3**.
- `npm run test:unit -- src/components/live/LiveStandingsBoard.test.tsx` (red): fallo esperado al no existir `LiveStandingsBoard`.
- `npm run test:unit -- src/components/live/LiveStandingsBoard.test.tsx` (green): **2/2**.
- `npm run test:unit -- tests/unit/live-page.test.tsx src/components/live/LiveStandingsBoard.test.tsx`: **5/5** tras conectar la ruta al componente y stub de page test.
- `npm run test:unit -- tests/unit/standings-page.test.tsx` (red): fallo esperado al no existir enlace `Ver tabla en vivo`.
- `npm run test:unit -- tests/unit/standings-page.test.tsx src/components/live/LiveStandingsBoard.test.tsx` (green): **9/9**.
- `npm run test:unit`: **25 archivos / 172 tests**, verde. Nota: jsdom imprime el aviso esperado de `HTMLCanvasElement.getContext()` sin fallar.
- `npm run test:integration`: **13 archivos / 53 tests**, verde.
- `npm run lint`: verde.
- `npm run typecheck`: primer intento fallo por `.next/types` stale sin `/live`; `npm run build` regenero tipos y el segundo `npm run typecheck` quedo verde.
- `npm run build`: verde; `/live` compila como Partial Prerender.
- `npm run test:e2e`: **2/2**, verde.
- Playwright local contra `http://localhost:3000/live` y `/standings` sin sesion: ambos redirigen a `/auth/login` y renderizan contenido (no blanco). Dev server apagado al finalizar.

### Completion Notes List

- **Tarea 1** — Agregada migracion idempotente para incluir solo `public.matches` en la publicacion `supabase_realtime`; no se tocaron otras tablas ni politicas RLS. Agregada prueba de integracion que consulta `pg_publication_tables` via el contenedor local de Supabase/Postgres.
- **Tarea 2** — Agregado `buildProjectedStandings` con puntos `finished + live`, `livePoints`, multiplicadores, exclusion de estados no relevantes/nulls, y desempate canonico sin cambiar `buildStandings`.
- **Tarea 3** — Creada ruta `/live` con Server Component bajo Suspense, sesion obligatoria, liga activa, carga inicial RLS de miembros/partidos/predicciones y estado "No hay partidos en vivo ahora".
- **Tarea 4** — Creado `LiveStandingsBoard` cliente con canal unico `live-matches:${leagueId}`, handler `postgres_changes`, polling browser Supabase cada 60s, cleanup de canal/intervalo, indicadores de conexion y tabla proyectada basada en `buildProjectedStandings`.
- **Tarea 5** — Agregada UI de tabla proyectada con filas tipo standings, badge `+live`, estados de conexion, transiciones con `motion-reduce`, y enlace `/standings` -> `/live` con icono `Radio` sin modificar `BottomNavbar`.
- **Tarea 6** — Verificacion final completa en verde: unit, integracion, lint, typecheck, build, e2e y smoke visual local con Playwright. Story lista para code review.

### File List

- `supabase/migrations/20260604123000_matches_realtime_publication.sql`
- `tests/integration/matches-realtime-publication.test.ts`
- `src/utils/standings.ts`
- `src/utils/standings.test.ts`
- `src/app/live/page.tsx`
- `tests/unit/live-page.test.tsx`
- `src/components/live/LiveStandingsBoard.tsx`
- `src/components/live/LiveStandingsBoard.test.tsx`
- `src/app/standings/page.tsx`
- `tests/unit/standings-page.test.tsx`
- `tests/unit/live-page.test.tsx`
- `_bmad-output/implementation-artifacts/4-1-conexion-websocket-y-tabla-proyectada-en-vivo-js-client-side.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Change Log

| Fecha | Version | Descripcion | Autor |
| --- | --- | --- | --- |
| 2026-06-04 | 0.1 | Story context creada para conexion WebSocket y tabla proyectada en vivo client-side. | BMad Create-Story |
| 2026-06-04 | 1.0 | Implementada tabla proyectada en vivo: Realtime publication para `matches`, helper `buildProjectedStandings`, ruta `/live`, componente cliente con WebSocket/polling, enlace desde `/standings` y cobertura completa. | GPT-5 Codex |

## Completion Note

Ultimate context engine analysis completed - comprehensive developer guide created.

---
baseline_commit: e396b9849ac650adba74b9abb89e74db7ac699ad
created: 2026-06-04T15:24:40-04:00
---

# Story 4.2: Notificaciones "Impacto de Gol" (Live Toast)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **espectador del Mundial**,
I want **recibir alertas emergentes (toast) que indiquen quién sube de puesto en la tabla proyectada ante un gol real, con la fila resaltada en dorado**,
so that **sentir la adrenalina de los cambios de posiciones de forma inmediata**.

## Contexto y alcance (leer primero)

Esta historia **NO crea infraestructura nueva de datos ni de red**. Story 4.1 (`done`) ya entregó:
ruta `/live`, suscripción Realtime a `public.matches`, fallback a polling, `buildProjectedStandings`,
reordenamiento suave con FLIP, e indicadores de conexión. **Todo 4.2 ocurre dentro de
`src/components/live/LiveStandingsBoard.tsx` (cliente) + un componente de toast nuevo, más el threading
de un prop desde `src/app/live/page.tsx`.** No hay migración, no se toca Realtime publication, no se toca
`scoring.ts` ni la semántica de `buildStandings`/`buildProjectedStandings`.

El trabajo es: (1) **enriquecer** los datos de partido en cliente para conservar el nombre del equipo
(`home_team`/`away_team`), que hoy se descartan; (2) **detectar qué equipo anotó** comparando el marcador
nuevo contra el anterior; (3) **detectar movimientos de puesto** comparando el rank previo vs. el recalculado;
(4) **mostrar un toast** "Impacto de Gol" y **destello dorado** en la fila que sube; (5) **swipe-to-dismiss**
+ botón × + auto-cierre; (6) accesibilidad (`aria-live`, `prefers-reduced-motion`).

## Acceptance Criteria

1. **Given** un usuario en `/live` con la tabla proyectada montada (suscripción Realtime o polling activos)
   **When** llega un `UPDATE` de un partido `live` cuyo marcador cambió y, tras recalcular `buildProjectedStandings`, **al menos un jugador sube de puesto** (su `rank` disminuye numéricamente)
   **Then** se despliega un **toast flotante** en la parte superior de `/live` con el copy: **"¡Gol de {Equipo}! {Jugador} sube al {N}º puesto proyectado 🎉"**, donde `{Equipo}` es el equipo que anotó, `{Jugador}` el `displayName` del jugador priorizado y `{N}` su nuevo `rank`.

2. **And** la selección de jugador y equipo es determinista y evita spam:
   - **Prioridad de jugador:** si el **usuario actual** (viewer) subió de puesto, el toast lo anuncia a él (`"{tu displayName} subes al {N}º"` o `"{displayName} sube al {N}º"`, copy final a criterio del dev pero consistente); si el viewer no subió pero **cambió el líder (rank 1)**, anunciar al nuevo líder; en cualquier otro caso, anunciar al jugador con el **mayor salto de puestos** (mayor `prevRank - newRank`, desempate por `rank` menor luego `userId`).
   - **Un solo toast por evento de gol** (un `UPDATE` con cambio de marcador), no uno por jugador. Si varios goles llegan casi a la vez, **no encolar más de los `MAX_VISIBLE_TOASTS` configurados** (sugerido 1–3); descartar/colapsar el exceso, los más viejos primero.
   - **`{Equipo}` se deriva del lado que incrementó** su marcador (`home_score` vs `away_score` nuevo > anterior). Si no se puede determinar el equipo (sin marcador previo conocido, ambos cambian, o falta el nombre), usar fallback neutro: **"¡Cambio en los marcadores! {Jugador} sube al {N}º puesto proyectado 🎉"**.

3. **And** la **fila que sube parpadea momentáneamente en dorado** (Championship Gold) y luego vuelve a su estilo normal:
   - usar **tokens** (`bg-accent`/`border-accent`/`ring-accent` u opacidad de `accent`), **nunca el hex `#E9C46A` hardcodeado**;
   - el destello dura ~1–1.5 s y no debe romper el reordenamiento FLIP existente (`useLayoutEffect` de transform/opacity de 4.1);
   - el destello es **aditivo**: no elimina ni reescribe la animación de reordenamiento de filas.

4. **And** la notificación es **descartable**:
   - **swipe lateral** (gesto horizontal con `PointerEvent`) descarta el toast; el umbral sugerido es ~40–80px de desplazamiento horizontal;
   - además existe un control **× / "Cerrar"** con `aria-label` y **tap target ≥ 48px**;
   - el toast **auto-cierra** tras un timeout (sugerido 5–6 s) si el usuario no interactúa;
   - descartar un toast **no** afecta el cálculo de standings ni la suscripción.

5. **And** se respeta accesibilidad y motion:
   - el contenedor de toasts es una región `aria-live="polite"` (o `role="status"`) para que lectores de pantalla anuncien el texto;
   - con **`prefers-reduced-motion: reduce`**, las transiciones del toast y del destello son **solo de opacidad** (sin slide-in horizontal ni desplazamientos), consistente con el patrón de 4.1;
   - se usan tokens Championship Gold (`bg-card`, `border-border`, `text-accent`, `text-foreground`, `text-muted-foreground`) sin hex hardcodeado.

6. **And** no se introduce regresión ni costo nuevo de infraestructura:
   - **no** se agrega ninguna librería nueva (sin `sonner`, `react-hot-toast`, `vaul`, `framer-motion`, etc.): toast y swipe se construyen con React + CSS/Pointer Events nativos;
   - **no** se cambia `buildStandings`, `buildProjectedStandings`, `scoring.ts`, la migración de Realtime ni la suscripción/polling de 4.1;
   - **no** se suscribe a `predictions` ni a otras tablas; el toast se deriva del mismo `UPDATE` de `matches` que ya procesa 4.1;
   - el comportamiento de conexión (`En vivo`/`Reconectando...`/`Polling`), el cleanup de canal/intervalos y la preservación de snapshot de 4.1 siguen intactos;
   - al desmontar `/live` se limpian todos los timeouts de toast/destello (sin timers colgados).

7. **And** existen pruebas (Vitest + Testing Library, fake timers) que cubren:
   - un `UPDATE` con cambio de marcador que produce subida de puesto → aparece el toast con copy correcto (equipo + jugador + Nº);
   - selección de jugador: viewer-sube > cambio-de-líder > mayor-salto (al menos viewer-prioritario y fallback de líder);
   - **derivación del equipo** que anotó (lado local vs visitante) y **fallback neutro** cuando no se puede determinar;
   - **destello dorado** aplicado a la fila correcta (clase/atributo) y removido tras el timeout;
   - **descartar**: por botón × y por gesto de swipe (simular `pointerdown`/`pointermove`/`pointerup`), y **auto-cierre** por timeout;
   - **no se rompe 4.1**: reordenamiento, indicadores de conexión, polling y cleanup siguen pasando; sin toast cuando un `UPDATE` no cambia puestos (p. ej. baja o empate sin reordenar);
   - `npm run test:unit`, `npm run test:integration`, `npm run lint`, `npm run typecheck` y `npm run build` quedan en verde.

## Tasks / Subtasks

- [x] **Tarea 1 — Conservar el equipo en los datos de partido del cliente** (AC: #1, #2, #6)
  - [x] Extender el tipo de partido que consume el board con nombres de equipo **sin tocar `StandingMatch` de `standings.ts`** (que es el contrato puro de scoring). Opciones aceptables: (a) un tipo local `LiveMatch = StandingMatch & { homeTeam: string | null; awayTeam: string | null }` en el componente live; o (b) un `Map<matchId, {homeTeam, awayTeam}>` paralelo. **No** agregar campos de presentación al motor puro de standings.
  - [x] En `src/app/live/page.tsx`, **dejar de descartar** `home_team`/`away_team`: pasarlos al `LiveStandingsBoard` (vía `initialMatches` enriquecidos o un prop nuevo `matchTeams`). Hoy se cargan en el `select` (línea ~55) pero se omiten en el `.map` a `StandingMatch` (líneas ~61-67).
  - [x] En `LiveStandingsBoard.tsx`, extender `mapPayloadToMatch`/`MatchPayload` para leer `home_team`/`away_team` del `payload.new` del `UPDATE` (la fila completa de `matches` viene en el evento Realtime). Mantener `buildProjectedStandings` recibiendo el shape `StandingMatch` (puede ignorar los campos extra).

- [x] **Tarea 2 — Detectar gol (equipo que anota) y movimientos de puesto** (AC: #1, #2)
  - [x] Antes de aplicar el nuevo marcador, comparar el `home_score`/`away_score` **nuevo** contra el del partido en el snapshot **anterior** para inferir qué lado incrementó → `scoringTeam = homeTeam | awayTeam | null`. Cubrir: solo un lado sube (caso normal), sin marcador previo (`null`), ambos cambian, o nombres faltantes → `null` (fallback neutro).
  - [x] Capturar `prevRankByUser: Map<userId, rank>` desde las `rows` previas a la recalculación, y comparar contra las `rows` recalculadas para hallar jugadores con `newRank < prevRank` (subieron).
  - [x] Implementar la **regla de selección** del AC #2: viewer-sube → cambio-de-líder → mayor-salto. Requiere conocer al **usuario actual**: ver Tarea 4 (prop `currentUserId`).
  - [x] Solo emitir toast si **hubo gol con subida real**. Un `UPDATE` que no cambia puestos (o solo baja a alguien) **no** dispara toast. Goles que no reordenan nada → sin toast (cubrir en test).

- [x] **Tarea 3 — Componente Toast (UI, swipe, auto-cierre, a11y)** (AC: #1, #3, #4, #5)
  - [x] Crear `src/components/live/GoalToast.tsx` (`"use client"`) o un par contenedor+item (`GoalToastStack` + `GoalToast`). Sin librerías nuevas.
  - [x] Render: tarjeta flotante superior (`fixed`/`sticky` dentro del layout `max-w-md`), tokens `bg-card border border-border text-foreground`, acento `text-accent`/emoji 🎉, copy del AC. Región `aria-live="polite"`/`role="status"`.
  - [x] **Swipe-to-dismiss** con Pointer Events: `onPointerDown` captura X inicial, `onPointerMove` traslada el toast (transform X) y al superar el umbral en `onPointerUp` lo descarta; por debajo del umbral, vuelve a su sitio. Respetar `prefers-reduced-motion` (sin transform de slide; descartar por opacidad).
  - [x] Botón **×/Cerrar** con `aria-label="Descartar notificación"` y `min-h-12 min-w-12` (≥48px).
  - [x] **Auto-cierre** por `setTimeout` (5–6 s); limpiar el timeout al descartar manualmente y al desmontar.
  - [x] Tope de toasts visibles (`MAX_VISIBLE_TOASTS`); colapsar/expulsar excedente (más viejos primero).

- [x] **Tarea 4 — Integrar en LiveStandingsBoard y destello de fila** (AC: #1, #3, #4, #6)
  - [x] Añadir prop **`currentUserId: string`** a `LiveStandingsBoard` y pasarlo desde `page.tsx` (el `LiveBoard` server component ya tiene `userId` de `auth.getClaims()`, hoy no se propaga).
  - [x] Estado de toasts (`useState<GoalToastModel[]>`) y estado/ref de "fila en destello" (`Set<userId>` o `Map<userId, expiry>`). Generar id estable por toast para keys y para limpieza.
  - [x] Disparar toast + marcar fila(s) que suben para destello en el **mismo handler** donde 4.1 procesa el `UPDATE` (`handleMatchUpdate`) y/o tras el recálculo de `rows`. Cuidado: 4.1 usa `setSnapshot(current => ...)`; calcular prev/new ranks de forma consistente con el snapshot resultante (considerar derivar el efecto desde el cambio de `rows` en un `useEffect`/`useLayoutEffect` que compare contra un ref de rows previas, similar al patrón FLIP ya existente).
  - [x] **Destello dorado**: aplicar clase condicional a `<li>` (p. ej. `ring-2 ring-accent` o `bg-accent/15`) cuando `userId ∈ filasEnDestello`; quitarla tras ~1–1.5 s vía timeout. **Aditivo** al `transition-[transform,opacity,border-color]` y al FLIP existentes; no reemplazar el `useLayoutEffect` de reordenamiento.
  - [x] Limpiar **todos** los timeouts (toast auto-cierre + destello) en el cleanup de desmontaje, junto a los de 4.1.

- [x] **Tarea 5 — Tests y verificación final** (AC: #7)
  - [x] Ampliar `src/components/live/LiveStandingsBoard.test.tsx` (reusar `makeSupabaseMock`, `getPostgresHandler`, fake timers) y/o crear `src/components/live/GoalToast.test.tsx`:
    - payload `UPDATE` que sube a un jugador → toast visible con equipo+jugador+Nº correctos;
    - viewer prioritario vs. nuevo líder vs. mayor salto (al menos 2 de 3 ramas);
    - derivación de equipo (home vs away) y fallback neutro;
    - destello aplicado a la fila correcta y removido tras timeout (`vi.advanceTimersByTimeAsync`);
    - descartar por botón × y por swipe (`pointerdown`/`pointermove`/`pointerup` con `clientX`); auto-cierre por timeout;
    - **regresión 4.1**: los 4 tests existentes siguen verdes; un `UPDATE` que no cambia puestos no crea toast; cleanup no deja timers (el test de unmount existente sigue pasando).
  - [x] (Opcional) `tests/unit/live-page.test.tsx`: si cambia la firma de `LiveStandingsBoard` (nuevo prop `currentUserId`/`matchTeams`), actualizar el stub para que el page test siga verde.
  - [x] Verificación final (toolchain de Node moderno; ver Dev Notes):
    - `npm run test:unit`
    - `npm run test:integration`
    - `npm run lint`
    - `npm run typecheck`
    - `npm run build`
  - [x] Si `test:unit` falla en frío por transform timeout (~30s), re-ejecutar en caliente y documentarlo (patrón recurrente Epic 3/4.1).

### Review Findings

- [x] [Review][Patch] El toast/destello debe dispararse solo ante un gol real (un lado incrementa su marcador), no ante correcciones a la baja que solo reordenan [src/components/live/LiveStandingsBoard.tsx:301] — resuelto: gate `hasScoreIncrease(prevMatch, nextMatch)` + tests (unit + board).
- [x] [Review][Patch] Swipe del toast no filtra por `pointerId`: un segundo puntero (multi-touch) sobreescribe `startXRef` y puede causar descarte accidental o transform pegado [src/components/live/GoalToast.tsx:41] — resuelto: `activePointerRef` filtra punteros no activos + test multi-touch.
- [x] [Review][Defer] Migrar el handler Realtime de updater funcional a lectura directa de `snapshotRef.current` puede perder un update si `refreshSnapshot({allowWhenLive})` resuelve y clobberea un evento concurrente (patrón heredado de 4.1) [src/components/live/LiveStandingsBoard.tsx:268] — deferred, pre-existing
- [x] [Review][Defer] En modo polling (Realtime caído) un gol actualiza la tabla pero no emite toast ni destello; el feedback "Impacto de Gol" queda atado al evento UPDATE de Realtime (consistente con AC#6) [src/components/live/LiveStandingsBoard.tsx:301] — deferred, pre-existing
- [x] [Review][Defer] `toScore` trata `null` como `0`, de modo que una transición `null → 1` (backfill del marcador, no un gol en juego) podría fabricar un toast fantasma; baja frecuencia y fix ambiguo [src/components/live/goalImpact.ts:35] — deferred, pre-existing
- [x] [Review][Defer] El swipe carece de gate de eje dominante: un arrastre vertical (scroll) sobre el toast lo desplaza horizontalmente por el jitter en X [src/components/live/GoalToast.tsx:51] — deferred, pre-existing

## Dev Notes

### Toolchain de Node (CRÍTICO)

Activa Node moderno antes de comandos: `source ~/.nvm/nvm.sh && nvm use 24`. El repo ha usado Node v26.2.0 en sesiones recientes. Supabase CLI vía `npx supabase ...` (no hay binario global). Esta historia **no** requiere `supabase db reset` (sin migración), pero `npm run build` puede regenerar `.next/types`; si `typecheck` falla en frío por tipos stale, correr `build` y reintentar (patrón observado en 4.1). [Source: _bmad-output/implementation-artifacts/4-1-conexion-websocket-y-tabla-proyectada-en-vivo-js-client-side.md#Dev Notes; node-version-toolchain memory]

### Estado actual heredado — construir sobre esto (NO reinventar)

- **`src/components/live/LiveStandingsBoard.tsx`** (de 4.1) es el único punto de integración del cliente. Ya tiene: canal único `live-matches:${leagueId}`, `handleMatchUpdate`, `refreshSnapshot` (polling), indicadores de conexión, reemplazo atómico de snapshot, **FLIP de reordenamiento** en un `useLayoutEffect` que compara `previousRowTopsRef` y aplica `transform/opacity` (respeta `prefers-reduced-motion`), y cleanup de canal/intervalos/reconnect. **El destello dorado y el toast deben coexistir con este FLIP, no reemplazarlo.** [Source: src/components/live/LiveStandingsBoard.tsx:246-274]
- `handleMatchUpdate` (líneas 205-244) ya mapea el `payload.new` a `StandingMatch` con `mapPayloadToMatch`. Extender ese mapeo para capturar `home_team`/`away_team` y comparar marcador previo. El snapshot previo está en `snapshotRef.current.matches`. [Source: src/components/live/LiveStandingsBoard.tsx:51-63, 205-244]
- **`buildProjectedStandings`** (en `src/utils/standings.ts`) devuelve `ProjectedStandingRow[]` ordenado con `rank` 1-based. Las filas tienen `rank, userId, displayName, avatarUrl, paymentStatus, totalPoints, exactCount, livePoints`. **Comparar `rank` previo vs nuevo aquí** es la fuente de "quién subió". NO modificar esta función ni `buildStandings` (rompería Story 3.1/4.1). [Source: src/utils/standings.ts:145-212]
- **`src/app/live/page.tsx`** carga `home_team, away_team, ...` en el `select` de `matches` (línea ~55) pero los **descarta** al mapear a `StandingMatch` (líneas 61-67). También tiene `userId` de `auth.getClaims()` (línea 26) que **no** se pasa al board. 4.2 debe propagar equipos + `currentUserId`. [Source: src/app/live/page.tsx:22-104]
- **No existe ninguna librería de toast ni de gestos** en `package.json` (verificado: solo `@radix-ui/*` puntuales, `lucide-react`; sin `sonner`/`vaul`/`framer-motion`/`react-hot-toast`). Construir toast + swipe con React + Pointer Events + CSS, igual que 4.1 evitó librerías nuevas para el reordenamiento. [Source: package.json]
- `PaymentStatusBadge` y el patrón de fila (`<li>` con avatar fallback `/assets/avatars/default-player.svg`, puntos en `text-accent`) ya están en el board; reusar, no duplicar. [Source: src/components/live/LiveStandingsBoard.tsx:347-426]

### Especificación UX del "Impacto de Gol"

- Copy oficial del toast: **"¡Gol de {Equipo}! {Jugador} sube al {N}º puesto proyectado 🎉"**. Ejemplos del diseño: *"¡Gol de Argentina! Laura sube al 3º puesto proyectado 🎉"* y, en el Flow 4 del viewer, *"¡Gol de Ecuador! Cris sube al 1er puesto proyectado."* → de ahí la **prioridad al usuario actual**. [Source: ux-designs/.../EXPERIENCE.md#Impacto de Gol (línea 68), #Flow 4 (línea 118-123)]
- Gestos: **swipe-to-dismiss habilitado** para los toasts de la tabla en vivo. [Source: EXPERIENCE.md línea 80]
- Motion Reduction: con reduced-motion activo, las transiciones de "Impacto de Gol" usan **solo cambios de opacidad**, saltando slide-in. [Source: EXPERIENCE.md línea 87]
- **Destello dorado de fila**: el mockup usa `.gold-flash` sobre la fila que sube (líder), separado de `.green-flash` para otros cambios. Para MVP, implementar el **gold-flash** en la(s) fila(s) que suben. Color = Championship Gold token `accent` (`#E9C46A`), **vía token, no hex**. [Source: mockups/live-leaderboard.html (.gold-flash, líneas 193-197, 589-606); DESIGN.md#Color (accent: #E9C46A, líneas 10, 75)]
- Tokens de marca (no hardcodear hex): `accent`=`#E9C46A` (puntos/oro/1er puesto), `bg-card`/`border-border` para superficies, `text-muted-foreground` secundario. Tap targets ≥48px. [Source: DESIGN.md#Color, #Do/Don't (líneas 75-76, 129-131)]

### Detección de equipo y de movimiento (guía de implementación)

- **Equipo que anota:** Realtime entrega la fila completa en `payload.new` para un `UPDATE`; incluye `home_team`/`away_team`/`home_score`/`away_score`. Inferir el lado que subió comparando contra el marcador previo del mismo `matchId` en `snapshotRef.current`. Si el evento Realtime no incluyera `old` (depende de `REPLICA IDENTITY`), **no dependas de `payload.old`**; usa el snapshot en memoria como "anterior". [Source: src/components/live/LiveStandingsBoard.tsx:205-244; supabase/migrations/20260604123000_matches_realtime_publication.sql]
- **Quién sube:** capturar `Map<userId, rank>` de `rows` previas; tras recalcular, `subió = newRank < prevRank`. Hacerlo de forma consistente con el snapshot resultante (el componente ya recalcula `rows` con `useMemo`; considerar un `useLayoutEffect`/`useEffect` que compare contra un `prevRowsRef`, en paralelo al FLIP existente). Evitar dobles disparos por renders de polling que no cambian puestos. [Source: src/components/live/LiveStandingsBoard.tsx:102-105, 246-274]
- **Anti-spam / atomicidad:** 4.1 ya sufrió bugs de "estado derivado de props/polling que se pisan"; replicar disciplina: derivar toasts de transiciones reales de `rank`, no de cada render; usar refs estables y reemplazos atómicos; cubrir con fake timers. [Source: epic-3-retro-2026-06-04.md#Donde batallamos; 4-1...md#Review Findings]

### Datos y RLS relevantes

- `matches` columnas: `id, external_ref, home_team, away_team, home_team_code, away_team_code, home_score, away_score, match_time, status, matchday, stage`. Estados: `scheduled, live, finished, suspended, canceled`. `home_team`/`away_team` son `not null`; los `*_code` (banderas) son nullable. [Source: supabase/migrations/20260603144628_matches_and_predictions.sql:18-21]
- `public.matches` ya está en la publicación `supabase_realtime` (Story 4.1). **No** agregar tablas nuevas a Realtime; el toast se deriva del mismo `UPDATE` de `matches`. [Source: supabase/migrations/20260604123000_matches_realtime_publication.sql]
- Sin cambios de RLS, sin `service_role`, sin nuevas rutas REST. Polling de 4.1 (browser Supabase client) intacto. [Source: 4-1...md#Dev Notes]

### Riesgos y guardrails específicos

- **No romper 4.1:** el reordenamiento FLIP, los estados de conexión, el polling y el cleanup deben seguir verdes. El destello es **aditivo** a la clase de transición de la fila; no reescribir el `useLayoutEffect`.
- **No tocar el motor puro:** `buildStandings`/`buildProjectedStandings`/`scoring.ts` son fuente de verdad oficial; el equipo/nombre es dato de presentación → mantenerlo fuera de `StandingMatch`/standings.ts (tipo local o map paralelo en el componente).
- **No librerías nuevas:** toast y swipe nativos. Añadir `sonner`/`vaul`/`framer-motion` es una desviación; si el dev cree imprescindible una, **registrarlo como pregunta**, no instalar por defecto.
- **No spam de toasts:** un toast por evento de gol, tope `MAX_VISIBLE_TOASTS`, descartar excedente. Muchos goles simultáneos no deben inundar la pantalla móvil.
- **No timers colgados:** todo `setTimeout` (auto-cierre, destello) debe limpiarse al descartar y al desmontar; el test de unmount de 4.1 no debe regresar.
- **Accesibilidad:** región `aria-live`, control de cierre ≥48px, reduced-motion solo opacidad. No usar solo color para comunicar (el texto del toast ya nombra puesto/jugador).
- **No implementar Epic 5/6:** nada de duelos, premios ni green-flash de "duelo ganado"; solo el gold-flash de subida de puesto del MVP.

### Project Structure Notes

Archivos **NUEVOS** esperados:
- `src/components/live/GoalToast.tsx` (toast item + posible `GoalToastStack` contenedor; o dos archivos si se separan)
- `src/components/live/GoalToast.test.tsx` (si los tests del toast no van todos dentro de `LiveStandingsBoard.test.tsx`)

Archivos **MODIFICADOS** esperados:
- `src/components/live/LiveStandingsBoard.tsx` (capturar equipo en payload, detectar subida, render de toasts, destello de fila, prop `currentUserId`, cleanup de timers)
- `src/components/live/LiveStandingsBoard.test.tsx` (nuevos casos + regresión)
- `src/app/live/page.tsx` (propagar `home_team`/`away_team` y `currentUserId` al board)
- `tests/unit/live-page.test.tsx` (solo si cambia la firma del board y el stub lo requiere)

**NO** se esperan: migraciones, cambios en `src/utils/standings.ts`, `src/utils/scoring.ts`, `BottomNavbar`, ni nuevas dependencias en `package.json`.

### Previous Story Intelligence

- 4.1 dejó el board con disciplina de refs/cleanup y reemplazo atómico de snapshot; los hallazgos de review fueron precisamente sobre re-suscripción, snapshot stale y transición efectiva. 4.2 debe mantener esa barra: derivar el toast de transiciones reales y testear con timers. [Source: 4-1...md#Review Findings, #Completion Notes List]
- Patrón TDD del repo: rojo → verde por archivo, luego suite completa + lint + typecheck + build (+ e2e cuando aplica). Mantenerlo. [Source: 4-1...md#Debug Log References]
- Story 3.3 enseñó: verificar que los archivos existen antes de asumirlos; aquí todos los archivos a modificar fueron verificados en este análisis. [Source: 3-3...md#Completion Notes]
- Bug recurrente Epic 3: estado optimista/derivado de props pisándose. En 4.2, no derivar toasts de cada render de polling. [Source: epic-3-retro-2026-06-04.md#Donde batallamos]

### Git Intelligence Summary

Últimos commits:
- `e396b98 feat: add live projected standings` (Story 4.1 — la base de esta historia)
- `024a56f docs: retrospectiva Epic 3 + decisiones de standings/admin`
- `babb4f3 feat: panel de administración y control de pagos (Story 3.3)`
- `ea34970 feat: add account awards and profiles`
- `787e236 feat: tabla de posiciones y filtro por jornada (Story 3.1)`

Patrón: cada feature client-side llega con tests unitarios co-localizados, Server Components con Suspense para páginas autenticadas, y seams explícitos para epics futuros. Mantener ese estilo; 4.2 es puramente client-side sobre la base de 4.1.

### Latest Tech Information

- **Pointer Events** son el estándar recomendado para gestos táctiles unificados (touch+mouse) sin librerías; usar `setPointerCapture` para seguir el dedo durante el swipe y `pointercancel` para abortar. Evita los problemas de `touchstart` passive y de doble-firing con mouse. [Source: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events]
- **`aria-live="polite"`** / `role="status"` es la forma correcta de anunciar toasts a lectores de pantalla sin robar foco; el contenedor debe existir en el DOM antes de inyectar el texto. [Source: https://www.w3.org/WAI/ARIA/apg/patterns/alert/ — usar `status`/`polite` para no interrumpir]
- **`prefers-reduced-motion`**: el repo ya consulta `window.matchMedia("(prefers-reduced-motion: reduce)")` en 4.1; reusar ese chequeo para degradar a opacidad. Tailwind ofrece `motion-reduce:` (ya usado en el board) para variantes sin JS. [Source: src/components/live/LiveStandingsBoard.tsx:247-249, 380]
- React 19 + Next 16 `cacheComponents: true`: el toast es 100% cliente dentro de `LiveStandingsBoard` (`"use client"`), no introduce lectura dinámica nueva en el server component; el `<Suspense>` de `/live` ya cubre la carga dinámica. [Source: 4-1...md#Realtime; next.config.ts]

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.2: Notificaciones "Impacto de Gol" (Live Toast)]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 4 (FR-17, FR-18)]
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture (líneas 158-160)]
- [Source: _bmad-output/planning-artifacts/architecture.md#Tabla en Vivo Reactiva (líneas 388-390)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/EXPERIENCE.md#Impacto de Gol (68), #Gestures (80), #Motion Reduction (87), #Flow 4 (118-123)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/DESIGN.md#Color (accent #E9C46A)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/mockups/live-leaderboard.html (.gold-flash, .toast-container)]
- [Source: _bmad-output/implementation-artifacts/4-1-conexion-websocket-y-tabla-proyectada-en-vivo-js-client-side.md]
- [Source: _bmad-output/implementation-artifacts/epic-3-retro-2026-06-04.md#Donde batallamos]
- [Source: src/components/live/LiveStandingsBoard.tsx]
- [Source: src/components/live/LiveStandingsBoard.test.tsx]
- [Source: src/app/live/page.tsx]
- [Source: src/utils/standings.ts]
- [Source: supabase/migrations/20260603144628_matches_and_predictions.sql]
- [Source: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events]

## Preguntas para Cris

Ninguna es bloqueante; la historia asume defaults sensatos y los registra aquí:

1. **¿A quién prioriza el toast cuando varios jugadores suben a la vez?** Supuesto adoptado (AC #2): **el usuario actual** si sube; si no, **el nuevo líder**; si no, **el de mayor salto de puestos**. Esto sigue el Flow 4 ("Cris sube al 1er puesto") y evita spam. Alternativa: anunciar siempre al nuevo líder, o un toast por cada jugador que sube (más ruido en móvil). ¿Confirmas la prioridad?
2. **¿Toast solo en subidas, o también avisar bajadas/cambios sin reordenar?** Supuesto: **solo subidas** disparan "Impacto de Gol" con gold-flash (el mockup tiene `green-flash` para otros casos, pero eso lo asociamos a Duelos/Epic 5). ¿Mantener solo subidas para el MVP?
3. **Copy en 1ª vs 3ª persona para el viewer:** el diseño muestra "Cris sube..." (3ª persona, su propio nombre). Supuesto: usar el `displayName` en 3ª persona para todos (incluido el viewer) por simplicidad. ¿Prefieres 2ª persona ("Subes al 1er puesto") cuando es el viewer?

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (claude-opus-4-8)

### Debug Log References

Ciclo red→green por módulo (Node v24.13.0 vía `nvm use 24`):

- `npm run test:unit -- src/components/live/goalImpact.test.ts` (green): **16/16** — lógica pura (equipo que anota, movers, selección, copy).
- `npm run test:unit -- src/components/live/GoalToast.test.tsx` (green): **6/6** — render aria-live, cerrar por botón, swipe sobre/bajo umbral, auto-cierre.
- `npm run test:unit -- src/components/live/` (green): **31/31** — incluye los 9 del board (4 de 4.1 + 5 nuevos de toast/flash/no-reorder/dismiss).
- `npm run test:unit` (green): **27 archivos / 201 tests** (jsdom imprime el aviso esperado de `HTMLCanvasElement.getContext()` sin fallar).
- `npm run typecheck` (red→green): error `TS2322` en `goalImpact.ts` (`sort()[0]` posiblemente `undefined`) → resuelto con destructuring + `?? null`.
- `npm run lint` (green), `npm run build` (green: `/live` Partial Prerender), `npm run test:integration` (green: **13 archivos / 53 tests**, sin migración nueva).

### Completion Notes List

- **Tarea 1** — Equipo conservado en cliente vía tipo local `LiveMatch = StandingMatch & { homeTeam, awayTeam }` en `goalImpact.ts` (sin tocar el motor puro `standings.ts`). `page.tsx` ahora mapea `home_team`/`away_team` y `refreshSnapshot`/`mapPayloadToMatch` los leen del `select` y del `payload.new`.
- **Tarea 2** — Lógica pura en `goalImpact.ts`: `resolveScoringTeam` (compara marcador nuevo vs snapshot anterior; null si ambos cambian/sin previo/sin nombre), `findMovers` (rank nuevo < previo), `selectAnnouncedMover` (viewer → nuevo líder → mayor salto). Toast solo si hay subida real.
- **Tarea 3** — `GoalToast.tsx`: `GoalToastStack` (región `role="status"`/`aria-live="polite"`, `pointer-events-none` para no bloquear la tabla) + `GoalToast` con swipe por Pointer Events (umbral 64px, `setPointerCapture` con guarda try/catch para jsdom), botón × `size-12` (≥48px), auto-cierre 5.5s, tope `MAX_VISIBLE_TOASTS=3`, degradación a opacidad con `prefers-reduced-motion`.
- **Tarea 4** — Integrado en `LiveStandingsBoard`: prop `currentUserId` (propagado desde `page.tsx` con el `userId` de `getClaims()`), estado de toasts + `Set` de filas en destello; `handleMatchUpdate` refactorizado para computar prev/next rows desde `snapshotRef.current` (snapshot autoritativo) sin efectos dentro de un updater. Destello dorado (`border-accent bg-accent/15 ring-2 ring-accent` por tokens) aditivo al FLIP existente, limpiado tras 1.5s; cleanup de todos los timeouts al desmontar.
- **Tarea 5** — Cobertura nueva (goalImpact 16, GoalToast 6, board +5) y regresión 4.1 intacta. Verificación final completa en verde (unit/integration/lint/typecheck/build). `live-page.test.tsx` no requirió cambios (mockea el board y ya pasaba `home_team`/`away_team`).
- **Decisiones registradas:** copy en 3ª persona con `displayName` para todos; solo subidas disparan toast+gold-flash; prioridad viewer→líder→mayor-salto (preguntas 1-3 para Cris siguen abiertas como confirmación, no bloquean).

### File List

- `src/components/live/goalImpact.ts` (nuevo)
- `src/components/live/goalImpact.test.ts` (nuevo)
- `src/components/live/GoalToast.tsx` (nuevo)
- `src/components/live/GoalToast.test.tsx` (nuevo)
- `src/components/live/LiveStandingsBoard.tsx` (modificado)
- `src/components/live/LiveStandingsBoard.test.tsx` (modificado)
- `src/app/live/page.tsx` (modificado)
- `_bmad-output/implementation-artifacts/4-2-notificaciones-impacto-de-gol-live-toast.md` (modificado)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modificado)

## Change Log

| Fecha | Versión | Descripción | Autor |
| --- | --- | --- | --- |
| 2026-06-04 | 0.1 | Story context creada para notificaciones "Impacto de Gol" (toast live + gold-flash + swipe) sobre la base de 4.1. | BMad Create-Story |
| 2026-06-04 | 1.0 | Implementadas notificaciones "Impacto de Gol": helper puro `goalImpact`, componente `GoalToast` (aria-live + swipe + auto-cierre), integración en `LiveStandingsBoard` con destello dorado y prop `currentUserId`. Sin migración ni librerías nuevas. Verificación completa en verde. | Claude Opus 4.8 |
| 2026-06-04 | 1.1 | Code review (3 capas): 2 patches resueltos — gate `hasScoreIncrease` para no celebrar correcciones a la baja, y filtro de `pointerId` para multi-touch en el swipe. 4 hallazgos diferidos, 8 descartados. Suite 208 unit + 53 integration en verde. | Claude Opus 4.8 |

## Completion Note

Ultimate context engine analysis completed - comprehensive developer guide created.

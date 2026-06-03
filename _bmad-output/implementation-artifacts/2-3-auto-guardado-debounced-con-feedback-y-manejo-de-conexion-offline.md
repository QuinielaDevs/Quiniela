---
baseline_commit: e9ab5370d78efb803d7713b9e58982f33c15f9d3
---

# Story 2.3: Auto-guardado Debounced con Feedback y Manejo de Conexion Offline

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **jugador**,
I want **que mis predicciones se guarden solas en segundo plano mientras las modifico y recibir confirmacion visual instantanea, inclusive si mi red falla**,
so that **no temer a la perdida de datos o tener que presionar botones de "Guardar"**.

## Acceptance Criteria

1. **Given** una tarjeta de partido con dos `GoalPicker` controlados
   **When** el jugador cambia el marcador local o visitante
   **Then** el valor se actualiza inmediatamente en UI y se programa un guardado automatico exactamente tras **500ms sin nuevos cambios**.

2. **Given** existe una edicion pendiente
   **When** pasan 500ms de inactividad
   **Then** se invoca la Server Action `savePrediction` en `src/app/actions/predictions.actions.ts` para persistir `league_id`, `match_id`, usuario autenticado, `home_score_pred` y `away_score_pred`
   **And** la accion retorna siempre `ServerActionResult<Prediction>` sin propagar excepciones al cliente.

3. **And** al completarse el guardado con exito, `MatchCard` muestra un micro-feedback no intrusivo: destello/borde verde turf (`success`) y texto/check `Guardado ✓` en el extremo superior de la tarjeta.

4. **And** mientras el guardado esta en vuelo, los controles se bloquean visualmente para evitar envios duplicados; al terminar se reactivan salvo que la prediccion quede pendiente por conexion.

5. **And** si el navegador esta sin red o la llamada de guardado falla por conectividad, la tarjeta muestra borde rojo destructivo (`destructive`), texto `Sin conexion - Pendiente`, conserva la prediccion en estado local de React y reintenta automaticamente al recibir el evento `online`.

6. **And** errores de validacion, autenticacion o permisos devueltos por el servidor NO entran en reintento infinito: se muestran como `Error al guardar. Reintentando...` solo cuando son fallos de conectividad; para errores definitivos se muestra un estado de error seguro y se permite que el proximo cambio del usuario reprograme el guardado.

7. **And** existen pruebas unitarias/co-localizadas o en `tests/unit/` que validan debounce de 500ms con timers falsos, cancelacion de timers al cambiar rapido, feedback de exito, estado offline pendiente, reintento al evento `online`, bloqueo visual durante guardado, y la Server Action con cliente Supabase mockeado. `npm run test:unit`, `npm run lint`, `npm run typecheck` y `npm run build` quedan en verde.

## Tasks / Subtasks

- [x] **Tarea 1 - Crear `src/app/actions/predictions.schema.ts`** (AC: #2, #6)
  - [x] Exportar un esquema Zod para entrada de guardado: `leagueId`, `matchId`, `homeScorePred`, `awayScorePred`.
  - [x] Validar UUIDs, enteros no negativos, y rechazar `NaN`, floats, negativos o payloads vacios antes de llamar Supabase.
  - [x] Mantener el esquema fuera de `predictions.actions.ts` porque los archivos `"use server"` solo deben exportar funciones async, siguiendo el patron de `leagues.schema.ts`.

- [x] **Tarea 2 - Crear Server Action `src/app/actions/predictions.actions.ts`** (AC: #2, #6)
  - [x] Usar `"use server"` al inicio del archivo, `createClient` de `@/utils/supabase/server`, y retornar `Promise<ServerActionResult<Prediction>>`.
  - [x] Obtener el usuario autenticado en servidor, preferiblemente con `supabase.auth.getUser()` para tomar `user.id`; si se usa `getClaims()` por consistencia con rutas existentes, tomar `claims.sub` y validar que exista. Si no hay usuario, retornar `{ success:false, data:null, error:"Debes iniciar sesion para guardar tu prediccion." }`.
  - [x] Persistir siempre con `user_id` derivado del servidor, nunca desde el cliente.
  - [x] **No usar `service_role`** en esta accion cliente: debe respetar RLS y grants de `authenticated`.
  - [x] **Evitar `upsert` directo con la sesion de usuario salvo que se ajuste la BD/RPC**: la migracion 2.1 revoca `update` de tabla y solo permite actualizar `home_score_pred`/`away_score_pred`; un upsert que intente actualizar tambien `league_id`, `match_id` o `user_id` puede fallar por privilegios de columna.
  - [x] Implementar flujo recomendado:
    1. `update({ home_score_pred, away_score_pred }).eq("league_id", leagueId).eq("match_id", matchId).eq("user_id", userId).select().maybeSingle()`.
    2. Si retorna fila, exito.
    3. Si no existe fila, `insert({ league_id, match_id, user_id, home_score_pred, away_score_pred }).select().single()`.
    4. Si el insert falla por unique violation `23505` por carrera entre tabs, reintentar el `update` una vez.
  - [x] No escribir `multiplier` ni `points_earned`; pertenecen a 2.4/procesamiento de resultados y estan protegidos por grants de columna.
  - [x] Mapear errores de Supabase a mensajes seguros. No exponer detalles internos tipo `permission denied`, SQL bruto o nombres de politicas RLS.

- [x] **Tarea 3 - Crear `src/components/predictions/MatchCard.tsx`** (AC: #1, #3, #4, #5, #6)
  - [x] Marcar como `"use client"`.
  - [x] Reutilizar `GoalPicker` dos veces: marcador local y visitante. No duplicar controles +/- ni reintroducir inputs.
  - [x] Props sugeridas:
    ```ts
    type MatchCardPrediction = {
      id?: string;
      homeScorePred: number;
      awayScorePred: number;
      updatedAt?: string;
    };

    type MatchCardProps = {
      leagueId: string;
      match: Pick<Match, "id" | "home_team" | "away_team" | "home_team_code" | "away_team_code" | "match_time" | "status" | "stage" | "matchday">;
      initialPrediction?: MatchCardPrediction | null;
      disabled?: boolean; // reservado para Story 2.4 kickoff lock
    };
    ```
  - [x] Estado local minimo: marcador local/visitante, `saveState` (`idle | dirty | saving | saved | offline | error`), ultimo error seguro, y una referencia/contador de request para ignorar respuestas obsoletas.
  - [x] Debounce con `useEffect` + `setTimeout(500)` y cleanup con `clearTimeout`; cambios rapidos deben cancelar el timer anterior.
  - [x] No disparar guardado en el primer render si `initialPrediction` coincide con el estado local.
  - [x] Mientras `saving`, pasar `disabled` a ambos `GoalPicker` o bloquear visualmente los controles segun el patron de arquitectura. Si llega una respuesta vieja, ignorarla para que no borre un estado mas reciente.
  - [x] Feedback visual:
    - `saved`: borde/destello `border-success` o `ring-success`, microcopy `Guardado ✓`.
    - `offline`: borde `border-destructive`, microcopy `Sin conexion - Pendiente`.
    - `saving`: microcopy corto `Guardando...` y controles bloqueados.
    - `error` definitivo: microcopy seguro, sin bucle automatico infinito.
  - [x] Registrar `window.addEventListener("online", retryPendingSave)` solo cuando haya pendiente offline y limpiar el listener al desmontar/cambiar estado.
  - [x] Usar tokens Tailwind existentes (`bg-card`, `border-border`, `text-accent`, `text-success`, `text-destructive`, `rounded-md`) y `cn` desde `@/utils/utils`.

- [x] **Tarea 4 - Pruebas de `MatchCard`** (AC: #1, #3, #4, #5, #6, #7)
  - [x] Co-localizar `src/components/predictions/MatchCard.test.tsx` o usar `tests/unit/match-card.test.tsx`; proyecto `unit` corre jsdom y Testing Library.
  - [x] Mockear `savePrediction` desde `@/app/actions/predictions.actions`.
  - [x] Usar `vi.useFakeTimers()` para comprobar los 500ms:
    - Click en `+` cambia UI inmediatamente.
    - Antes de 500ms no se llama la accion.
    - A los 500ms se llama una sola vez con el ultimo marcador.
    - Dos cambios rapidos cancelan el timer anterior y guardan solo el ultimo estado.
  - [x] Validar feedback `Guardando...` durante promesa pendiente y `Guardado ✓` tras resolver `{ success:true }`.
  - [x] Validar que en `navigator.onLine === false` o accion rechazada por conectividad se muestra `Sin conexion - Pendiente` y se conserva el marcador local.
  - [x] Validar reintento al disparar `window.dispatchEvent(new Event("online"))`.
  - [x] Validar que errores definitivos `{ success:false, error:"..." }` no registran reintento infinito.
  - [x] Validar que no existen inputs/textboxes introducidos por `MatchCard`; se mantiene el contrato anti-teclado de `GoalPicker`.

- [x] **Tarea 5 - Pruebas de `savePrediction`** (AC: #2, #6, #7)
  - [x] Crear tests unitarios con `createClient` mockeado, siguiendo `tests/unit/leagues-actions.test.ts`.
  - [x] Casos minimos:
    - Payload invalido retorna error y no llama Supabase.
    - Usuario no autenticado retorna error seguro.
    - Fila existente: ejecuta `update(...).select().maybeSingle()` y retorna `Prediction`.
    - Fila inexistente: ejecuta `insert(...).select().single()` y retorna `Prediction`.
    - Insert con `23505`: reintenta update una vez.
    - Error interno/permiso se normaliza sin filtrar SQL/RLS.

- [x] **Tarea 6 - Verificacion final** (AC: #7)
  - [x] Activar Node 24 con nvm antes de comandos npm (el shell por defecto puede estar en Node 12).
  - [x] Ejecutar `npm run test:unit`.
  - [x] Ejecutar `npm run lint`.
  - [x] Ejecutar `npm run typecheck`.
  - [x] Ejecutar `npm run build`.
  - [x] No se requiere arrancar Supabase local ni `npm run test:integration` para cerrar esta historia, salvo que se decida cambiar grants/RPC o agregar migracion.

### Review Findings

- [x] [Review][Patch] Prediccion nueva 0-0 puede no persistirse si el usuario edita y vuelve al marcador inicial [src/components/predictions/MatchCard.tsx:68]
- [x] [Review][Patch] Fallos transitorios devueltos por la Server Action quedan como error definitivo y no activan retry offline [src/app/actions/predictions.actions.ts:95]
- [x] [Review][Patch] `MatchCard` conserva estado y refs obsoletos si cambian `match` o `initialPrediction` en la misma instancia [src/components/predictions/MatchCard.tsx:57]
- [x] [Review][Patch] Un error previo no se limpia al volver al ultimo valor guardado [src/components/predictions/MatchCard.tsx:128]
- [x] [Review][Patch] Los marcadores no tienen tope superior antes de llegar a Supabase/DB [src/app/actions/predictions.schema.ts:10]

## Dev Notes

### Alcance - leer primero

**SI (2.3):**
- `MatchCard.tsx` como tarjeta cliente de partido con dos `GoalPicker`, estado local, debounce de 500ms, feedback visual y reintento offline.
- `predictions.actions.ts` + `predictions.schema.ts` para guardar marcador del usuario autenticado.
- Tests unitarios de temporizadores, estados visuales, reintentos y Server Action.

**NO (otras historias):**
- Calcular o degradar `multiplier`, advertencia de perdida de multiplicador, y bloqueo real por `match_time - 1 minuto` - Story 2.4.
- Calcular `points_earned`, standings oficiales/proyectadas, duelos o reparto de escrow - Epics 3-5.
- Reemplazar completamente `/protected` o construir todo el dashboard de Pronosticos si no es necesario para probar `MatchCard`; esa pantalla aun conserva contenido del starter y puede ser una historia posterior de composicion.
- Modificar RLS/grants salvo que la estrategia update-then-insert resulte insuficiente y se documente una migracion/RPC SECURITY DEFINER con tests de integracion.

### Historia previa 2.2 - inteligencia reutilizable

- `GoalPicker` ya existe en `src/components/predictions/GoalPicker.tsx`; es controlado (`value`/`onChange`), usa `<button>` + `<span>` no editable, tap targets `h-12 w-12`, lucide `Plus`/`Minus`, `aria-label` por equipo y prop `disabled`.
- Reutilizarlo dos veces en `MatchCard`; no crear otro stepper ni usar `<input type="number">`.
- `GoalPicker.test.tsx` muestra el patron de arnes controlado y Testing Library para componentes co-localizados.
- Story 2.2 ya valido `npm run test:unit`, `lint`, `typecheck` y `build` con Node 24.

### Historia previa 2.1 - contratos de datos y seguridad

- `matches` y `predictions` ya existen en Supabase. `predictions` tiene unique `(league_id, user_id, match_id)`, scores no negativos, `multiplier default 1.00`, `points_earned nullable`.
- RLS:
  - Usuario autenticado puede insertar predicciones propias en ligas a las que pertenece.
  - Usuario autenticado puede actualizar solo predicciones propias.
  - Rivales no leen predicciones antes de `match_time - 1 minute`; el dueño siempre puede leer las suyas.
- Grants de columna importantes:
  - `authenticated` puede `insert` solo `league_id`, `match_id`, `user_id`, `home_score_pred`, `away_score_pred`.
  - `authenticated` puede `update` solo `home_score_pred`, `away_score_pred`.
  - Por eso `savePrediction` no debe escribir `multiplier` ni `points_earned`, y debe tener cuidado con upsert directo.
- `src/types/index.ts` ya exporta `Match`, `Prediction`, `PredictionInsert`, `PredictionUpdate`, `MatchStatus` y `ServerActionResult<T>`.

### Archivos existentes a preservar

- `src/components/predictions/GoalPicker.tsx`: preservar contrato controlado, disabled, min/max, a11y y anti-teclado.
- `src/app/actions/leagues.actions.ts`: referencia de formato `"use server"`, `try/catch`, `ServerActionResult`, mensajes seguros y cliente Supabase SSR.
- `src/app/actions/leagues.schema.ts`: referencia para separar esquemas Zod fuera de archivos `"use server"`.
- `src/app/page.tsx` y `src/app/protected/page.tsx`: contienen patrones recientes de Next 16 con `Suspense` para datos dinamicos (`getClaims`, `searchParams`) por `cacheComponents`; no romperlos si se toca composicion de ruta.
- `supabase/migrations/20260603144628_matches_and_predictions.sql` y `20260603144630_predictions_rls.sql`: no relajar RLS ni grants para hacer pasar la UI.

### Detalles de implementacion recomendados

- En `MatchCard`, considerar `lastSavedRef` o comparacion de marcador inicial para evitar guardar al montar.
- Usar `requestIdRef` o bandera de cancelacion para ignorar respuestas viejas. React documenta que los effects ejecutan cleanup antes de rerun y al desmontar; esa limpieza debe cancelar timers/listeners y evitar race conditions.
- Para offline:
  - `navigator.onLine === false` puede adelantar el estado offline antes de llamar al servidor.
  - Si la Server Action rechaza por conectividad, mantener pendiente en estado local y escuchar `online`.
  - El evento `online` solo indica que el navegador recupero acceso de red; MDN advierte que no garantiza disponibilidad de un sitio especifico. El reintento debe seguir manejando fallos.
- Para exito visual, usar texto corto de EXPERIENCE.md: `Guardado ✓`; no usar modales/toasts intrusivos.
- Para errores definitivos devueltos por `ServerActionResult`, no encolar reintentos automaticos infinitos. El siguiente cambio del usuario debe crear una nueva edicion dirty.

### Latest Technical Information

- Versiones locales reales desde `package-lock.json`: Next `16.2.7`, React `19.2.7`, `@supabase/supabase-js` `2.107.0`, `@supabase/ssr` `0.10.3`, Vitest `4.1.8`, Testing Library React `16.3.2`, user-event `14.6.1`.
- Next docs: para usar Server Functions desde Client Components, crear funciones en un archivo dedicado con `"use server"` arriba y luego importarlas en el componente cliente. Fuente: https://en.nextjs.im/docs/app/api-reference/directives/use-server/
- React docs: `useEffect` debe devolver cleanup; React ejecuta cleanup antes del siguiente setup y al desmontar. Esto aplica al debounce (`clearTimeout`) y listener `online`. Fuente: https://react.dev/reference/react/useEffect
- MDN: `window` dispara `online` cuando `Navigator.onLine` cambia a `true`, pero no prueba reachability del backend. Fuente: https://developer.mozilla.org/en-US/docs/Web/API/Window/online_event
- Supabase JS docs: `.upsert()` no devuelve filas por defecto; se encadena `.select()` para retornar datos. En este proyecto, preferir update-then-insert por grants de columnas salvo que se cree RPC/migracion. Fuente: https://supabase.com/docs/reference/javascript/upsert

### Project Structure Notes

- Archivos **NUEVOS esperados**:
  - `src/app/actions/predictions.schema.ts`
  - `src/app/actions/predictions.actions.ts`
  - `src/components/predictions/MatchCard.tsx`
  - `src/components/predictions/MatchCard.test.tsx`
  - `tests/unit/predictions-actions.test.ts` (o nombre equivalente)
- Archivos **UPDATE posibles**:
  - Ninguno obligatorio para cumplir la historia si `MatchCard` se prueba aislado.
  - Si se cablea una pantalla, hacerlo con cuidado en `/protected/page.tsx` o ruta futura de Pronosticos y mantener los wrappers `Suspense` de datos dinamicos.
- No se esperan migraciones SQL para el camino recomendado. Si el dev elige RPC SECURITY DEFINER para salvar atomicidad de upsert, agregar migracion y tests de integracion.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.3: Auto-guardado Debounced con Feedback y Manejo de Conexion Offline]
- [Source: _bmad-output/planning-artifacts/epics.md#FR-8: Auto-guardado con Debounce e Indicador Visual]
- [Source: _bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/prd.md#4.4 Tablero de Predicciones Tactil con Auto-guardado]
- [Source: _bmad-output/planning-artifacts/architecture.md#Process Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Tablero de Predicciones y Auto-guardado]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/EXPERIENCE.md#Flow 2 - Guardado Automatico de Marcador]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/DESIGN.md#Do's and Don'ts]
- [Source: _bmad-output/implementation-artifacts/2-2-componente-goalpicker-tactil-mobile-viewport.md#Dev Notes]
- [Source: src/components/predictions/GoalPicker.tsx]
- [Source: src/types/index.ts]
- [Source: src/app/actions/leagues.actions.ts]
- [Source: supabase/migrations/20260603144628_matches_and_predictions.sql]
- [Source: supabase/migrations/20260603144630_predictions_rls.sql]

## Story Completion Status

Status final de creacion: **ready-for-dev**.

Completion note: Ultimate context engine analysis completed - comprehensive developer guide created.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- RED: `npx vitest run --project unit tests/unit/predictions-schema.test.ts` fallo por import inexistente de `@/app/actions/predictions.schema`.
- GREEN: `npx vitest run --project unit tests/unit/predictions-schema.test.ts` paso 6/6 tras crear el esquema.
- RED: `npx vitest run --project unit tests/unit/predictions-actions.test.ts` fallo por import inexistente de `@/app/actions/predictions.actions`.
- GREEN: `npx vitest run --project unit tests/unit/predictions-actions.test.ts` paso 6/6 tras crear `savePrediction`.
- RED: `npx vitest run --project unit src/components/predictions/MatchCard.test.tsx` fallo por import inexistente de `@/components/predictions/MatchCard`.
- GREEN: `npx vitest run --project unit src/components/predictions/MatchCard.test.tsx` paso 8/8 tras crear `MatchCard` y ajustar tests con timers falsos estables.
- `npm run test:unit`: 12 archivos, 71 tests en verde.
- `npm run lint`: verde tras eliminar un parametro no usado en `predictions.actions.ts`.
- `npm run typecheck`: verde.
- `npm run build`: verde con Next 16.2.7 / Turbopack.
- Primer `npm run test:ci`: unit paso, integracion fallo por Supabase local detenido (`ECONNREFUSED 127.0.0.1:54321`).
- Se arranco el stack local existente con `docker start ...`; `npx supabase status` confirmo Supabase local corriendo.
- Segundo `npm run test:ci`: unit 71/71, integration 30/30 y E2E 2/2 en verde.
- Validacion final tras bloquear controles en estado offline: `npm run lint`, `npm run build` y `npm run test:ci` en verde.
- Review patch: `npx vitest run --project unit src/components/predictions/MatchCard.test.tsx tests/unit/predictions-actions.test.ts tests/unit/predictions-schema.test.ts` paso 29/29.
- Review patch final: `npm run test:unit` paso 80/80; `npm run lint`, `npm run typecheck` y `npm run build` en verde.

### Completion Notes List

- Tarea 1: creado `savePredictionSchema` con Zod en `src/app/actions/predictions.schema.ts`, separado del modulo `"use server"` y cubierto por tests unitarios para UUIDs, enteros no negativos, floats, negativos y `NaN`.
- Tarea 2: creado `savePrediction` con usuario autenticado derivado del servidor, flujo update-then-insert, reintento por unique violation `23505`, sin escritura de `multiplier`/`points_earned`, y errores seguros sin filtrar detalles SQL/RLS.
- Tarea 3: creado `MatchCard` cliente con dos `GoalPicker`, debounce 500ms, estados `dirty/saving/saved/offline/error`, feedback `Guardando...`/`Guardado ✓`/`Sin conexion - Pendiente`, bloqueo de controles durante `saving` y `offline`, reintento con evento `online`, y proteccion contra respuestas obsoletas.
- Tarea 4: agregada suite co-localizada de `MatchCard` con timers falsos y mock de `savePrediction`; cubre no guardar al montar, debounce 500ms, cancelacion de timer, feedback de exito, bloqueo durante guardado y offline, offline por `navigator.onLine`, offline por promesa rechazada, reintento `online`, error definitivo sin reintento y contrato anti-teclado.
- Tarea 5: agregada suite unitaria de `savePrediction` con `createClient` mockeado; cubre payload invalido sin Supabase, usuario no autenticado, update existente, insert nuevo, retry por `23505` y normalizacion de errores internos.
- Tarea 6: validacion completa ejecutada con Node 24. Unit, lint, typecheck, build y `test:ci` completo quedan en verde; para integracion fue necesario arrancar los contenedores Supabase locales existentes.
- Review patch: corregida persistencia de prediccion nueva 0-0 tras edicion, clasificacion de fallos transitorios como reintentables, reseteo de estado al cambiar partido/prediccion inicial, limpieza de error al volver al valor guardado y tope superior compartido de marcador.

### File List

- `_bmad-output/implementation-artifacts/2-3-auto-guardado-debounced-con-feedback-y-manejo-de-conexion-offline.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `src/app/actions/predictions.constants.ts`
- `src/app/actions/predictions.schema.ts`
- `src/app/actions/predictions.actions.ts`
- `src/components/predictions/MatchCard.tsx`
- `src/components/predictions/MatchCard.test.tsx`
- `tests/unit/predictions-actions.test.ts`
- `tests/unit/predictions-schema.test.ts`

## Change Log

| Fecha       | Version | Descripcion                                                                                                     | Autor |
| ----------- | ------- | --------------------------------------------------------------------------------------------------------------- | ----- |
| 2026-06-03  | 0.1     | Historia creada con contexto de epic, arquitectura, UX, historias 2.1/2.2, contratos RLS/grants y latest tech. | Codex |
| 2026-06-03  | 0.2     | Implementados `savePredictionSchema`, `savePrediction`, `MatchCard` con debounce/offline/retry y suites unitarias; gates completos en verde. | Codex |
| 2026-06-03  | 0.3     | Aplicados hallazgos de code review para 0-0 nuevo, errores transitorios reintentables, sincronizacion de props, limpieza de error y tope de marcador. | Codex |

## Preguntas para Cris (no bloquean la implementacion)

1. **Persistencia offline entre recargas:** la AC pide estado local de React. Se asume que NO hace falta `localStorage`/IndexedDB en 2.3; si el usuario recarga estando offline, puede perder el pendiente.
2. **Cableado de pantalla:** se asume que 2.3 puede cerrar con `MatchCard` probado de forma aislada, sin reemplazar todavia `/protected` por el dashboard completo de Pronosticos.

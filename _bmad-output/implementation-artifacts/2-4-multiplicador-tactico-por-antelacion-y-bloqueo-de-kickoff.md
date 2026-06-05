---
baseline_commit: 403a8bbcf013c0174cc3c0e8e9131971d2b06476
---

# Story 2.4: Multiplicador Tactico por Antelacion y Bloqueo de Kickoff

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **jugador de la quiniela**,
I want **que el sistema premie mis predicciones tempranas con multiplicadores y me avise antes de degradar mi multiplicador al editar**,
so that **jugar de manera estrategica en base a la antelacion**.

## Acceptance Criteria

1. **Given** un usuario que crea o edita una prediccion antes del bloqueo
   **When** se guarda la prediccion
   **Then** el backend calcula con hora UTC del servidor un multiplicador por lotes de dias, calibrado a la ventana real del Mundial 2026, y persiste `predictions.multiplier`:
   - `< 7 dias`: `1.00`
   - `7 a 13 dias`: `1.30`
   - `14 a 20 dias`: `1.60`
   - `21 a 27 dias`: `1.90`
   - `28 a 34 dias`: `2.20`
   - `>= 35 dias`: `2.50`

2. **And** si el usuario edita una prediccion existente, el multiplicador se recalcula y sobrescribe con el umbral vigente al momento del guardado. El cliente autenticado no puede enviar ni manipular `multiplier` directamente.

3. **And** si un cambio de marcador sobre una prediccion ya guardada causaria bajar el multiplicador actual, `MatchCard` muestra una advertencia interactiva antes de programar el autosave. Si el usuario cancela, el marcador vuelve al ultimo valor guardado y no se llama `savePrediction`; si confirma, el cambio sigue el debounce existente de 500ms.

4. **And** cuando llegue la hora de `match_time` (kickoff), la UI bloquea los botones `+`/`-`, muestra un candado cerrado con microcopy `Pronostico cerrado`, no programa autosave nuevo, y preserva el contrato anti-teclado de `GoalPicker`.

5. **And** el bloqueo de escritura y lectura se valida estrictamente en Supabase/Postgres usando `now()` del servidor. Cualquier `insert`, `update` o RPC de guardado después de `match_time` (o si status ya no es scheduled) falla con un error seguro y no modifica scores ni multiplier. La lectura de rivales se desbloquea exactamente en el mismo instante.

6. **And** `src/utils/scoring.ts` expone y prueba la aplicacion final `PuntosObtenidos = PuntosBase * Multiplicador` sin duplicar la logica de puntos base existente; partidos `scheduled`, `live`, `suspended` o `canceled` siguen puntuando `0`.

7. **And** existen pruebas unitarias e integracion que cubren calculo de multiplicador en bordes de umbral, degradacion por edicion, cancelacion/confirmacion de advertencia, bloqueo UI por kickoff, denegacion DB/RLS/RPC post-kickoff, imposibilidad de tampering de `multiplier`, y regresion del autosave/offline. `npm run test:unit`, `npm run test:integration`, `npm run lint`, `npm run typecheck` y `npm run build` quedan en verde.

## Tasks / Subtasks

- [x] **Tarea 1 - Extender motor de scoring con multiplicador por lotes de dias** (AC: #1, #6)
  - [x] En `src/utils/scoring.ts`, agregar constantes para la escala canonica: `1.00`, `1.30`, `1.60`, `1.90`, `2.20`, `2.50`.
  - [x] Agregar `calculatePredictionMultiplier(savedAt, matchTime)` como funcion pura que acepte `Date | string | number` o una firma simple tipada y convierta a milisegundos UTC de forma deterministica.
  - [x] Implementar los lotes por antelacion exacta: `<7d = 1.00`, `>=7d = 1.30`, `>=14d = 1.60`, `>=21d = 1.90`, `>=28d = 2.20`, `>=35d = 2.50`.
  - [x] Agregar `calculatePredictionPoints(basePoints, multiplier)` o equivalente para `base * multiplier`, redondeando solo si hace falta para persistencia/visualizacion; no cambiar `calculateBasePoints`.
  - [x] Cubrir bordes exactos: `6.99d` da `1.00`; `7d` da `1.30`; `14d` da `1.60`; `21d` da `1.90`; `28d` da `2.20`; `35d` y `38d` dan `2.50`; `0d`/despues del kickoff da `1.00`.

- [x] **Tarea 2 - Crear migracion SQL de guardado server-authoritative** (AC: #1, #2, #5)
  - [x] Crear migracion con `source ~/.nvm/nvm.sh && nvm use 24 && npx supabase migration new prediction_multiplier_and_kickoff_lock`.
  - [x] Agregar helper SQL `public.fn_match_editable(p_match_id uuid) returns boolean` o equivalente que use `now() < match_time` y `status = 'scheduled'`, `language sql`, `security definer`, `set search_path = ''`.
  - [x] Redefinir helper SQL `public.fn_match_unlocked(p_match_id uuid) returns boolean` para que libere la lectura exactamente en `now() >= match_time`.
  - [x] Agregar helper SQL para calcular multiplier desde `now()` del servidor y el kickoff del primer partido del torneo. Usar la escala por lotes canonica de esta story: maximo `2.50` a partir de `35 dias`.
  - [x] Crear RPC `public.fn_save_prediction(p_league_id uuid, p_match_id uuid, p_home_score_pred int, p_away_score_pred int)` `security definer set search_path = ''` que:
    - lee `auth.uid()` y rechaza anonimos;
    - valida pertenencia con `public.fn_user_in_league(p_league_id)`;
    - valida scores enteros no negativos;
    - valida `fn_match_editable(p_match_id)` antes de escribir;
    - calcula `v_multiplier` con `now()` y `match_time`;
    - hace update-then-insert para `(league_id,user_id,match_id)`;
    - en carrera `unique_violation`, reintenta update una vez;
    - retorna la fila `public.predictions`.
  - [x] Conceder `execute` de la RPC solo a `authenticated`; no conceder escritura directa de `multiplier` a `authenticated`.
  - [x] Ajustar politicas/grants directos de `predictions_insert_own` y `predictions_update_own` para incluir el bloqueo por kickoff. Esto cierra el diferido de 2.1: aun si alguien bypassa la UI/Server Action, la escritura directa del rol `authenticated` falla despues del umbral.

- [x] **Tarea 3 - Actualizar `savePrediction` para usar la RPC** (AC: #1, #2, #5)
  - [x] Mantener `"use server"` en `src/app/actions/predictions.actions.ts` y el contrato `Promise<ServerActionResult<Prediction>>`; nunca propagar excepciones al cliente.
  - [x] Reutilizar `savePredictionSchema`; no aceptar `multiplier` ni `user_id` desde el cliente.
  - [x] Reemplazar el flujo directo `updateExistingPrediction`/`insertPrediction` por llamada a `supabase.rpc("fn_save_prediction", ...)`.
  - [x] Mapear error de kickoff cerrado a mensaje seguro estable, por ejemplo `Pronostico cerrado. El partido esta por comenzar.`
  - [x] Conservar la clasificacion de errores transitorios (`TRANSIENT_SAVE_ERROR`) para que la UI offline de 2.3 siga reintentando.
  - [x] Actualizar tests unitarios de `tests/unit/predictions-actions.test.ts` para RPC success, payload invalido sin Supabase, anonimo, error definitivo de kickoff, error transitorio y seguridad sin filtrar SQL/RLS.

- [x] **Tarea 4 - Extender tipos y datos de `MatchCard` para multiplier/kickoff** (AC: #2, #3, #4)
  - [x] En `src/components/predictions/MatchCard.tsx`, extender `MatchCardPrediction` con `multiplier: number` y conservar compatibilidad inicial solo si realmente se necesita para tests; preferir que todo caller futuro pase la fila `Prediction`.
  - [x] Derivar `currentMultiplier` del `initialPrediction?.multiplier ?? 1`.
  - [x] Calcular `nextMultiplier` para advertencia usando el mismo helper TS de `scoring.ts` con `Date.now()` solo para UI predictiva. El valor autoritativo final siempre viene del backend/RPC.
  - [x] Derivar `isLocked` con `match.match_time` en cliente para UX inmediata: `Date.now() >= new Date(match.match_time).getTime()`. Tratar estados `live`, `finished`, `suspended`, `canceled` como cerrados visualmente.
  - [x] Pasar `disabled={controlsDisabled || isLocked}` a ambos `GoalPicker`.
  - [x] Mostrar candado con icono `Lock` de `lucide-react` y microcopy `Pronostico cerrado`; evitar emoji de candado para mantener iconografia consistente aunque el AC lo describa como candado cerrado.
  - [x] Mostrar indicador de multiplier con color `text-accent`/Championship Gold; no convertir toda la tarjeta en dorada.

- [x] **Tarea 5 - Advertencia interactiva de degradacion** (AC: #3)
  - [x] Reutilizar componentes UI existentes si estan disponibles (`src/components/ui/dialog.tsx`, `button.tsx`); si falta alguno, usar un modal accesible minimo sin introducir librerias nuevas.
  - [x] Disparar advertencia solo si hay prediccion guardada y `nextMultiplier < currentMultiplier`.
  - [x] La advertencia debe ocurrir antes de marcar `hasUserEditedRef` y antes del debounce. Si el usuario cancela, no cambia score persistible ni estado dirty.
  - [x] Si confirma, aplicar el score local y dejar que el debounce/offline/retry de 2.3 opere sin duplicar logica.
  - [x] Evitar bucles: una confirmacion debe cubrir el cambio actual, no abrir de nuevo para el mismo click confirmado.

- [x] **Tarea 6 - Tests de UI y acciones** (AC: #3, #4, #7)
  - [x] En `src/components/predictions/MatchCard.test.tsx`, agregar casos para:
    - muestra multiplier actual;
    - edicion que no degrada no abre advertencia;
    - edicion que degrada abre advertencia y cancelar no llama `savePrediction`;
    - confirmar advertencia llama `savePrediction` tras 500ms;
    - partido en `match_time` bloquea botones y muestra `Pronostico cerrado`;
    - respuesta de kickoff cerrado muestra error seguro y no entra en retry offline;
    - regresion: offline/transient retry sigue funcionando.
  - [x] En `tests/unit/predictions-actions.test.ts`, actualizar mocks al shape de `.rpc(...)`.
  - [x] En `src/utils/scoring.test.ts`, agregar matriz de umbrales y aplicacion `base * multiplier`.

- [x] **Tarea 7 - Tests de integracion DB/RLS/RPC** (AC: #1, #2, #5, #7)
  - [x] Extender `tests/integration/rls-policies.test.ts` o crear `tests/integration/predictions-save-rpc.test.ts`.
  - [x] Con Supabase local, probar que RPC guarda una prediccion futura con multiplier esperado y retorna fila.
  - [x] Probar que editar via RPC recalcula multiplier hacia abajo cuando el match_time esta mas cerca.
  - [x] Probar que el rol `authenticated` sigue sin poder escribir `multiplier` directo.
  - [x] Probar que insert/update directo y RPC fallan después de `match_time` o si status no es `scheduled`.
  - [x] Probar que dueño conserva lectura de su prediccion y que la politica de lectura gated de 2.1 no se rompe.

- [x] **Tarea 8 - Verificacion final** (AC: #7)
  - [x] Activar Node 24 con `source ~/.nvm/nvm.sh && nvm use 24`.
  - [x] Ejecutar `npm run test:unit`.
  - [x] Ejecutar `npm run test:integration` con Supabase local activo. Si falla por Supabase detenido, arrancar el stack local existente y reintentar una vez.
  - [x] Ejecutar `npm run lint`.
  - [x] Ejecutar `npm run typecheck`.
  - [x] Ejecutar `npm run build`.
  - [x] Si se cambia el esquema, ejecutar `npm run db:types` y commitear `src/types/database.types.ts`.

## Dev Notes

### Alcance - leer primero

**SI (2.4):**
- Calculo del multiplier por antelacion en TS y en SQL/RPC.
- Persistencia de `predictions.multiplier` al crear/editar predicciones.
- Bloqueo real de escritura por `match_time` en base de datos y Server Action.
- UI en `MatchCard` para candado/estado cerrado y advertencia de degradacion.
- Tests unitarios e integracion que cierran el diferido de 2.1.

**NO (otras historias):**
- Persistir `points_earned` al finalizar partidos o recalcular standings oficiales: queda para Epic 3/4/5.
- Construir dashboard completo de Pronosticos o cablear `/protected` si no hace falta para probar `MatchCard`.
- Implementar desafios/escrow o especiales del torneo.
- Relajar RLS/grants para hacer pasar la UI. Si algo necesita escribir `multiplier`, debe hacerlo codigo confiable (RPC/SECURITY DEFINER o service_role controlado), no el cliente directo.

### Historia previa 2.3 - inteligencia reutilizable

- `MatchCard` ya existe como componente cliente con dos `GoalPicker`, debounce de 500ms, estados `dirty/saving/saved/offline/error`, `pendingRef`, `lastSavedRef`, `requestIdRef`, reintento por `online`, y proteccion contra respuestas obsoletas.
- `savePrediction` ya retorna siempre `ServerActionResult<Prediction>` y clasifica `TRANSIENT_SAVE_ERROR` para mantener la cola offline de `MatchCard`.
- Review de 2.3 corrigio 5 bordes: 0-0 nuevo tras edicion, errores transitorios reintentables, reset por cambio de props, limpieza de error al volver al valor guardado y tope `MAX_PREDICTION_SCORE = 99`.
- Tests existentes de `MatchCard` usan `vi.useFakeTimers()`, `fireEvent`, mocks de `savePrediction` y helpers `setOnline`/`flushPromises`. Extender ese patron; no reescribir la suite.
- `GoalPicker` ya soporta `disabled`, `min`, `max`, tap targets `h-12 w-12`, `aria-label` por equipo y marcador en `<span>` no editable. No crear otro stepper ni introducir inputs.

### Historia previa 2.1 - seguridad y DB

- `matches.match_time timestamptz not null` es la fuente de kickoff UTC.
- `predictions.multiplier numeric(3,2) not null default 1.00 check (multiplier >= 1.00)` ya existe.
- `predictions.points_earned numeric(6,2)` queda nullable y fuera de esta story.
- `fn_match_unlocked(match_id)` ya existe y se redefinió para usar `now() >= match_time` (o status != 'scheduled') para lectura gated, alineándose con el momento de cierre de edición.
- `fn_match_editable(match_id)` para escritura usa `now() < match_time` y `status = 'scheduled'`.
- `predictions_select_gated`: dueño siempre puede leer; rivales de la liga solo despues de desbloqueo. No romper.
- Grants actuales revocan insert/update de tabla y reconceden al rol `authenticated` solo columnas de score. Esto fue un hardening de review para impedir tampering de `points_earned`/`multiplier`; 2.4 debe preservarlo.
- Hay un hallazgo diferido explicito de 2.1: "Sin bloqueo de escritura por kickoff -1min en INSERT/UPDATE" asignado a Story 2.4. Esta story debe cerrarlo con tests.

### Archivos existentes a modificar

- `src/utils/scoring.ts`: hoy calcula solo puntos base con `calculateBasePoints`. Agregar helpers de multiplier sin cambiar las reglas base ni los tests existentes.
- `src/utils/scoring.test.ts`: extender matriz; mantener casos de canceled/suspended = 0.
- `src/app/actions/predictions.actions.ts`: hoy hace update-then-insert directo via Supabase client autenticado y no puede escribir `multiplier`. Cambiar a RPC segura para que el backend calcule y persista multiplier.
- `src/app/actions/predictions.schema.ts`: probablemente no necesita aceptar campos nuevos; mantener `leagueId`, `matchId`, `homeScorePred`, `awayScorePred`.
- `src/app/actions/predictions.constants.ts`: agregar constantes de error si hace falta (`PREDICTION_LOCKED_ERROR`) y reutilizar `MAX_PREDICTION_SCORE`.
- `src/components/predictions/MatchCard.tsx`: extender props/estado para multiplier, candado y confirmacion; preservar debounce/offline/retry.
- `src/components/predictions/MatchCard.test.tsx`: extender sin borrar regresiones de 2.3.
- `tests/unit/predictions-actions.test.ts`: adaptar mocks de Supabase de `.from().update/insert` a `.rpc()`.
- `tests/integration/rls-policies.test.ts` o nuevo archivo integration: agregar pruebas DB/RPC.
- `supabase/migrations/*.sql`: crear nueva migracion; no editar migraciones antiguas salvo que el proyecto lo permita explicitamente. Mantener `set search_path = ''` en funciones.
- `src/types/database.types.ts`: regenerar con `npm run db:types` si la migracion agrega funciones/tipos relevantes.

### Detalles de implementacion recomendados

#### Calculo de multiplier por lotes de dias

**Override de producto (2026-06-03):** aunque la Decision 10 del PRD habla de umbrales semanales de `1.0x` a `2.0x`, Cris ajusto la regla para que las fechas reales del Mundial 2026 (`11 de junio` a `19 de julio`) tengan sentido y el rango total sea `1.0x` a `2.5x`. La regla de esta story reemplaza la escala anterior para implementacion.

FIFA confirma que el Mundial 2026 se juega del **11 de junio al 19 de julio de 2026**. Entre la apertura y la final hay 38 dias de diferencia. Por eso una escala con maximo desde `>=35 dias` permite que una prediccion muy anticipada de partidos finales llegue al premio completo, sin exigir antelaciones irreales fuera de la ventana del torneo.

Usar dias exactos sobre milisegundos/intervalos, no calendario local:

```ts
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const daysUntilKickoff = (matchTimeMs - savedAtMs) / MS_PER_DAY;
```

Regla de bordes:
- `< 7 dias`: `1.00`
- `>= 7 dias`: `1.30`
- `>= 14 dias`: `1.60`
- `>= 21 dias`: `1.90`
- `>= 28 dias`: `2.20`
- `>= 35 dias`: `2.50`
- `0 dias` o negativo: `1.00`

SQL debe espejar esta misma regla con `extract(epoch from (match_time - now())) / 86400.0` y un `case` ordenado de mayor a menor (`>= 35`, `>= 28`, etc.). No usar `date_part('day', interval)` porque pierde fracciones y puede driftar contra TS.

#### RPC recomendada

Preferir una RPC como fuente unica de escritura porque:
- el cliente `authenticated` no debe tener grants sobre `multiplier`;
- el calculo debe usar `now()` del servidor, no `Date.now()` del navegador;
- update-then-insert ya existe conceptualmente en `savePrediction`, pero en 2.4 debe moverse a DB o quedar encapsulado tras una funcion confiable que escriba score + multiplier atomicos.

La RPC debe validar explicitamente pertenencia, usuario, scores y kickoff. No confiar en que `SECURITY DEFINER` + RLS haga todo: una funcion definer puede operar con privilegios del owner, asi que las guardas deben estar dentro de la funcion.

#### UI y advertencia

- `MatchCard` debe bloquear controles si `disabled`, `saving`, `offline` o `isLocked`.
- El lock de UI es defensivo/ergonomico; la DB sigue siendo autoridad. Si el reloj del cliente esta mal, la Server Action/RPC debe denegar.
- La advertencia de degradacion no debe aparecer para una prediccion nueva sin multiplier guardado.
- Si `currentMultiplier = 1.00`, no hay degradacion posible; no mostrar modal.
- Si el usuario confirma un cambio que degrada, el autosave normal debe mostrar `Guardando...`/`Guardado ✓` igual que 2.3.
- Si el usuario cancela, regresar el control al ultimo score guardado y mantener `saveState` estable (`idle` o `saved` segun contexto).
- Usar iconos lucide (`Lock`) en vez de emoji visible; el AC pide candado cerrado, no necesariamente caracter unicode.
- El copy visible debe ser corto: `Pronostico cerrado`, `Tu multiplicador bajara de 1.8x a 1.6x` (sin textos largos de ayuda dentro de la app).

### Latest Technical Information

- Versiones instaladas reales desde `package-lock.json`: Next `16.2.7`, React `19.2.7`, `@supabase/supabase-js` `2.107.0`, `@supabase/ssr` `0.10.3`, Vitest `4.1.8`, Testing Library React `16.3.2`, user-event `14.6.1`, Playwright `1.60.0`, Zod `4.4.3`, lucide-react `0.511.0`.
- FIFA confirma las fechas oficiales del Mundial 2026: partido inaugural el jueves 11 de junio de 2026 y final el domingo 19 de julio de 2026. La escala por lotes de esta story usa esa ventana real para que `>=35 dias` alcance el maximo `2.50x`. Fuente: https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/fifa-world-cup-26-match-schedule-revealed
- Next docs: para usar Server Functions desde Client Components, crear funciones en archivo dedicado con `"use server"` arriba e importarlas desde el componente cliente; mantener `predictions.actions.ts` dedicado. Fuente: https://en.nextjs.im/docs/app/api-reference/directives/use-server/
- Next docs: `"use client"` marca el limite cliente; secretos/API keys y acceso directo a DB deben quedarse en server code. Fuente: https://nextjs.im/docs/app/getting-started/server-and-client-components/
- Supabase RLS docs: `INSERT` usa `WITH CHECK`; `UPDATE` necesita `USING` para filas objetivo y `WITH CHECK` para nuevos valores. Fuente: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase database functions docs: las funciones SQL pueden usar `security definer set search_path = ''`; usar `SECURITY DEFINER` solo con guardas explicitas. Fuente: https://supabase.com/docs/guides/database/functions
- Supabase advisors: el lint marca funciones con `search_path` mutable y politicas RLS permisivas/sin `WITH CHECK`; mantener `set search_path = ''` y checks especificos. Fuente: https://supabase.com/docs/guides/database/database-advisors

### Project Structure Notes

- Archivos **NUEVOS esperados**:
  - `supabase/migrations/<timestamp>_prediction_multiplier_and_kickoff_lock.sql`
  - opcional `tests/integration/predictions-save-rpc.test.ts` si la suite RLS queda demasiado grande.
- Archivos **UPDATE esperados**:
  - `src/utils/scoring.ts`
  - `src/utils/scoring.test.ts`
  - `src/app/actions/predictions.actions.ts`
  - `src/app/actions/predictions.constants.ts`
  - `src/components/predictions/MatchCard.tsx`
  - `src/components/predictions/MatchCard.test.tsx`
  - `tests/unit/predictions-actions.test.ts`
  - `tests/integration/rls-policies.test.ts` o nuevo integration test
  - `src/types/database.types.ts` si se regeneran tipos
- No introducir dependencias nuevas. Ya existen lucide, Radix/shadcn primitives, Testing Library, Vitest y Supabase.
- No usar `service_role` en `savePrediction`; el cliente web debe seguir operando con la sesion del usuario y una RPC segura.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.4: Multiplicador Tactico por Antelacion y Bloqueo de Kickoff]
- [Source: _bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/prd.md#4.4 Tablero de Predicciones Tactil con Auto-guardado]
- [Source: _bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/prd.md#4.5 Multiplicador Incremental por Prediccion Anticipada]
- [Source: _bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/.decision-log.md#Decision 10: Multiplicadores Ajustados por Partido]
- [Source: _bmad-output/planning-artifacts/architecture.md#Technical Constraints & Dependencies]
- [Source: _bmad-output/planning-artifacts/architecture.md#Cross-Cutting Concerns Identified]
- [Source: _bmad-output/planning-artifacts/architecture.md#Tablero de Predicciones y Auto-guardado]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/EXPERIENCE.md#Component/State Patterns]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/DESIGN.md#Do's and Don'ts]
- [Source: _bmad-output/implementation-artifacts/2-1-modelos-de-partidos-predicciones-y-motor-de-puntuacion-scoring.md#Dev Notes]
- [Source: _bmad-output/implementation-artifacts/2-2-componente-goalpicker-tactil-mobile-viewport.md#Dev Notes]
- [Source: _bmad-output/implementation-artifacts/2-3-auto-guardado-debounced-con-feedback-y-manejo-de-conexion-offline.md#Dev Notes]
- [Source: supabase/migrations/20260603144628_matches_and_predictions.sql]
- [Source: supabase/migrations/20260603144630_predictions_rls.sql]
- [Source: src/components/predictions/MatchCard.tsx]
- [Source: src/app/actions/predictions.actions.ts]
- [Source: src/utils/scoring.ts]

## Story Completion Status

Status final de creacion: **ready-for-dev**.

Completion note: Ultimate context engine analysis completed - comprehensive developer guide created.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Opus 4.8)

### Debug Log References

- `npm run test:unit`: **101/101** (incluye matriz de umbrales de multiplicador en `scoring.test.ts`, casos de degradación/candado/error de kickoff en `MatchCard.test.tsx`, y `predictions-actions.test.ts` adaptado a la RPC).
- `npm run test:integration`: **36/36** (nuevo `predictions-save-rpc.test.ts` con 6 casos; `rls-policies.test.ts` ajustado al nuevo lock de escritura).
- `npm run lint` y `npm run typecheck`: 0 errores.
- `npm run build`: compila OK (ruta `/predictions` con multiplier).
- `npx supabase db reset`: idempotente (re-aplica la migración nueva + seed sin errores, verificado en varias pasadas).
- Incidencia de entorno: tras reinicios repetidos del stack local, Auth devolvió 502 y se regeneró `.env.test.local`; recuperado con `npx supabase stop && start` + espera de health. NO fue un problema de código (la suite pasa 36/36 con el stack sano).

### Completion Notes List

- **Scoring (Tarea 1)** — `src/utils/scoring.ts`: añadidos `MULTIPLIER_TIERS`, `MIN/MAX_MULTIPLIER`, `calculatePredictionMultiplier(savedAt, matchTime)` (lotes de días, máximo 2.50 desde ≥35d) y `calculatePredictionPoints(base, mult)`. No se tocó `calculateBasePoints`. Vector de pruebas de bordes (6.99/7/14/21/28/35/38, 0 y negativos) + aplicación base×mult.
- **Migración (Tarea 2)** — `20260603201630_prediction_multiplier_and_kickoff_lock.sql`: `fn_match_editable` (now() < match_time − 1min), `fn_prediction_multiplier` (espeja TS), y RPC `fn_save_prediction` (SECURITY DEFINER) que valida usuario/pertenencia/scores/kickoff y hace upsert de score+multiplier con `now()` del servidor (única vía de escritura de `multiplier`). Se reforzaron `predictions_insert_own`/`predictions_update_own` con `fn_match_editable` → cierra el diferido de 2.1 (escritura directa también bloqueada tras kickoff).
- **Server Action (Tarea 3)** — `predictions.actions.ts` ahora llama `rpc("fn_save_prediction", …)`; mapea el bloqueo de kickoff a `PREDICTION_LOCKED_ERROR` (definitivo, no reintentable) y conserva la clasificación transitoria para la cola offline de 2.3. El cliente nunca envía `multiplier`/`user_id`.
- **MatchCard (Tareas 4-5)** — indicador de multiplicador (`text-accent`), candado (`Lock` + "Pronostico cerrado") cuando falta ≤1min o el partido no está `scheduled` (deshabilita ambos GoalPicker), y advertencia interactiva (alertdialog) que intercepta la edición si bajaría el multiplicador guardado: Cancelar no aplica el cambio ni guarda; Continuar aplica y deja correr el debounce de 2.3. Se preservó toda la mecánica de auto-guardado/offline/retry.
- **Página (Tarea 4)** — `src/app/predictions/page.tsx` ahora selecciona y pasa `multiplier` a cada `MatchCard`.
- **Tipos** — `src/types/database.types.ts` regenerado con las 3 funciones nuevas.
- **Tests (Tareas 6-7)** — unit de scoring/MatchCard/acción y un nuevo integration de la RPC (crea con 2.50, recalcula a 1.30 al acercar el kickoff, no-miembro rechazado, RPC e insert directo bloqueados tras kickoff, multiplier no manipulable).
- **Alcance respetado**: NO se persiste `points_earned` ni standings (Epic 3/5); sin dependencias nuevas; sin `service_role` en la Server Action; RLS/grants de 2.1 preservados y reforzados.

### File List

**Migraciones / DB (nuevo):**
- `supabase/migrations/20260603201630_prediction_multiplier_and_kickoff_lock.sql`

**Código (modificado):**
- `src/utils/scoring.ts`
- `src/app/actions/predictions.actions.ts`
- `src/app/actions/predictions.constants.ts`
- `src/components/predictions/MatchCard.tsx`
- `src/app/predictions/page.tsx`

**Tipos (modificado, regenerado):**
- `src/types/database.types.ts`

**Tests (nuevo / modificado):**
- `tests/integration/predictions-save-rpc.test.ts` (nuevo)
- `src/utils/scoring.test.ts` (modificado)
- `src/components/predictions/MatchCard.test.tsx` (modificado)
- `tests/unit/predictions-actions.test.ts` (modificado)
- `tests/integration/rls-policies.test.ts` (modificado: fixture compatible con el lock de escritura)

## Change Log

| Fecha       | Version | Descripcion | Autor |
| ----------- | ------- | ----------- | ----- |
| 2026-06-03  | 0.1     | Historia creada con contexto de Epic 2, PRD/Decision 10, arquitectura, UX, historias 2.1/2.2/2.3, RLS/grants actuales y latest tech. | Codex |
| 2026-06-03  | 0.2     | Ajustada regla de multiplicador a escala diaria lineal `1 + clamp(dias,0,38)/38`, basada en fechas oficiales del Mundial 2026 (11 jun-19 jul). | Codex |
| 2026-06-03  | 0.3     | Reemplazada escala diaria por lotes de dias semanales con rango `1.00x` a `2.50x`: `<7`, `7-13`, `14-20`, `21-27`, `28-34`, `>=35`. | Codex |
| 2026-06-03  | 1.0     | Implementacion completa: scoring (multiplier + base×mult), RPC `fn_save_prediction` server-authoritative con bloqueo de kickoff (cierra diferido de 2.1), Server Action via RPC, MatchCard con multiplicador/candado/advertencia, wiring en `/predictions`, tests unit (101) e integracion (36). Lista para review. | Amelia (Dev) |

## Review Findings

> Revisión adversarial — 2026-06-03 (3 capas; las 2 que cayeron por límite de sesión se re-lanzaron y completaron). **Acceptance Auditor: PASS** (las 7 ACs cumplidas, gates verdes, alcance respetado). Historia sensible a seguridad (RLS / SECURITY DEFINER): las 3 capas confirman las rutas seguras (auth/pertenencia/kickoff dentro del DEFINER, `search_path=''`, sin SQL dinámico; `multiplier` no escribible por el cliente). Hallazgo crítico potencial (numeric serializado como string → crash al renderizar) **verificado y DESCARTADO**: PostgREST devuelve `numeric` como número JSON. Triage final: 0 decisiones, 1 patch (aplicado), 1 diferido (ampliado con sub-casos del Edge Case Hunter), resto descartado/by-design.

### Patches (aplicados 2026-06-03)

> Patch aplicado y verificado: `db reset` idempotente, integration **36/36**, unit **101/101**, lint/typecheck/build limpios.

- [x] [Review][Patch] `fn_prediction_multiplier` era `SECURITY DEFINER` sin necesitarlo (solo aritmética sobre su argumento + `now()`, sin acceso a tablas). Se quitó `security definer` (mínimo privilegio); sigue funcionando invocada desde `fn_save_prediction` [supabase/migrations/20260603201630_prediction_multiplier_and_kickoff_lock.sql]

### Deferred

- [x] [Review][Defer] **UI derivada de tiempo evaluada solo en render** (`MatchCard.tsx`). Sin un timer/intervalo que fuerce re-render, una tarjeta abierta no refleja el paso del tiempo. Sub-casos (Blind + Edge Case Hunter): (a) el candado no se auto-bloquea al cruzar `match_time−1min`; (b) el indicador de multiplicador y `nextMultiplier` quedan stale al cruzar un lote de días; (c) `degradeAckRef` (confirmación por sesión) podría tapar una degradación mayor posterior; (d) si la tarjeta se bloquea con la advertencia abierta, el diálogo sigue interactivo. **Sin riesgo de datos**: el servidor (RPC `fn_save_prediction` → P0001) es la autoridad y rechaza toda escritura post-kickoff. Solución única: un `setInterval` que re-renderice y reseteé el ack al cruzar umbrales. [src/components/predictions/MatchCard.tsx]
- [x] [Review][Defer] La RPC `fn_save_prediction` y la tabla `predictions` validan `>= 0` pero **no un tope superior** de marcador (el `MAX_PREDICTION_SCORE = 99` es solo cliente/zod). Una llamada directa a la RPC por un `authenticated` podría guardar un marcador enorme (cosmético, sin impacto de seguridad). Hardening futuro: CHECK de tope en la tabla + validación en la RPC. [supabase/migrations/20260603201630_prediction_multiplier_and_kickoff_lock.sql]

### Descartados (resumen)
- **Falso positivo:** `numeric` como string (verificado: es número).
- **Spec'd (no bug):** overwrite del `multiplier` al editar (AC#2); advertencia que dispara al editar tras decaer el tiempo (AC#3 — editar SÍ recalcula a la baja); mostrar el multiplier guardado como "actual" (solo baja al guardar).
- **Fuera de alcance (Epic 5):** `calculatePredictionPoints` expuesto/testeado pero sin cablear (AC#6 solo pide exponer+probar; `points_earned` es Epic 5).
- **Aceptable:** `isPredictionLockedError` usa code `P0001` (único raise de kickoff en la RPC) + fallback de mensaje; `23514`/`P0002` mapeados a error seguro no-reintentable; fixture de lectura sembrado con service_role (el insert directo post-kickoff sí se cubre en el test RPC); helpers `stable` llamados varias veces por la política directa (ruta de respaldo, no caliente).

## Preguntas para Cris (no bloquean la implementacion)

1. **Copy final de advertencia:** se propone `Tu multiplicador bajara de {actual}x a {nuevo}x. ¿Continuar?`; dev puede ajustar microcopy sin cambiar comportamiento.
2. **Persistencia visual del multiplier:** se asume que basta mostrarlo en `MatchCard`; no se construye aun una pagina completa de Pronosticos ni standings.

# Fase 4 — Tablero de predicciones: edición, autosave, candados y multiplicadores

## Objetivo
Completar la cobertura del corazón del producto. Ya existen 21 tests de **visualización** (`predictions-finished.spec.ts`: resultados, badges de puntos, tabs, drift chip, estados live/suspended/TBD). Esta fase añade la **interacción**: edición táctil, autosave con debounce, deshacer, candado de kickoff, predicciones por defecto, multiplicadores dinámicos y offline.

## Dependencias
Fases 1-3. Los 21 tests existentes son el punto de partida — NO duplicarlos; esta fase los complementa.

## Contexto requerido
- `00-contexto.md` §4.1-4.3 (scoring, multiplicador por jornadas, candados) y §7.2/7.4 (trampas de jornada en curso y kickoff).
- Leer: `src/components/predictions/MatchCard.tsx` (lógica de guardado, undo, drift, estados), `GoalPicker.tsx`, `PredictionsBoardView.tsx`, `src/app/actions/predictions.actions.ts` (savePrediction/revertPrediction, mensajes de error), `src/app/predictions/page.tsx` (dónde se invoca `fn_ensure_default_predictions`), spec existente `tests/e2e/predictions-finished.spec.ts` (patrones a seguir).

## Entregables
- `tests/e2e/predictions-edit.spec.ts`
- `tests/e2e/predictions-lock.spec.ts`

## Casos de prueba

### Edición y autosave (`predictions-edit.spec.ts`)
Seed: usuario+liga+partido editable J2/J3 (kickoff +2 días) con predicción default 0-0.

| ID | Caso | Acción | Verificación |
|---|---|---|---|
| PRED-01 | Incrementar goles local y visitante | `goal-increment` en ambos lados | `goal-value` refleja 1-1; tras debounce, `save-status` indica guardado |
| PRED-02 | Decrement en 0 no baja de 0 | `goal-decrement` con valor 0 | valor sigue 0 (o botón disabled — según componente) |
| PRED-03 | Persistencia tras reload | editar a 2-1, esperar guardado, `page.reload()` | la card muestra 2-1; BD (`getPrediction`) coincide |
| PRED-04 | Debounce colapsa ediciones rápidas | 5 clicks rápidos en `goal-increment` (<500 ms entre sí) | un único valor final 5 en UI y BD; el indicador pasa por "guardando→guardado" una vez estabilizado |
| PRED-05 | Deshacer restaura el valor anterior | editar 0-0→3-1, guardar; click `undo-button` | vuelve al valor previo persistido (verificar semántica real de `revertPrediction`: ¿último guardado o valor original?) en UI y BD |
| PRED-06 | Multiplicador mostrado = cálculo dinámico | leer `multiplier-badge` | igual a `expectedMultiplierForMatch()` (helper Fase 1) — **nunca** valor hardcodeado |
| PRED-07 | J1 siempre 1.0x | partido `test_` con matchday=1 editable | badge muestra 1.0x y BD guarda multiplier=1.00 tras editar |
| PRED-08 | Editar recalcula multiplicador en BD | editar predicción | `getPrediction().multiplier` == cálculo dinámico del momento del guardado |
| PRED-09 | Drift warning al editar con multiplicador degradado | seed: predicción con multiplier sembrado 2.5 en partido cuya distancia actual da menos | `multiplier-drift-chip` visible ANTES de editar (ya cubierto) y comportamiento del warning al editar (leer `MatchCard` — si hay confirmación, probarla; si el chip simplemente persiste, assertear el recálculo) |
| PRED-10 | Offline: error visual y recuperación | `context.setOffline(true)`, editar | `save-status` muestra error (borde rojo); `setOffline(false)` → reintento automático o al re-editar (verificar mecanismo real en `MatchCard`) termina guardado y BD coincide |
| PRED-11 | Predicciones default 0-0 al entrar | usuario recién unido a liga con partidos editables sembrados | al cargar `/predictions`, las cards muestran 0-0 ya persistido (`fn_ensure_default_predictions`); BD tiene filas para todos los editables; recargar no duplica (idempotente) |
| PRED-12 | Default respeta J1=1.0x y resto dinámico | mismo seed con partidos J1 y J2 | multiplicadores de las filas default: J1=1.00, J2=cálculo dinámico |
| PRED-13 | Tabs con muchas jornadas son navegables | seed partidos en J1, J2, J3 y un knockout | `ScrollableTabs` permite llegar a todas; cada tab filtra sus partidos |

### Candados (`predictions-lock.spec.ts`)

| ID | Caso | Setup | Verificación |
|---|---|---|---|
| PRED-14 | Partido dentro de la ventana de bloqueo | `lockedMatch()` (kickoff +30 s, scheduled) | sin GoalPickers o disabled; `lock-indicator` visible |
| PRED-15 | Partido live bloqueado | `liveMatch()` | pickers disabled + etiqueta "En vivo" (complementa el caso existente: aquí verificar que tampoco hay `undo-button`) |
| PRED-16 | TBD sin pickers | `tbdKnockoutMatch()` | sin controles de edición |
| PRED-17 | Transición editable→bloqueado en vivo `@slow` | partido kickoff = now+75 s | al cargar es editable; tras esperar ~80 s y recargar, está bloqueado. Un solo test de este tipo en toda la suite |
| PRED-18 | El servidor rechaza el guardado tardío | partido editable; interceptar: editar y, ANTES del fin del debounce, mover `match_time` a now−1min via service role | el guardado falla y la UI muestra el error de "pronóstico cerrado" (mensaje real del action). Simula la carrera real usuario-vs-kickoff |
| PRED-19 | Time-gating de lectura: predicciones ajenas ocultas pre-kickoff | 2 usuarios (helper multi-user); user B con predicción en partido editable | en TODA la UI visible para user A no aparece la predicción de B antes del kickoff (localizar dónde la app muestra predicciones ajenas — probablemente standings/detalle post-kickoff — y assertear su ausencia pre-kickoff); tras simular kickoff (mover `match_time` atrás via service role + reload), la predicción de B se vuelve visible donde el producto lo contemple. Documentar en notas dónde se muestra |

## Criterios de aceptación (DoD)
1. 19 casos nuevos verdes 3 ejecuciones seguidas; los 21 existentes siguen verdes.
2. Ningún assert de multiplicador hardcodeado (revisión por grep de `1.25`/`2.5` en los specs nuevos — solo permitidos si vienen de seeds explícitos).
3. PRED-17 etiquetado `@slow`.
4. Suite completa + lint + typecheck verdes; notas de ejecución rellenadas (semántica real de undo, mecanismo offline, dónde se ven predicciones ajenas).

## Riesgos y notas
- PRED-18 manipula `match_time` de un partido `test_` — no tocar partidos del calendario WC.
- PRED-10: si el reintento automático no existe en el producto (solo error visual), el assert es el error + guardado manual posterior; anotar el comportamiento real.
- El debounce de 500 ms obliga a un `waitForTimeout(~700)` puntual — permitido aquí por estar documentado (convención §8 del contexto).

## Notas de ejecución

**Ejecutada**: 2026-06-10 · rama `test/e2e-full` · 19 tests nuevos
(`predictions-edit.spec.ts` PRED-01..13, `predictions-lock.spec.ts`
PRED-14..19). Los 21 existentes siguen verdes.

### Desviaciones del plan/contexto (comportamiento real del producto)
- **El candado es el kickoff EXACTO, sin ventana de 1 minuto**: la migración
  vigente (`20260605150000_fix_tbd_knockout_predictions_lock.sql`) define
  `fn_match_editable` como `now() < match_time`, y la UI lo espeja
  (`KICKOFF_LOCK_MS = 0` en MatchCard). El §4.3 de `00-contexto.md` y el
  preset `lockedMatch()` (+30 s) están desactualizados: un partido a +30 s
  HOY sigue siendo editable. PRED-14 siembra el bloqueado con
  `kickoffOffsetMs: -30_000` (scheduled con kickoff pasado).
  `fn_match_unlocked` (lectura) sí conserva `match_time - 1 min`.
- **El debounce real es 1500 ms** (`DEBOUNCE_MS` en MatchCard), no 500 ms.
- **PRED-09 tiene confirmación explícita**: editar con multiplicador degradado
  abre un `alertdialog` ("Advertencia de multiplicador" → "Tu multiplicador
  bajara de X a Y.") con Cancelar/Continuar ANTES de aplicar la edición; una
  confirmación cubre el resto de la sesión de la card (degradeAck).

### Semánticas reales documentadas (DoD #4)
- **Undo (`revertPrediction`)**: el servidor restaura el ÚLTIMO estado
  persistido previo al cambio (marcador + multiplicador, stash de
  `fn_save_prediction`), con ventana de gracia de 2 min (`UNDO_WINDOW_MS`,
  espejo de `fn_revert_prediction` que rechaza con P0003 al expirar). El botón
  solo aparece si el guardado CAMBIÓ el marcador respecto al guardado anterior.
- **Offline**: `navigator.onLine === false` (o un error transitorio de red)
  deja el guardado pendiente en memoria con estado "Sin conexion - Pendiente"
  (borde destructivo) y SÍ hay reintento automático: un listener del evento
  `window 'online'` relanza el guardado pendiente al volver la conexión.
- **Predicciones ajenas pre-kickoff**: NO existe superficie de UI que las
  liste (las queries de `/standings` filtran `finished` y las de `/live`
  `live/finished`); la invariante la garantiza la policy SELECT con
  `fn_match_unlocked` (visible desde `match_time - 1 min`). PRED-19 la
  verifica por la vía real del cliente (sesión `signInWithPassword` con la
  anon key) pre y post kickoff, y comprueba la superficie agregada que la
  consume (`/live` con 2 `live-row`).
- Los **defaults 0-0** (`fn_ensure_default_predictions`) se crean en cada
  carga de `/predictions` para TODOS los partidos editables del catálogo
  (no solo los `test_`), son idempotentes, y respetan J1=1.00 / resto
  dinámico. Los TBD/locked no reciben default.

### Estabilidad
- Sin multiplicadores hardcodeados: expectativas vía
  `expectedMultiplierForMatch()` (el único `2.5` de los specs es un seed
  explícito por service role, permitido por el DoD).
- PRED-17 etiquetado `@slow` con `test.setTimeout(150_000)` (espera real de
  80 s); es el único de su tipo en la suite.
- Mismo patrón anti-takeover de Fases 2-3 (locators anclados a `<main>`).

### Validación
`npm run lint` ✅ · `npm run typecheck` ✅ · `npm run test:unit` ✅ (470) ·
`npm run test:e2e` ✅ ×3 consecutivos (83 passed, 1 skipped por `fixme` BUG-001).

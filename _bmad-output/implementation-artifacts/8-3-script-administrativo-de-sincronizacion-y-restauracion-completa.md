---
baseline_commit: 024163aa824c440a730499a0a8acbbaaa65249d2
---

# Story 8.3: Script Administrativo de Sincronización y Restauración Completa

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Como administrador de la quiniela,
quiero contar con un script ejecutable de restauración y sincronización completa desde la consola que cargue todos los datos vigentes de la API de Zafronix,
para que el calendario y resultados del Mundial se puedan resembrar, validar o corregir de golpe si es necesario.

## Acceptance Criteria

1. **Given** un script administrativo de Node/TypeScript en `scripts/restore-zafronix-data.ts`.
2. **When** el administrador ejecuta el script con las credenciales apropiadas (usando la variable de entorno `SUPABASE_SERVICE_ROLE_KEY` o mediante una función RPC admin-gated).
3. **Then** realiza una solicitud GET directa a la API de Zafronix sin cabeceras condicionales para traer el listado completo de partidos del Mundial 2026.
4. **And** procesa e inserta o actualiza todos los registros de partidos en `public.matches` asociándolos por `external_ref`, respetando las relaciones y claves foráneas existentes.
5. **And** si hay diferencias con los marcadores locales, actualiza los datos y recalcula las clasificaciones oficiales correspondientes.
6. **And** el script incluye logs informativos detallados (ej. "Partidos actualizados: X, Partidos creados: Y, Errores: Z").
7. **And** se verifica mediante pruebas de integración que la ejecución del script sobre una base de datos limpia o parcialmente poblada restaura el estado exacto de la Copa del Mundo reportada por la API de Zafronix sin duplicar registros ni corromper las predicciones de los usuarios.

## Tasks / Subtasks

- [x] **Configuración e Infraestructura** (AC: #1, #2)
  - [x] Validar que las variables de entorno `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `WC_API_KEY` estén configuradas.
  - [x] Agregar el script `"restore-zafronix-data": "tsx scripts/restore-zafronix-data.ts"` a la sección `scripts` de `package.json`.
- [x] **Desarrollo del Script de Restauración (`scripts/restore-zafronix-data.ts`)** (AC: #1, #2, #3, #4, #5, #6)
  - [x] Inicializar el cliente Supabase utilizando la clave de rol de servicio (`SUPABASE_SERVICE_ROLE_KEY`) para evadir RLS.
  - [x] Realizar una petición GET directa (sin cabecera `If-None-Match`) a la API de Zafronix: `https://api.zafronix.com/fifa/worldcup/v1/matches?year=2026`.
  - [x] Validar y parsear la respuesta JSON de la API usando un esquema Zod compatible con el esquema de partidos (ej. reutilizar o espejar `zafronixResponseSchema` de `sync-matches.ts`).
  - [x] Consultar todos los partidos locales actuales de la tabla `public.matches`.
  - [x] Mapear los partidos retornados por la API contra los locales en memoria (usando `external_ref`, `bracket_slot` o combinación de nombres de equipos).
  - [x] Por cada partido de la API:
    - [x] Si **no existe localmente**:
      - [x] Insertarlo en `public.matches` con los campos mapeados (`external_ref`, `home_team`, `away_team`, `home_team_code`, `away_team_code`, `home_score`, `away_score`, `match_time`, `status`, `matchday`, `stage`, `group_label`, `bracket_slot`, `home_source`, `away_source`, `venue`).
    - [x] Si **existe localmente**:
      - [x] Comprobar si hay diferencias en marcadores (`home_score`, `away_score`), estado o equipos.
      - [x] Si hay diferencias en goles/estado en un partido que pasa a `finished` (o que ya está en `finished` pero el marcador cambió):
        - [x] Obtener todas las predicciones asociadas al partido.
        - [x] Para cada predicción que ya haya sido evaluada (`evaluated_at IS NOT NULL`), calcular el nuevo puntaje usando `src/utils/scoring.ts` (`calculateBasePoints` + `calculatePredictionPoints`).
        - [x] Calcular la diferencia de puntos (`delta = puntos_nuevos - puntos_anteriores`).
        - [x] Si `delta !== 0`:
          - [x] Actualizar `points_earned` en `public.predictions`.
          - [x] Ajustar el `wager_balance` del miembro en `public.league_members` sumando el `delta`.
          - [x] Insertar transacción en `public.point_transactions` con el valor del delta, descripción `'match_accrual_correction'`, y `reference_id` del partido.
      - [x] Actualizar el partido en `public.matches` con los nuevos datos.
  - [x] Ejecutar las consultas de actualización eficientemente en paralelo con `Promise.all` para evitar consultas N+1 secuenciales bloqueantes.
  - [x] Loguear un resumen del proceso (partidos creados, actualizados, errores y correcciones aplicadas).
- [x] **Desarrollo de Pruebas de Integración (`tests/integration/restore-zafronix-data.test.ts`)** (AC: #7)
  - [x] Crear la suite de pruebas `tests/integration/restore-zafronix-data.test.ts` utilizando Vitest.
  - [x] Mockear la función global `fetch` para interceptar llamadas a la API de Zafronix.
  - [x] Probar escenario de base de datos vacía/limpia: verificar que se inserten todos los partidos de Zafronix correctamente.
  - [x] Probar escenario de actualización con cambios de marcador y estado:
    - [x] Crear partidos previos en la base de datos local.
    - [x] Simular que la API retorna marcadores diferentes para un partido finalizado.
    - [x] Ejecutar la función de restauración.
    - [x] Verificar que los partidos cambien su marcador y status en `public.matches`.
    - [x] Verificar que las predicciones existentes se hayan recalculado de forma precisa y que los saldos (`wager_balance`) de los usuarios se actualicen sumando/restando el delta exacto de la corrección.
    - [x] Verificar que se registren transacciones correspondientes de corrección en `public.point_transactions`.

### Review Findings

- [x] [Review][Decision] Completed Challenges Omitted from Score Corrections — When a match's score is corrected, the script only recalculates predictions and user balances for predictions. It does not touch challenges or challenge_participants which might have already been completed based on the old score. The database trigger only resolves active challenges (status = 'active'), so any completed challenges will remain incorrect.
- [x] [Review][Patch] Missing existence check for league member in RPC [supabase/migrations/20260606130000_accrual_correction_rpc.sql:67]
- [x] [Review][Patch] Reset evaluated_at to NULL in RPC when match status reverts from finished [supabase/migrations/20260606130000_accrual_correction_rpc.sql:48]
- [x] [Review][Patch] Lack of Transactional Boundary Between Prediction Corrections and Match Updates [scripts/restore-zafronix-data.ts:457]
- [x] [Review][Patch] Potential duplicate match records in API response [scripts/restore-zafronix-data.ts:390]
- [x] [Review][Patch] Missing external_ref persistence on match updates [scripts/restore-zafronix-data.ts:485]
- [x] [Review][Patch] Unbounded concurrency in Promise.all database requests [scripts/restore-zafronix-data.ts:440]
- [x] [Review][Patch] Fragile Entry Point Script Detection [scripts/restore-zafronix-data.ts:559]
- [x] [Review][Patch] Lack of exception handling in concurrent prediction corrections [scripts/restore-zafronix-data.ts:273]
- [x] [Review][Patch] Omission of Kickoff Time Updates [scripts/restore-zafronix-data.ts:426]
- [x] [Review][Patch] Corrupted UTF-8 Character Encoding [scripts/restore-zafronix-data.ts:1]
- [x] [Review][Defer] Unnormalized Stage Value Insertions [scripts/restore-zafronix-data.ts:229] — deferred, pre-existing

## Dev Notes

- **Conexión a la Base de Datos**: Inicializar el cliente Supabase usando la clave `SUPABASE_SERVICE_ROLE_KEY` para poder realizar operaciones de escritura y actualizaciones evadiendo RLS en la tabla `matches`, `predictions`, `league_members`, y `point_transactions`.
- **Motor de Puntuación Único**: Para calcular los puntos de las predicciones, se debe importar de forma exclusiva `src/utils/scoring.ts` (`calculateBasePoints`, `calculatePredictionPoints`). Queda prohibido duplicar la lógica de puntuación en el script administrativo.
- **Evitar N+1 Queries**: Utilizar procesamiento por lotes o procesamiento en paralelo con `Promise.all` para optimizar las actualizaciones de partidos y predicciones.
- **Idempotencia y Ledger**: Asegurar que la corrección de marcadores ajuste los saldos sumando o restando el *delta* exacto (`puntos_nuevos - puntos_viejos`) en lugar de sobreescribir incondicionalmente o re-sumar los puntos completos. Esto previene la corrupción de la tabla `league_members`.
- **Relación con Triggers**: Tener en cuenta que cambiar el estado de un partido a `finished` en la base de datos disparará el trigger `tr_resolve_challenges_on_match_status_change` para los partidos y predicciones que aún no han sido evaluados (`evaluated_at IS NULL`). El script administrativo debe sincronizarse con este comportamiento. Específicamente, si un partido no estaba evaluado, el script puede delegar al trigger la evaluación inicial, pero si es una **corrección** de un partido ya evaluado (`evaluated_at IS NOT NULL`), el trigger de la base de datos lo ignorará, por lo que el script administrativo debe realizar el recálculo manual en TypeScript.

### Project Structure Notes

- El script se ubicará en `scripts/restore-zafronix-data.ts`.
- Las pruebas de integración se ubicarán en `tests/integration/restore-zafronix-data.test.ts`.
- Se añadirá el script `"restore-zafronix-data": "tsx scripts/restore-zafronix-data.ts"` a `package.json`.

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Bypass de Límite de Cuota de API]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.3]
- [Source: scripts/sync-matches.ts]
- [Source: src/utils/scoring.ts]
- [Source: supabase/migrations/20260604195000_resolve_challenges.sql#tr_resolve_challenges_on_match_status_change]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (1M context)

### Debug Log References

- `npm run typecheck` → sin errores.
- `npx eslint scripts/restore-zafronix-data.ts tests/integration/restore-zafronix-data.test.ts` → sin errores en los archivos nuevos.
- `npx vitest run --project integration tests/integration/restore-zafronix-data.test.ts` → 8/8 passed.
- `npm run test:unit` → 267/267 passed. `npm run test:integration` → 179/179 passed (sin regresiones).
- `npx supabase migration up --local` → migración `20260606130000_accrual_correction_rpc.sql` aplicada.

### Completion Notes List

- **Script `scripts/restore-zafronix-data.ts`**: función exportada `restoreZafronixData(supabase, apiKey, fetchFn)` para testabilidad + `main()` como entry point con validación de envs (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WC_API_KEY`). Hace un GET DIRECTO sin `If-None-Match` (a diferencia del cron de la 8.2), valida con un esquema Zod que espeja y amplía `zafronixResponseSchema`, resuelve cada partido por `external_ref` → `bracket_slot` → nombres normalizados (misma lógica que `sync-matches.ts`), inserta los ausentes y actualiza los cambiados. Ejecuta inserciones y actualizaciones en paralelo con `Promise.all` (evita N+1). Loguea resumen `{ created, updated, corrections, errors }`.
- **Motor de puntuación único**: el recálculo importa exclusivamente `calculateBasePoints` + `calculatePredictionPoints` de `src/utils/scoring.ts`; NO se duplicó lógica de puntuación.
- **Integridad del ledger (decisión de diseño)**: para preservar el invariante de conservación `wager_balance == SUM(point_transactions.amount)` bajo `Promise.all`, se añadió la RPC SECURITY DEFINER `fn_apply_accrual_correction(p_prediction_id, p_new_points, p_match_id)` (migración `20260606130000`). El script calcula los puntos nuevos en TS y la RPC aplica el `delta` (nuevo − viejo) de forma ATÓMICA sobre `predictions`, `league_members` y `point_transactions`, con locks de fila. Así se evita el read-modify-write racy de `wager_balance` desde TS.
- **Sincronía con el trigger**: solo se corrigen manualmente las predicciones YA evaluadas (`evaluated_at IS NOT NULL`), que el trigger `tr_resolve_challenges_on_match_status_change` ignora; las no evaluadas las puntúa el trigger al actualizar el partido (la corrección manual ocurre ANTES del `UPDATE` del partido para que el trigger las salte). La RPC también es idempotente por estado (ignora `evaluated_at IS NULL`).
- **Inserción**: `match_time` es `NOT NULL`; si la API no provee kickoff para un partido ausente, se OMITE e informa (cuenta como `errors`) en lugar de insertar un kickoff inválido que corrompa el time-gating.
- **Lint preexistente**: `npm run lint` reporta 9 errores en 4 archivos NO tocados por esta historia (`scripts/sync-matches.ts`, `src/app/api/webhooks/zafronix/route.ts`, `DesafioClient.tsx`, `DuelsDashboard.tsx`), provenientes de stories previas. Fuera del alcance de la 8.3; los archivos nuevos pasan lint limpio.

### File List

- `package.json` (modificado: script `restore-zafronix-data`)
- `scripts/restore-zafronix-data.ts` (nuevo)
- `supabase/migrations/20260606130000_accrual_correction_rpc.sql` (nuevo)
- `tests/integration/restore-zafronix-data.test.ts` (nuevo)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modificado: estado de la historia)

### Change Log

- 2026-06-06: Implementada la Story 8.3. Script administrativo `restore-zafronix-data.ts` (GET directo + insert/update + recálculo de predicciones evaluadas), RPC atómica `fn_apply_accrual_correction` para corrección de ledger, y suite de integración (8 pruebas). Estado → review.

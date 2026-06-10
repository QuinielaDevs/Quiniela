# Fase 5 — Clasificación oficial y panel de administración

## Objetivo
Verificar el ranking con sus cuatro niveles de desempate, los filtros por jornada/fase, la exclusión de partidos anulados, y todo el panel admin: captura de resultados con su máquina de estados, gestión de pagos, expulsiones y promoción de admins — incluyendo los efectos colaterales en BD (accrual, cascada de duelos).

## Dependencias
Fases 1-4 (en especial helper multi-usuario y `db-assert.ts`).

## Contexto requerido
- `00-contexto.md` §4.4 (desempates), §4.8 (RPCs admin), §4.5 (accrual al finalizar).
- Leer: `src/utils/standings.ts` (`buildStandings` exacto), `src/components/standings/*` (tabla, badges, banner, admin lists, expel dialog), `src/app/standings/page.tsx` y `manage/page.tsx`, `src/app/actions/matches.actions.ts`, migración `20260604140000_admin_match_results_rpc.sql` (**matriz real de transiciones de estado** — copiarla a las notas antes de escribir ADM-04), `member-admin-management` RPCs.

## Entregables
- `tests/e2e/standings.spec.ts`
- `tests/e2e/standings-admin.spec.ts`

## Casos de prueba

### Clasificación (`standings.spec.ts`)
Seed base: liga con 3-4 usuarios (multi-user helper), partidos `test_` finalizados con predicciones y `points_earned` sembrados via service role para construir escenarios EXACTOS de desempate (sembrar también `wager_balance`+transacción cuando el desempate 3 lo requiera).

| ID | Caso | Seed específico | Verificación |
|---|---|---|---|
| STD-01 | Orden por puntos totales | A=12.5, B=8, C=2 | filas `standings-row` en orden A,B,C con `standings-points` correctos |
| STD-02 | Desempate por exactos | A y B mismos puntos; A 2 exactos, B 1 | A antes que B; `standings-exact` correcto |
| STD-03 | Desempate por `wager_balance` | A y B mismos puntos y exactos; balances 50 vs 10 | A antes que B |
| STD-04 | Desempate por `joined_at` | todo igual; A se unió antes | A antes que B |
| STD-05 | Totales = Σ(base×multiplicador) | predicciones con multiplicadores sembrados distintos | el total de la UI coincide con el cálculo importando `calculatePredictionPoints` de `src/utils/scoring.ts` |
| STD-06 | Suspendidos/cancelados excluidos | partido suspended con predicción "ganadora" | no suma puntos; no aparece en los totales |
| STD-07 | Filtro por jornada/fase | partidos en J1 y J2 finalizados | cada tab muestra solo los puntos de su fase; la acumulada suma todo |
| STD-08 | Badge y banner de pago | liga con pago; miembro pending y miembro paid | `payment-status-badge` con `data-status` correcto por fila; `payment-banner` visible para el pending |
| STD-09 | Predicciones ajenas visibles post-kickoff | partido finalizado | donde el producto muestre el detalle (ver PRED-19), las predicciones de otros son visibles ya finalizado el partido |

### Panel admin (`standings-admin.spec.ts`)
Seed: liga con admin + 2 miembros; partidos `test_` en varios estados; un duelo activo entre los 2 miembros para ADM-08.

| ID | Caso | Acción | Verificación |
|---|---|---|---|
| ADM-01 | Guard de admin | miembro NO admin visita `/standings/manage` | redirect o bloqueo (verificar comportamiento real); admin sí entra |
| ADM-02 | scheduled → live con marcador parcial | editar `admin-home-score`/`admin-away-score`, status live, guardar | la card del partido en `/predictions` muestra "En vivo" con marcador |
| ADM-03 | live → finished dispara scoring | poner marcador final y finished | (a) standings refleja los puntos nuevos; (b) BD: `predictions.points_earned` y `evaluated_at` poblados; (c) `wager_balance` de quien acertó subió (accrual §4.5); (d) `assertLedgerInvariant` pasa |
| ADM-04 | Transiciones inválidas bloqueadas | intentar cada transición prohibida por la matriz real (leída de la migración) | error visible (`admin-result-error`), estado no cambia |
| ADM-05 | Knockout TBD no finalizable | `tbdKnockoutMatch()` | la UI lo impide o el server responde error claro |
| ADM-06 | Marcador inválido | score negativo / vacío con finished | imposible en UI o error claro |
| ADM-07 | Toggle de pago | `payment-toggle` pending→paid→pending | badge cambia en vivo y persiste tras reload; BD coincide |
| ADM-08 | Expulsión con cascada de duelos | `expel-button` → `expel-confirm` sobre miembro con duelo activo | miembro desaparece de standings y roster; BD: duelo cancelado, **escrow devuelto a la contraparte**, `assertLedgerInvariant` de los restantes pasa |
| ADM-09 | Último admin intocable | liga con UN admin | la opción de expulsarse/degradarse no existe o falla con mensaje claro (RPC lo bloquea) |
| ADM-10 | Promoción a admin | si la UI lo expone: promover miembro | nuevo admin puede entrar a `/standings/manage`. Si NO hay UI de promoción, documentarlo en notas y omitir (el RPC ya está cubierto en integration) |
| ADM-11 | El no-admin no puede mutar por UI | sesión de miembro | no ve controles de edición de resultados/pagos en ninguna vista |

## Criterios de aceptación (DoD)
1. 20 casos implementados (o documentada la omisión justificada de ADM-10) y verdes 3 ejecuciones seguidas.
2. ADM-03 verifica los 4 efectos (UI, points_earned, balance, invariante).
3. La matriz de transiciones probada en ADM-04 está copiada en las notas de ejecución desde la migración.
4. Suite completa + lint + typecheck verdes.

## Riesgos y notas
- Los escenarios de desempate exigen control fino de `points_earned` — sembrar SIEMPRE via service role; no depender del trigger para construir el escenario (el trigger se prueba en ADM-03).
- ADM-08 toca el dominio de duelos antes de la Fase 6: usar `seedChallenge` del helper (vía RPC real) — si algo del flujo de duelos bloquea, coordinar con la Fase 6 y dejar el caso `fixme` referenciado.
- `joined_at` para STD-04: setearlo explícitamente via service role (no depender del orden de inserción).

## Notas de ejecución
_(rellenar al ejecutar)_

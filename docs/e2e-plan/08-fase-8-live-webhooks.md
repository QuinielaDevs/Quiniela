# Fase 8 — Tabla en vivo (Realtime) y webhooks Zafronix de extremo a extremo

## Objetivo
Probar el circuito completo de datos en vivo: un evento externo (webhook firmado o actualización admin) → Postgres → Realtime → UI (`/live` con toasts y reorden) → triggers (accrual, duelos) → clasificación. Incluye la seguridad del endpoint (HMAC, replay, out-of-order) ejercitada contra el servidor Next REAL del E2E.

## Dependencias
Fases 1-6 (helper `webhook.ts`, duelos para verificar liquidación, multi-usuario).

## Contexto requerido
- `00-contexto.md` §4.7 (contrato webhook completo) y trampa §7.3 (replica identity → suscripción amplia, timeouts generosos).
- Leer: `src/app/api/webhooks/zafronix/route.ts` (respuestas exactas: claves `error`/`ok`/`ignored`), `src/lib/zafronix/contract.ts`, `src/components/live/LiveStandingsBoard.tsx` (qué dispara el toast, cómo reordena, fallback polling) y `GoalToast.tsx`, `tests/fixtures/zafronix/*.sample.json` (forma exacta de payloads), `tests/integration/zafronix-webhook.test.ts` (qué está ya cubierto a nivel handler — el E2E aporta la capa UI/Realtime y los efectos visibles).
- `ZAFRONIX_WEBHOOK_SECRET` debe estar en `.env.test.local` (lo comparte el firmante del test y el dev server — §5.3 del contexto).

## Convención de la fase
Tests de UI en vivo etiquetados `@realtime` con `expect(..., { timeout: 15_000 })`. Los partidos siempre `test_` con `external_ref` propio (`test-e2e-<runId>-<n>`). El navegador queda ABIERTO en `/live` ANTES de disparar el evento (el flujo real).

## Casos de prueba

### Tabla en vivo (`tests/e2e/live.spec.ts`)
Seed: liga 3 usuarios con predicciones distintas sobre un partido `live` 0-0 sembrado, de modo que un gol cambie el orden proyectado (diseñar las predicciones para forzar el swap: p. ej. B acierta exacto con 1-0).

| ID | Caso | Acción | Verificación |
|---|---|---|---|
| LIVE-01 | El board carga con el partido en vivo | abrir `/live` | `live-board` visible, filas `live-row` por miembro |
| LIVE-02 | Gol → toast `@realtime` | UPDATE marcador 0-0→1-0 via service role | `goal-toast` aparece y nombra al equipo correcto (texto real del componente) |
| LIVE-03 | Gol → reorden de filas `@realtime` | mismo evento | el orden de `live-row` cambia al proyectado correcto (calcular expectativa con `buildProjectedStandings` importado de `src/utils/standings.ts`) |
| LIVE-04 | Goles consecutivos apilan toasts `@realtime` | 1-0→2-0→2-1 espaciados ~2 s | `goal-toast-stack` muestra/encola múltiples |
| LIVE-05 | Dismiss del toast | gesto/click según componente | desaparece |
| LIVE-06 | Partido pasa a finished `@realtime` | UPDATE status finished | el board lo consolida (proyectado→oficial, según semántica del componente) |
| LIVE-07 | Puntos proyectados correctos | estado con 1 live + 1 finished | los puntos por fila igualan el cálculo TS importado (cero hardcodeo) |

### Webhooks end-to-end (`tests/e2e/webhooks.spec.ts`)
Los POST van al endpoint real del dev server vía `request` de Playwright (helper `sendZafronixEvent`).

| ID | Caso | Evento | Verificación |
|---|---|---|---|
| WHK-01 | `match.finalized` actualiza producto | finalized firmado sobre partido `test_` live con predicciones y un duelo activo | 200 `ok:true`; BD: status finished + marcador; UI `/standings` refleja los puntos; `/predictions` muestra el resultado |
| WHK-02 | finalized → accrual idempotente | reenviar el MISMO evento (mismo ts) | segunda respuesta ignorada u OK sin efectos (out-of-order/evaluated_at); `points_earned` y `wager_balance` NO se duplican; `assertLedgerInvariant` |
| WHK-03 | finalized → duelos liquidados | duelo del seed | challenge completed, pozo repartido (BD), saldo visible en `/duels` actualizado |
| WHK-04 | `match.patched` corrige marcador y ledger | patched que cambia 1-0→1-1 tras WHK-01 | BD: marcador nuevo; `points_earned` recalculado; el DELTA aplicado al balance (transacción de corrección); UI standings actualizada; invariante OK |
| WHK-05 | `match.postponed` anula todo | postponed sobre partido con predicciones y duelo pending | status suspended; predicciones a 0 con `evaluated_at`; duelo cancelado y reembolsado; la card muestra "Suspendido" |
| WHK-06 | Firma inválida | `badSignature: true` | 401, body `signature_mismatch`; CERO cambios en BD |
| WHK-07 | Replay fuera de ventana | `timestampOverride: now − 6 min` | 401 `replay_rejected`; sin cambios |
| WHK-08 | Out-of-order ignorado | finalized ts=T, luego patched ts=T−60s | segundo → 200 con `ignored:true` (verificar clave exacta en route.ts); marcador intacto |
| WHK-09 | Payload malformado | JSON inválido / schema roto | 400 (`invalid_json`/`validation_failed`); sin cambios |
| WHK-10 | Matching por `bracket_slot` (knockout) | finalized con matchNo/bracket sobre partido knockout `test_` | el partido correcto se actualiza (no otro) |
| WHK-11 | Partido inexistente | external_ref desconocido | 404 `not_found`, sin efectos colaterales |
| WHK-12 | Webhook → Realtime → `/live` `@realtime` | navegador en `/live`; finalized vía webhook (no service role) | la UI reacciona igual que LIVE-06 — cierra el circuito 100% real |

## Criterios de aceptación (DoD)
1. 19 casos verdes; los `@realtime` toleran 1 retry local como máximo (si necesitan más, investigar — no subir timeouts a ciegas).
2. WHK-02 y WHK-04 verifican la invariante del ledger explícitamente.
3. Las claves exactas de respuesta del handler documentadas en notas (leídas de `route.ts`, no asumidas).
4. Suite completa + lint + typecheck verdes.

## Riesgos y notas
- Realtime local puede tardar en el primer evento tras abrir canal (handshake): si LIVE-02 es flaky en frío, añadir una espera de suscripción activa (la app puede exponer estado de conexión; si no, un primer evento de calentamiento documentado).
- NO probar aquí el fallback de polling tras caída de Realtime (requiere simular la caída del websocket — frágil): queda registrado como cobertura manual en el README del plan.
- Los timestamps del evento (`ts`) controlan el out-of-order: generarlos explícitamente en el helper, nunca depender del reloj implícito entre dos llamadas.
- El cron de respaldo (`scripts/sync-matches.ts`) ya tiene cobertura integration (`sync-matches.test.ts`) — fuera del alcance E2E.

## Notas de ejecución
_(rellenar al ejecutar)_

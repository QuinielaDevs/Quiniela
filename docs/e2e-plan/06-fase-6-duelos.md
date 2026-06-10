# Fase 6 — Duelos 1v1 y abiertos: escrow, resolución y landing pública

## Objetivo
Cubrir la economía completa de duelos: creación (directo/abierto) con escrow al crear, aceptación/rechazo, expiración, resolución automática en todas sus variantes (ganador único, empate/split, sin ganador, suspensión), la landing pública `/desafio/[id]` y la **invariante del ledger después de cada escenario**.

## Dependencias
Fases 1-5. Crítico: helper multi-usuario (`createLeagueWithUsers`), `seedChallenge` vía RPC real, `db-assert.ts`, y saldo inicial sembrado correctamente (balance + transacción `seed_initial_balance`).

## Contexto requerido
- `00-contexto.md` §4.5 completo (escrow, triggers, invariante) y §4.9 (códigos de error).
- Leer: `src/components/duels/DuelsDashboard.tsx`, `CreateDuelDialog.tsx`, `AcceptDuelDialog.tsx`, `src/app/duels/page.tsx`, `src/app/desafio/[id]/page.tsx` (+ su client component), `src/app/actions/duels.actions.ts` (mensajes de error exactos), migraciones `20260604024700_challenges_and_escrow.sql`, `20260604024800_accept_reject_challenges.sql`, `20260604195000_resolve_challenges.sql` (semántica EXACTA de resolución y split del pozo — copiar el reparto a las notas), `tests/integration/triggers.test.ts` y `challenges-kickoff-lock.test.ts` (qué está ya probado a nivel RPC: el E2E verifica la integración por UI, no re-prueba cada rama SQL).

## Convención de la fase
Cada test termina con `assertLedgerInvariant(leagueId)` (en `afterEach` del describe). Los saldos iniciales se siembran con el patrón balance+transacción. Resolver partidos preferentemente con `sendZafronixEvent` (webhook firmado) o `fn_admin_set_match_result` via UI admin — ambas rutas reales.

## Casos de prueba (`tests/e2e/duels.spec.ts`, dividir en 2-3 specs si crece)

### Creación

| ID | Caso | Setup | Verificación |
|---|---|---|---|
| DUE-01 | Crear duelo directo (happy) | A y B con saldo 50; partido editable | dialog → partido, rival B, apuesta 10, predicción → `duel-card` pending visible; saldo de A en UI baja a 40; BD: challenge pending, transacción de escrow −10 |
| DUE-02 | Saldo insuficiente | A con saldo 5 | apuesta 10 → error claro (mensaje real del action, código `P0003`); sin deducción; sin challenge |
| DUE-03 | No auto-reto | A | el selector de rival no ofrece a A (o error `P0002` si se fuerza) |
| DUE-04 | Apuesta inválida | A | 0 y negativo → validación UI o error del server; sin efectos |
| DUE-05 | Partido ya iniciado | partido live/locked | no seleccionable en el dialog (o error `P0004`) |
| DUE-06 | Crear duelo abierto | A | sin rival; `duel-card` tipo open visible para el resto de la liga |

### Aceptación / rechazo / expiración

| ID | Caso | Setup | Verificación |
|---|---|---|---|
| DUE-07 | Aceptar directo | duelo pending A→B; contexto de B | B mete su predicción y acepta → status active en UI de ambos; saldo de B baja; BD: participante añadido, escrow −10 de B |
| DUE-08 | Doble aceptación | duelo ya aceptado | reintento de B falla limpio (UI deshabilitada o error) |
| DUE-09 | Reto dirigido a otro | duelo A→B; contexto de C | C no puede aceptarlo (no le aparece como aceptable) |
| DUE-10 | Aceptar sin saldo | B con saldo 5, apuesta 10 | error `P0003`; duelo sigue pending |
| DUE-11 | Rechazar | duelo pending A→B; B rechaza | status canceled; escrow de A reembolsado (UI y BD, transacción de reembolso) |
| DUE-12 | Expiración al kickoff | duelo pending sin aceptar; mover el match a live (admin UI o service role status) | trigger cancela y reembolsa a A; UI refleja cancelado |
| DUE-13 | Abierto con 3 participantes | duelo open de A; B y C aceptan | status/participantes correctos; pozo = 3×apuesta en BD |

### Resolución automática (vía partido finalizado)

| ID | Caso | Predicciones (duelo) | Resultado | Verificación |
|---|---|---|---|---|
| DUE-14 | Ganador único | A exacto, B falla | finalizar partido | A recibe el pozo completo (saldo UI+BD); transacción de pago; challenge completed con `winner_ids=[A]` |
| DUE-15 | Empate en el máximo → split | A y B mismo nivel de acierto (p. ej. ambos aciertan resultado) | finalizar | pozo dividido según la semántica real de la migración (leerla; documentar si hay redondeos); `winner_ids` ambos |
| DUE-16 | Sin ganador → reembolso | ambos fallan todo | finalizar | ambos recuperan su apuesta exacta |
| DUE-17 | Suspensión → reembolso | duelo active; webhook `match.postponed` | — | challenge canceled; ambos reembolsados |
| DUE-18 | Duelo y predicción normal coexisten | A tiene predicción de quiniela Y duelo en el mismo partido | finalizar | el accrual de la predicción (base×multiplicador) y el resultado del duelo (base sin multiplicador) se aplican AMBOS y por separado; invariante OK |

### Landing pública

| ID | Caso | Verificación |
|---|---|---|
| DUE-19 | `/desafio/[id]` anónima oculta predicciones | datos del duelo (liga, partido, apuesta, retador) visibles; las predicciones de los participantes NO (confidencialidad pre-kickoff del RPC `fn_get_challenge_landing`) |
| DUE-20 | Metadata OG del desafío | `og:title`/`og:description` correctos |
| DUE-21 | Deep-link: landing → login → aceptar | B anon abre la landing, CTA → login → puede aceptar el duelo |

## Criterios de aceptación (DoD)
1. 21 casos verdes 3 ejecuciones seguidas, cada uno con invariante de ledger verificada.
2. La semántica exacta del split (DUE-15) copiada de la migración a las notas.
3. Suite completa + lint + typecheck verdes.
4. Notas de ejecución completas (mensajes de error reales mapeados, semántica del pozo, cualquier desviación).

## Riesgos y notas
- **El pozo**: la migración define el reparto exacto (por cabeza vs proporcional). NO asumir — leer `20260604195000_resolve_challenges.sql` primero; el assert debe reflejar el código real.
- Los duelos usan puntos base SIN multiplicador (constatado en §4.5) — DUE-18 es el caso que protege esa separación.
- Multi-contexto: cada usuario su `BrowserContext`; cerrar contextos en cleanup para no filtrar páginas.
- Si la UI no expone alguna acción (p. ej. rechazar), verificar dónde vive realmente (¿landing? ¿dashboard?) antes de declarar bug.

## Notas de ejecución
_(rellenar al ejecutar)_

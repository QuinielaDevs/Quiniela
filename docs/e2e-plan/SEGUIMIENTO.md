# Seguimiento del plan E2E — decisiones y estado por fase

> Documento de seguimiento del plan maestro E2E (`docs/e2e-plan/`). Registra el
> estado de cada fase y las **decisiones de diseño que NO deben revertirse** al
> ejecutar fases posteriores. Espejo versionado de las notas de proyecto del
> equipo, para que cualquier agente o persona que retome el trabajo tenga el
> contexto crítico sin releer toda la conversación.
>
> La tabla de estado canónica vive en [`README.md`](README.md); aquí se amplía
> con el porqué de cada decisión.

---

## Estado por fase

| Fase | Estado | Fecha | Tests añadidos | Rama / commits |
|---|---|---|---|---|
| 1 — Fundación | ✅ completada | 2026-06-09 | 0 (por diseño; 22 existentes verdes ×3) | `test/e2e-full` · `9811e7f..0c36f51` |
| 2 — Smoke + Auth | ✅ completada | 2026-06-10 | 26 (25 activos + 1 `fixme`) | `test/e2e-full` |
| 3 — Ligas | ✅ completada | 2026-06-10 | 18 | `test/e2e-full` |
| 4 — Predicciones | ⬜ pendiente | — | — | — |
| 5 — Standings + Admin | ⬜ pendiente | — | — | — |
| 6 — Duelos | ⬜ pendiente | — | — | — |
| 7 — Premios | ⬜ pendiente | — | — | — |
| 8 — Live + Webhooks | ⬜ pendiente | — | — | — |
| 9 — Journey + Extremos | ⬜ pendiente | — | — | — |
| 10 — CI | ⬜ pendiente | — | — | — |

---

## Decisiones de diseño que NO deben revertirse

Estas reglas no se derivan del código a simple vista; revertirlas produce una
suite flaky o resultados incorrectos.

- **`workers: 1` / `fullyParallel: false` en Playwright es OBLIGATORIO**:
  `matches` es un catálogo **global sin `league_id`**, así que cualquier
  partido sembrado lo ven TODOS los tests y altera la pestaña por defecto y la
  "jornada en curso". Hay un comentario protector en `playwright.config.ts`.
- **PROHIBIDO hardcodear multiplicadores esperados**: la "jornada en curso"
  (`fn_current_round_ordinal`) avanza con el **tiempo real** porque `seed.sql`
  trae las fechas reales del Mundial (jun-jul 2026). Calcular expectativas con
  `tests/e2e/helpers/multiplier.ts` (reutiliza `currentRoundOrdinal` /
  `calculatePredictionMultiplier` de `src/utils/scoring.ts`), o sembrar el
  `multiplier` vía service role.
- **Multiplicador por DISTANCIA EN JORNADAS** (+0.25/jornada, tope 2.5x, J1
  siempre 1.0x). La fórmula por días es obsoleta.
- **Sembrar `wager_balance` exige insertar la transacción `seed_initial_balance`
  equivalente** (invariante del ledger: `wager_balance == SUM(point_transactions.amount)`).
  El helper `seed/league.addMember({ wagerBalance })` ya lo hace.
- **Palanca de los tests de premios**: mover ventanas de `tournament_phases` vía
  service role y **restaurar SIEMPRE** (estado global). Helpers
  `seed/phases.ts` (snapshot/restore) y `seed/awards.ts`.
- **Bugs de producto** → `docs/e2e-plan/BUGS.md` + `test.fixme`. **Nunca**
  debilitar asserts para estabilizar.

---

## Hallazgos y desviaciones de la Fase 1

Detalle completo en las "Notas de ejecución" de
[`01-fase-1-fundacion.md`](01-fase-1-fundacion.md). Los más relevantes para las
fases 2-10:

- **RPC real de duelos**: `create_challenge` / `accept_challenge` (SIN prefijo
  `fn_`). Los docs del plan asumían `fn_create_challenge`; es incorrecto. Fuente:
  `src/app/actions/duels.actions.ts`.
- **`reject-duel-button` vive en `DuelsDashboard`**, no en `AcceptDuelDialog`:
  el rechazo de un reto no abre diálogo.
- **Buzón de email local = Mailpit** (`/api/v1/messages`). El helper
  `tests/e2e/helpers/mail.ts` detecta Mailpit y cae a Inbucket como fallback.
- **`bracket_slot` de slots TBD de test usa valores `>= 9000`**: la columna solo
  tiene UNIQUE parcial (sin CHECK de rango), así no colisiona con los 73-104
  reales del calendario.
- **Flake conocido de `next dev`**: tras un `goto`, el tablist puede aparecer
  **duplicado unos ms** (dos tabs idénticos, ambos `aria-selected`) mientras el
  router cliente toma el control del HTML SSR. Ya ocurría en la línea base.
  Mitigación: usar `selectPhaseTab()` de `tests/e2e/helpers/ui.ts` (espera
  `toHaveCount(1)` antes del click) en vez de clicks directos a `[role="tab"]`.
  **No es bug de producto** (el DOM se asienta en un único tablist).

---

## Hallazgos y desviaciones de la Fase 2

Detalle completo en las "Notas de ejecución" de
[`02-fase-2-smoke-auth.md`](02-fase-2-smoke-auth.md). Lo crítico para fases
posteriores:

- **`.env.test.local` DEBE traer `NEXT_PUBLIC_SUPABASE_URL` y
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` del stack LOCAL**: dotenv las hereda de
  `.env` (Supabase hosted) si faltan, y el webServer de Playwright autentica
  contra otra base (todo login E2E falla con "Invalid login credentials").
- **`supabase/config.toml` para E2E**: allow-list de redirects con el puerto
  3100 (recuperación de contraseña) y `email_sent = 100`/h (el default 2/h
  rompe ejecuciones consecutivas de AUTH-10). Aplicar con `supabase stop && start`.
- **El flake del takeover de `next dev` deja la copia huérfana FUERA de
  `<main>`**: patrón estable = anclar a `getByRole("main")` + `filter({ visible:
  true })` + `toHaveCount(1)` (ver `expectSettledVisible` en `smoke.spec.ts`).
- **BUG-001**: `/desafio/[id]` anónimo redirige a login (el middleware no lo
  excluye); afecta a la Fase 6 (landing pública de duelos) — sus casos anon
  deberán ser `fixme` hasta que se corrija el middleware.
- **El middleware enmascara el 404 anónimo**: rutas inexistentes fuera de
  prefijos públicos redirigen a login (no not-found).
- **Forms de sign-up/forgot/update-password en inglés** (template); login en
  español.

---

## Hallazgos y desviaciones de la Fase 3

Detalle completo en [`03-fase-3-ligas.md`](03-fase-3-ligas.md). Lo crítico:

- **La landing `/join/<code>` AUTO-une al usuario autenticado** server-side y
  redirige a `/predictions?joined=1&league=<id>`: ningún test debe visitar
  `/join` con un usuario logueado esperando ver la tarjeta.
- **Códigos de invitación sembrados**: usar SOLO el alfabeto del producto
  (sin O/0, I/1, L). `inviteCodeFromRunId` (seed/league.ts) ya lo garantiza;
  la server action del form manual rechaza códigos fuera del alfabeto aunque
  la URL los acepte.
- **Monto de inscripción 0 es válido** (`nonnegative` deliberado en
  `leagues.schema.ts`): no asumir error.
- **Liga activa** = `profiles.active_league_id` + botón "Usar <liga> como liga
  actual" en `/account`; fallback a la membresía más reciente.
- El `welcome-payment-modal` vive dentro de `<main>` (aunque sea overlay
  fixed): el patrón de anclaje anti-takeover aplica.

---

## Contrato de testids e infraestructura disponible (Fase 1)

El contrato final de `data-testid` (nombres definitivos por componente, que las
fases 2-10 usan como contrato) está en la tabla de "Notas de ejecución" de
[`01-fase-1-fundacion.md`](01-fase-1-fundacion.md).

Helpers composables listos para usar en `tests/e2e/helpers/`:

| Módulo | Para qué |
|---|---|
| `admin.ts` | `requireEnv`, `createAdminClient` (service role), `createAnonClient` |
| `cleanup.ts` | `createCleanupStack()` → pila LIFO idempotente |
| `users.ts` | `createUser`, `loginViaForm`, `loginAs`, `createLeagueWithUsers` (multi-usuario) |
| `ui.ts` | `selectPhaseTab` (estabiliza la selección de tabs) |
| `seed/league.ts` | `seedLeague`, `addMember` (con saldo + ledger), `setActiveLeague` |
| `seed/matches.ts` | `seedMatch(es)` + presets (`editableMatch`, `lockedMatch`, `liveMatch`, `finishedMatch`, `suspendedMatch`, `tbdKnockoutMatch`) |
| `seed/predictions.ts` | `seedPrediction` (vía service role) |
| `seed/challenges.ts` | `seedChallenge` (RPC real), `acceptChallengeAs`, `seedChallengeRaw` |
| `seed/phases.ts` | `getPhases`, `setActivePhase`, `snapshotPhases`, `restorePhases`, `getActivePhase` |
| `seed/awards.ts` | `setWinner`, `clearWinners`, `snapshot/restoreWinners`, `getCandidate` |
| `webhook.ts` | `sendZafronixEvent` (eventos firmados HMAC) |
| `mail.ts` | `getLastEmailTo`, `waitForEmailTo`, `extractLinks` |
| `db-assert.ts` | `getWagerBalance`, `getTransactions`, `assertLedgerInvariant`, `getPrediction`, `getChallenge`, `getMatch` |
| `multiplier.ts` | `expectedMultiplierForMatch`, `currentRoundOrdinalFromDb` |

`seed.ts` y `auth.ts` son façades de compatibilidad (API intacta) que componen
los módulos nuevos.

---

## Cómo actualizar este documento

Al terminar cada fase: cambiar su fila en la tabla de estado (aquí y en el
`README.md`), añadir las desviaciones encontradas a la sección de hallazgos, y
registrar cualquier bug de producto en `BUGS.md`.

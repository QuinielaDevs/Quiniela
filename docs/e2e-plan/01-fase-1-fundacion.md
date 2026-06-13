# Fase 1 — Fundación: instrumentación, helpers y configuración

## Objetivo
Dejar lista la infraestructura sobre la que se construyen todas las fases siguientes: `data-testid` en los componentes interactivos, helpers de seed composables, soporte multi-usuario, firma de webhooks, control de fases del torneo, helper de email local y aserciones de BD. **Esta fase no añade tests nuevos** (salvo mantener verdes los existentes).

## Dependencias
Ninguna (primera fase). Prerrequisito operativo: entorno funcionando según `00-contexto.md` §5 — antes de tocar nada, ejecutar `npx supabase start && npx supabase db reset && npm run test:e2e` y confirmar línea base verde (≈23 tests).

## Contexto requerido
- `00-contexto.md` completo (especialmente §6 infraestructura existente y §7 trampas).
- Leer: `tests/e2e/helpers/auth.ts`, `tests/e2e/helpers/seed.ts`, `tests/integration/helpers/hmac.ts`, `playwright.config.ts`, `src/utils/scoring.ts`.

## Entregables

### 1.1 Instrumentación `data-testid` (solo atributos, CERO cambios de comportamiento)

Regla: el agente abre cada componente, localiza el elemento correcto y añade el atributo. Si un nombre propuesto no encaja con la estructura real del componente, ajustarlo y **documentar el nombre final en la tabla de "Notas de ejecución"** al pie de este archivo (las fases posteriores usan estos nombres como contrato).

| Componente (`src/components/…`) | testids propuestos |
|---|---|
| `predictions/GoalPicker.tsx` | raíz `goal-picker` con `data-side="home|away"`; botones `goal-increment`, `goal-decrement`; valor `goal-value` (los botones ya tienen aria-labels — conservarlos) |
| `predictions/MatchCard.tsx` | raíz `match-card` con `data-match-id`; `save-status` (indicador guardando/guardado/error); `undo-button`; `lock-indicator` (candado); `multiplier-badge` |
| `predictions/PredictionsBoardView.tsx` | `predictions-board`; cada tab ya usa `role="tab"` (no duplicar) |
| `predictions/WelcomePaymentModal.tsx` | `welcome-payment-modal`, `payment-amount`, `payment-instructions`, botón de cierre `welcome-payment-close` |
| `leagues/LeagueCreateForm.tsx` | `league-name-input`, `requires-payment-switch`, `payment-amount-input`, `payment-instructions-input`, `create-league-submit`, `create-league-error` |
| `join/JoinByCodeForm.tsx` / `join/JoinLeagueCard.tsx` / `join/NoLeagueState.tsx` | `join-code-input`, `join-submit`, `join-error`; `join-league-card`, `join-league-name`, `join-payment-info`; `no-league-state` |
| `standings/StandingsTable.tsx` | `standings-table`; fila `standings-row` con `data-user-id`; celdas `standings-rank`, `standings-points`, `standings-exact` |
| `standings/PaymentBanner.tsx` / `PaymentStatusBadge.tsx` | `payment-banner`; `payment-status-badge` con `data-status="pending|paid"` |
| `standings/MatchAdminList.tsx` | `match-admin-row` con `data-match-id`; `admin-home-score`, `admin-away-score`, `admin-status-select`, `admin-save-result`, `admin-result-error` |
| `standings/MemberAdminList.tsx` / `ExpelMemberDialog.tsx` | `member-admin-row` con `data-user-id`; `payment-toggle`; `expel-button`; `expel-dialog`, `expel-confirm` |
| `duels/DuelsDashboard.tsx` | `duels-dashboard`; `duel-card` con `data-challenge-id` y `data-status`; `create-duel-button`; `duel-balance` (saldo visible) |
| `duels/CreateDuelDialog.tsx` | `duel-match-select`, `duel-rival-select`, `duel-bet-input`, `duel-home-pred`, `duel-away-pred`, `duel-type-toggle` (directo/abierto), `create-duel-submit`, `create-duel-error` |
| `duels/AcceptDuelDialog.tsx` | `accept-home-pred`, `accept-away-pred`, `accept-duel-submit`, `accept-duel-error`, `reject-duel-button` |
| `awards/AwardsBoard.tsx` / `AwardSelector.tsx` / `CandidatePicker.tsx` | `awards-board`; `award-category` con `data-category="champion|top_scorer|mvp"`; `selected-candidate`; `candidate-option` con `data-candidate-id`; `award-locked-notice`; `award-phase-points` |
| `account/AccountLeaguesPanel.tsx` / `LeaveLeagueDialog.tsx` / `BadgeHistory.tsx` / `ProfileSummaryCard.tsx` | `account-league-item` con `data-league-id`; `leave-league-button`, `leave-league-dialog`, `leave-league-confirm`; `badge-item` con `data-badge`; `profile-summary` |
| `layout/BottomNavbar.tsx` | `bottom-nav`; cada item `nav-item` con `data-route` (derivar los destinos reales del componente) |
| raíz: `login-form.tsx`, `sign-up-form.tsx`, `forgot-password-form.tsx`, `update-password-form.tsx`, `google-signin-button.tsx`, `logout-button.tsx` | `auth-error` (mensaje de error en cada form — los inputs ya tienen labels accesibles, usarlas); `google-signin-button`; `logout-button` |
| `ui/ScrollableTabs.tsx` | nada si ya expone `role="tab"`/`aria-selected` (verificar) |

Después de instrumentar: `npm run lint && npm run typecheck && npm run test:unit` (hay tests unit de varios de estos componentes — no deben romperse) y `npm run test:e2e`.

### 1.2 Refactor de helpers a módulo composable (`tests/e2e/helpers/`)

Mantener compatibilidad: `predictions-finished.spec.ts` debe seguir pasando sin cambios, o actualizarse en el mismo commit.

| Archivo nuevo | API y comportamiento |
|---|---|
| `admin.ts` | Extraer de `auth.ts`: `requireEnv(name)`, `createAdminClient()` (service role, sin sesión). |
| `cleanup.ts` | `createCleanupStack()` → `{ add(fn), run() }` LIFO idempotente (errores de un paso no abortan el resto; loguear y seguir). |
| `users.ts` | `createUser(opts?)` (admin API, email `e2e-<runId>-<n>@test.pija`, password fija, email confirmado); `loginViaForm(page, email, password)` (extraído de `auth.ts`); `createAuthenticatedContext(browser)` se conserva como wrapper; **nuevo** `createLeagueWithUsers(browser, { members: n, admins?: 1, leagueOpts? })` → crea liga + n usuarios miembros, devuelve `{ league, users: [{ userId, email, context, page }] }` con un BrowserContext logueado por usuario (login por formulario; para >2 usuarios crear contextos bajo demanda con `loginAs(browser, user)` para no pagar n logins si el test no los usa). |
| `seed/league.ts` | `seedLeague({ runId, creatorId, requiresPayment?, paymentAmount?, paymentInstructions? })`; `addMember(leagueId, userId, { role?, paymentStatus?, wagerBalance? })` — si `wagerBalance > 0`, **insertar también `point_transactions` con description `seed_initial_balance` por el mismo monto** (invariante del ledger, `00-contexto.md` §4.5). |
| `seed/matches.ts` | `seedMatch(spec)` y `seedMatches(specs[])` con specs declarativos: `{ home, away, kickoffOffsetMs | matchTime, status, matchday?, stage?, groupLabel?, bracketSlot?, homeScore?, awayScore?, externalRef? }`. Siempre prefijo `test_` en nombres de equipo. Exportar presets: `editableMatch()` (kickoff +2 días), `lockedMatch()` (kickoff +30 s), `liveMatch(score)`, `finishedMatch(score)`, `suspendedMatch()`, `tbdKnockoutMatch()` (home/away "Por definir", `home_source`/`away_source`, `bracket_slot` libre ≥ 9000 — verificar contra el CHECK/UNIQUE real). |
| `seed/predictions.ts` | `seedPrediction({ leagueId, userId, matchId, home, away, multiplier?, pointsEarned?, evaluatedAt? })` via service role (es la única vía de escribir `multiplier`/`points_earned`). |
| `seed/challenges.ts` | `seedChallenge({ leagueId, matchId, creatorId, pointsBet, type, challengedId?, creatorPred })` — **preferir llamar al RPC real `fn_create_challenge` autenticado como el creador** (con un client anon + `signInWithPassword`) para ejercitar la misma ruta que producción; fallback service-role solo si se necesita un estado imposible de alcanzar por RPC. |
| `seed/phases.ts` | `getPhases()`, `setActivePhase(code)` (mueve ventanas `starts_at`/`ends_at` para que `now()` caiga en la fase pedida, ajustando las demás para no solaparse), `restorePhases(snapshot)` — capturar snapshot antes de tocar y restaurar SIEMPRE en cleanup. |
| `seed/awards.ts` | `setWinner(category, candidateId)` / `clearWinners()` (UPDATE `award_candidates.is_winner` via service role, con restore). |
| `webhook.ts` | `sendZafronixEvent(request, { type, matchExternalRef | bracketSlot | teams, payload, ts?, timestampOverride?, badSignature? })` → construye el body como los fixtures de `tests/fixtures/zafronix/`, firma con la lógica de `tests/integration/helpers/hmac.ts` (reutilizar/importar, no copiar) y hace POST con `page.request` o `playwright.request` a `/api/webhooks/zafronix`. Devuelve la respuesta para asserts de status/body. |
| `mail.ts` | `getLastEmailTo(email)` → intenta Mailpit (`GET http://127.0.0.1:54324/api/v1/messages` + detalle) y si 404, Inbucket (`/api/v1/mailbox/<user>`); extrae links del cuerpo (`extractLinks(html)`). |
| `db-assert.ts` | `getWagerBalance(leagueId, userId)`, `getTransactions(leagueId, userId)`, `assertLedgerInvariant(leagueId)` (para cada miembro: `wager_balance === SUM(point_transactions.amount)`; lanzar con diff claro), `getPrediction(leagueId, userId, matchId)`, `getChallenge(id)`. |
| `multiplier.ts` | `expectedMultiplierForMatch(match)` → carga los matches relevantes de la BD con el admin client y reutiliza `currentRoundOrdinal` + `calculatePredictionMultiplier` **importados de `src/utils/scoring.ts`** (no reimplementar). Es la respuesta a la trampa §7.2 (jornada en curso avanza con el tiempo real). |

`seed.ts` actual: convertirlo en façade que re-exporta desde los módulos nuevos (o migrar `predictions-finished.spec.ts` a las APIs nuevas — elegir lo que produzca el diff más pequeño y dejarlo anotado).

### 1.3 Configuración Playwright y scripts

En `playwright.config.ts`:
- Añadir proyecto `desktop-chromium` (viewport 1280×800, sin touch) con `grep: /@desktop/` — solo corre tests etiquetados.
- En el proyecto `mobile-chromium` añadir `grepInvert: /@desktop/`.
- `expect: { timeout: 10_000 }` global (Realtime/SSR locales pueden tardar).
- **Mantener `workers: 1` y `fullyParallel: false`** (trampa §7.1) — añadir comentario explicando por qué, para que nadie lo "optimice".

En `package.json`, añadir scripts: `"test:e2e:headed": "playwright test --headed"`, `"test:e2e:ui": "playwright test --ui"`, `"test:e2e:report": "playwright show-report"`.

### 1.4 Documento de bugs
Crear `docs/e2e-plan/BUGS.md` con la plantilla de registro (ID, fecha, fase, caso, esperado, real, archivos, severidad) y cero entradas.

## Criterios de aceptación (DoD)
1. `npm run lint && npm run typecheck` verdes.
2. `npm run test:unit` verde (los unit tests de componentes instrumentados no se rompieron).
3. `npm run test:e2e` verde — los 23 tests existentes pasan con los helpers refactorizados.
4. Todos los testids de la tabla 1.1 existen en el DOM (verificación manual con `--ui` o grep en src).
5. Tabla de "Notas de ejecución" rellenada con los nombres finales de testids y cualquier desviación.
6. `BUGS.md` creado.

## Verificación
```bash
npm run lint && npm run typecheck && npm run test:unit && npm run test:e2e
```

## Riesgos y notas
- El refactor de `seed.ts` es el paso con más riesgo de romper `predictions-finished.spec.ts`: hacerlo en commits separados (1: instrumentación, 2: helpers nuevos sin tocar seed.ts, 3: migración del seed/spec).
- `seedChallenge` vía RPC autenticado necesita `signInWithPassword` con el client JS estándar (no SSR) — el password de los usuarios E2E es fijo, así que es directo.
- No añadir testids a componentes del boilerplate sin uso (`tutorial/*`, `deploy-button`, etc.).

## Notas de ejecución

> Ejecutada el 2026-06-09. Línea base verificada: `supabase start` + `db reset` + suite E2E (22 tests reales, no 23: sanity 1 + create-league 1 + predictions-finished 20).

### Contrato final de testids (las fases 2-10 usan ESTOS nombres)

| Componente | testids finales | Desviación vs propuesta |
|---|---|---|
| `GoalPicker` | raíz `goal-picker` (default) con `data-side="home\|away"`; `goal-increment`, `goal-decrement`, `goal-value` | El testid de la raíz es **overridable vía prop `testId`** (así se implementan los ids contextuales de admin/duelos). `data-side` se pasa por prop `side`. |
| `MatchCard` | `match-card` + `data-match-id`; `save-status` + `data-state` (idle/dirty/saving/saved/offline/error); `undo-button`; `lock-indicator` + `data-reason` ("tbd" o status); `multiplier-badge` (solo en scheduled no-TBD, igual que el multiplicador de cabecera); ya existían: `actual-home-score`, `actual-away-score`, `your-prediction`, `points-badge` (+`data-variant`), `multiplier-drift-chip`, `result-divider`, `result-summary` | `save-status` y `lock-indicator` son mutuamente excluyentes (mismo hueco de la cabecera). |
| `PredictionsBoardView` | `predictions-board` | Tabs: sin testid (ya exponen `role="tab"`). |
| `WelcomePaymentModal` | `welcome-payment-modal`, `payment-amount`, `payment-instructions`, `welcome-payment-close` ("Ahora no") | `payment-instructions` existe también sin instrucciones (texto fallback). |
| `LeagueCreateForm` | `league-name-input`, `requires-payment-switch`, `payment-amount-input`, `payment-instructions-input`, `create-league-submit`, `create-league-error` | — |
| `JoinByCodeForm` / `JoinLeagueCard` / `NoLeagueState` | `join-code-input`, `join-submit`, `join-error`; `join-league-card`, `join-league-name`, `join-payment-info`; `no-league-state` | `join-error` se reutiliza en ambos componentes (nunca coexisten en una página). `join-payment-info` cubre las dos variantes (con/sin pago). El CTA del card se localiza por rol (`aria-label="Unirme a la liga <nombre>"`). |
| `StandingsTable` | `standings-table` (el `<ol>`), `standings-row` + `data-user-id`, `standings-rank`, `standings-points`, `standings-exact` | — |
| `PaymentBanner` / `PaymentStatusBadge` | `payment-banner`; `payment-status-badge` + `data-status="pending\|paid"` | — |
| `MatchAdminList` | `match-admin-row` + `data-match-id`; `admin-home-score` / `admin-away-score` (raíz del GoalPicker vía prop `testId`, hijos `goal-increment`/`goal-decrement`/`goal-value`); `admin-status-select`; `admin-save-result`; `admin-result-error` | El aviso `warning` (no error) no tiene testid; localizar por texto si hace falta. |
| `MemberAdminList` / `ExpelMemberDialog` | `member-admin-row` + `data-user-id`; `payment-toggle`; `expel-button`; `expel-dialog`; `expel-confirm` | — |
| `DuelsDashboard` | `duels-dashboard`; `duel-card` + `data-challenge-id` + `data-status`; `create-duel-button`; `duel-balance`; **extras**: `accept-duel-button`, `reject-duel-button`, `join-pool-button`, `cancel-duel-button` | **`reject-duel-button` vive AQUÍ** (tarjeta del reto recibido), no en `AcceptDuelDialog` como proponía el plan: el rechazo no abre diálogo. |
| `CreateDuelDialog` | `duel-match-select`, `duel-rival-select`, `duel-bet-input`, `duel-home-pred`/`duel-away-pred` (GoalPicker `testId`), `duel-type-toggle` (contenedor, + `data-type`) con `duel-type-direct`/`duel-type-open`, `create-duel-submit`, `create-duel-error`, **extra** `create-duel-success` (pantalla de éxito) | — |
| `AcceptDuelDialog` | `accept-home-pred`, `accept-away-pred` (GoalPicker `testId`), `accept-duel-submit`, `accept-duel-error` | Sin `reject-duel-button` (ver DuelsDashboard). |
| `AwardsBoard` / `AwardSelector` / `CandidatePicker` | `awards-board`; `award-category` + `data-category` (la Card); `award-locked-notice`; `award-phase-points` + `data-active-phase` (A-D); `selected-candidate` + `data-candidate-id`; `candidate-option` + `data-candidate-id` (en el dropdown del selector Y en CandidatePicker) | `CandidatePicker` no se usa en ninguna página actualmente (solo `AwardSelector`); se instrumentó igual. |
| `AccountLeaguesPanel` / `LeaveLeagueDialog` / `BadgeHistory` / `ProfileSummaryCard` | `account-league-item` + `data-league-id`; `leave-league-button`; `leave-league-dialog`; `leave-league-confirm`; `badge-item` + `data-badge` (badgeType); `profile-summary` | El checkbox de consentimiento del dialog se localiza por rol. |
| `BottomNavbar` | `bottom-nav`; `nav-item` + `data-route` (`/predictions`, `/standings`, `/duels`, `/rules`, `/account`) | 5 destinos reales (incluye `/rules`, no listado en el plan original). |
| Forms raíz de auth | `auth-error` (login, sign-up, forgot-password, update-password); `google-signin-button`; `logout-button` | Los textos de sign-up/forgot/update están en inglés (boilerplate) — los asserts de la Fase 2 deben copiarlos del componente. |
| `ScrollableTabs` | sin cambios | Verificado: ya expone `role="tablist"`/`role="tab"`/`aria-selected`. |

### Helpers (API final y desviaciones)

- `admin.ts`: `requireEnv`, `createAdminClient`, **extra** `createAnonClient` (para RPCs autenticados).
- `cleanup.ts`, `users.ts`, `seed/league.ts`, `seed/matches.ts`, `seed/predictions.ts`, `seed/phases.ts`, `seed/awards.ts`, `webhook.ts`, `mail.ts`, `db-assert.ts`, `multiplier.ts`: según el plan, con estas desviaciones:
  - **`seed/challenges.ts`**: el RPC real en BD es **`create_challenge`** (no `fn_create_challenge`; ídem `accept_challenge` — fuente: `duels.actions.ts`). `seedChallenge` recibe `creator: { email, password? }` en lugar de `creatorId` porque el RPC autentica con `auth.uid()` (password fija `TEST_PASSWORD`). Extras: `acceptChallengeAs()` y fallback service-role `seedChallengeRaw()`.
  - `users.ts`: `createLeagueWithUsers` hace login eager solo de los 2 primeros usuarios (`opts.eagerLogins`); el resto vía `user.login()` lazy. `leagueOpts.paymentStatus` default `"paid"` (evita el WelcomePaymentModal en tests que no lo prueban). Devuelve `cleanup()` LIFO que borra contextos, liga y usuarios.
  - `seed/league.ts`: `addMember` con `wagerBalance > 0` inserta la transacción `seed_initial_balance` (invariante del ledger). `seedLeague` genera invite codes **solo alfanuméricos** (aptos para `/join/<code>`). Extra `setActiveLeague()` (las páginas leen `profiles.active_league_id`).
  - `seed/matches.ts`: `bracket_slot >= 9000` para TBD verificado contra el esquema real — la columna NO tiene CHECK de rango, solo UNIQUE parcial. Spec con escape hatch `rawTeamNames` (para placeholders "Por definir" del dataset histórico).
  - `mail.ts`: el stack local actual levanta **Mailpit** (confirmado en `supabase start`); Inbucket queda como fallback. Extra `waitForEmailTo()` con polling.
  - `webhook.ts`: `timestampOverride` firma CON ese timestamp (firma válida + fuera de ventana → ejercita `replay_rejected`); `badSignature` corrompe manteniendo formato/longitud (71 chars).
  - `multiplier.ts`: importa `currentRoundOrdinal`/`calculatePredictionMultiplier` de `src/utils/scoring.ts` por ruta relativa (sin reimplementar).
  - **extra** `ui.ts`: `selectPhaseTab(page, name)` — ver flake abajo.
- `seed.ts`: quedó como **façade** que conserva la API y el dataset EXACTOS de `seedPredictionsE2E` pero compone los módulos nuevos (valida los módulos contra los 20 tests existentes). `auth.ts` re-exporta desde `users.ts`/`admin.ts`.

### Flake investigado (pre-existente, NO bug de producto)

En `next dev`, inmediatamente tras un `goto`, el tablist puede aparecer **duplicado durante unos ms** (dos tabs idénticos, ambos `aria-selected=true`) mientras el router cliente toma el control del HTML SSR; el DOM se asienta en un único tablist (verificado con el page snapshot del error-context: al momento del snapshot ya había 1). Provocaba violaciones de strict mode intermitentes en `locator('[role="tab"]').click()` — **ya ocurría en la línea base** (1/22 fallos, test distinto en cada run). Mitigación sin debilitar asserts: `selectPhaseTab()` espera `toHaveCount(1)` (auto-retry; fallaría fuerte si la duplicación fuera permanente) antes del click, y el test de pestaña por defecto asserta `toHaveCount(1)` del tab activo antes del texto. `predictions-finished.spec.ts` se actualizó en el mismo commit solo para usar este helper.

### Configuración

- `playwright.config.ts`: `expect.timeout` 10 s global; proyecto `desktop-chromium` (1280×800, `grep: /@desktop/`); `mobile-chromium` con `grepInvert: /@desktop/`; comentario anti-"optimización" sobre `workers: 1` + `fullyParallel: false`.
- `package.json`: `test:e2e:headed`, `test:e2e:ui`, `test:e2e:report`.

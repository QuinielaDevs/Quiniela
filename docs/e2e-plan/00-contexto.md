# 00 — Contexto compartido del proyecto (LECTURA OBLIGATORIA para todo agente ejecutor)

> Este documento es la base de conocimiento mínima para ejecutar cualquier fase del plan E2E.
> Léelo COMPLETO antes de tocar código. Las fases (`01-…` a `10-…`) lo referencian y NO repiten esta información.

---

## 1. Qué es el producto

**Pija Quiniela** es una app móvil-first de quinielas del Mundial 2026 entre amigos. Un usuario crea una liga, invita por WhatsApp con un código, y los miembros:

- **Predicen marcadores** de los 104 partidos del Mundial (tablero táctil con botones +/-, autosave con debounce de 500 ms).
- **Ganan puntos**: 5 por marcador exacto, 2 por acertar el resultado, 0 si fallan — multiplicados por un **multiplicador por antelación** (ver §4.2).
- **Compiten en una clasificación** con desempates canónicos, por jornada/fase y acumulada.
- **Ven una tabla proyectada en vivo** (WebSocket/Supabase Realtime) con toasts de "impacto de gol".
- **Se retan en duelos 1v1 o abiertos** apostando puntos de una **economía separada** (`wager_balance`) con escrow atómico.
- **Predicen premios especiales** (campeón, goleador, MVP) con recompensa decreciente por fase del torneo (50/25/10/0).
- **El admin** gestiona pagos (pending/paid), expulsa miembros y captura resultados manualmente.
- Los resultados llegan automáticamente vía **webhooks de Zafronix** (proveedor real de datos deportivos, con HMAC) y un **cron de respaldo con ETags**.

Stack: **Next.js 15 (App Router, React 19, Server Actions) + Supabase (Postgres 17, Auth, RLS, Realtime) + Tailwind/shadcn**. Idioma de la UI y de los tests: **español**.

Los 8 épicos del producto están implementados (auth/ligas, predicciones, standings/admin, live, duelos, premios, seed/avance de fases, webhooks).

---

## 2. Mapa de rutas

| Ruta | Acceso | Qué hace |
|---|---|---|
| `/` | anon | Home/landing |
| `/auth/login`, `/auth/sign-up` | anon | Email+password y botón Google OAuth |
| `/auth/forgot-password`, `/auth/update-password` | anon / sesión recovery | Recuperación de contraseña (emails capturados por Inbucket/Mailpit local) |
| `/auth/error`, `/auth/sign-up-success` | anon | Estados auxiliares |
| `/leagues/new` | auth | Form de creación de liga (`LeagueCreateForm`) → RPC `fn_create_league` |
| `/join/[invite_code]` | anon/auth | Landing de invitación (RPC `fn_get_invite_landing`, accesible anon) + auto-join autenticado (`fn_join_league_by_invite`) |
| `/predictions` | auth+miembro | Tablero de predicciones (`PredictionsBoardView` → `MatchCard` → `GoalPicker`), tabs por jornada |
| `/standings` | auth+miembro | Clasificación oficial (`StandingsTable`), tabs por fase, banner de pago |
| `/standings/manage` | auth+admin | Panel admin: resultados (`MatchAdminList`), pagos y expulsiones (`MemberAdminList`, `ExpelMemberDialog`) |
| `/live` | auth+miembro | Tabla proyectada en vivo (`LiveStandingsBoard` + `GoalToast`), suscripción Realtime a `matches` |
| `/duels` | auth+miembro | Panel de duelos (`DuelsDashboard`, `CreateDuelDialog`, `AcceptDuelDialog`) |
| `/desafio/[id]` | anon/auth | Landing pública de un duelo (RPC `fn_get_challenge_landing`, oculta predicciones pre-kickoff), OG metadata para WhatsApp |
| `/awards` | auth+miembro | Premios especiales (`AwardsBoard`, `AwardSelector`, `CandidatePicker`) |
| `/account` | auth | Perfil, insignias (`BadgeHistory`), ligas (`AccountLeaguesPanel`, `LeaveLeagueDialog`) |
| `/rules` | auth | Reglas de la liga (incluye tabla de multiplicadores) |
| `/protected` | auth | Redirect placeholder a `/predictions` |
| `POST /api/webhooks/zafronix` | HMAC | Único route handler API: eventos `match.finalized` / `match.patched` / `match.postponed` |

---

## 3. Modelo de datos esencial (Supabase, `supabase/migrations/`)

| Tabla | Claves/constraints que importan en E2E |
|---|---|
| `profiles` | 1:1 con `auth.users`, creada por trigger `fn_handle_new_user` (display_name default "Jugador Anónimo"). |
| `leagues` | `invite_code` UNIQUE; `requires_payment`, `payment_amount`, `payment_instructions`. |
| `league_members` | UNIQUE(league_id, user_id); `role` ∈ admin/member; `payment_status` ∈ pending/paid; `joined_at` (desempate); `wager_balance numeric(12,2) CHECK >= 0` (default **0.00**). |
| `matches` | **CATÁLOGO GLOBAL, sin league_id** (ver trampa §7.1). `status` ∈ scheduled/live/finished/suspended/canceled; `match_time` (kickoff UTC); `matchday` (1-3 grupos); `stage` ∈ group/round-32/round-16/quarter/semi/third-place/final; `group_label` A-L; `bracket_slot` 73-104 UNIQUE (knockout); `home_source`/`away_source` (placeholders "1A", "W74"); `external_ref` UNIQUE (id Zafronix); `external_last_sync_at` (control out-of-order). |
| `predictions` | UNIQUE(league_id, user_id, match_id); `multiplier numeric(3,2)` y `points_earned numeric(6,2)` **sin GRANT de escritura para `authenticated`** (solo el RPC los escribe); `evaluated_at` = marca de idempotencia del accrual. |
| `challenges` | `type` ∈ direct/open; `status` ∈ pending/active/completed/canceled; `points_bet > 0`; `winner_ids uuid[]`. |
| `challenge_participants` | PK(challenge_id, user_id) con la predicción del duelo. |
| `point_transactions` | Ledger de la economía de duelos. **Invariante: `league_members.wager_balance == SUM(point_transactions.amount)` por (user, liga)** (documentada en `supabase/migrations/20260606130000_accrual_correction_rpc.sql:12`). |
| `award_candidates` | category ∈ champion/top_scorer/mvp; `is_winner`, `is_active`, `display_order`. UNIQUE(id, category). |
| `special_predictions` | UNIQUE(user_id, league_id, category); `predicted_at` lo fija el servidor (trigger `fn_touch_special_prediction`); trigger `fn_check_awards_locked` bloquea INSERT/UPDATE/DELETE cuando la fase activa tiene `edits_locked`. |
| `tournament_phases` | Filas A/B/C/D con `reward_points` (50/25/10/0), ventanas `starts_at`/`ends_at`, `edits_locked`. **Palanca de los tests de premios** (§7.5). |
| `system_config` | key/value (ETag de Zafronix, etc.). |

**Seed local** (`supabase/seed.sql`, aplicado por `supabase db reset`): calendario completo WC2026 (72 partidos de grupos + 32 knockout con placeholders), `tournament_phases` A-D con fechas reales del torneo y `award_candidates`.

---

## 4. Reglas de negocio que el E2E debe verificar

### 4.1 Puntos base (`src/utils/scoring.ts`, espejo SQL `score_prediction`)
- Marcador exacto → **5**. Mismo resultado (ganador o empate) con marcador distinto → **2**. Resto → **0**.
- Partido NO `finished` (incluye `suspended`/`canceled`) → **0** y queda **excluido** de toda clasificación.

### 4.2 Multiplicador por antelación — POR DISTANCIA EN JORNADAS (¡no por días!)
Fuente de verdad: `src/utils/scoring.ts:80-208` (espejo SQL: `fn_match_round_ordinal`, `fn_current_round_ordinal`, `fn_prediction_multiplier`).

- Rondas como ordinales: J1=1, J2=2, J3=3, 16avos=4, octavos=5, cuartos=6, semis=7, 3er puesto=8, final=8.
- "Jornada en curso" = mayor ronda cuyo **primer partido ya empezó** (`match_time <= now()`, excluyendo `canceled`) sobre **TODA** la tabla `matches`.
- Multiplicador = `min(2.5, 1.0 + 0.25 × distancia)` donde `distancia = max(0, ordinal_partido − max(ordinal_en_curso, 1))`.
- **Jornada 1 SIEMPRE vale 1.0x** (línea base).
- El valor autoritativo lo calcula `fn_save_prediction` con el `now()` del **servidor**; se recalcula en **cada** edición (editar tarde degrada el multiplicador → la UI muestra un *drift chip* de advertencia, `MatchCard` testid `multiplier-drift-chip`).
- Puntos finales = `round(base × multiplier, 2)`.

### 4.3 Candados temporales (kickoff)
- **Escritura**: predicciones editables solo si `now() < match_time − 1 min` (`fn_match_editable`, validado por RLS **y** dentro de `fn_save_prediction`, error `P0001` "Pronostico cerrado").
- **Lectura (time-gating)**: las predicciones AJENAS solo son visibles cuando `now() >= match_time − 1 min` (`fn_match_unlocked` en la policy SELECT). Antes, cada quien ve solo las suyas.
- Duelos: crear/aceptar exige que el partido no haya empezado (`P0004`).

### 4.4 Clasificación (`src/utils/standings.ts`, cálculo on-the-fly en cliente/SSR)
Orden: 1) puntos totales desc → 2) nº de exactos desc → 3) `wager_balance` desc → 4) `joined_at` asc → 5) userId (estable). Solo partidos `finished`. `buildProjectedStandings` añade los `live` (no oficial, para `/live`).

### 4.5 Duelos y escrow
- `fn_create_challenge`: valida saldo (`P0003` si insuficiente), no auto-reto (`P0002`), partido no iniciado (`P0004`), apuesta > 0 (`P0001`). **Deduce el escrow AL CREAR** y registra transacción.
- `fn_accept_challenge`: deduce escrow del aceptante, pasa a `active`. `fn_reject_challenge`: cancela.
- Trigger `fn_cancel_pending_challenges_on_match_start` (al cambiar status del match): pending con ≥2 participantes → active; con <2 → cancelado + reembolso; match suspendido/cancelado → reembolsa TODO.
- Trigger `fn_resolve_challenges_on_match_status_change` (al pasar a `finished`): además del **accrual** de predicciones normales (suma `points_earned` al `wager_balance`, idempotente vía `evaluated_at`), liquida duelos: gana quien tenga más puntos base (sin multiplicador) en su predicción del duelo; empate en el máximo → split del pozo; nadie acierta nada → reembolso.
- El saldo inicial de `wager_balance` es 0 y **se gana con el accrual de predicciones** — para sembrar saldo en tests hay que setearlo via service role **e insertar la transacción `seed_initial_balance` equivalente** para no romper la invariante del ledger.

### 4.6 Premios especiales
Recompensa según la fase activa **al momento de `predicted_at`**: A (pre-inaugural)=50, B (grupos)=25, C (octavos/cuartos)=10, D (semis en adelante)=0 y **edición bloqueada** (trigger + UI). Resolución: `award_candidates.is_winner` → vista `special_predictions_with_points`.

### 4.7 Webhooks Zafronix (`src/app/api/webhooks/zafronix/route.ts`)
- Headers: `X-Zafronix-Timestamp` (s o ms) + `X-Zafronix-Signature-256` = `sha256=` + HMAC-SHA256(`${timestamp}.${rawBody}`, `ZAFRONIX_WEBHOOK_SECRET`), comparación timing-safe.
- Ventana anti-replay: ±5 min → si no, `401 replay_rejected`. Firma mala → `401 signature_mismatch`.
- Matching del partido: `external_ref` → `bracket_slot` (knockout) → nombres normalizados (grupos).
- Out-of-order: si `event.ts <= matches.external_last_sync_at` → 200 con `ignored: true`, sin cambios.
- `match.finalized` → marcador + `finished` (dispara triggers de accrual/duelos). `match.patched` → aplica diff de `changes` y **corrige el ledger** con deltas (`fn_apply_accrual_correction`). `match.postponed` → RPC `fn_postpone_match_and_predictions` (status suspended/canceled, predicciones anuladas a 0, duelos reembolsados).
- Existe firma de ejemplo y helper HMAC reutilizable en `tests/integration/helpers/hmac.ts` y fixtures en `tests/fixtures/zafronix/*.sample.json`.

### 4.8 Admin
- `fn_admin_set_match_result`: requiere ser admin de **al menos una** liga (`fn_user_is_any_league_admin`); matriz de transiciones de estado válidas; bloquea capturar resultado de knockout con equipos TBD; valida marcador↔estado.
- `fn_set_member_payment_status`, `fn_promote_member_to_admin`, `fn_remove_member` (no permite eliminar al último admin; cascada cancela duelos del expulsado y reembolsa contrapartes), `fn_leave_league` (mismo guard de último admin).

### 4.9 Códigos de error RPC (para asserts de mensajes en UI)
`P0001` pronóstico cerrado / apuesta inválida · `P0002` no existe / auto-reto · `P0003` saldo insuficiente · `P0004` partido ya comenzó · `42501` no autorizado · `22023` datos de entrada inválidos (invitación, transición). Las Server Actions (`src/app/actions/*.actions.ts`) mapean estos códigos a mensajes en español — leer el action correspondiente antes de assertear textos.

---

## 5. Entorno de ejecución (runbook)

### 5.1 Prerrequisitos de máquina
- **Docker Desktop corriendo** (Supabase local). Windows: el puerto 3000 puede estar ocupado por Docker → E2E usa el **3100**.
- El `project_id` de `supabase/config.toml` debe coincidir con el nombre del directorio del repo (requisito conocido del stack local).
- `.env.test.local` en la raíz con las credenciales del stack local (ver §5.3).

### 5.2 Comandos
```bash
npx supabase start        # stack local: API 54321, DB 54322, Studio 54323, Inbucket/Mailpit 54324
npx supabase db reset     # re-aplica migraciones + seed.sql (calendario WC2026, fases, candidatos)
npm run test:e2e          # Playwright; levanta `next dev --port 3100` solo (webServer)
npx playwright test tests/e2e/<spec> --project=mobile-chromium   # un spec
npm run test:ci           # unit + integration + e2e (lo que corre CI)
```
CI (`.github/workflows/ci.yml`): ubuntu, Node 22, `supabase start`, exporta credenciales con `supabase status -o env`, corre `test:ci`, sube `playwright-report/`. Google OAuth usa placeholders (NO se ejercita el flujo real). `ZAFRONIX_SANDBOX_KEY` no se inyecta → la suite de sandbox real se omite (skip) a propósito.

### 5.3 Variables de entorno usadas por los tests
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `E2E_PORT` (default 3100), `ZAFRONIX_WEBHOOK_SECRET` (debe estar definido en `.env.test.local`/`.env` para que **tanto** el firmante del test **como** el dev server del webServer compartan secreto — `playwright.config.ts` carga dotenv y el proceso hijo lo hereda).

### 5.4 Emails locales
`config.toml` expone el servidor de email de pruebas en `http://127.0.0.1:54324`. Según versión del CLI es **Inbucket** (`/api/v1/mailbox/{user}`) o **Mailpit** (`/api/v1/messages`). El helper de mail (Fase 1) debe detectar cuál responde.

---

## 6. Infraestructura E2E existente (NO partir de cero)

| Pieza | Archivo | Qué hace |
|---|---|---|
| Config Playwright | `playwright.config.ts` | testDir `tests/e2e`, **workers: 1, fullyParallel: false** (ver §7.1), proyecto único `mobile-chromium` (390×844, touch), baseURL `http://127.0.0.1:3100`, webServer `npm run dev -- --port 3100` (reuse local), trace on-first-retry, retries 2 en CI. |
| Auth helper | `tests/e2e/helpers/auth.ts` | `createAuthenticatedContext(browser)`: crea usuario vía admin API (`e2e-<ts>-<rand>@test.pija`, password `PijaE2E!Test-2026`, email confirmado) y hace **login por el formulario real** (`/auth/login`, labels "Correo electrónico"/"Contraseña", botón /iniciar sesi/i, espera `/predictions`). `deleteE2EUser(userId)`. Estrategia deliberada: NO forjar cookies. |
| Seed helper | `tests/e2e/helpers/seed.ts` (~396 líneas) | `seedPredictionsE2E(userId)`: liga + membresía admin + 8 partidos `test_*` (finalizados/scheduled/live/suspended/TBD) + predicciones con multiplicadores y `points_earned` sembrados. Cleanup LIFO + red de seguridad por prefijo `test_`. |
| Specs actuales | `tests/e2e/sanity.spec.ts` (1), `tests/e2e/create-league.spec.ts` (1, solo guard), `tests/e2e/predictions-finished.spec.ts` (21) | Total ≈ 23 tests. Solo cubren `/predictions` en profundidad. |
| HMAC | `tests/integration/helpers/hmac.ts` | Firma de webhooks Zafronix reutilizable. |
| Fixtures | `tests/fixtures/zafronix/*.sample.json` | Payloads reales de finalized/patched/postponed. |
| data-testid existentes | `MatchCard` (7: `actual-home-score`, `actual-away-score`, `your-prediction`, `points-badge` con `data-variant`, `multiplier-drift-chip`, `result-divider`, `result-summary`), `LiveStandingsBoard` (`live-board`, `live-row`), `GoalToast` (`goal-toast`, `goal-toast-stack`) | El resto de componentes NO tiene testids (se instrumentan en Fase 1). |

Cobertura existente en niveles inferiores (no duplicar en E2E, solo verificar la integración por UI): ~23 archivos unit (schemas Zod, actions, páginas con stubs, scoring/awards puros) y ~35 integration (RLS, todos los RPCs, triggers de escrow, webhook con HMAC, realtime publication, paridad TS↔SQL de scoring, knockout, fases).

---

## 7. TRAMPAS CONOCIDAS (leer dos veces)

1. **`matches` es global (sin league_id)**: cualquier partido sembrado lo ven TODOS los tests y afecta la pestaña por defecto del tablero y la "jornada en curso". Por eso `workers: 1` y ejecución secuencial son **obligatorios** — no lo cambies. Prefijo `test_` en `home_team` para identificar/limpiar. Los specs no deben asumir que "solo existen sus partidos": el calendario WC2026 completo está sembrado.
2. **La "jornada en curso" avanza con el tiempo REAL**: el seed trae las fechas reales del Mundial (junio-julio 2026) y `fn_current_round_ordinal()` mira `match_time <= now()` sobre toda la tabla. Hoy el torneo puede no haber empezado; en semanas la jornada en curso será 2, 3… → **PROHIBIDO hardcodear multiplicadores esperados** en asserts. Calcula la expectativa dinámicamente con `currentRoundOrdinal()`/`calculatePredictionMultiplier()` de `src/utils/scoring.ts` sobre el estado real de la BD, o siembra el multiplicador explícitamente via service role (patrón del seed actual).
3. **Realtime + replica identity**: `matches` tiene replica identity `default` → los filtros de canal por columnas no-PK NO entregan eventos. Suscribirse amplio y filtrar en el callback (la app ya lo hace). En tests de `/live`, usar timeouts generosos (10-15 s) en los `expect` y etiquetar `@realtime`.
4. **Candado de kickoff**: para probar el estado bloqueado, siembra el partido con `match_time = now + 30s` (ya dentro de la ventana de 1 min, sigue `scheduled`). Para probar la transición en vivo necesitas esperar ~70 s reales → etiqueta `@slow` y úsalo con moderación; prefiere sembrar dos partidos (uno editable, uno bloqueado).
5. **Fases de premios**: la fase activa se resuelve por `now()` contra las ventanas de `tournament_phases`. La palanca de test es **mover `starts_at`/`ends_at`/`edits_locked` via service role** — SIEMPRE restaurar los valores originales en el cleanup (o `db reset`), porque es estado global que afecta a otros specs.
6. **OAuth Google fuera de alcance** del E2E automatizado (CI usa placeholders). Se cubre: visibilidad del botón y que la navegación sale hacia `<SUPABASE_URL>/auth/v1/authorize?provider=google` (interceptar, no completar).
7. **El dev server comparte BD con lo que tengas corriendo**: si tienes `npm run dev` en 3000 con datos sucios, no afecta (puerto distinto), pero la BD es la misma — corre los E2E sobre un stack recién reseteado cuando midas resultados.
8. **Texto en español sin i18n**: los asserts de texto deben copiarse del componente fuente, no inventarse. Antes de escribir un assert de texto, abre el componente y copia el literal exacto.
9. **`points_earned`/`multiplier` no son escribibles por el cliente** (REVOKE por columna): los seeds que los fijan deben usar el **service role**.
10. **Cleanup**: borrar usuario (`deleteE2EUser`) cascadea profile→memberships→predictions→duelos. Los partidos `test_%` deben borrarse explícitamente. Patrón LIFO. Si un test muere a mitad, el siguiente run debe poder limpiar (cleanup previo idempotente, como hace `seed.ts`).

---

## 8. Convenciones para escribir los tests

- **Idioma**: títulos y comentarios en español. Incluir el ID del caso del plan en el título: `test("PRED-04: el debounce colapsa ediciones rápidas en un solo guardado", …)`.
- **Estructura**: `test.describe` por área; `beforeAll` (usuario+seed+login), `afterAll` (cleanup LIFO). AAA dentro de cada test.
- **Selectores** (orden de preferencia): `getByRole`/`getByLabel` (semántica y a11y) → `getByTestId` (estados/datos) → `getByText` con literal copiado del componente (último recurso). Testids nuevos en **kebab-case**.
- **Esperas**: nunca `waitForTimeout` salvo para debounce documentado; usar auto-wait de `expect`. Realtime: `expect(...).toBeVisible({ timeout: 15_000 })`.
- **Tags** en el título cuando aplique: `@slow` (esperas reales >30 s), `@realtime`, `@desktop`.
- **Aserciones de BD**: los E2E verifican primero la UI; las invariantes (ledger, evaluated_at) se verifican después con el admin client (helpers de `db-assert`). Esto es deliberado y está bien.
- **Datos**: `runId` único por ejecución (timestamp+random) en nombres/códigos; equipos con prefijo `test_`.
- **Determinismo**: cero dependencia de red externa (Zafronix real solo en la suite integration de sandbox, que ya existe y se omite sin key).

## 9. Reglas de oro para el agente ejecutor

1. **No modifiques lógica de producción.** La única excepción es añadir atributos `data-testid` (Fase 1) — cero cambios de comportamiento, cero refactors oportunistas.
2. **Si el producto se comporta distinto a lo que este plan asume**, la fuente de verdad es el código del producto: adapta el test al comportamiento real y anota la desviación en la sección "Notas de ejecución" del doc de tu fase. **Si el comportamiento real parece un bug** (contradice las reglas de §4), NO "arregles" el test para que pase: regístralo en `docs/e2e-plan/BUGS.md` (crear si no existe: ID, caso de prueba, comportamiento esperado vs real, archivos implicados) y marca el test con `test.fixme` referenciando el bug.
3. **Lee antes de escribir**: el componente/página/action implicado en cada caso, para copiar textos, labels y rutas exactas.
4. **Cada fase termina verde**: `npm run lint && npm run typecheck && npx playwright test` (suite completa, no solo tus specs) sin fallos ni `.only`. Los tests existentes no pueden romperse; si tu cambio de helper los afecta, actualízalos.
5. **No borres ni debilites asserts existentes** para estabilizar; investiga la causa.
6. **Marca el progreso**: al terminar, actualiza la tabla de estado del `README.md` del plan (fase → ✅ + fecha + nº de tests añadidos).

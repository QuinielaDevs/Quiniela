---
baseline_commit: cc9ace72af793b08359b2dfb9c5f253627f305d6
---

# Story 8.4: Entorno de Pruebas Integradas con el Sandbox de Zafronix (Año 9999)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Como desarrollador del proyecto,
quiero configurar un entorno de pruebas de integración automatizadas que interactúe con el Sandbox real de Zafronix del año 9999,
para que el ciclo de vida completo de un partido (resultado en sandbox → webhook firmado → escritura en DB local → propagación Realtime → tabla proyectada en el cliente) se pueda probar de manera fiel, controlada y sin tocar datos reales del Mundial 2026.

## Contexto de la API real de Zafronix (verificado en docs oficiales)

**Zafronix es una API real** (`https://api.zafronix.com/fifa/worldcup/v1`, header `X-API-Key`). Su documentación oficial (https://api.zafronix.com/docs) confirma un **Sandbox real**:

- **Sandbox = torneo sintético "año 9999":** 12 grupos, 48 equipos ficticios (Alpha-A … Delta-L), 104 partidos.
- **Claves de sandbox `zwc_skt_…`:** leen cualquier año (1930–2026 y 9999) pero **solo pueden escribir en el año 9999**. Las claves de producción NO pueden mutar el 9999. → El aislamiento del AC #4 lo garantiza la propia API en el lado remoto.
- **Endpoints de escritura (solo 9999):**
  - `POST /matches/{matchId}/result` — body: `{ homeScore, awayScore, extraTime, penalties, attendance?, referee? }`. Emite evento `match.finalized`.
  - `PATCH /matches/{matchId}` — corrige campos de un partido finalizado. Emite `match.patched`.
  - `POST /matches/{matchId}/postpone` — marca status (postponed/abandoned/cancelled). Emite `match.postponed`.
  - Todos aceptan cabecera opcional `Idempotency-Key` (semántica at-most-once).
- **`POST /sandbox/reset`** — regenera los fixtures, idempotente, **capado a 10/hora/clave**. `GET /sandbox/status` — timestamp de último reset + contador de modificaciones.
- **Webhooks reales:** HMAC-SHA256 sobre `` `${timestamp}.${rawBody}` ``; cabeceras `X-Zafronix-Signature-256: sha256=<hex>`, `X-Zafronix-Timestamp` (ms), `X-Zafronix-Event-Type`; ventana de replay 5 min; reintentos con backoff (0s,5s,25s,2m,10m,52m) y auto-disable tras 20 fallos. **Nuestro handler ya implementa este contrato 1:1** (ver [route.ts](src/app/api/webhooks/zafronix/route.ts)).
- **Cuotas:** `POST /sandbox/reset` = **10/h/clave** (cuello de botella). Cuota diaria de la clave vía `X-RateLimit-Limit`/`X-RateLimit-Remaining` (ventana 24h); cuenta **cada** read y write.

## Decisión de diseño: enfoque HÍBRIDO + pruebas "gated" (CONFIRMADO con el PO)

Los docs **no confirman entrega de webhooks a `localhost`** y la registración de webhooks es "via studio admin (subscriber-side endpoints land in a follow-up release)"; no hay feature de *send-test-event*/replay/CLI. Es decir: escribir en el sandbox real es trivial, pero que Zafronix entregue el webhook firmado a nuestro `localhost` durante un test **no está garantizado**. Decisión acordada:

1. **Híbrido (escritura real + re-firma local):** el test **SÍ escribe en el sandbox real** con la clave `zwc_skt_…` (verifica el contrato de salida real: auth, URL, body, status, `Idempotency-Key`). Como Zafronix no alcanza `localhost`, el test luego **re-firma localmente** el estado resultante con `ZAFRONIX_WEBHOOK_SECRET` y lo inyecta en nuestro handler `POST` local (mismo patrón que [zafronix-webhook.test.ts](tests/integration/zafronix-webhook.test.ts)). Así se cubre el ciclo completo salvo el salto de red de entrega (que Zafronix no hace a localhost de todos modos).
2. **Gated en CI:** las pruebas que tocan el sandbox real se **omiten (`skip`) cuando `ZAFRONIX_SANDBOX_KEY` no está presente**. El CI principal ([ci.yml](.github/workflows/ci.yml)) sigue 100% offline y verde; el ciclo live se corre en local o en un job manual/programado con la clave. Esto evita quemar el cap de reset (10/h) y la cuota diaria en cada PR/retry.

## Acceptance Criteria

1. **Given** la suite de integración de Vitest (proyecto `integration`), **When** se ejecutan las pruebas del flujo del sandbox **y `ZAFRONIX_SANDBOX_KEY` (formato `zwc_skt_…`) está presente**, **Then** las escrituras de resultados se dirigen a partidos del **año 9999** del sandbox real usando esa clave en `X-API-Key`; **And** cuando la clave NO está presente, esas pruebas se **omiten (skip)** de forma limpia (CI offline permanece verde).
2. **And** la suite invoca `POST /sandbox/reset` (helper `resetSandbox()`) **una sola vez en `beforeAll`** (NUNCA en `beforeEach`) para garantizar fixtures consistentes, respetando el cap de **10/h/clave**.
3. **And** se verifica el ciclo completo: (a) la escritura real al sandbox (`POST /matches/{id}/result`) responde con éxito; (b) el evento resultante, **re-firmado localmente con HMAC-SHA256 válido**, es aceptado por nuestro handler local (`200`); (c) `public.matches` queda actualizada (`home_score`, `away_score`, `status`); (d) el cambio se **propaga vía Supabase Realtime** (`postgres_changes` UPDATE sobre `public.matches`), habilitando la verificación de la tabla proyectada en el cliente.
4. **And** **no se ejecuta ninguna escritura sobre partidos reales del año 2026**: en el lado remoto lo garantiza la clave `zwc_skt_` (solo escribe 9999); en el lado local, los fixtures usan un namespace 9999 inequívoco y se aserta que los partidos 2026 permanecen intactos antes/después.
5. **And** se incluye al menos un caso negativo de firma inválida (`401`) y la suite corre de forma determinista: verde en CI offline (con los casos live omitidos) y verde en local con la clave presente.

## Tasks / Subtasks

- [x] **Tarea 1 — Variables de entorno y gating** (AC: #1, #5)
  - [x] Añadir `ZAFRONIX_SANDBOX_KEY` (formato `zwc_skt_…`) a la gestión de entorno: cargarla en `.env.test.local` para uso local. NO añadirla como secreto de CI (decisión: CI principal offline). → Documentado el snippet exacto en README + `.env.example`. **NOTA:** los archivos `.env*` están protegidos por un guardrail del entorno; el agente no puede escribir el secreto en `.env.test.local` (es acción del usuario). El gating tolera su ausencia.
  - [x] Asegurar que `ZAFRONIX_WEBHOOK_SECRET` esté presente en el entorno de tests. → Centralizado `TEST_WEBHOOK_SECRET` en [hmac.ts](tests/integration/helpers/hmac.ts) (prioriza `process.env`, fallback `whsec_test_secret_for_integration_tests_only`) y **exportado el mismo valor en CI** ([ci.yml](.github/workflows/ci.yml)) para que el handler vea el mismo secreto (antes faltaba → habría dado 500 en CI).
  - [x] Implementar el gating: `describe.skipIf(!process.env.ZAFRONIX_SANDBOX_KEY)` + `console.info` explicativo en [zafronix-sandbox-e2e.test.ts](tests/integration/zafronix-sandbox-e2e.test.ts).
  - [x] Documentar las variables nuevas en el README. (`.env.example` no editable por guardrail; el snippet quedó en [README.md](README.md) sección "Testing de integración".)
- [x] **Tarea 2 — Cliente del Sandbox real** (AC: #1, #2, #3a)
  - [x] Crear [tests/integration/helpers/zafronix-sandbox.ts](tests/integration/helpers/zafronix-sandbox.ts) (helper de pruebas; NO código de producción).
  - [x] Cliente tipado contra `https://api.zafronix.com/fifa/worldcup/v1` con `X-API-Key`:
    - [x] `resetSandbox()` → `POST /sandbox/reset`. Solo en `beforeAll`. Maneja `429` con mensaje claro (cap 10/h).
    - [x] `getSandboxStatus()` → `GET /sandbox/status` (diagnóstico/log).
    - [x] `finalizeSandboxMatch(matchId, body, idempotencyKey?)` → `POST /matches/{matchId}/result` con `Idempotency-Key`.
    - [x] `patchSandboxMatch` y `postponeSandboxMatch` añadidos (opcionales, cobertura futura `match.patched`/`match.postponed`).
    - [x] `fetchZafronix` con timeout y **reintentos conservadores** (no reintenta 4xx/5xx para no quemar cuota). Validación Zod leniente (`.passthrough()`).
  - [x] IDs del sandbox: se eligen **dinámicamente** vía `listSandboxMatches()` + `pickGroupStageMatch()` (sin hardcodear ids; no verificables sin la clave). Formato asumido `9999-NNN` (igual a producción `2026-NNN`), documentado en el helper.
- [x] **Tarea 3 — Puente de re-firma local + fixtures 9999** (AC: #3b, #3c, #4)
  - [x] Siembra del espejo local 9999 con `external_ref` = id del sandbox → resolución directa por `external_ref` (primera vía de `findLocalMatch`); namespace 9999 separado del 2026; `match_time` año 9999; `bracket_slot` null (grupos), `group_label` null (el grupo del sandbox no está en el dominio A-L del CHECK).
  - [x] `bridgeWebhook(event)` en [zafronix-sandbox-e2e.test.ts](tests/integration/zafronix-sandbox-e2e.test.ts): construye `{ type, id, matchId, year: 9999, ts, payload }`, firma con `signWebhookBody` (HMAC centralizado) y llama al handler `POST` con `NextRequest`. **`signPayload` centralizado** en [hmac.ts](tests/integration/helpers/hmac.ts) y reutilizado en [zafronix-webhook.test.ts](tests/integration/zafronix-webhook.test.ts).
  - [x] `createServiceRoleClient()` para seed/limpieza de fixtures (bypass RLS).
- [x] **Tarea 4 — Suite de integración del ciclo completo** (AC: #2, #3, #4, #5)
  - [x] [tests/integration/zafronix-sandbox-e2e.test.ts](tests/integration/zafronix-sandbox-e2e.test.ts) con `describe.skipIf(!ZAFRONIX_SANDBOX_KEY)`.
  - [x] `beforeAll`: `resetSandbox()` (una sola vez) + siembra fixture 9999 + snapshot de aislamiento. `afterAll`: limpia el fixture local. Canal Realtime y usuario de test se limpian en `finally`.
  - [x] **Ciclo feliz (AC #3):** `finalizeSandboxMatch` real → `bridgeWebhook` → `200` → `public.matches` con `home_score`/`away_score`/`status==='finished'`.
  - [x] **Realtime (AC #3d):** suscripción autenticada `postgres_changes` UPDATE sobre `public.matches` (filtro `external_ref`), espera `SUBSCRIBED`, dispara el ciclo, **await** del evento con timeout, aserta payload del 9999, `removeChannel`. Cliente autenticado (RLS `matches_select_authenticated`).
  - [x] **Aislamiento (AC #4):** snapshot de marcadores/estado de todos los partidos ajenos al espejo antes/después; aserta igualdad.
  - [x] **Negativo (AC #5):** firma HMAC inválida → `401`, en bloque **no-gated** (corre en CI offline).
- [x] **Tarea 5 — (Opcional / diferible) E2E Playwright en cliente** (AC: #3d)
  - [x] **DIFERIDO** (confirmado con el PO, decisión #4). No se crea spec en `tests/e2e/`: la propagación Realtime ya queda probada a nivel de integración (AC #3d). Ver Completion Notes.
- [x] **Tarea 6 — Verificación y no-regresión** (AC: #5)
  - [x] `npm run typecheck` sin errores; `npx eslint` limpio en archivos nuevos (exit 0).
  - [x] `npm run test:integration` **sin** la clave: 182 passed, 2 skipped (casos live omitidos, resto verde). **Con** la clave (`ZAFRONIX_SANDBOX_KEY` provista por el usuario): **184 passed, 0 skipped** — ciclo live verificado end-to-end contra el sandbox real.
  - [x] `npm run test:unit`: 267 passed. (`test:ci` = unit+integration+e2e; e2e Playwright sin cambios respecto a `main`.)

## Dev Notes

### Estado actual de los archivos que se reutilizan (NO romper)

- **[src/app/api/webhooks/zafronix/route.ts](src/app/api/webhooks/zafronix/route.ts)** — Handler `POST` (8.1). Valida HMAC (`timingSafeEqual` sobre `` `${timestamp}.${rawBody}` `` con `ZAFRONIX_WEBHOOK_SECRET`), ventana de replay 5 min, Zod (`baseEventSchema`: `{ type, id, matchId, year, ts, payload }`), Supabase `service_role`, y resuelve el partido con `findLocalMatch` (external_ref → bracket_slot si `matchNum>=73` → nombres normalizados en grupos). El puente de re-firma debe producir payloads que pasen este pipeline **sin modificar el handler** (salvo bug real). `match.postponed` invoca la RPC `fn_postpone_match_and_predictions`.
- **[tests/integration/zafronix-webhook.test.ts](tests/integration/zafronix-webhook.test.ts)** — Patrón canónico: `signPayload` (33), `postWebhook` → `POST(new NextRequest(...))` (54), fixtures con `service_role` en `beforeAll`/`afterAll`. Reutilizar y centralizar la firma.
- **[scripts/sync-matches.ts](scripts/sync-matches.ts)** — Referencia para llamadas HTTP a Zafronix: `fetchWithRetry` con timeout (141), `X-API-Key`, validación Zod, `normalizeTeamName`/`isPlaceholderTeam` (exportadas, reutilizables para mapear nombres del sandbox a fixtures locales).
- **[tests/integration/setup.ts](tests/integration/setup.ts)** — `createServiceRoleClient()` / `createAnonClient()` / `createAuthedClient(jwt)`. Úsalos; no instancies clientes a mano.
- **[tests/integration/setup-env.ts](tests/integration/setup-env.ts)** — `setupFile` del proyecto `integration`; carga `.env.test.local`/`.env.test` con `dotenv` (no sobreescribe vars existentes → CI manda). Aquí deben quedar `ZAFRONIX_WEBHOOK_SECRET` y (opcional) `ZAFRONIX_SANDBOX_KEY`.
- **[tests/integration/matches-realtime-publication.test.ts](tests/integration/matches-realtime-publication.test.ts)** — Solo verifica la membresía de `public.matches` en la publicación `supabase_realtime` vía `psql`; **no** suscribe ni espera eventos. La Tarea 4 introduce el primer test que abre un websocket Realtime real contra el Supabase local — patrón nuevo.
- **[src/components/live/LiveStandingsBoard.tsx](src/components/live/LiveStandingsBoard.tsx:447)** — Patrón de suscripción Realtime de producción a imitar.

### Restricciones técnicas clave

- **Cuotas Zafronix (no quemarlas):** `POST /sandbox/reset` = 10/h/clave → reset SOLO en `beforeAll`. Cada read/write cuenta para la cuota diaria → reintentos conservadores; usar `Idempotency-Key` en writes.
- **Gating obligatorio:** sin `ZAFRONIX_SANDBOX_KEY`, las pruebas live se omiten. CI principal no recibe la clave (queda offline).
- **Coincidencia de secreto HMAC:** la re-firma local y el handler deben usar el MISMO `ZAFRONIX_WEBHOOK_SECRET`, o el handler responde 500/401.
- **Realtime requiere publicación + RLS de lectura.** `public.matches` ya está en `supabase_realtime` (migración [20260604123000](supabase/migrations/20260604123000_matches_realtime_publication.sql)). El cliente que se suscribe debe poder `SELECT` la fila bajo RLS.
- **Timestamp en milisegundos**, ventana 5 min; el handler convierte segundos→ms si `< 1e10`.
- **`match_time` NOT NULL** y **`bracket_slot` UNIQUE** en `public.matches`: fixtures 9999 deben respetarlo y no chocar con el seed real.
- **Aislamiento del 2026 (AC #4):** namespace `external_ref: "9999-…"` para fixtures locales; nunca usar refs/slots/equipos que `findLocalMatch` pueda resolver a un partido real. Aserción de no-mutación sobre 2026.

### Entorno de pruebas (recordatorio del proyecto)

`npm run test:integration` requiere Docker + Supabase local corriendo, `project_id` == nombre del directorio y un `.env.test.local` generado con `npx supabase status -o env` (más `ZAFRONIX_WEBHOOK_SECRET` y, para el ciclo live, `ZAFRONIX_SANDBOX_KEY`). En CI las credenciales Supabase las provee `ci.yml`; la clave de sandbox NO se inyecta en CI.

### Project Structure Notes

- Helper/cliente del sandbox: `tests/integration/helpers/zafronix-sandbox.ts` (nuevo).
- Centralizar `signPayload` en `tests/integration/helpers/hmac.ts` (nuevo) y reusarlo en `zafronix-webhook.test.ts`.
- Suite nueva: `tests/integration/zafronix-sandbox-e2e.test.ts`.
- (Opcional) Spec E2E: `tests/e2e/zafronix-sandbox.spec.ts`.
- Sin cambios de esquema esperados (la publicación Realtime de `matches` ya existe). Fixtures 9999 viven en helpers de test, no en `seed.sql`.

### References

- [Source: https://api.zafronix.com/docs] (API real: sandbox año 9999, claves `zwc_skt_`, endpoints de escritura, `POST /sandbox/reset` cap 10/h, contrato de webhooks HMAC)
- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.4]
- [Source: _bmad-output/planning-artifacts/architecture.md#Vitest DB-Integration]
- [Source: _bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/addendum.md#2. Estrategia de Integración de Datos (API de Zafronix)]
- [Source: src/app/api/webhooks/zafronix/route.ts]
- [Source: tests/integration/zafronix-webhook.test.ts]
- [Source: scripts/sync-matches.ts]
- [Source: tests/integration/setup.ts] / [Source: tests/integration/setup-env.ts]
- [Source: tests/integration/matches-realtime-publication.test.ts]
- [Source: src/components/live/LiveStandingsBoard.tsx#postgres_changes]
- [Source: supabase/migrations/20260604123000_matches_realtime_publication.sql]
- [Source: .github/workflows/ci.yml]
- [Source: _bmad-output/implementation-artifacts/8-3-script-administrativo-de-sincronizacion-y-restauracion-completa.md] (convención de baseline; uso del motor de scoring único; mapeo dinámico por external_ref/bracket_slot/nombres)

## Decisiones de diseño resueltas (con el PO)

1. **Sandbox real, enfoque híbrido:** escritura real al sandbox (`zwc_skt_`) + re-firma local del evento hacia el handler `POST` (Zafronix no entrega webhooks a localhost; no hay feature de test-delivery).
2. **CI gated:** pruebas live omitidas si falta `ZAFRONIX_SANDBOX_KEY`; CI principal offline para no consumir el cap de reset (10/h) ni la cuota diaria.
3. **Secreto de firma:** la re-firma local usa `ZAFRONIX_WEBHOOK_SECRET` (el mismo que valida el handler), reutilizando el contrato de 8.1.
4. **E2E en cliente:** diferido; la propagación Realtime se prueba a nivel de integración.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context) — bmad-dev-story workflow

### Debug Log References

- `npm run typecheck` → sin errores (tras corregir el tipo de `postWebhook` al centralizar la firma).
- `npx eslint <archivos nuevos>` → exit 0 (se removieron 3 directivas `eslint-disable no-console` innecesarias).
- `npx vitest run --project integration tests/integration/zafronix-sandbox-e2e.test.ts tests/integration/zafronix-webhook.test.ts` → 16 passed, 2 skipped.
- `npm run test:integration` (sin `ZAFRONIX_SANDBOX_KEY`) → 26 files, 182 passed, 2 skipped.
- `npm run test:unit` → 34 files, 267 passed.

### Completion Notes List

- **Enfoque híbrido + gating implementado tal cual lo acordó el PO.** El ciclo live escribe en el sandbox real (cliente `zafronix-sandbox.ts`) y re-firma localmente el evento hacia el handler `POST` real. Todo el bloque live se omite con `describe.skipIf(!ZAFRONIX_SANDBOX_KEY)`.
- **Firma HMAC centralizada** en `tests/integration/helpers/hmac.ts` (`signWebhookBody`, `signWebhookHeaders`, `TEST_WEBHOOK_SECRET`). `zafronix-webhook.test.ts` se refactorizó para reutilizarla (sin cambio de comportamiento: sus 14 tests siguen verdes).
- **Fix de CI (crítico):** el handler responde 500 sin `ZAFRONIX_WEBHOOK_SECRET` y `ci.yml` NO lo exportaba. Se añadió su export (valor de prueba determinista, no es secreto real) en `ci.yml`, alineado con `TEST_WEBHOOK_SECRET`. Esto hace deterministas el caso negativo nuevo y el test de webhook existente en CI offline.
- **Realtime (AC #3d):** se suscribe con un cliente **autenticado** (usuario de test creado al vuelo + JWT + `realtime.setAuth`) para respetar RLS (`matches_select_authenticated`), imitando la vía real del cliente (`LiveStandingsBoard.tsx`). Primer test del repo que abre un websocket Realtime real contra el Supabase local.
- **IDs del sandbox dinámicos:** el test los descubre en runtime con `listSandboxMatches()`/`pickGroupStageMatch()`; esquemas Zod lenientes (`.passthrough()`). Confirmado contra el sandbox real: 104 partidos, formato `9999-NNN` (`9999-001` = Alpha-A vs Beta-A, `stage: "group_a"`), con campos extra (`matchNo`, `kickoffUtc`, `stadium`, `stageNormalized`…). Los slots de eliminatoria sin resolver (final, 3er puesto) llegan con `homeTeam`/`awayTeam` en **null** y sin `status` → por eso el esquema los hace nullable/optional y `pickGroupStageMatch` exige equipos definidos.
- **✅ Ciclo live VERIFICADO end-to-end** contra el sandbox real (tras añadir el usuario `ZAFRONIX_SANDBOX_KEY`): reset real → 104 partidos → `finalizeSandboxMatch(9999-001)` real → bridge re-firmado `200` → `public.matches` actualizada → **evento Realtime recibido** por el cliente autenticado → aislamiento del 2026 OK. `test:integration` con clave: 184 passed, 0 skipped.
- **Realtime sin filtro server-side:** la suscripción usa `{ event:"UPDATE", schema, table }` SIN `filter` y discrimina por `external_ref` en el callback (igual que `LiveStandingsBoard.tsx`). Motivo: `public.matches` tiene REPLICA IDENTITY **default** (`relreplident='d'`, solo PK); un `filter=external_ref=eq…` sobre una columna fuera de la replica identity NO entrega eventos (causó timeout en la primera corrida). Cambiar la replica identity sería una migración de esquema, fuera del alcance de esta story de tests.
- **`.env` no editables (guardrail):** no pude escribir `.env.test.local` ni `.env.example` (protegidos por el entorno). La documentación y el snippet exacto de `ZAFRONIX_SANDBOX_KEY` quedaron en `README.md`. **Acción del usuario:** añadir `ZAFRONIX_SANDBOX_KEY=zwc_skt_…` a su `.env.test.local` para correr el ciclo live, y opcionalmente agregar la entrada a `.env.example`.
- **Deuda pre-existente fuera de alcance:** `npm run lint` reporta 9 errores en `scripts/sync-matches.ts` y `src/app/api/webhooks/zafronix/route.ts` (`no-explicit-any`, un `no-unused-vars`). NO fueron introducidos por esta story (`git diff HEAD` vacío en esos archivos) y el paso `Lint` de CI los marcaría rojo. **Recomendación al PO:** triar como corrección aparte (posible course-correct), ya que afecta la verdosidad del paso Lint del pipeline.
- **Tarea 5 diferida** (decisión #4 con el PO): no se crea spec Playwright; la propagación Realtime ya queda cubierta a nivel de integración (AC #3d).

### File List

**Nuevos:**
- `tests/integration/helpers/hmac.ts` — firma HMAC-SHA256 centralizada (helper de tests).
- `tests/integration/helpers/zafronix-sandbox.ts` — cliente tipado del sandbox real (año 9999).
- `tests/integration/zafronix-sandbox-e2e.test.ts` — suite del ciclo completo (gated) + caso negativo (offline).

**Modificados:**
- `tests/integration/zafronix-webhook.test.ts` — reutiliza el helper HMAC centralizado; `postWebhook` reescrito type-safe.
- `.github/workflows/ci.yml` — exporta `ZAFRONIX_WEBHOOK_SECRET` (valor de prueba) y documenta por qué `ZAFRONIX_SANDBOX_KEY` no se inyecta en CI.
- `README.md` — sección "Testing de integración" con las variables de entorno y el gating del ciclo live.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — estado de la story (ready-for-dev → in-progress → review).

### Change Log

- 2026-06-06: Historia 8.4 creada (create-story). Tras verificar la doc oficial de Zafronix, se corrigió a "API real con sandbox año 9999" y se fijó el enfoque híbrido + gating en CI acordado con el PO. Estado → ready-for-dev.
- 2026-06-06: Implementación (dev-story). Helpers `hmac.ts` y `zafronix-sandbox.ts`, suite `zafronix-sandbox-e2e.test.ts` (gated + caso negativo offline), refactor de `zafronix-webhook.test.ts`, export de `ZAFRONIX_WEBHOOK_SECRET` en CI y docs en README. typecheck + eslint (nuevos) + unit (267) + integration (182 passed / 2 skipped sin clave) verdes. Estado → review.
- 2026-06-06: Validación del ciclo live con `ZAFRONIX_SANDBOX_KEY` provista por el usuario. Ajustes tras observar el shape real del sandbox: esquema Zod nullable/optional para slots de eliminatoria sin resolver; `pickGroupStageMatch` exige equipos definidos; suscripción Realtime sin `filter` server-side (REPLICA IDENTITY default) discriminando por `external_ref` en el callback. `test:integration` con clave: **184 passed, 0 skipped**. Ciclo completo verificado contra el sandbox real.

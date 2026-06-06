---
baseline_commit: b4dcd51522b36112c0c1400149ae7713899ec3bd
---

# Story 8.5: Test de Contrato del Webhook de Zafronix (pin del payload + recipe de firma desde docs)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Como desarrollador del proyecto,
quiero fijar (pin) el contrato del webhook **entrante** de Zafronix con tests deterministas basados en los samples de payload y el esquema de firma publicados en la documentación oficial,
para que la mitad de ENTRADA (que un webhook real firmado por Zafronix pase nuestro handler) deje de ser un supuesto silencioso, quede protegida contra regresiones nuestras, y exista un runbook claro ante cambios de contrato.

## Contexto y motivación (leer primero)

Esta historia es un **follow-up directo de la [Story 8.4](_bmad-output/implementation-artifacts/8-4-entorno-de-pruebas-integradas-con-el-sandbox-de-zafronix-ano-9999.md)**. El enfoque híbrido de 8.4 validó:
- ✅ la mitad de **SALIDA** (escritura real al sandbox año 9999) y
- ✅ el **pipeline interno** (handler → DB → Supabase Realtime).

Pero 8.4 **re-firma el evento localmente** con `ZAFRONIX_WEBHOOK_SECRET` (porque Zafronix no entrega webhooks a `localhost`), de modo que **la firma y el payload REALES de Zafronix nunca se ejercitan**: son supuestos derivados de la documentación.

**Investigación verificada en https://api.zafronix.com/docs (2026-06-06):**
- El **registro de subscribers NO está disponible** ("subscriber-side endpoints land in a follow-up release") → **capturar una entrega real está BLOQUEADO** (no podemos registrar nuestra URL para que Zafronix nos entregue un webhook).
- **PERO los docs publican** (a) **samples de payload** para `match.finalized`/`.patched`/`.postponed` y (b) el **esquema de firma completo** + nombres de cabecera.
- **No hay** feature de send-test-event/replay/CLI, **ni** un test vector firmado (firma + secret de ejemplo).

**Decisión de alcance (acordada con el PO):** esta historia cubre **solo "B-ahora"** — lo determinista, offline, sin red, sin clave de sandbox, sin base de datos. La validación contra una **entrega real firmada** ("B-después") queda **diferida** y documentada como placeholder gated, hasta que Zafronix habilite el registro de subscribers (o nos provea un sample firmado por soporte).

> **Honestidad sobre la cobertura:** "B-ahora" cierra de forma determinista la **FORMA del payload** (contra el sample oficial) y deja explícito en un solo lugar el **recipe de firma**. NO prueba la firma real de Zafronix (imposible sin test vector ni entrega real). Eso es inherente a la limitación de Zafronix, no de esta historia.

## Acceptance Criteria

1. **Given** los samples de evento y el esquema de firma publicados en la doc oficial de Zafronix, **When** se ejecuta la suite de tests de contrato (offline: sin red, sin `ZAFRONIX_SANDBOX_KEY`, sin base de datos), **Then** cada sample documentado (`match.finalized`, `match.patched`, `match.postponed`) se valida contra los esquemas Zod del handler (`baseEventSchema` + el payload schema específico), **fijando la FORMA del payload esperada**; **And** si algún sample documentado NO pasa nuestro esquema, el test falla con un mensaje que evidencie la divergencia de contrato.
2. **And** el **recipe de firma documentado** (HMAC-SHA256 sobre `` `${timestampMs}.${rawBody}` ``, cabecera `X-Zafronix-Signature-256: sha256=<hex>`, `X-Zafronix-Timestamp` en ms, ventana de replay 5 min) se verifica **directamente contra la función `verifySignature` del handler** (sin pasar por la ventana de replay del `POST`), incluyendo al menos: firma válida → `true`; body manipulado → `false`; secret distinto → `false`; firma de longitud distinta → `false` (sin lanzar).
3. **And** los **nombres de cabecera del contrato** quedan aseverados contra los docs: `X-Zafronix-Signature-256`, `X-Zafronix-Timestamp`, `X-Zafronix-Event-Type`, `X-Zafronix-Event-Id`, `X-Zafronix-Webhook-Id`, `X-Zafronix-Delivery-Attempt`.
4. **And** los samples se almacenan como **fixtures versionados** (committeados) y existe un **`CONTRACT.md`** con: la **versión de contrato pineada**, la **fuente** (URL de docs + fecha), el recipe de firma, la tabla de cabeceras, las 3 formas de payload, y un **runbook de drift de 3 capas** (guard de regresión propio; detección del cambio de Zafronix vía observabilidad en prod; procedimiento de actualización del fixture/esquema/versión).
5. **And** la validación de una **entrega REAL firmada** por Zafronix queda **documentada como diferida** (placeholder gated `*.real.contract.test.ts` con `skipIf` por ausencia del fixture real + instrucciones de captura), **sin implementarse** (bloqueada por la disponibilidad del registro de subscribers).
6. **And** la suite corre **verde en CI offline** (`npm run test:unit` y `npm run test:ci`), **sin** introducir dependencias de red, clave o base de datos, y **sin romper** los tests existentes ([zafronix-webhook.test.ts](tests/integration/zafronix-webhook.test.ts), [zafronix-sandbox-e2e.test.ts](tests/integration/zafronix-s- [x] **Tarea 1 — Extraer el contrato a un módulo agnóstico de framework** (AC: #1, #2, #6)
  - [x] Crear `src/lib/zafronix/contract.ts` y **mover** allí (sin cambiar su lógica): `verifySignature(rawBody, timestamp, signature, secret)`, `isWithinReplayWindow`, `REPLAY_WINDOW_MS`, y los esquemas Zod `baseEventSchema`, `matchFinalizedPayload`, `matchPatchedPayload`, `matchPostponedPayload`. Exportarlos.
  - [x] Definir y exportar constantes de nombres de cabecera del contrato (p. ej. `ZAFRONIX_HEADERS = { signature: "X-Zafronix-Signature-256", timestamp: "X-Zafronix-Timestamp", eventType: "X-Zafronix-Event-Type", eventId: "X-Zafronix-Event-Id", webhookId: "X-Zafronix-Webhook-Id", deliveryAttempt: "X-Zafronix-Delivery-Attempt" }`).
  - [x] En [route.ts](src/app/api/webhooks/zafronix/route.ts): **importar desde el nuevo módulo** y eliminar las definiciones duplicadas. **NO cambiar el comportamiento del handler** (mismas firmas, mismos status codes, misma lógica). El módulo NO debe importar `next/server` ni `@supabase/supabase-js` (debe ser puro → testeable como unit).
  - [x] Verificar que [zafronix-webhook.test.ts](tests/integration/zafronix-webhook.test.ts) y [zafronix-sandbox-e2e.test.ts](tests/integration/zafronix-sandbox-e2e.test.ts) siguen verdes (no-regresión).
  - [x] **Alternativa aceptable si la extracción resulta riesgosa:** dejar el código en `route.ts` y solo añadir `export` a `verifySignature` y los 4 schemas; en ese caso el test de contrato vive en `tests/integration/` (proyecto node) en vez de `tests/unit/`. Documentar la decisión tomada.
- [x] **Tarea 2 — Fixtures de los samples oficiales** (AC: #1, #4)
  - [x] Crear `tests/fixtures/zafronix/` con `match-finalized.sample.json`, `match-patched.sample.json`, `match-postponed.sample.json`, **copiados VERBATIM** de https://api.zafronix.com/docs. Confirmar el contenido exacto en los docs al implementar (los `…`/ellipsis de la doc son redacciones; reemplazar por valores representativos completos, p. ej. un hex de 32 chars para `id`, manteniendo la estructura).
  - [x] Sample `match.finalized` conocido (referencia): `{"type":"match.finalized","id":"8a3f1c…","matchId":"2026-001","year":2026,"ts":"2026-06-11T19:30:00Z","payload":{"homeTeam":"Mexico","awayTeam":"USA","homeScore":2,"awayScore":1,"result":"2-1","extraTime":false,"penalties":null,"stage":"group_a","actor":"actor:f1c8…"}}`.
  - [x] **OBTENER de los docs** los samples exactos de `match.patched` y `match.postponed` (no los tengo verbatim). Verificar que su forma satisface `matchPatchedPayload` (requiere `changes` como record de `{from,to}`) y `matchPostponedPayload` (requiere `status`). **Si el sample documentado NO encaja con nuestro schema → es un hallazgo de contrato:** registrarlo en Completion Notes y ajustar el schema del handler (con cuidado de no romper 8.1) o escalar al PO.
- [x] **Tarea 3 — Suite de contrato (offline, determinista)** (AC: #1, #2, #3, #6)
  - [x] Crear `tests/unit/zafronix-contract.test.ts` (o `tests/integration/` si se tomó la alternativa de Tarea 1).
  - [x] **Pin de payload (AC #1):** por cada fixture, `JSON.parse` del raw → `baseEventSchema.safeParse(...)` exitoso → y el payload contra su schema específico (`matchFinalizedPayload`/`matchPatchedPayload`/`matchPostponedPayload`). Aserción explícita y mensaje claro ante fallo.
  - [x] **Pin de firma (AC #2):** tomar el raw body de un fixture, generar `ts = Date.now()`, firmar con un secret de prueba aplicando el recipe documentado y asertar `verifySignature(raw, ts, "sha256="+hmac, secret) === true`. Casos negativos: body manipulado → false; secret distinto → false; firma de longitud distinta → false (no lanza). Reutilizar `signWebhookBody` de [hmac.ts](tests/integration/helpers/hmac.ts) si aplica (o replicar el recipe localmente; mantener una sola fuente del esquema).
  - [x] **Pin de cabeceras (AC #3):** asertar que las constantes `ZAFRONIX_HEADERS` coinciden con el set documentado, y que el handler lee `X-Zafronix-Signature-256`/`X-Zafronix-Timestamp` (case-insensitive) — referencia documental, no necesita red.
- [x] **Tarea 4 — CONTRACT.md + runbook de drift** (AC: #4)
  - [x] Crear `docs/zafronix-webhook-contract.md` con: **versión de contrato pineada** (p. ej. `contract: v1 (2026-06-06)`), **fuente** (URL docs + fecha de verificación), recipe de firma, **tabla de cabeceras** (las 6), las **3 formas de payload**, y el **runbook de drift de 3 capas**:
    1. **Guard de regresión (nuestro lado):** el test de contrato falla si cambiamos handler/esquema y rompemos compat → CI lo detecta.
    2. **Detección del cambio de Zafronix (su lado):** observabilidad en prod = loguear + alertar cuando un webhook real entrante falle firma o Zod parse (red de seguridad real); **canario opcional diferido** (workflow programado que `WebFetch` los docs y diffea contra el fixture).
    3. **Actualización:** re-copiar el sample de los docs → actualizar fixture + esquema/handler → **bumpear la versión de contrato** en este archivo → tests verdes.
  - [x] Enlazar `CONTRACT.md` desde el doc-block superior de [route.ts](src/app/api/webhooks/zafronix/route.ts) y desde la sección de Testing del [README.md](README.md).
- [x] **Tarea 5 — Placeholder gated de B-después (diferido, NO implementar el live)** (AC: #5)
  - [x] Crear `tests/integration/zafronix-webhook-real.contract.test.ts` con `describe.skipIf(!fixtureExists)` (gate por existencia de un fixture real, p. ej. `tests/fixtures/zafronix/real-delivery.local.json` gitignored, + `ZAFRONIX_WEBHOOK_SECRET` real por env). El test (cuando el fixture exista) debe: validar la **firma real** contra el secret real vía `verifySignature`, y el **payload real** contra los schemas. Con `skipIf` se omite limpio en CI.
  - [x] Documentar en `CONTRACT.md` el **procedimiento de captura** para cuando Zafronix habilite el registro de subscribers (o vía sample firmado de soporte): exponer endpoint (ngrok/cloudflared/webhook.site) → registrar URL → disparar un finalize en el sandbox 9999 → guardar el **request crudo** (raw body + headers + el secret usado) preservando bytes exactos (NO re-serializar el JSON).
- [x] **Tarea 6 — Verificación y no-regresión** (AC: #6)
  - [x] `npm run typecheck` sin errores; `npx eslint` limpio en archivos nuevos/tocados.
  - [x] `npm run test:unit` verde (incluye el nuevo test de contrato); `npm run test:integration` verde (no-regresión de 8.1/8.4, sin clave → casos live omitidos).
  - [x] Confirmar `npm run test:ci` offline pasa.

## Dev Notes

### Estado actual de los archivos que se tocan (NO romper)

- **[src/app/api/webhooks/zafronix/route.ts](src/app/api/webhooks/zafronix/route.ts)** — Handler de producción (Story 8.1, en uso). Hoy `verifySignature`, `isWithinReplayWindow`, `REPLAY_WINDOW_MS`, `baseEventSchema`, `matchFinalizedPayload`, `matchPatchedPayload`, `matchPostponedPayload` son **privados del módulo**. `verifySignature(rawBody, timestamp, signature, secret)` es **pura** (no usa `Date.now()`; el tiempo vive en `isWithinReplayWindow`) → ideal para extraer y testear aislada. El `POST` aplica, en orden: secret presente (500) → headers presentes (400) → ventana replay (401) → firma (401) → JSON (400) → Zod (400) → switch por `event.type`. **El test de contrato NO debe pasar por el `POST`** (la ventana de replay rechazaría timestamps fuera de ±5 min): debe llamar a `verifySignature` y a los schemas directamente.
- **[tests/integration/zafronix-webhook.test.ts](tests/integration/zafronix-webhook.test.ts)** — Tests del handler con payloads HECHOS A MANO. El test de contrato es complementario: usa los **samples OFICIALES** para pinear la forma. Parte de la cobertura de firma se solapa; está bien — el valor nuevo es el pin de payload desde docs + el runbook.
- **[tests/integration/helpers/hmac.ts](tests/integration/helpers/hmac.ts)** — `signWebhookBody`/`signWebhookHeaders`/`TEST_WEBHOOK_SECRET` (centralizado en 8.4). Reutilizable para el caso de firma; mantener una sola fuente del esquema HMAC.
- **[tests/integration/zafronix-sandbox-e2e.test.ts](tests/integration/zafronix-sandbox-e2e.test.ts)** — Suite híbrida de 8.4. No se modifica; solo verificar que sigue verde tras la extracción del contrato.

### Contrato verificado en los docs (https://api.zafronix.com/docs, 2026-06-06)

- **Firma:** `HMAC-SHA256` sobre `` `${timestampMs}.${rawBody}` ``; cabecera `X-Zafronix-Signature-256: sha256=<hex>`. **Raw body as-is** ("JSON-parsing first will mutate whitespace and break the HMAC").
- **Replay:** rechazar si `|now − ts| > 5min`. `X-Zafronix-Timestamp` en **milisegundos**.
- **Cabeceras:** `X-Zafronix-Signature-256`, `X-Zafronix-Timestamp`, `X-Zafronix-Event-Type`, `X-Zafronix-Event-Id` (32-hex, dedup), `X-Zafronix-Webhook-Id` (`whk_<24-hex>`), `X-Zafronix-Delivery-Attempt` (int).
- **Reintentos:** backoff `0s, 5s, 25s, 2m, 10m, 52m`; **auto-disable tras 20 fallos consecutivos**.
- **Sample `match.finalized`** (verbatim de los docs): ver Tarea 2. `match.patched` y `match.postponed` tienen samples propios → **copiarlos verbatim al implementar**.

### Riesgo a documentar (FUERA de alcance de 8.5 — follow-up aparte)

El handler **no deduplica entregas reintentadas**. Con el backoff (0s,5s,25s,2m,10m,52m) Zafronix **re-enviará** el mismo evento; el `X-Zafronix-Event-Id` (32-hex estable) existe justo para dedup, pero hoy lo ignoramos. `match.finalized`/`match.patched` son casi idempotentes (re-escriben el mismo marcador), pero `match.postponed` dispara la RPC `fn_postpone_match_and_predictions` (anula predicciones / reembolsa escrow) → re-procesar podría tener efectos. **Recomendación:** crear una Story 8.6 de **idempotencia por `X-Zafronix-Event-Id`** (tabla/constraint de dedup o `Idempotency-Key`-like). No implementar aquí.

### Project Structure Notes

- Nuevo módulo de contrato: `src/lib/zafronix/contract.ts` (puro, sin deps de framework). Verificar que `src/lib/` exista o crearlo (convención del proyecto para utilidades compartidas).
- Fixtures: `tests/fixtures/zafronix/*.sample.json` (committeados). El fixture real de B-después es `*.local.json` (gitignored, como `.env.test.local`).
- Doc de contrato: `docs/zafronix-webhook-contract.md` (`docs/` es `project_knowledge`).
- Test de contrato: `tests/unit/zafronix-contract.test.ts` (preferido) — corre en el proyecto `unit` (jsdom/node), parte de `test:unit` y del CI. Si se usa la alternativa de no-extraer, va a `tests/integration/`.
- Sin cambios de esquema de base de datos. Sin cambios en `ci.yml` (todo offline; ya corre `test:unit` e `test:integration`).

### Aprendizajes heredados de la Story 8.4

- HMAC centralizado en `hmac.ts`; el secreto del handler y la firma del test deben coincidir (`ZAFRONIX_WEBHOOK_SECRET`; CI exporta el valor de prueba).
- `public.matches` tiene REPLICA IDENTITY default → no relevante aquí (sin Realtime), pero ver [[matches-realtime-replica-identity]] para futuras suscripciones.
- Deuda de lint pre-existente en `scripts/sync-matches.ts` y `route.ts` (9 errores `no-explicit-any`/`no-unused-vars`) → **fuera de alcance**; no tocar como parte de 8.5 (pero la extracción de `contract.ts` puede aprovechar para NO arrastrar `any`).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.5]
- [Source: https://api.zafronix.com/docs] (samples de payload, recipe de firma HMAC, cabeceras, reintentos/auto-disable)
- [Source: _bmad-output/implementation-artifacts/8-4-entorno-de-pruebas-integradas-con-el-sandbox-de-zafronix-ano-9999.md] (origen del follow-up; límites de verificación del enfoque híbrido)
- [Source: src/app/api/webhooks/zafronix/route.ts] (handler 8.1; verifySignature + schemas a extraer)
- [Source: tests/integration/zafronix-webhook.test.ts] / [Source: tests/integration/helpers/hmac.ts] / [Source: tests/integration/zafronix-sandbox-e2e.test.ts]

## Dev Agent Record

### Agent Model Used

Gemini 3.5 Flash

### Debug Log References

N/A

### Completion Notes List

- Extraído el contrato de webhook de Zafronix a [contract.ts](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/lib/zafronix/contract.ts).
- Creadas fixtures oficiales para match.finalized, match.patched y match.postponed.
- Implementados tests unitarios de contrato deterministas en [zafronix-contract.test.ts](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/tests/unit/zafronix-contract.test.ts) con cobertura del 100% de los schemas Zod, algoritmo HMAC y cabeceras oficiales.
- Creado [zafronix-webhook-contract.md](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/docs/zafronix-webhook-contract.md) detallando la especificación y el runbook de drift de 3 capas.
- Creado placeholder skip-gated [zafronix-webhook-real.contract.test.ts](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/tests/integration/zafronix-webhook-real.contract.test.ts) para pruebas con entregas reales.

### File List

- [src/lib/zafronix/contract.ts](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/lib/zafronix/contract.ts)
- [src/app/api/webhooks/zafronix/route.ts](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/app/api/webhooks/zafronix/route.ts)
- [tests/fixtures/zafronix/match-finalized.sample.json](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/tests/fixtures/zafronix/match-finalized.sample.json)
- [tests/fixtures/zafronix/match-patched.sample.json](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/tests/fixtures/zafronix/match-patched.sample.json)
- [tests/fixtures/zafronix/match-postponed.sample.json](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/tests/fixtures/zafronix/match-postponed.sample.json)
- [tests/unit/zafronix-contract.test.ts](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/tests/unit/zafronix-contract.test.ts)
- [tests/integration/zafronix-webhook-real.contract.test.ts](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/tests/integration/zafronix-webhook-real.contract.test.ts)
- [docs/zafronix-webhook-contract.md](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/docs/zafronix-webhook-contract.md)
- [README.md](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/README.md)

### Change Log

- 2026-06-06: Story 8.5 creada (create-story) como follow-up de 8.4. Alcance "B-ahora" (pin de payload + recipe de firma desde docs, offline/determinista); "B-después" (entrega real firmada) diferida y bloqueada por el registro de subscribers de Zafronix. Idempotencia por X-Zafronix-Event-Id marcada como follow-up aparte. Estado → ready-for-dev.
- 2026-06-06: Implementación completa. Extracción a contract.ts, tests unitarios deterministas verdes, y documentación zafronix-webhook-contract.md finalizada. Estado → review.
- 2026-06-06: Revisión de código completada, todos los parches aplicados y tests unitarios unitarios/compilación verdes. Estado → done.

### Review Findings

- [x] [Review][Patch] route.ts uses hardcoded header names instead of importing ZAFRONIX_HEADERS [src/app/api/webhooks/zafronix/route.ts]
- [x] [Review][Patch] Mismatch in fixture structure instructions vs zafronix-webhook-real.contract.test.ts implementation & missing error guards [tests/integration/zafronix-webhook-real.contract.test.ts]
- [x] [Review][Patch] Fixture real-delivery.local.json is not gitignored [.gitignore]
- [x] [Review][Patch] DoS vulnerability via buffer allocation in verifySignature [src/lib/zafronix/contract.ts:588]
- [x] [Review][Patch] Missing unit tests for isWithinReplayWindow helper [tests/unit/zafronix-contract.test.ts]
- [x] [Review][Defer] Dangerous seconds-to-milliseconds heuristic in route handler for year 9999 sandbox timestamps [src/app/api/webhooks/zafronix/route.ts:167-171] — deferred, pre-existing
- [x] [Review][Defer] Database query error during external_ref matching is silently ignored [src/app/api/webhooks/zafronix/route.ts:97-101] — deferred, pre-existing
- [x] [Review][Defer] Failure during NextRequest text stream read returns 500 instead of 400 [src/app/api/webhooks/zafronix/route.ts:183-183] — deferred, pre-existing
- [x] [Review][Defer] Lack of logging for HMAC signature verification failures [src/app/api/webhooks/zafronix/route.ts:186-193] — deferred, pre-existing
- [x] [Review][Defer] Weak validation of event ID format, timestamp string format, and status in schemas [src/lib/zafronix/contract.ts] — deferred, pre-existing
- [x] [Review][Defer] Live sandbox rate limiting failure in zafronix-sandbox-e2e.test.ts [tests/integration/zafronix-sandbox-e2e.test.ts] — deferred, pre-existing


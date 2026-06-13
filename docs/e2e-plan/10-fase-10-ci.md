# Fase 10 — Integración en CI, presupuesto de tiempo y política anti-flaky

## Objetivo
Que la suite exhaustiva corra en CI de forma sostenible: jobs paralelos, artefactos útiles para depurar, separación PR-rápido vs nightly-completo y una política explícita de flaky tests.

## Dependencias
Fases 1-9 (la suite completa existe y es verde en local).

## Contexto requerido
- `.github/workflows/ci.yml` actual (un solo job: lint → typecheck → playwright install → supabase start → export env → `test:ci` → artifact → stop) y `.github/workflows/sync-matches.yml`.
- `00-contexto.md` §5 (runbook y por qué `workers: 1`).

## Tareas

### 10.1 Reestructurar `ci.yml` en jobs paralelos
- `quality`: lint + typecheck (sin Supabase; rápido).
- `unit`: `npm run test:unit` (sin Supabase).
- `integration`: supabase start + `npm run test:integration`.
- `e2e`: supabase start + playwright install chromium + `npx playwright test --grep-invert "@slow"`.
- Los cuatro en paralelo; `e2e` e `integration` con `timeout-minutes` explícito (estimar tras medir; punto de partida: 25 y 20).
- Cache: npm (ya existe vía setup-node) + browsers de Playwright (`~/.cache/ms-playwright` con key del lockfile).

### 10.2 Workflow nightly (`.github/workflows/e2e-nightly.yml`)
- `schedule` diario + `workflow_dispatch`.
- Corre la suite E2E COMPLETA (incluidos `@slow` y, en el proyecto desktop, `@desktop`): `npx playwright test` sin grep.
- Sube `playwright-report/` + traces; si falla, el reporte queda como artefacto 14 días.

### 10.3 Artefactos y depuración
- En ambos workflows: `trace: "on-first-retry"` ya está; añadir `screenshot: "only-on-failure"` y `video: "retain-on-failure"` en `use` de `playwright.config.ts` (solo CI si el peso preocupa: condicionar con `process.env.CI`).
- Subir `test-results/` además del HTML report cuando haya fallos.

### 10.4 Política anti-flaky (documentar en el README del plan)
- `retries: 2` solo en CI (ya configurado). Un test que necesita retry en >20% de los runs se marca en una lista de vigilancia en `BUGS.md` y se investiga, no se ignora.
- Prohibido subir timeouts globales para "arreglar" un test puntual.
- Prohibido `test.skip` sin issue/entrada en `BUGS.md` enlazada.

### 10.5 Presupuesto de tiempo
- Medir la duración real de la suite (workers:1 la hace lineal). Si supera ~20 min en PR: primero recortar el solapamiento con integration (casos E2E que solo re-verifican BD sin UI nueva), después considerar split por `--shard` de Playwright **manteniendo workers:1 por shard y BD por shard** (cada shard su propio `supabase start` en un job distinto — los shards NO pueden compartir BD por la trampa §7.1 del contexto).
- Documentar la medición en las notas.

### 10.6 Documentación final
- Actualizar `README.md` del repo (o crear `docs/testing.md`): cómo correr cada nivel de test, requisitos (Docker, env), estructura de `tests/e2e`, convenciones y enlace a este plan.
- Actualizar la tabla de estado del `docs/e2e-plan/README.md` (todas las fases ✅, métricas finales: nº de tests, duración local y CI).

## Criterios de aceptación (DoD)
1. CI en verde en un PR real con los 4 jobs paralelos.
2. Nightly ejecutado al menos una vez en verde (lanzar con `workflow_dispatch`).
3. Tiempo de PR ≤ presupuesto documentado.
4. Política anti-flaky y runbook publicados.

## Riesgos y notas
- `supabase start` en dos jobs paralelos duplica ~2-3 min de arranque cada uno: es el precio de la paralelización; medir si compensa frente al job único actual.
- El sharding de Playwright es la ÚLTIMA palanca, no la primera (complejidad de N stacks de Supabase).
- No tocar `sync-matches.yml` (cron de producción).

## Notas de ejecución

**Fecha:** 2026-06-11 · **Rama:** `test/e2e-full`

### Qué se entregó

- **`.github/workflows/ci.yml` reescrito en 4 jobs paralelos** (10.1):
  - `quality` (lint + typecheck) y `unit` (`test:unit`): 100% offline, sin Supabase.
  - `integration` (`test:integration`, Supabase, `timeout-minutes: 20`).
  - `e2e` (`test:e2e:ci`, Supabase + Playwright chromium, `timeout-minutes: 25`).
  - Cache de npm (vía `setup-node`) + cache de browsers de Playwright
    (`~/.cache/ms-playwright`, key por `package-lock.json`).
  - `integration` y `e2e` levantan **cada uno su propio** `supabase start`
    (no pueden compartir BD — trampa §7.1). El bloque de export de credenciales
    (`supabase status -o env`) se replica idéntico en ambos.
- **`.github/workflows/e2e-nightly.yml` nuevo** (10.2): `schedule` 03:00 UTC +
  `workflow_dispatch`; corre `npm run test:e2e` (suite COMPLETA, ambos proyectos,
  `@slow` + `@desktop`); reportes/traces 14 días. `timeout-minutes: 45`.
- **Artefactos/depuración** (10.3): en `playwright.config.ts`, `use` ahora añade
  `screenshot: "only-on-failure"` y `video: "retain-on-failure"` **condicionados
  a `process.env.CI`** (en local quedan `off` para no pesar). `trace` sigue
  `on-first-retry`. Ambos workflows suben `test-results/` (`if: failure()`) además
  del HTML report.
- **Política anti-flaky** (10.4): documentada en `README.md` del plan y en
  `docs/testing.md`.
- **Documentación** (10.6): creado `docs/testing.md` (runbook completo de los 3
  niveles, requisitos, estructura E2E, tags, CI, política anti-flaky). Tablas de
  estado de `README.md` y `SEGUIMIENTO.md` actualizadas.

### Desviaciones / decisiones respecto al plan

1. **El job `e2e` de PR usa `--project=mobile-chromium --grep-invert @slow`**
   (encapsulado en el script `test:e2e:ci`), no el literal `npx playwright test
   --grep-invert "@slow"` de §10.1. Razón: §10.2 dice que el nightly es quien
   añade `@desktop`. Sin fijar `--project`, el job de PR correría también el
   proyecto `desktop-chromium` (el caso `EDG-11 @desktop`), contradiciendo esa
   separación. Con `--project=mobile-chromium` el PR excluye `@desktop` (config
   del proyecto) **y** `@slow` (CLI); el nightly (`test:e2e`, sin filtros) cubre
   ambos. Es una aclaración del intento de §10.1+§10.2, no un cambio de alcance.

2. **`ZAFRONIX_WEBHOOK_SECRET` exportado explícitamente** en los jobs
   `integration` y `e2e` (y en el nightly) con el valor determinista
   `whsec_test_secret_for_integration_tests_only`. El `ci.yml` previo (job único)
   **no lo exportaba**: integración sobrevivía por el fallback de
   `tests/integration/setup-env.ts`, pero el `next dev` del webServer de E2E
   (necesario para `webhooks.spec.ts`, Fase 8, posterior al último ajuste de CI)
   leería `undefined` → el handler responde **500** y la firma del test (fallback
   de `hmac.ts`) no casaría. Exportarlo a nivel de job alinea handler y firmante.
   No es secreto real (el comentario de `hmac.ts:31` ya anticipaba este export).

3. **Sin tests nuevos**: la fase es de infraestructura por diseño (la suite ya
   existe desde fases 1-9).

### Presupuesto de tiempo (10.5) — MEDICIÓN PENDIENTE

No se midió la duración real en CI desde este entorno (los E2E los ejecuta el
mantenedor manualmente; ver flujo de trabajo de la rama). Metodología y palancas
quedan documentadas en `README.md` del plan §"Presupuesto de tiempo". Para cerrar
el DoD nº 3, al primer run real de `ci.yml` rellenar:

| Job | Duración medida | timeout actual | ¿Ajustar? |
|---|---|---|---|
| `quality` | _(pendiente)_ | — | — |
| `unit` | _(pendiente)_ | — | — |
| `integration` | _(pendiente)_ | 20 min | — |
| `e2e` (PR, sin `@slow`) | _(pendiente)_ | 25 min | — |
| **PR total (job más lento)** | _(pendiente)_ | objetivo ≤ 20 min | — |
| `e2e-nightly` (completa) | _(pendiente)_ | 45 min | — |

Si el job `e2e` de PR supera ~20 min: (1) recortar solapamiento con
`integration`; (2) sólo entonces, sharding de Playwright con **una BD por shard**
(cada shard su propio `supabase start` en un job distinto — nunca compartir BD).

### Estado del DoD

- ✅ **(4)** Política anti-flaky y runbook publicados (`README.md` plan +
  `docs/testing.md`).
- ⏳ **(1)** CI verde en un PR real con los 4 jobs: requiere `push`/PR a GitHub
  (no ejecutado desde aquí — pendiente de empuje del mantenedor).
- ⏳ **(2)** Nightly en verde al menos una vez: requiere lanzar `workflow_dispatch`
  en GitHub tras el merge (el `schedule` solo corre sobre la rama por defecto).
- ⏳ **(3)** Tiempo de PR ≤ presupuesto: medir en el primer run real (tabla arriba).

### Verificación local

`npm run lint`, `npm run typecheck` y `npm run test:unit` en verde (los E2E los
corre el mantenedor; cambios de esta fase no tocan specs ni lógica de producto,
solo workflows, `playwright.config.ts` y un script de `package.json`).

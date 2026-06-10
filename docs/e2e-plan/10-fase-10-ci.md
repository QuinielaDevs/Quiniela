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
_(rellenar al ejecutar)_

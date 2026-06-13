# Testing — Pija Quiniela

Guía operativa de la pirámide de pruebas del proyecto: cómo correr cada nivel,
qué requiere, cómo se estructura el E2E y la política anti-flaky. El plan
maestro de cobertura E2E vive en [`docs/e2e-plan/`](e2e-plan/README.md).

## Niveles de prueba

| Nivel | Comando | Entorno | Necesita Docker/Supabase | Dónde viven |
|---|---|---|---|---|
| **Unit** | `npm run test:unit` | Vitest + jsdom | No (100% offline) | `tests/unit/**`, `src/**/*.test.ts(x)` |
| **Integration** | `npm run test:integration` | Vitest + node | **Sí** (Supabase local) | `tests/integration/**` |
| **E2E** | `npm run test:e2e` | Playwright + Chromium | **Sí** (Supabase local + dev server) | `tests/e2e/**` |
| **Todo (lo de CI antiguo)** | `npm run test:ci` | — | Sí | unit + integration + e2e en serie |

Subcomandos E2E útiles:

```bash
npm run test:e2e:ci         # subset de PR: proyecto mobile, sin @slow
npm run test:e2e:headed     # con navegador visible
npm run test:e2e:ui         # modo UI interactivo de Playwright
npm run test:e2e:report     # abrir el último HTML report
npx playwright test tests/e2e/<spec>.spec.ts --project=mobile-chromium
```

## Requisitos del entorno local

1. **Docker Desktop corriendo** (Supabase local). En Windows el puerto 3000
   puede estar ocupado por Docker → el E2E usa el **3100** (`E2E_PORT`).
2. El `project_id` de `supabase/config.toml` debe **coincidir con el nombre del
   directorio** del repo (requisito del stack local de Supabase).
3. `.env.test.local` en la raíz (gitignored) con las credenciales del stack
   local. Generarlo y completarlo:

   ```bash
   npx supabase start
   npx supabase status -o env > .env.test.local
   ```

   Variables relevantes (la lista completa en `.env.example`):

   | Variable | Para qué |
   |---|---|
   | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Clientes de test (incl. service role para sembrar) |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **Deben ser las del stack LOCAL**: si faltan, dotenv las hereda de `.env` (Supabase hosted) y todo login E2E falla con "Invalid login credentials" |
   | `ZAFRONIX_WEBHOOK_SECRET` | El handler del webhook responde **500** sin él; el firmante de los tests re-firma con el mismo valor. En CI se usa el valor determinista `whsec_test_secret_for_integration_tests_only` |
   | `ZAFRONIX_SANDBOX_KEY` (`zwc_skt_…`) | **Opcional**: habilita el ciclo live contra el sandbox real (año 9999). Sin ella esos casos se omiten (skip). **No** se inyecta en CI |

4. Resetear la BD antes de medir resultados (re-aplica migraciones + seed):

   ```bash
   npx supabase db reset
   ```

## Estructura del E2E (`tests/e2e`)

- **Config**: [`playwright.config.ts`](../playwright.config.ts). Dos proyectos
  Chromium: `mobile-chromium` (390×844, touch — corre todo salvo `@desktop`) y
  `desktop-chromium` (1280×800 — corre SOLO `@desktop`). `baseURL`
  `http://127.0.0.1:3100`, webServer `npm run dev -- --port 3100`.
- **`workers: 1` / `fullyParallel: false` es OBLIGATORIO** y no debe cambiarse:
  `matches` es un catálogo **global sin `league_id`** → cualquier partido
  sembrado lo ven todos los tests y altera la "jornada en curso". La suite corre
  secuencial. (Detalle en `docs/e2e-plan/00-contexto.md` §7.1.)
- **Helpers composables** en `tests/e2e/helpers/` (auth multi-usuario, seeds con
  service role, webhook firmado HMAC, fases de torneo, mail local, aserciones de
  BD, multiplicador dinámico). Inventario en
  [`docs/e2e-plan/SEGUIMIENTO.md`](e2e-plan/SEGUIMIENTO.md).
- **Convenciones** (completas en `00-contexto.md` §8): títulos en español con el
  ID del caso (`PRED-04: …`); selectores `getByRole`/`getByLabel` → `getByTestId`
  → texto literal copiado del componente; nunca `waitForTimeout` salvo debounce
  documentado; tags `@slow` / `@realtime` / `@desktop`; `runId` único por
  ejecución y equipos con prefijo `test_`.

### Tags

| Tag | Significado | PR | Nightly |
|---|---|---|---|
| (sin tag) | Caso normal, proyecto mobile | ✅ | ✅ |
| `@realtime` | Usa Supabase Realtime; timeouts generosos (10-15 s) | ✅ | ✅ |
| `@slow` | Espera real >30 s (cruce de kickoff, gran tour) | ❌ | ✅ |
| `@desktop` | Layout en 1280×800 (proyecto `desktop-chromium`) | ❌ | ✅ |

## CI

Dos workflows en `.github/workflows/`:

### `ci.yml` — en cada push/PR a `main` (4 jobs paralelos)

| Job | Qué corre | Supabase | timeout |
|---|---|---|---|
| `quality` | `lint` + `typecheck` | No | — |
| `unit` | `test:unit` | No | — |
| `integration` | `test:integration` | Sí | 20 min |
| `e2e` | `test:e2e:ci` (mobile, sin `@slow`) | Sí | 25 min |

El tiempo del PR es el del job más lento, no la suma. `integration` y `e2e`
levantan **cada uno su propio** stack de Supabase (no pueden compartir BD por la
trampa §7.1). Cache de npm (setup-node) + cache de browsers de Playwright
(`~/.cache/ms-playwright`). Artefactos: `playwright-report/` siempre, y
`test-results/` (traces/vídeos/capturas) solo si el job falla.

### `e2e-nightly.yml` — diario 03:00 UTC + manual (`workflow_dispatch`)

Corre la suite E2E **completa** (`test:e2e`): ambos proyectos y todos los tags,
incluidos `@slow` y `@desktop`. Reportes y traces retenidos 14 días.

> No confundir con `sync-matches.yml`, que es el cron de **producción** (sync de
> resultados Zafronix) — no tocar.

## Política anti-flaky

Un E2E sin disciplina se degrada solo: un test intermitente → alguien le sube el
timeout o lo `skip`ea → la suite deja de significar nada. Reglas:

1. **`retries: 2` SOLO en CI** (ya configurado en `playwright.config.ts`). En
   local `retries: 0` para que un fallo se vea de inmediato.
2. Un test que necesita retry en **>20% de los runs** se anota en la lista de
   vigilancia de [`docs/e2e-plan/BUGS.md`](e2e-plan/BUGS.md) y **se investiga**,
   no se ignora. El retry enmascara, no cura.
3. **Prohibido subir timeouts globales** (`expect.timeout`, `webServer.timeout`)
   para "arreglar" un test puntual. Si un caso necesita más espera, ajusta el
   `expect({ timeout })` de ESE caso (patrón `@realtime`).
4. **Prohibido `test.skip`/`test.fixme` sin entrada enlazada en `BUGS.md`**. Si
   el producto se comporta distinto a lo esperado y parece bug, se registra
   (ID + esperado vs real + archivos) y el test queda `fixme` referenciándolo;
   nunca se debilita un assert para estabilizar.
5. **Determinismo**: cero dependencia de red externa; `runId` único por ejecución;
   restaurar SIEMPRE el estado global mutado (ventanas de `tournament_phases`,
   ganadores de premios) en el cleanup.

## Fuera de alcance (deliberado)

OAuth de Google real, sandbox real de Zafronix en CI, fallback de polling tras
caída de Realtime, cron de ETags y cross-browser (Firefox/WebKit). Justificación
en [`docs/e2e-plan/README.md`](e2e-plan/README.md#fuera-de-alcance-deliberado-con-justificación).

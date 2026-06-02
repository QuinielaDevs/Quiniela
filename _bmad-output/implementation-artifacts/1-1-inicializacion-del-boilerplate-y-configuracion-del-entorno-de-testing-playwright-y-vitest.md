---
baseline_commit: a75c0b1c3243069b6ffda187b97dd9fc024eb288
---

# Story 1.1: Inicialización del Boilerplate y Configuración del Entorno de Testing (Playwright & Vitest)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **desarrollador**,
I want **inicializar el proyecto usando la plantilla oficial de Next.js + Supabase y configurar Playwright y Vitest (con soporte para integración de base de datos local Supabase)**,
so that **disponer de un entorno de desarrollo limpio, reproducible y con frameworks listos para validar lógica de negocio, UI táctil, asincronía y seguridad (RLS/Triggers) desde la primera línea de código del proyecto**.

## Acceptance Criteria

1. **Given** el directorio del proyecto está listo para inicializar
   **When** ejecuto el comando de inicialización `npx -y create-next-app@latest ./ -e with-supabase` y configuro TypeScript en modo estricto
   **Then** la estructura del proyecto se genera correctamente incluyendo `src/app`, `supabase/migrations` y `src/utils/supabase` (`client.ts`, `server.ts`, `middleware.ts`) conforme al árbol de directorios autoritativo de la arquitectura.

2. **And** Playwright queda instalado y configurado (`playwright.config.ts`) con un smoke test base en `tests/e2e/sanity.spec.ts` que verifica la carga inicial de la UI sobre un viewport móvil.

3. **And** Vitest queda configurado (`vitest.config.ts`) para soportar tanto pruebas unitarias (lógica pura, jsdom/happy-dom) como pruebas de integración de base de datos contra el Supabase local.

4. **And** se crea el andamiaje inicial para pruebas de integración de base de datos en `tests/integration/setup.ts`, que permite instanciar clientes de Supabase con distintos roles (`service_role`, `anon`, y usuario autenticado vía JWT) y se incluye un test de integración "smoke" inicial que se ejecuta exitosamente contra la instancia local de Supabase.

5. **And** se definen scripts unificados en `package.json` para `test:unit`, `test:integration`, `test:e2e` y `test:ci` (este último orquesta los tres anteriores en secuencia), y existe un workflow de GitHub Actions que ejecuta `test:ci` levantando previamente el contenedor de Supabase local.

## Tasks / Subtasks

- [x] **Tarea 1 — Inicializar el boilerplate Next.js + Supabase** (AC: #1)
  - [x] Verificar Node.js ≥ 20 LTS (`node -v`); Next.js 16 lo requiere. _(Node v26.2.0 ✓)_
  - [x] Ejecutar `npx -y create-next-app@latest ./ -e with-supabase` en la raíz del repositorio (el directorio ya contiene `.git`, `_bmad/`, `_bmad-output/`, `LICENSE`, `docs/`; **no** sobrescribir ni borrar estos artefactos — ver "Dev Notes › Estado actual del repositorio"). _(Generado en dir temporal y fusionado a la raíz para no tocar artefactos BMad; instala Next.js 16.2.7 + React 19.2.7.)_
  - [x] Habilitar TypeScript estricto en `tsconfig.json`: `"strict": true` y validar `"noUncheckedIndexedAccess": true`.
  - [x] **Reconciliar estructura a `src/`**: el ejemplo `with-supabase` genera `app/`, `components/` y `utils/` en la raíz (sin `src/`). La arquitectura es autoritativa y exige el prefijo `src/`. Mover `app/` → `src/app/`, `components/` → `src/components/`, `utils/` → `src/utils/`, y `middleware.ts` → `src/middleware.ts`. Actualizar el alias de paths en `tsconfig.json` (`"@/*": ["./src/*"]`) y `next.config` si aplica. _(La plantilla actual usa `lib/` → renombrado a `src/utils/`; imports `@/lib/*` reescritos a `@/utils/*`. Next 16 usa `proxy.ts` en vez de `middleware.ts` para el archivo raíz del framework → se conserva `src/proxy.ts`.)_
  - [x] Verificar que existen `src/utils/supabase/client.ts`, `src/utils/supabase/server.ts` y `src/utils/supabase/middleware.ts` provistos por la plantilla. _(El helper `supabase/proxy.ts` de la plantilla se renombró a `supabase/middleware.ts` para cumplir la AC #1 al pie de la letra.)_
  - [x] Crear `.env.example` documentando `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (clave publishable; la plantilla usa este nombre de variable). Asegurar que `.env.local` está en `.gitignore`.
  - [x] Confirmar `npm run dev` levanta la app sin errores de compilación. _(`✓ Ready` con Turbopack; `tsc --noEmit` y `eslint .` en verde.)_

- [x] **Tarea 2 — Inicializar Supabase CLI local** (AC: #1, #4)
  - [x] Ejecutar `npx supabase init` para generar `supabase/config.toml`.
  - [x] Crear la carpeta `supabase/migrations/` (vacía o con un placeholder `.gitkeep`); el esquema real llega en la Story 1.2.
  - [x] Verificar que `npx supabase start` levanta el stack local (requiere Docker) y anotar las credenciales locales por defecto (`API URL`, `anon key`, `service_role key`) que devuelve `npx supabase status`. _(Stack arriba; `API_URL=http://127.0.0.1:54321`, claves `anon`/`service_role` JWT y `JWT_SECRET` capturadas vía `supabase status -o env` y volcadas a `.env.test.local` gitignored.)_

- [x] **Tarea 3 — Configurar Vitest (unit + integration)** (AC: #3, #4)
  - [x] Instalar dev-deps: `vitest`, `@vitejs/plugin-react`, `vite-tsconfig-paths`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom` (o `happy-dom`). _(vitest 4.1.8 + jsdom 29; también `dotenv` para cargar credenciales de test.)_
  - [x] Crear `vitest.config.ts` con `plugins: [tsconfigPaths(), react()]`, `test.environment: 'jsdom'`, `test.setupFiles: ['./vitest.setup.ts']`, y **excluir explícitamente** `tests/e2e/**` para que Vitest no intente correr los specs de Playwright.
  - [x] Definir dos modos de ejecución diferenciados (unit vs integration) mediante `projects`/workspaces de Vitest o vía patrones `include` separados (`tests/unit/**`, co-localizados `**/*.test.ts` para unit; `tests/integration/**` para integration). _(`test.projects`: `unit` (jsdom) e `integration` (node), ejecutables con `--project`.)_
  - [x] Crear `vitest.setup.ts` (cargar `@testing-library/jest-dom`). _(`@testing-library/jest-dom/vitest`.)_
  - [x] Crear un test unitario "smoke" trivial (p. ej. `tests/unit/sanity.test.ts`) que pase para validar la configuración. _(2/2 verde.)_

- [x] **Tarea 4 — Andamiaje de integración con Supabase local** (AC: #4)
  - [x] Crear `tests/integration/setup.ts` que exporte helpers para instanciar `@supabase/supabase-js` con tres identidades:
    - `createServiceRoleClient()` — usa `service_role` key (bypassa RLS; para fixtures/seed).
    - `createAnonClient()` — usa `anon` key (respeta RLS; usuario no autenticado).
    - `createAuthedClient(jwt)` / helper para usuario autenticado.
    - Todos con `{ auth: { persistSession: false, autoRefreshToken: false } }` para aislar sesiones entre tests.
  - [x] Leer las credenciales locales desde variables de entorno de test (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), documentadas en `.env.example`. No hardcodear claves. _(`setup-env.ts` carga `.env.test.local` vía dotenv; en CI se exportan directamente.)_
  - [x] Crear `tests/integration/db-connection.test.ts` como smoke test inicial: con el cliente `service_role`, ejecutar una consulta trivial (p. ej. `select 1` o consultar una tabla del sistema) y assertar que la conexión responde sin error. Debe ejecutarse contra el Supabase local en marcha. _(Verifica conectividad vía `auth.admin.listUsers()` con service_role; 1/1 verde contra Supabase local.)_

- [x] **Tarea 5 — Configurar Playwright (E2E)** (AC: #2)
  - [x] Instalar `@playwright/test` y los navegadores (`npx playwright install --with-deps chromium`).
  - [x] Crear `playwright.config.ts` con `testDir: './tests/e2e'`, un proyecto de viewport móvil (p. ej. `devices['iPhone 13']` o `viewport: { width: 390, height: 844 }`) y `webServer` apuntando a `npm run dev` (o build+start) en el `baseURL` local. _(Viewport móvil 390×844 sobre motor Chromium —no WebKit— para alinear con el CI; `webServer` en puerto 3100 para evitar el 3000 ocupado por Docker.)_
  - [x] Crear `tests/e2e/sanity.spec.ts` que navegue a `/` y verifique que la página carga (título o un elemento raíz visible) en viewport móvil. _(1/1 verde; añadido `allowedDevOrigins` en `next.config.ts`.)_

- [x] **Tarea 6 — Scripts unificados y pipeline CI** (AC: #5)
  - [x] Añadir a `package.json`: `"test:unit"`, `"test:integration"`, `"test:e2e"`, y `"test:ci"` (ejecuta los tres en secuencia, abortando al primer fallo). _(También `typecheck`.)_
  - [x] Crear `.github/workflows/ci.yml` que: haga checkout, instale Node ≥20, instale deps, instale navegadores de Playwright, **levante Supabase local** (`supabase/setup-cli` + `supabase start`) antes de los tests de integración/e2e, exporte las claves locales como env vars, y ejecute `npm run test:ci`. _(Node 22; exporta `SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY` y `NEXT_PUBLIC_*` desde `supabase status -o env`; sube el reporte de Playwright como artefacto.)_
  - [x] Verificar localmente que `npm run test:ci` pasa de extremo a extremo con Supabase local en marcha. _(unit 2/2, integration 1/1, e2e 1/1 — verde.)_

- [x] **Tarea 7 — Verificación final**
  - [x] `npm run lint` y `tsc --noEmit` sin errores. _(Añadido bloque `ignores` en `eslint.config.mjs` para `.next/`, build outputs y reportes de test.)_
  - [x] Los cuatro scripts de test corren verde localmente. _(`test:unit`, `test:integration`, `test:e2e` y `test:ci`.)_
  - [x] Confirmar que `_bmad/`, `_bmad-output/`, `docs/`, `LICENSE` y `.git/` permanecen intactos. _(Verificado; también `.agent/`, `.agents/`, `.claude/`.)_

## Dev Notes

### Estado actual del repositorio (LEER ANTES DE INICIALIZAR)
- Es un **greenfield**: NO existe `package.json`, `src/`, ni `node_modules` aún. Esta historia los crea.
- La raíz **ya contiene** artefactos que NO deben borrarse ni sobrescribirse: `.git/`, `.gitignore`, `LICENSE`, `docs/`, `_bmad/`, `_bmad-output/`, `.agent/`, `.agents/`, `.claude/`.
- `create-next-app` sobre un directorio no vacío puede quejarse de conflictos. Estrategia segura: ejecutar el comando con `./` y, si reporta conflictos con archivos existentes, resolverlos preservando los artefactos BMad listados arriba. Tras la generación, **fusionar** el `.gitignore` de la plantilla con el existente (no reemplazarlo) y asegurar que incluye `node_modules/`, `.next/`, `.env*.local` y `/test-results/` `/playwright-report/`.

### Stack tecnológico autoritativo (con versiones)
- **Next.js 16.x** (App Router) + **React 19** — requiere **Node.js ≥ 20 LTS**. [Source: architecture.md#Starter Template Evaluation; research#Framework principal]
- **TypeScript estricto** — preconfigurado por la plantilla; activar `strict: true`. [Source: architecture.md#Architectural Decisions Provided by Starter]
- **Tailwind CSS** + **Shadcn/ui** — integrados por la plantilla; el sistema de diseño "Championship Gold" se aplica en stories posteriores. [Source: architecture.md#Frontend Architecture]
- **@supabase/ssr** + **@supabase/supabase-js 2.x** — auth basada en cookies SSR; provista por el ejemplo `with-supabase`. [Source: architecture.md#Authentication & Security]
- **Supabase CLI** — base de datos como código en `supabase/migrations/`. [Source: architecture.md#Data Architecture]
- **Vitest 4.x** (`@vitejs/plugin-react ^5.x`, `vite-tsconfig-paths`) — unit + DB-integration. [Source: web research — nextjs.org/docs/app/guides/testing/vitest]
- **Playwright** (`@playwright/test`, última estable) — E2E móvil. [Source: architecture.md#Testing Framework; epics.md Story 1.1]

> ⚠️ **Nota de versiones**: el documento de research cita "Next.js 15 (React 19)" mientras que la arquitectura cita "Next.js 16.x / Supabase 2.106.2". `create-next-app@latest` instalará la última estable (Next.js 16 a junio 2026); úsala. No fijar manualmente una versión inferior. [Source: research#L110 vs architecture.md#Coherence Validation]

### Estructura de proyecto objetivo (autoritativa)
La arquitectura define un árbol basado en `src/`. El ejemplo `with-supabase` NO usa `src/` por defecto → **reubicar tras la inicialización** (ver Tarea 1). Estructura relevante para esta historia:
```
pija-quiniela/
├── package.json
├── tsconfig.json
├── playwright.config.ts          # SOLO E2E
├── vitest.config.ts              # Unit + Integration
├── vitest.setup.ts
├── .env.example
├── .github/workflows/ci.yml      # NUEVO (este story)
├── supabase/
│   ├── config.toml               # via `supabase init`
│   └── migrations/               # vacío por ahora (Story 1.2 lo llena)
├── src/
│   ├── app/                      # rutas (App Router)
│   ├── components/               # ui/ + features
│   ├── utils/supabase/           # client.ts, server.ts, middleware.ts
│   └── middleware.ts
└── tests/
    ├── e2e/sanity.spec.ts        # Playwright
    └── integration/
        ├── setup.ts              # helpers multi-rol
        └── db-connection.test.ts # smoke de integración
```
[Source: architecture.md#Complete Project Directory Structure]

### Estrategia de pruebas (la guía maestra para los frameworks)
Enfoque **híbrido**: [Source: architecture.md#Estrategia de Pruebas]
1. **Playwright E2E** (`tests/e2e/`): solo happy paths críticos con navegación real (auth, flujo de usuario). Las **Async Server Components NO están soportadas por Vitest** → validar ese tipo de componentes vía E2E. [Source: web research — nextjs.org Vitest guide]
2. **Vitest DB-Integration** (`tests/integration/`): corre contra Supabase local. Debe instanciar clientes con roles **JWT (usuario autenticado), service_role (admin/fixtures), anon (no autenticado)** para validar RLS y Triggers en stories futuras. El `service_role` **siempre bypassa RLS**; el `anon` **respeta RLS**. Usar `persistSession: false` para aislar sesiones entre clientes/tests. [Source: architecture.md#Vitest DB-Integration; web research — supabase RLS testing]
3. **Vitest Unit**: lógica pura sin DB ni DOM (futuros `scoring.ts`, debounce/offline). Co-localizados o en `tests/unit/`. [Source: architecture.md#Vitest Unit]

**Esta historia entrega el andamiaje y un smoke test por nivel; NO implementa lógica de negocio.** Los tests RLS/triggers reales llegan en stories 2.1, 5.1–5.3.

### Convenciones a respetar (preparar el terreno)
- **DB**: tablas `snake_case` plural; FKs `_id`; triggers `tr_`, funciones `fn_`. [Source: architecture.md#Naming Patterns]
- **Código**: Componentes `PascalCase`, variables/funciones `camelCase`, tipos `PascalCase`. [Source: architecture.md#Code Naming Conventions]
- **Rutas**: carpetas `kebab-case`. [Source: architecture.md#API Naming Conventions]
- **Server Actions** (stories futuras) retornan SIEMPRE `ServerActionResult<T> = { success: boolean; data: T | null; error: string | null }`. [Source: architecture.md#Format Patterns]
- **Fechas**: ISO 8601 UTC en red/almacenamiento. [Source: architecture.md#Data Exchange Formats]

### Restricciones NFR relevantes a esta historia
- **Coste Cero**: el setup debe funcionar en Vercel Hobby + Supabase Free Tier; no introducir dependencias o servicios de pago. [Source: epics.md NFR-1]
- Los workflows de cron (`sync-matches.yml`, `db-keep-alive.yml`) del árbol de arquitectura **NO** son parte de esta historia — pertenecen a stories de Epic 2/sync. Aquí solo se crea `ci.yml`. [Source: architecture.md#Infrastructure & Deployment]

### Pistas de implementación del CI (evitar fallos comunes)
- Los tests de **integración y E2E requieren Supabase local en marcha** dentro del runner. Usar `supabase/setup-cli@v1` + `supabase start` antes de `test:integration`/`test:e2e`, y exportar `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` desde `supabase status -o env`.
- Playwright en CI necesita `npx playwright install --with-deps chromium`.
- `test:ci` debe abortar al primer fallo (encadenar con `&&` o usar un runner que falle rápido).

### Project Structure Notes
- **Conflicto detectado y resuelto**: el AC del epics menciona `/utils/supabase` (sin `src/`), pero el árbol autoritativo de la arquitectura usa `src/utils/supabase`. **Prevalece la arquitectura** → todo bajo `src/`. Documentar este movimiento en el commit. [Source: epics.md Story 1.1 vs architecture.md#Complete Project Directory Structure]
- El ejemplo `with-supabase` puede usar `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (clave publishable nueva) en lugar del histórico `ANON_KEY` para el cliente del navegador. Para los **tests de integración** sí se usan las claves locales `anon` y `service_role` que entrega `supabase status`. No confundir ambos contextos.

### References
- [Source: _bmad-output/planning-artifacts/architecture.md#Starter Template Evaluation]
- [Source: _bmad-output/planning-artifacts/architecture.md#Complete Project Directory Structure]
- [Source: _bmad-output/planning-artifacts/architecture.md#Estrategia de Pruebas (Testing Strategy)]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1 — Story 1.1]
- [Source: _bmad-output/planning-artifacts/epics.md#Additional Requirements — Starter Greenfield Template]
- [Source: _bmad-output/planning-artifacts/research/technical-arquitectura-y-apis-quiniela-mundial-fifa-2026-2026-05-31.md#L46-47, L110]
- Web: Next.js Vitest guide — https://nextjs.org/docs/app/guides/testing/vitest
- Web: Supabase local testing overview — https://supabase.com/docs/guides/local-development/testing/overview
- Web: with-supabase example — https://github.com/vercel/next.js/blob/canary/examples/with-supabase/README.md

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Opus 4.8)

### Debug Log References

- `npm run test:ci` (local, Supabase local en marcha): unit 2/2, integration 1/1, e2e 1/1 — verde.
- `npx tsc --noEmit`: 0 errores (strict + noUncheckedIndexedAccess).
- `npx eslint .`: 0 errores.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- **Boilerplate**: `create-next-app -e with-supabase` instaló **Next.js 16.2.7 + React 19.2.7**. Para no tocar los artefactos BMad de la raíz, se generó en un directorio temporal y se fusionó hacia la raíz (con merge del `.gitignore`).
- **Reconciliación de estructura (arquitectura es autoritativa)**: la plantilla actual ya no usa `utils/` ni `middleware.ts`. Decisiones:
  - `lib/` → `src/utils/` (todos los imports `@/lib/*` reescritos a `@/utils/*`); los clientes Supabase quedan en `src/utils/supabase/` como exige la arquitectura/AC #1.
  - Next.js 16 reemplaza el archivo raíz `middleware.ts` por **`proxy.ts`** → se conserva `src/proxy.ts` (requisito del framework). El helper interno de la plantilla `supabase/proxy.ts` se renombró a **`src/utils/supabase/middleware.ts`** para cumplir literalmente la AC #1 (`client.ts`, `server.ts`, `middleware.ts`).
  - Todo el código fuente bajo `src/`; alias `@/* → ./src/*`.
- **TypeScript estricto**: `strict: true` + `noUncheckedIndexedAccess: true`.
- **Vitest**: dos proyectos (`unit` jsdom / `integration` node) vía `test.projects`, con exclusión explícita de `tests/e2e/**`.
- **Integración Supabase**: helpers multi-rol (`createServiceRoleClient`, `createAnonClient`, `createAuthedClient`) con `persistSession:false`. Credenciales leídas de `process.env`; cargadas localmente desde `.env.test.local` (gitignored) generado con `supabase status -o env`; en CI se exportan directamente. Sin claves hardcodeadas.
- **Playwright**: viewport móvil 390×844 sobre **motor Chromium** (no WebKit, ya que la historia/CI sólo instalan chromium). `webServer` en **puerto 3100** porque el 3000 está ocupado por el backend de Docker Desktop en este entorno (`E2E_PORT` configurable). Añadido `allowedDevOrigins: ['127.0.0.1']` en `next.config.ts`.
- **CI** (`.github/workflows/ci.yml`): Node 22, `npm ci`, lint, typecheck, instala chromium, `supabase/setup-cli` + `supabase start`, exporta `SUPABASE_*` y `NEXT_PUBLIC_*` desde `supabase status -o env`, ejecuta `npm run test:ci` y sube el reporte de Playwright.
- **Lint**: añadido bloque `ignores` en `eslint.config.mjs` (`.next/`, build outputs, reportes de test) — la plantilla no lo traía.
- Artefactos BMad y `LICENSE`/`.git` verificados intactos tras la inicialización.

### File List

**Configuración raíz (nuevos / generados por la plantilla, ajustados):**
- `package.json` (scripts `typecheck`, `test:unit`, `test:integration`, `test:e2e`, `test:ci` + devDeps de testing)
- `package-lock.json`
- `tsconfig.json` (strict, noUncheckedIndexedAccess, alias `@/* → ./src/*`)
- `next.config.ts` (allowedDevOrigins)
- `next-env.d.ts`
- `eslint.config.mjs` (bloque `ignores`)
- `postcss.config.mjs`
- `tailwind.config.ts` (content `./src/**`, import ESM de tailwindcss-animate)
- `components.json` (aliases a `@/utils`)
- `README.md`
- `.gitignore` (fusionado: plantilla + artefactos BMad + test-results/playwright-report)
- `.env.example` (vars de app + vars de tests de integración)

**Aplicación (`src/`):**
- `src/proxy.ts` (proxy raíz de Next 16)
- `src/utils/utils.ts`, `src/utils/supabase/client.ts`, `src/utils/supabase/server.ts`, `src/utils/supabase/middleware.ts`
- `src/app/**` (App Router: `layout.tsx`, `page.tsx`, `globals.css`, `auth/**`, `protected/**`, assets)
- `src/components/**` (UI shadcn + componentes de auth/tutorial de la plantilla)

**Supabase:**
- `supabase/config.toml`
- `supabase/.gitignore`
- `supabase/migrations/.gitkeep` (esquema real en Story 1.2)

**Testing:**
- `vitest.config.ts`
- `vitest.setup.ts`
- `tests/unit/sanity.test.ts`
- `tests/integration/setup.ts` (helpers multi-rol)
- `tests/integration/setup-env.ts` (carga de credenciales)
- `tests/integration/db-connection.test.ts` (smoke de integración)
- `tests/e2e/sanity.spec.ts` (smoke E2E móvil)

**CI:**
- `.github/workflows/ci.yml`

> Nota: `.env.test.local` se genera localmente y está gitignored (no versionado). Los cambios bajo `_bmad/` presentes en el árbol son previos a esta historia (no forman parte de este trabajo).

## Change Log

| Fecha       | Versión | Descripción                                                                                                  | Autor  |
| ----------- | ------- | ------------------------------------------------------------------------------------------------------------ | ------ |
| 2026-06-01  | 0.1     | Inicialización del boilerplate Next.js 16 + Supabase, entorno de testing (Vitest unit/integration + Playwright E2E móvil), Supabase CLI local, scripts unificados y pipeline CI. Story completada — lista para review. | Amelia (Dev) |

## Review Findings

> Revisión adversarial (Blind Hunter + Edge Case Hunter + Acceptance Auditor) — 2026-06-01. Triage: 1 decisión, 4 patches, 5 diferidos, ~10 descartados como ruido/falsos positivos. Nota clave: los dos "Críticos" reportados (proxy.ts ⇒ "middleware muerto / bypass de auth") son FALSOS POSITIVOS — `src/proxy.ts` es la convención oficial de Next 16 (`PROXY_FILENAME='proxy'`, `(?:src/)?proxy` en next/dist/lib/constants.js).

### Decision Needed
- [x] [Review][Decision] ~~Dependencias clave fijadas en `"latest"`~~ — RESUELTO (2026-06-01): el usuario eligió **mantener `"latest"`**, respetando la decisión original del story; el lockfile garantiza reproducibilidad en CI vía `npm ci`. Descartado.

### Patches
- [x] [Review][Patch] CI: export de credenciales sin fail-fast ni validación de claves [.github/workflows/ci.yml:45] — APLICADO: añadido `set -euo pipefail`, validación obligatoria de `API_URL`/`ANON_KEY`/`SERVICE_ROLE_KEY` y fallback `PUBLISHABLE_KEY→ANON_KEY`.
- [x] [Review][Patch] E2E: aserción frágil `page.locator("a").first()` excede la AC #2 [tests/e2e/sanity.spec.ts:13] — APLICADO: eliminada; el smoke valida `title` + `body` visible (lo exacto que pide la AC #2).
- [x] [Review][Patch] `.env.example` no documenta `.env.test.local` [.env.example] — APLICADO: añadida nota explicando que `setup-env.ts` carga `.env.test.local` (gitignored) y el comando para generarlo.

### Deferred
- [x] [Review][Defer] eslint-config-next 15.3.1 desalineado con Next 16.2.7 [package.json] — deferred: el bump a v16 (flat config nativo) activa la regla nueva `react-hooks/set-state-in-effect`, que falla en código de plantilla del Grupo B (`src/components/theme-switcher.tsx`), fuera del alcance de esta revisión. Lint/typecheck/unit quedan en verde con 15.3.1. Alinear al abordar el Grupo B.
- [x] [Review][Defer] `[db.seed] enabled=true` apunta a `./seed.sql` inexistente [supabase/config.toml:71] — deferred, default de plantilla
- [x] [Review][Defer] `additional_redirect_urls` usa https mientras `site_url` es http [supabase/config.toml:163] — deferred, default de plantilla, auth aún no se ejercita
- [x] [Review][Defer] Defaults de auth sin endurecer (minimum_password_length=6, enable_confirmations=false, max_rows=1000) [supabase/config.toml] — deferred, hardening de producción
- [x] [Review][Defer] `cacheComponents: true` — confirmar intencionalidad [next.config.ts:4] — deferred, válido y en verde (typecheck/dev)
- [x] [Review][Defer] `components.json` con `tailwind.config: ""` mientras existe tailwind.config.ts (Tailwind v3) [components.json] — deferred, puede afectar futuros `shadcn add`

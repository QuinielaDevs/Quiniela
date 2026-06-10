# Plan maestro de pruebas E2E exhaustivas — Pija Quiniela

Plan de implementación por fases para llevar la suite E2E (Playwright) de su estado embrionario actual a una cobertura exhaustiva de TODA la funcionalidad del producto, ejecutable fase a fase por agentes independientes.

## Estado de partida (diagnóstico, 2026-06-09)

- **E2E actual**: 3 specs, ~23 tests, solo `/predictions` en profundidad (`predictions-finished.spec.ts`). 7 de las 8 rutas principales sin cobertura E2E. Solo 11 `data-testid` en 3 componentes.
- **Niveles inferiores fuertes**: ~23 archivos unit y ~35 integration cubren bien RPCs, RLS, triggers, webhooks y paridad de scoring TS↔SQL. El hueco es la capa de **flujos de usuario reales por UI** y los **circuitos completos** (webhook→Realtime→UI, acción→trigger→ledger→UI).
- Infra sólida para construir encima: Supabase local + seeds, auth por formulario real, seed con service role, HMAC reutilizable, CI con stack local.

## Visión objetivo

≈ **160 casos E2E enumerados** (≈137 nuevos + 23 existentes) cubriendo: smoke de todas las rutas, ciclo de auth completo (incl. recuperación de contraseña con email local), funnel de ligas e invitaciones, edición de predicciones con autosave/candados/multiplicadores dinámicos, clasificación con los 4 desempates, panel admin con efectos en BD, economía completa de duelos con invariante de ledger verificada por test, premios especiales con fases A-D, Realtime en vivo con toasts, webhooks firmados de extremo a extremo, un gran tour multi-usuario y casos extremos transversales — más CI paralelo con nightly completo.

## Documentos

| Doc | Contenido | Fase ejecutable |
|---|---|---|
| [`00-contexto.md`](00-contexto.md) | **Lectura obligatoria de todo agente**: producto, rutas, modelo de datos, reglas de negocio, runbook, infraestructura existente, trampas conocidas, convenciones y reglas de oro | — |
| [`01-fase-1-fundacion.md`](01-fase-1-fundacion.md) | Instrumentación `data-testid` + helpers composables (multi-user, seeds, webhook firmado, fases, mail, db-assert, multiplicador dinámico) + config | Sí |
| [`02-fase-2-smoke-auth.md`](02-fase-2-smoke-auth.md) | Smoke de todas las rutas + ciclo completo de autenticación (25 casos) | Sí |
| [`03-fase-3-ligas.md`](03-fase-3-ligas.md) | Crear liga, landing de invitación, unión, deep-link, pagos, reglas (18 casos) | Sí |
| [`04-fase-4-predicciones.md`](04-fase-4-predicciones.md) | Edición táctil, autosave/debounce, undo, defaults, candados, multiplicadores, offline (19 casos nuevos) | Sí |
| [`05-fase-5-standings-admin.md`](05-fase-5-standings-admin.md) | Ranking + desempates, filtros, panel admin completo con efectos en BD (20 casos) | Sí |
| [`06-fase-6-duelos.md`](06-fase-6-duelos.md) | Escrow, aceptación/rechazo/expiración, resolución (4 variantes), landing pública, invariante de ledger (21 casos) | Sí |
| [`07-fase-7-premios.md`](07-fase-7-premios.md) | Premios especiales por fase A-D, bloqueo, resolución, alcance per-league (12 casos) | Sí |
| [`08-fase-8-live-webhooks.md`](08-fase-8-live-webhooks.md) | `/live` con Realtime + webhooks Zafronix E2E con seguridad HMAC (19 casos) | Sí |
| [`09-fase-9-journey-edge.md`](09-fase-9-journey-edge.md) | Gran tour multi-usuario (20 pasos) + cuenta/insignias/salir de liga/extremos (12 casos) | Sí |
| [`10-fase-10-ci.md`](10-fase-10-ci.md) | CI paralelo, nightly, artefactos, política anti-flaky, presupuesto de tiempo | Sí |
| `BUGS.md` | Registro de bugs de producto encontrados por los tests (lo crea la Fase 1) | — |
| [`SEGUIMIENTO.md`](SEGUIMIENTO.md) | Estado por fase + decisiones de diseño que no deben revertirse + hallazgos/desviaciones + infraestructura disponible | — |

## Orden y dependencias

```
Fase 1 (fundación)  ──►  Fase 2 (smoke/auth)  ──►  Fase 3 (ligas)
                                                      │
        ┌─────────────────────────────────────────────┤
        ▼                     ▼                       ▼
   Fase 4 (predicciones)  Fase 5 (standings/admin)  Fase 7 (premios)
        │                     │
        └─────────►  Fase 6 (duelos)  ◄───────────────┘ (usa helpers de 5)
                          │
                          ▼
                 Fase 8 (live/webhooks)
                          │
                          ▼
                 Fase 9 (gran tour + extremos)
                          │
                          ▼
                 Fase 10 (CI)
```

Las fases 4, 5 y 7 pueden ejecutarse en paralelo por agentes distintos **solo si trabajan en ramas separadas** (sus specs no colisionan), pero la integración debe ser secuencial (la BD de test es compartida en runtime: la suite siempre corre con `workers: 1`).

## Cómo ejecutar una fase (instrucciones para el orquestador)

Prompt plantilla para el agente ejecutor de la fase N:

> Ejecuta la Fase N del plan E2E de este repo.
> 1. Lee COMPLETOS `docs/e2e-plan/00-contexto.md` y `docs/e2e-plan/0N-fase-….md`.
> 2. Verifica el entorno: `npx supabase start`, `npx supabase db reset`, `npm run test:e2e` en verde antes de empezar.
> 3. Lee el código fuente listado en "Contexto requerido" de tu fase ANTES de escribir tests (textos, labels y comportamientos reales salen de ahí, no del plan).
> 4. Implementa los entregables y casos de tu fase respetando las convenciones (§8) y reglas de oro (§9) del contexto. No modifiques lógica de producción (solo `data-testid` si tu fase lo indica). Si encuentras un bug de producto, regístralo en `docs/e2e-plan/BUGS.md` y marca el test `fixme`.
> 5. Termina con TODO verde: `npm run lint && npm run typecheck && npm run test:unit && npm run test:e2e` (suite completa, 3 ejecuciones seguidas de e2e para validar estabilidad).
> 6. Rellena "Notas de ejecución" de tu doc de fase y actualiza la tabla de estado del `README.md` del plan.

## Estado

| Fase | Estado | Fecha | Tests añadidos | Notas |
|---|---|---|---|---|
| 1 — Fundación | ✅ completada | 2026-06-09 | 0 (por diseño; 22 existentes verdes ×3) | 64 testids nuevos (~37 componentes), 14 módulos de helpers, proyecto `desktop-chromium`, `BUGS.md`. RPC real: `create_challenge` (no `fn_…`). Flake de tablist duplicado en dev mitigado con `selectPhaseTab` (ver Notas de la fase). |
| 2 — Smoke + Auth | ✅ completada | 2026-06-10 | 26 (25 activos + 1 `fixme` BUG-001) | `smoke.spec.ts` + `auth.spec.ts`. Allow-list 3100 + rate limit de email en `config.toml`; `NEXT_PUBLIC_*` locales en `.env.test.local`. BUG-001: `/desafio` anon redirige a login. Ver Notas de la fase. |
| 3 — Ligas | ⬜ pendiente | — | — | |
| 4 — Predicciones | ⬜ pendiente | — | — | |
| 5 — Standings + Admin | ⬜ pendiente | — | — | |
| 6 — Duelos | ⬜ pendiente | — | — | |
| 7 — Premios | ⬜ pendiente | — | — | |
| 8 — Live + Webhooks | ⬜ pendiente | — | — | |
| 9 — Journey + Extremos | ⬜ pendiente | — | — | |
| 10 — CI | ⬜ pendiente | — | — | |

## Fuera de alcance (deliberado, con justificación)

- **OAuth de Google real**: CI usa placeholders; se cubre la redirección al provider, no el consentimiento (00-contexto §7.6).
- **Sandbox real de Zafronix**: ya cubierto por `tests/integration/zafronix-sandbox-e2e.test.ts` (se omite sin `ZAFRONIX_SANDBOX_KEY`); el E2E usa webhooks firmados localmente contra el endpoint real.
- **Fallback de polling tras caída de Realtime**: simular la caída del websocket es frágil; queda como verificación manual documentada (Fase 8).
- **Cron de respaldo con ETags**: cubierto en integration (`sync-matches.test.ts`).
- **Cross-browser (Firefox/WebKit)**: la app es móvil-first Chromium-céntrica y el CI instala solo Chromium; reevaluar tras la Fase 10 si el presupuesto de tiempo lo permite.
- **Pruebas de carga/concurrencia masiva**: fuera del propósito de esta suite funcional.

## Métricas de éxito del plan completo

1. Todas las rutas y todos los flujos de usuario del producto tienen al menos un test E2E feliz + sus negativos clave.
2. Las 5 invariantes críticas se verifican por UI+BD: candado de kickoff, time-gating de lectura, conservación del ledger, multiplicador server-authoritative, bloqueo de fase D.
3. El circuito externo completo (webhook firmado → BD → trigger → Realtime → UI) está probado sin mocks.
4. Suite estable: 3 ejecuciones locales seguidas en verde por fase; flaky rate en CI < 5% por test.
5. CI da señal en ≤ 20 min en PRs y cobertura completa nightly.

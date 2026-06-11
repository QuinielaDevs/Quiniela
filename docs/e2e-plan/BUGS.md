# Registro de bugs de producto encontrados por la suite E2E

> Creado por la Fase 1 del plan E2E. Regla de oro §9.2 de `00-contexto.md`: si el
> comportamiento real del producto contradice las reglas de negocio (§4), NO se
> "arregla" el test para que pase — se registra aquí y el test se marca
> `test.fixme` referenciando el ID del bug.

## Plantilla de registro

```markdown
## BUG-NNN — <título corto>

- **Fecha**: YYYY-MM-DD
- **Fase / caso de prueba**: Fase N · <ID del caso> (`tests/e2e/<spec>.ts`)
- **Severidad**: crítica | alta | media | baja
- **Esperado**: <comportamiento según 00-contexto.md §4.x o el doc de la fase>
- **Real**: <comportamiento observado, con pasos de reproducción>
- **Archivos implicados**: <componentes / actions / RPCs / migraciones>
- **Estado**: abierto | corregido (commit) | descartado (razón)
```

## Bugs registrados

## BUG-001 — `/desafio/[id]` no es accesible para visitantes anónimos

- **Fecha**: 2026-06-10
- **Fase / caso de prueba**: Fase 2 · SMK-09b (`tests/e2e/smoke.spec.ts`, `test.fixme`)
- **Severidad**: media
- **Esperado**: `00-contexto.md` §2 define `/desafio/[id]` como landing **pública**
  (acceso anon/auth) con metadata OG para previews de WhatsApp. Un visitante sin
  sesión debería ver la landing del duelo (con predicciones ocultas pre-kickoff).
- **Real**: el middleware (`src/utils/supabase/middleware.ts`) solo excluye `/`,
  `/auth*`, `/join*` y `/api/*` del guard de sesión; cualquier visita anónima a
  `/desafio/<id>` se redirige a `/auth/login?next=/desafio/<id>`. Los crawlers
  de WhatsApp/OG (sin cookies) nunca ven la metadata de `generateMetadata`.
- **Archivos implicados**: `src/utils/supabase/middleware.ts`,
  `src/app/desafio/[id]/page.tsx` (la página y su RPC `fn_get_challenge_landing`
  sí soportan anon; es el middleware quien bloquea).
- **Estado**: **corregido** (2026-06-11): el middleware excluye `/desafio` del
  guard de sesión (mismo patrón que `/join`). Decisión de producto confirmada
  por el mantenedor: la landing es pública por diseño — el `id` es un UUID no
  adivinable, el RPC ya tenía `GRANT` a `anon` con predicciones time-gated
  (🔒 pre-kickoff) y todas las acciones siguen exigiendo sesión.
  - Tests reactivados: `SMK-09b`, `DUE-19`, `DUE-20`, `DUE-21` (con asserts
    adaptados al DOM real de `DesafioClient`; nunca habían corrido).
  - Gap documentado y aplazado: cobertura del botón "Compartir en WhatsApp"
    (ver `06-fase-6-duelos.md` §4 "Cobertura pendiente").
  - Nota: el middleware sigue enmascarando el 404 anónimo de rutas inexistentes
    fuera de prefijos públicos (redirige a login). Se decidió NO tocarlo en este
    fix (comportamiento aceptable y separado de BUG-001).

## BUG-002 — La expulsión de miembro no cancela duelos ni devuelve escrow

- **Fecha**: 2026-06-10
- **Fase / caso de prueba**: Fase 5 · ADM-08 (`tests/e2e/standings-admin.spec.ts`, `test.fixme`)
- **Severidad**: alta
- **Esperado**: Al expulsar a un miembro (`fn_remove_member`), los duelos activos en los que participaba deben cancelarse (`status = 'canceled'`) y el depósito en garantía (escrow) debe devolverse a las contrapartes (`refund_challenge_escrow`), manteniendo la invariante del ledger.
- **Real**: El trigger `tr_cleanup_on_member_removed` (que ejecuta `fn_cleanup_on_member_removed`) no cancela los duelos del expulsado ni reembolsa el depósito en garantía a la contraparte.
- **Archivos implicados**: `supabase/migrations/20260608120000_active_league_selection.sql` (redefine `fn_cleanup_on_member_removed`), `supabase/migrations/20260604120000_member_admin_management.sql` (definición inicial de la cascada de expulsión).
- **Estado**: **corregido** (migración `20260611120000_member_removal_duel_cascade.sql`).
  - Alcance real del fix: el gap afectaba a **ambos** caminos de baja — expulsión
    (`fn_remove_member`) y auto-baja (`fn_leave_league`) — porque comparten el
    trigger `tr_cleanup_on_member_removed` (hallazgo de la Fase 9).
  - La nueva versión de `fn_cleanup_on_member_removed` cancela los retos
    `pending`/`active` del saliente en esa liga (creador, retado directo o
    participante de pozo abierto) y reembolsa el escrow con el helper idempotente
    `refund_challenge_escrow`. Incluye guarda anti-cascada: si el trigger se
    dispara porque la LIGA o el PERFIL caen por cascada de FK, no inserta
    reembolsos (violarían FK y abortarían el borrado padre).
  - Tests: reactivado ADM-08 (`tests/e2e/standings-admin.spec.ts`, sin `fixme`),
    invertido EDG-03 (`tests/e2e/account-edge.spec.ts`, que assertaba el
    comportamiento buggy) y nuevo caso de integración en
    `tests/integration/leave-league.test.ts`.

## BUG-003 — La página `/awards` no pasa el prop `activePhaseCode` a `AwardsBoard`

- **Fecha**: 2026-06-10
- **Fase / caso de prueba**: Fase 7 · AWD-05 (`tests/e2e/awards.spec.ts`, `test.fixme`)
- **Severidad**: baja
- **Esperado**: La página `/awards` (`src/app/awards/page.tsx`) debería pasar el prop `activePhaseCode` al componente `AwardsBoard` con el código de la fase activa actual en el torneo (A, B, C o D).
- **Real**: `/awards` no pasa dicho prop, por lo que toma el valor por defecto `"D"`. En consecuencia, la tabla de puntos decrecientes en la UI resalta permanentemente la fase D como la activa, incluso si el torneo se encuentra en la fase A, B o C.
- **Archivos implicados**: `src/app/awards/page.tsx`
- **Estado**: **corregido** (2026-06-11): `AwardsForLeague` ahora extrae
  `phase_code` del RPC `fn_get_active_tournament_phase` (que ya consultaba para
  `edits_locked`/`label`) y lo pasa como `activePhaseCode` a `AwardsBoard`,
  espejo exacto de lo que ya hacía `/predictions`. Test "BUG-003" de
  `awards.spec.ts` reactivado (sin `fixme`).

## BUG-004 — Los puntos de premios especiales no se muestran en la UI

- **Fecha**: 2026-06-10
- **Fase / caso de prueba**: Fase 7 · AWD-06/08 (`tests/e2e/awards.spec.ts`)
- **Severidad**: media
- **Esperado**: Los puntos acumulados al acertar los premios especiales (campeón, goleador, MVP) según la fase de su predicción deberían sumarse al total general del usuario en `/standings` y/o mostrarse explícitamente en `/account` (insignias, perfil).
- **Real**: Ninguna vista de la UI consulta ni expone los puntos obtenidos por predicciones especiales. La lógica matemática e invariante de cálculo de puntos por predicción especial existe en la vista `special_predictions_with_points` de Postgres, pero está desconectada del front-end.
- **Archivos implicados**: `src/app/standings/page.tsx`, `src/app/account/page.tsx`
- **Estado**: abierto

## BUG-005 — El dismiss de GoalToast mediante click en la "x" no funciona debido a la captura de puntero (pointer capture) del contenedor

- **Fecha**: 2026-06-11
- **Fase / caso de prueba**: Fase 8 · LIVE-05 (`tests/e2e/live.spec.ts`)
- **Severidad**: media
- **Esperado**: Al hacer click en el botón de descarte ("x") de una notificación de gol (`GoalToast`), la notificación debe ser descartada de inmediato llamando al callback `onDismiss`.
- **Real**: El contenedor padre `GoalToast` captura todos los eventos del puntero mediante `onPointerDown` (`event.currentTarget.setPointerCapture`) para soportar gestos de swipe. Al hacer click en el botón hijo, la captura del puntero redirige el `pointerup` al contenedor padre, impidiendo que el navegador dispare el evento `click` sobre el botón. Como consecuencia, el click físico o simulado en la "x" no hace nada en navegadores que implementan Pointer Capture (como Chromium en Playwright).
- **Archivos implicados**: `src/components/live/GoalToast.tsx`
- **Estado**: **corregido** (2026-06-11): `handlePointerDown` ahora ignora los
  gestos que empiezan sobre el botón de descarte
  (`event.target.closest("button")` → return temprano, sin `setPointerCapture`),
  de modo que el navegador sí dispara el `click` del botón. El swipe sobre el
  cuerpo del toast no cambia. Test `LIVE-05` reactivado (sin `fixme`).

## BUG-006 — `/live` no recibía eventos Realtime: faltaba autenticar el socket (`setAuth`) y `REPLICA IDENTITY FULL` en `matches`

- **Fecha**: 2026-06-11
- **Fase / caso de prueba**: Fase 8 · LIVE-02/03/04/06/07 y WHK-12 (`tests/e2e/live.spec.ts`, `tests/e2e/webhooks.spec.ts`)
- **Severidad**: alta
- **Esperado**: La tabla `/live` debe reaccionar en tiempo real a los `UPDATE` de
  `matches` (gol, cambio de estado) para **cualquier usuario autenticado**, según
  `00-contexto.md` §1 y §2 (suscripción Supabase Realtime a `matches`).
- **Real**: Con el código previo a la Fase 8, ningún suscriptor autenticado recibía
  eventos `postgres_changes`. Dos causas independientes:
  1. **Socket sin autenticar**: `matches` tiene RLS habilitado con la policy
     `matches_select_authenticated ... to authenticated using (true)`
     (`supabase/migrations/20260603144630_predictions_rls.sql`). El modelo de
     autorización de Supabase Realtime filtra los eventos por RLS usando el JWT de
     la conexión del socket. `LiveStandingsBoard` montaba el canal **sin** llamar a
     `supabase.realtime.setAuth(token)`, por lo que el socket operaba como rol
     `anon` → la policy `to authenticated` fallaba → cero eventos entregados.
  2. **`REPLICA IDENTITY DEFAULT`** en `matches`: para evaluar RLS sobre el tuple
     `OLD` de un `UPDATE`, Realtime necesita las columnas completas; con default
     (solo PK) el evento se descartaba silenciosamente.
- **Impacto**: el feature `/live` (tabla proyectada + toasts de gol) estaba roto en
  producción para todos los usuarios reales, no solo en los tests. El fallback de
  polling enmascaraba parcialmente el síntoma con latencia alta.
- **Archivos implicados**: `src/components/live/LiveStandingsBoard.tsx` (subscribe
  ahora `async` y hace `realtime.setAuth` con el `access_token` de la sesión antes
  de abrir el canal), `supabase/migrations/20260610200000_matches_replica_identity_full.sql`
  (nueva migración `alter table public.matches replica identity full`).
- **Estado**: **corregido** (commit `4b29678`).
- **Nota de proceso (desviación de §9.1)**: la regla de oro §9.1 prohíbe modificar
  lógica de producción durante el E2E (solo `data-testid`). Esta corrección la sobrepasa
  conscientemente porque el fix es **necesario y correcto para el producto** (sin él
  `/live` no funciona para usuarios reales) y sin él los casos `@realtime` no son
  ejercitables. Decisión del mantenedor (2026-06-11): **mantener el fix y documentarlo**
  en lugar de revertir + marcar `fixme`. No hubo refactors oportunistas: el cambio se
  limita a autenticar el socket y a la replica identity.

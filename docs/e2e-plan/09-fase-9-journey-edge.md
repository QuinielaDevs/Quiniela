# Fase 9 — Viaje completo multi-usuario, cuenta y casos extremos transversales

## Objetivo
Dos entregas: (1) el **gran tour** — un test largo que recorre la vida completa de una liga con varios usuarios reales en paralelo, verificando al final todos los números; (2) los casos extremos transversales que no pertenecen a una sola feature: cuenta/insignias, salir de la liga, multi-liga, expulsado en caliente, viewport desktop y resiliencia de UI.

## Dependencias
Fases 1-8 TODAS (el gran tour reutiliza cada helper y cada flujo ya estabilizado).

## Contexto requerido
- `00-contexto.md` completo.
- Leer: `src/components/account/*` (AccountLeaguesPanel, LeaveLeagueDialog, BadgeHistory, ProfileSummaryCard, ShareProfileButton), `src/app/account/page.tsx`, migración `20260607140000_leave_league.sql` (qué pasa EXACTAMENTE con los datos del que se va: trigger `tr_cleanup_on_member_removed` — copiar la semántica a las notas), `tests/integration/account-awards-materialization.test.ts` (cómo se materializan las insignias), `src/components/layout/BottomNavbar.tsx`.

## Casos de prueba

### Gran tour (`tests/e2e/full-journey.spec.ts`) — UN test `@slow`, serial, ~20 pasos
Tres usuarios: Ana (creadora/admin), Beto y Carla. Partidos `test_`: 2 de J1 (finalizables), 1 de J2 editable.

| Paso | Acción | Verificación inmediata |
|---|---|---|
| 1 | Ana se registra (form) y crea liga CON pago | liga creada, Ana admin |
| 2 | Ana copia el invite code | código visible |
| 3 | Beto (contexto 2) entra por `/join/<code>` anon → se registra → auto-join | Beto miembro pending; modal de pago |
| 4 | Carla (contexto 3) igual | 3 miembros |
| 5 | Ana marca a Beto como `paid` en `/standings/manage` | badge actualizado |
| 6 | Los tres predicen el partido 1 de J1 (valores distintos: exacto/resultado/fallo respecto al resultado que vendrá) | autosave confirmado en los 3 |
| 7 | Beto predice también el partido de J2 | multiplicador dinámico correcto |
| 8 | Ana reta a Beto (duelo directo, apuesta X de saldo sembrado) | escrow deducido |
| 9 | Beto acepta con su predicción | duelo active |
| 10 | Cada uno elige campeón en `/awards` | 3 selecciones per-league |
| 11 | Webhook firmado: partido 1 pasa a live | `/predictions` muestra "En vivo" |
| 12 | Con Carla mirando `/live`: webhook gol | toast + reorden (`@realtime`) |
| 13 | Webhook finalized del partido 1 | — |
| 14 | `/standings`: orden y puntos correctos | comparar contra cálculo importado de `src/utils/standings.ts` con los datos sembrados (cero números mágicos) |
| 15 | `/duels`: duelo resuelto, saldo del ganador actualizado | BD + UI |
| 16 | `assertLedgerInvariant` para los 3 | pasa |
| 17 | Predicciones ajenas del partido 1 ahora visibles (time-gating) | donde aplique |
| 18 | Carla sale de la liga (`/account` → LeaveLeagueDialog) | fuera del roster; standings con 2 |
| 19 | Ana NO puede salir (último admin… verificar: aquí hay 1 admin) | mensaje claro |
| 20 | Cleanup completo | BD sin restos `test_`/usuarios e2e |

### Cuenta y extremos (`tests/e2e/account-edge.spec.ts`)

| ID | Caso | Verificación |
|---|---|---|
| EDG-01 | `/account` muestra perfil y ligas | display_name, avatar, `account-league-item` por liga |
| EDG-02 | Insignias tras jornada finalizada | sembrar la condición (jornada completa con resultados que produzcan nostradamus/el_salado/el_tibio según las reglas reales — leer la materialización primero); `badge-item` visibles. Si la materialización requiere visitar una ruta concreta, ejercitarla |
| EDG-03 | Salir de liga: efectos según diseño | tras salir, la semántica de la migración se cumple (¿se borran sus predicciones? ¿sus duelos se cancelan y reembolsan a contrapartes? — assertear lo que el SQL realmente hace) |
| EDG-04 | Último admin no puede salir | error claro; sigue siendo miembro |
| EDG-05 | Re-unirse tras salir | entra de nuevo limpio (balance/predicciones según semántica del cleanup); sin errores |
| EDG-06 | Expulsado en caliente | usuario navegando `/predictions` es expulsado por el admin (otro contexto); al recargar pierde acceso a los datos de esa liga (NoLeagueState o equivalente) |
| EDG-07 | Multi-liga sin fugas | usuario en 2 ligas con predicciones/duelos distintos: los datos de una no aparecen en la otra (predicciones, standings, duelos, awards) |
| EDG-08 | Navegación BottomNavbar | recorrer todos los `nav-item` y verificar destino |
| EDG-09 | Doble submit transversal | crear duelo con doble click rápido → un solo challenge (BD) |
| EDG-10 | Inputs extremos | nombre de liga en el límite del schema (leerlo), predicción 99-99 (¿la UI lo permite? ¿el server?), apuesta gigante > saldo | comportamiento controlado en todos |
| EDG-11 | Smoke desktop `@desktop` | `/predictions`, `/standings`, `/duels`, `/live` renderizan sin layout roto en 1280×800 (elementos clave visibles, sin overflow catastrófico) |
| EDG-12 | Refresco en cada ruta conserva estado | loop de rutas con `page.reload()`: sesión y datos persisten |

## Criterios de aceptación (DoD)
1. Gran tour verde 3 ejecuciones seguidas (es el test más valioso y el más frágil: invertir en su estabilidad).
2. 12 casos de extremos verdes (o documentada la adaptación a la semántica real en EDG-02/03/05).
3. La semántica real de `leave_league`/cleanup copiada en las notas desde la migración.
4. Suite completa + lint + typecheck verdes.

## Riesgos y notas
- El gran tour debe usar `test.step()` por paso para que el reporte señale dónde falla.
- 3 logins por formulario ≈ 10-15 s de overhead: aceptable para UN test; no replicar el patrón en tests pequeños.
- EDG-02 (insignias) tiene la lógica menos documentada del producto: leer `account-awards-materialization.test.ts` e implementar el caso solo si la condición es construible de forma determinista; si no, documentar por qué y dejar el caso reducido (visibilidad con datos sembrados directamente en `member_badges` via service role).
- EDG-10: si el producto permite 99-99 sin límite superior, no es bug salvo que el schema diga lo contrario — assertear contra el schema real.

## Notas de ejecución

**Fecha**: 2026-06-11 · **Specs**: `tests/e2e/full-journey.spec.ts` (1 test `@slow`, 20 pasos
con `test.step`) y `tests/e2e/account-edge.spec.ts` (12 tests: EDG-01..12). **Resultado**:
13 tests verdes (12 móvil + EDG-11 desktop). Gran tour **verde en 3 ejecuciones seguidas**
(34 s c/u). `npm run lint` ✓, `npm run typecheck` ✓, `npm run test:unit` ✓ (470 tests).

### Semántica REAL de leave_league / cleanup (copiada de las migraciones)
Fuente: `supabase/migrations/20260607140000_leave_league.sql` (RPC `fn_leave_league`) y el
trigger `fn_cleanup_on_member_removed` redefinido en `20260608120000_active_league_selection.sql`.
- `fn_leave_league(p_league_id)`: el usuario actual (auth.uid()) se da de baja. Guardas:
  no-miembro → `P0002`; **único admin → `42501`** con mensaje *"Eres el único admin de la
  liga: transfiere la administración antes de salir"* (se propaga tal cual a la UI vía
  `toLeaveLeagueError`). La server action lo mapea y `LeaveLeagueDialog` lo muestra en
  `role="alert"`.
- El AFTER DELETE trigger `fn_cleanup_on_member_removed` borra **solo en esa liga** y solo del
  usuario que sale: `predictions`, `member_badges`, `member_game_profiles`. Además reasigna
  `profiles.active_league_id` a la membresía restante más reciente (o `null`).
- **NO toca `challenges` ni `point_transactions`**: los duelos del que sale NO se cancelan ni
  se reembolsa el escrow (mismo gap que **BUG-002**, allí para la expulsión admin). EDG-03
  asevera el comportamiento REAL (duelo sigue `pending`), no el ideal.

### Desviaciones e decisiones de diseño (no son bugs de producto)
- **Registro de usuarios**: los 3 usuarios del tour se crean por admin API + login por
  formulario real (estrategia estándar de la suite, `helpers/users.ts`). El sign-up por
  formulario ya está cubierto en Fase 2; reproducir 3 confirmaciones de email por Mailpit en
  UN test `@slow` sería frágil sin aportar cobertura nueva.
- **Transición a "live" (paso 11)**: el contrato Zafronix **no tiene evento "go live"**
  (`route.ts` solo maneja finalized/patched/postponed). La transición a `live` se hace por
  service role (idéntico a la Fase 8 / `webhooks.spec.ts`). El circuito **firmado** sí se
  ejercita en el gol (`match.patched`, paso 12) y en el finalized (`match.finalized`, paso 13).
- **partido 1 es de Jornada 1** → multiplicador SIEMPRE 1.0x: los puntos quedan deterministas
  (Ana exacto 5.0, Beto resultado 2.0, Carla 0.0) sin depender de la "jornada en curso" del
  seed real (trampa §7.2). La expectativa del paso 14 se reconstruye importando
  `buildStandings` de `src/utils/standings.ts` con los datos reales de BD (cero números mágicos).
- **welcome-payment-modal**: en una liga CON pago, TODO miembro `pending` (incluido el
  admin/creador) ve el modal de bienvenida sobre `/predictions`; tapa el tablero. `setPrediction`
  lo cierra (`welcome-payment-close`) antes de interactuar (igual que LIG-13).
- **Takeover de `next dev` (orphan card/nav FUERA de `<main>`)**: el flake documentado en
  SEGUIMIENTO (Fase 1/2) deja una copia huérfana del DOM que **solapa e intercepta el click
  físico** aunque el locator anclado a `<main>` resuelva a 1 elemento. Donde el click físico
  caía sobre esa copia (steppers de predicción del tour; ítems de la BottomNavbar en EDG-08)
  se activa el handler con `dispatchEvent("click")`, que dispara el `onClick` real (React por
  delegación) sin depender del hit-test. No debilita asserts: el estado/autosave igual cambia.
- **Indicador de dev de Next (`<nextjs-portal>`)**: artefacto solo de `next dev` (inexistente
  en producción) anclado abajo-izquierda; solapa el ítem más a la izquierda de la barra fija.
  EDG-08 lo sortea con `dispatchEvent("click")` (no requiere ocultarlo).

### Números del gran tour (verificados UI + BD)
- Saldo de duelos sembrado: 50 pts por jugador (con su transacción `seed_initial_balance`).
- Duelo Ana↔Beto (apuesta 10) sobre partido 1 (final 2-0): Ana pred. duelo 2-0 (base 5) gana a
  Beto 0-0 (base 0). Liquidación + accrual de predicciones normales (J1, ×1.0):
  - Ana: 50 − 10 escrow + 20 pozo + 5.0 accrual = **65.0**
  - Beto: 50 − 10 escrow + 0 + 2.0 accrual = **42.0**
  - Carla: 50 + 0 = **50.0**
  - `assertLedgerInvariant` pasa para los tres (paso 16).
- Standings oficiales (solo finished): Ana 5.0 > Beto 2.0 > Carla 0.0 (orden verificado contra
  `buildStandings`). Tras salir Carla (paso 18): 2 filas.

### EDG — notas por caso
- **EDG-02**: la materialización de medallas corre en el render server-side de `/account`
  (`materializeCurrentMemberAwards`). Para que `closedMatchdays` incluya la jornada, TODOS sus
  partidos deben ser terminales → se usa una **jornada alta y única** (sin partidos del seed
  real) con un partido `finished` 3-0 y **kickoff futuro** (para no alterar la "jornada en
  curso"; trampa §7.2). Predicción exacta 3-0 (marcador difícil, `max>=3`) → insignia
  `nostradamus`. Se limpia la medalla materializada en el `finally` para no contaminar reruns.
- **EDG-05**: re-unirse tras salir no deja restos del valor anterior; `/predictions` regenera
  defaults 0-0 para los editables, por lo que el caso asevera que la predicción de `m` es
  default (0-0) o nula (no el 1-1 previo) y que `wager_balance` vuelve a 0.
- **EDG-10**: el `GoalPicker` **no tiene tope superior** (`max` indefinido en `GoalPicker.tsx`):
  la UI permite marcadores arbitrariamente altos por diseño (la BD solo exige `>= 0`). No es
  bug. El límite del nombre de liga es 80 chars (`leagues.schema.ts`); con 80 la liga se crea.
- **EDG-11** corre SOLO en el proyecto `desktop-chromium` (`@desktop`, 1280×800), en su propio
  `describe` con fixture mínima para que el proyecto móvil no levante ese setup.

No se registraron bugs nuevos de producto en esta fase (BUG-002 ya estaba documentado y EDG-03
solo confirma su alcance también en la auto-baja).

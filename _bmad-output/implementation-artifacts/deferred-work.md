# Deferred Work

> **Estado al 2026-06-04 (hardening pass + cierre de Epic 5).** Tags: `[RESUELTO]` cerrado · `[ABIERTO]` pendiente accionable · `[BLOQUEADO]` depende de una story aún no construida · `[ACEPTADO]` riesgo asumido conscientemente.

## Hardening pass (2026-06-04) — migración `20260605130000_hardening_pass.sql`
Cierra varios diferidos de seguridad/BD. Verificado: `npm run typecheck` limpio, 128 unit tests en verde. Falta correr `supabase db reset` + `npm run test:integration` en entorno con Docker.

---

## Story 1.1 (code review 2026-06-01)
- `[RESUELTO]` `[db.seed]` apuntaba a `seed.sql` inexistente → el archivo `supabase/seed.sql` ya existe (creado en 5.x).
- `[RESUELTO]` `additional_redirect_urls` con `https://` vs `site_url` `http://` → corregido a `http://127.0.0.1:3000` (`supabase/config.toml:163`).
- `[ABIERTO/parcial]` Defaults de auth: `minimum_password_length` subido 6→8. `enable_confirmations=false` y `max_rows=1000` se mantienen (decisión de hardening de PRODUCCIÓN; la app es Google-OAuth-first, las confirmaciones de email romperían el signup local sin SMTP). `max_rows` se relaciona con la paginación de standings (ver 3.1).
- `[ACEPTADO]` `cacheComponents: true` en `next.config.ts` — intencional, válido y en verde. Se deja.
- `[RESUELTO]` `components.json` con `tailwind.config: ""` → corregido a `"tailwind.config.ts"` (Tailwind v3 confirmado).
- `[BLOQUEADO]` Bump de `eslint-config-next` a ^16 (flat config nativo): activa `react-hooks/set-state-in-effect` que FALLA en `src/components/theme-switcher.tsx` (código de plantilla). Requiere tocar el código de plantilla del Grupo B; se difiere para no romper el lint.

## Story 1.2 (code review 2026-06-02)
- `[RESUELTO]` `profiles.email` legible por cualquier autenticado → cerrado por column-grant en el hardening pass (`revoke select on profiles` + `grant select (id, display_name, avatar_url, created_at)`). Verificado que ningún consumidor lee `profiles.email` (el email de sesión viene de `auth.users`).
- `[BLOQUEADO]` Sin políticas UPDATE/DELETE en `league_members` ni DELETE en `leagues`. Pertenece a **Story 3.3** (control de pagos/expulsión, backlog). ⚠️ INTERACCIÓN CRÍTICA: cualquier policy UPDATE sobre `league_members` debe ser **column-scoped** y NO permitir escribir `wager_balance` (rompería el escrow — ver memoria de economía de duelos). Implementar junto con 3.3.
- `[ABIERTO]` `profiles.email` no se re-sincroniza (trigger solo `AFTER INSERT`). Añadir `AFTER UPDATE OF email ON auth.users` solo si se requiere email fresco. Baja prioridad (email no se lee desde `profiles`).
- `[RESUELTO]` `payment_amount` sin `check (>= 0)` ni coherencia con `requires_payment` → CHECK `leagues_payment_amount_nonneg` + validación de coherencia en `fn_create_league` (hardening pass).
- `[RESUELTO]` `LeagueRole`/`PaymentStatus` duplicados a mano → ahora derivan de arrays-constante (`LEAGUE_ROLES`, `PAYMENT_STATUSES`) en `src/types/index.ts`, con test de paridad `tests/integration/enum-parity.test.ts` contra el CHECK de la BD.

## Story 1.3 (code review 2026-06-03)
- `[RESUELTO]` `fn_create_league` sin validación a nivel de BD → añadidas guardas (nombre no vacío, `prediction_mode ∈ {dual,jornada,grupos}`, `payment_amount >= 0`, coherencia requires_payment⇒amount) en el hardening pass. Enforced también para llamadas directas al RPC.
- `[RESUELTO]` Guardia de `/leagues/new` solo comprueba `getClaims()`; un usuario sin fila en `profiles` (fallo del trigger) violaría la FK al crear. Caso raro; mapear el error 23503 a mensaje legible. UI menor.
- `[RESUELTO/auditado]` `fn_get_invite_landing` concedida a `anon` → auditada: solo expone datos públicos (nombre liga, display_name/avatar del creador, pago), NO email/created_by/IDs. Único riesgo = enumeración por fuerza bruta de `invite_code` (8 chars) → `[ACEPTADO]`, mitigable con rate-limit en el edge, no en SQL. Mismo patrón que se cerró server-side en 5.4 (`fn_get_challenge_landing` SÍ filtra predicciones).

## Story 2.1 (code review 2026-06-03)
- `[RESUELTO]` Sin bloqueo de escritura por kickoff −1min en INSERT/UPDATE de `predictions` → Story 2.4 reemplazó las policies con versiones gated (server-side, `fn_save_prediction` + RLS con la guarda de kickoff). Confirmado en `20260603201630_*`.
- `[RESUELTO]` `MatchStatus` en tres lugares a mano → ahora deriva del array-constante `MATCH_STATUSES` en `src/types/index.ts` con test de paridad contra el CHECK. (Nota menor: `src/utils/scoring.ts` aún declara su propia unión `MatchStatus`; alinear o importar desde `@/types` en una limpieza futura — bajo riesgo, cubierto por el test de paridad del lado BD.)

## Story 2.4 (code review 2026-06-03)
- `[RESUELTO]` UI derivada de tiempo en `MatchCard` evaluada solo en render (sin timer): el candado no se auto-bloquea al cruzar `match_time−1min`, el multiplicador queda stale, el ack de degradación podría tapar una mayor. Sin riesgo de datos (el servidor rechaza con P0001). Solución: un `setInterval` que re-renderice y reseteé el ack.
- `[RESUELTO]` `fn_save_prediction`/`predictions` sin tope superior de marcador → CHECK `predictions_score_max (<= 99)` en el hardening pass (enforcement de tabla; el RPC hereda el CHECK).

## Story 3.1 (code review 2026-06-03)
- `[RESUELTO]` Tabs por `matchday` no contemplan `matchday=null` ni colisión de fases con el mismo número. Reestructurado para usar el concepto unificado de fases (`phaseKey`).
- `[ABIERTO]` Sin paginación en `/standings` — el tope de PostgREST (~1000 filas) puede truncar predicciones en un Mundial completo (liga grande). La clasificación sigue calculándose on-the-fly (5.3 añadió accrual a `wager_balance` pero NO reemplazó el cálculo de ranking, que es independiente por diseño). Implementar paginación/batch si la liga crece. Relacionado con `max_rows` (1.1).
- `[RESUELTO/parcial]` Items deshabilitados de `BottomNavbar`: **Duelos** ya es destino real (Epic 5). **Mi Cuenta** sigue placeholder → depende de **Story 3.2** (backlog). `[BLOQUEADO]`.

## Story 3.3 (code review 2026-06-04)
- Admin de una liga que NO es su membresía más reciente no puede gestionarla: `/standings/manage` resuelve la "liga más reciente" igual que `/standings` y `/predictions` (`src/app/standings/manage/page.tsx`). Pre-existente; el selector multi-liga es trabajo futuro de toda la app.
- `[RESUELTO]` Fidelidad de mensajes de error en las server actions de admin: `P0002` (miembro no encontrado), auto-expulsión y único-admin colapsan a `ADMIN_SAVE_ERROR`/`ADMIN_NOT_AUTHORIZED_ERROR` genéricos (`src/app/actions/leagues.actions.ts`). Las guardas funcionan; solo el copy es genérico. Polish de UX.
- `isPending` (un solo `useTransition`) compartido entre el toggle de pago y el diálogo de baja en `MemberAdminList.tsx`: una operación en vuelo deshabilita la otra. Tradeoff aceptable a esta escala móvil; separar transiciones por acción es polish.

### Story 3.3 (code review ronda 2, 2026-06-04)
- `FOR UPDATE` en `fn_remove_member` (supabase/migrations/20260604120000_member_admin_management.sql) bloquea solo las filas `role='admin'` existentes; no serializa contra un futuro flujo de promote-to-admin o cambio de rol (hoy inexistente). Revisar el bloqueo cuando se añada promoción de admins.
- El test de "último admin" (tests/integration/member-admin-management.test.ts) valida el invariante (la liga conserva ≥1 admin) pero no ejercita la rama concurrente `count<=1`+`FOR UPDATE`, que requeriría un test de dos transacciones simultáneas. La carrera es difícil de reproducir en integración.

### Mini-sesión de decisiones post-Epic 3 (2026-06-04)
- **Historia futura — Editar reglas de liga post-creación**: añadir al panel `/standings/manage` la edición de modo de predicción, monto e instrucciones de cobro (hoy solo se fijan al crear la liga en Story 1.3). Reusa el patrón Server Action + RPC `SECURITY DEFINER` (admin-gated) y `leagues.rules`/`payment_*`. Candidata a story propia cuando se priorice.
- **Deuda conocida — Transferir/otorgar rol admin (promote-to-admin)**: NO se hace para MVP (1 admin/liga = el creador). Cuando se implemente, endurecer la guarda de "último admin" en `fn_remove_member` (hoy `FOR UPDATE` defensivo) para serializar también contra cambios de rol.
- **Deuda recurrente — Selector multi-liga**: `/standings`, `/standings/manage`, `/account` y `/predictions` resuelven "liga más reciente". Evaluar una historia de selector multi-liga (diferido ya en 3.1 y 3.3).

## Story 4.2 (code review 2026-06-04)
- Handler Realtime en `src/components/live/LiveStandingsBoard.tsx` migró de `setSnapshot(updater funcional)` a lectura/escritura directa de `snapshotRef.current`. Para eventos Realtime síncronos es equivalente, pero si `refreshSnapshot({allowWhenLive:true})` (rama de partido nuevo, heredada de 4.1) resuelve mientras llega un evento de marcador, su guarda de versión está bypasseada y puede clobberear el update concurrente. Pre-existente desde 4.1; evaluar serializar refreshSnapshot con el snapshotVersion al tocar este flujo.
- `[RESUELTO]` En modo polling (Realtime caído, `reconnecting`/`polling`) un gol detectado por el `refreshSnapshot` de 60s actualiza la tabla pero NO emite toast ni destello "Impacto de Gol" — la lógica vive solo en `handleMatchUpdate`. Es consistente con AC#6 (el toast se deriva del UPDATE de Realtime), pero degrada el feedback a cero durante la ventana de polling. Enhancement: comparar prev/next snapshot dentro de `refreshSnapshot` para emitir feedback también en polling.
- `[RESUELTO]` `toScore(null)` ⇒ `0` en `src/components/live/goalImpact.ts`: una transición de marcador `null → 1` (backfill de un marcador desconocido, no un gol en juego) cuenta como incremento y podría fabricar un toast/destello fantasma. Baja frecuencia (live suele traer 0-0, y `buildProjectedStandings` ya excluye live con score null) y el fix (exigir prev conocido) podría suprimir goles legítimos vistos primero por Realtime. Revisar si aparecen falsos positivos con datos reales del sync.
- `[RESUELTO]` Swipe del toast (`src/components/live/GoalToast.tsx`) sin gate de eje dominante: un arrastre intencionalmente vertical (scroll) sobre el toast lo desplaza horizontalmente por el jitter en `clientX`. Polish de UX; agregar chequeo `|dy| > |dx|` para ignorar intención vertical.

## Story 5.1 (code review 2026-06-04)
- `[RESUELTO]` Carga diferida de retos históricos en `DuelsDashboard.tsx` no cancela peticiones previas al alternar pestañas rápido → posible condición de carrera de estado. Solución: `requestCountRef` para ignorar respuestas stale.

## Story 5.4 (code review 2026-06-04)
- `[RESUELTO]` Riesgo de hydration mismatch en `DesafioClient.tsx` por `toLocaleDateString` en cliente. Solución: formatear server-side o con locale/timezone fijos, con suppressHydrationWarning.
- `[RESUELTO]` Tras unirse a la liga, la landing refresca pero no abre el modal de aceptación → fricción. Solución: auto-abrir `AcceptDuelDialog` tras el join exitoso (vía inline handler y parámetros de consulta).

## Story 6.1 — Premios Especiales (code review 2026-06-03)
- `[RESUELTO]` Fuga de datos de predicciones tras abandonar una liga (`20260603015757_special_awards_rls.sql`) — cerrado por el trigger `tr_cleanup_predictions_on_member_leave` (`20260603183500_fix_deferred_work.sql`), que borra las predicciones especiales al salir/expulsar de la liga.
- `[RESUELTO]` Parseo repetitivo e ineficiente de fechas en `resolvePhase` (`src/utils/awardsScoring.ts`) — `TOURNAMENT_PHASES_2026` parsea cadenas de fecha en cada invocación pese a ser constantes. Cachear/precomputar.

## Story 6.2 — Puntuación decreciente y cierre por semifinales (code review 2026-06-03)
- `[RESUELTO]` Doble fuente de verdad en la config de fases (`src/config/tournamentPhases.ts`) — la Server Action y la UI chequean fechas hardcodeadas en TS en vez de consultar la tabla `tournament_phases`. Ya existen `fn_are_special_predictions_locked()` y `fn_get_active_tournament_phase()` (`20260603181000_fix_retro_gaps.sql`) para migrar a la verdad del lado BD.
- `[RESUELTO]` Resolución de tiempo inconsistente Node vs PostgreSQL (`special-predictions.actions.ts`) — `new Date()` de Node vs `now()` de la BD. Mitigable usando las RPC DB-backed añadidas en `fix_retro_gaps`.
- `[RESUELTO]` La vista `special_predictions_with_points` descartaba predicciones de candidatos borrados/inactivos (inner join) — cambiada a LEFT JOIN en `20260603183500_fix_deferred_work.sql`.
- `[RESUELTO]` Mensaje de bloqueo hardcodeado en `AwardsBoard` ("Semifinales en adelante") — quedará desfasado si cambia la lógica de bloqueo. Derivar del `label` de la fase activa.

### Integración Epic-6 ↔ Epic-7 (detectado y resuelto en el merge 2026-06-05)
- `[RESUELTO]` `fn_sync_tournament_phases_from_matches` usaba la columna imaginada `kickoff_at` y `stage = 'semifinals'/'semifinal'`, incompatibles con el esquema real de Epic-7 (`match_time`, `stage = 'semi'`). Corregida en `20260605140000_sync_tournament_phases.sql`.
- `[RESUELTO]` Las fechas de `tournament_phases` estaban hardcodeadas (hasta 3h de desfase con el calendario real). La nueva migración `20260605140000_sync_tournament_phases.sql` EJECUTA la función corregida tras el seed de Epic-7, derivando las fronteras de fase del calendario real. `src/config/tournamentPhases.ts` actualizado a los mismos valores; el contract test valida config ↔ BD ↔ calendario.
- `[ABIERTO]` Doble fuente de verdad parcial: el config TS y la tabla `tournament_phases` ahora COINCIDEN, pero siguen siendo dos copias sincronizadas a mano. Si el calendario cambia, re-ejecutar `fn_sync_tournament_phases_from_matches` y actualizar el config. Single-source real = futura story del motor de fases (Epic 7.x).

## Story 7.2 (code review 2026-06-04)
- `[RESUELTO]` **Granularidad de errores + observabilidad en Server Actions admin**: `setMatchResult` (y el `toAdminError` compartido de Story 3.3) colapsan todo error no-42501 en `ADMIN_SAVE_ERROR` y el `catch {}` no loguea. P0002 y 22023 no se distinguen del fallo genérico. Mejora repo-wide. [src/app/actions/matches.actions.ts, leagues.actions.ts]
- `[RESUELTO]` **Captura de resultados de knockout**: la UI de `/standings/manage` filtra `stage='group'`, así que los partidos de eliminatoria no se gestionan aquí. Cuando Story 7.3 resuelva equipos reales del bracket, surfacing de la captura de resultados knockout en este panel (el RPC ya lo soporta para partidos con códigos resueltos). [src/app/standings/manage/page.tsx]
- `[RESUELTO]` **Confirmación UX para transiciones destructivas**: revertir `finished→live` o `→canceled` saca puntos ya consolidados de la clasificación oficial sin confirmación. La matriz de transiciones es by-design (correcciones de admin), pero un diálogo de confirmación para transiciones destructivas sería una mejora de UX. [src/components/standings/MatchAdminList.tsx]

---

## Resumen
- **Cerrado en hardening pass:** PII de email, validación de `fn_create_league`, CHECKs de `payment_amount` y tope de marcador, paridad de tipos, config (redirect/password/tailwind), seed.
- **Ya resuelto por stories posteriores:** write-lock de predictions (2.4), gate de `challenge_participants` (5.4), Duelos en navbar (Epic 5).
- **Resuelto en Batch UI / Hardening final:** MatchCard timer, DuelsDashboard race, DesafioClient hydration + post-join UX, confirmación UX para transiciones destructivas (7.2), observabilidad/errores genéricos (7.2), captura de resultados de knockout en admin panel (7.2), sincronización de fases (config ↔ DB).
- **Otras deudas / mejoras:** Paginación de standings (3.1), selector multi-liga (3.3), editar reglas de liga (3.3).

---

## Deferred from: code review of 8-1-endpoint-de-webhook-para-sincronizacion-de-partidos-en-tiempo-real-zafronix-api.md (2026-06-06)
- `[RESUELTO]` **El recálculo de puntos ante correcciones de marcadores (match.patched)** — Trigger `fn_resolve_challenges_on_match_status_change` redefinido para recalcular e invalidar predicciones evaluadas en caso de correcciones, manteniendo idempotencia y recalculando también predicciones normales de ligas activas.
- `[RESUELTO]` **Vulnerabilidad ante entrega de eventos de webhook fuera de orden** — Añadida la columna `external_last_sync_at` en la tabla `matches`. El webhook valida que el timestamp recibido del evento sea estrictamente mayor que el almacenado localmente para evitar sobrescribir con eventos obsoletos.

## Deferred from: code review of 8-3-script-administrativo-de-sincronizacion-y-restauracion-completa.md (2026-06-06)
- `[RESUELTO]` **Unnormalized Stage Value Insertions** — Implementada la función `normalizeStage` en `restore-zafronix-data.ts` para mapear los valores de fase de la API (ej: `1/8`, `1/4`) a las constantes internas correspondientes (`last_16`, `quarter`), evitando fallos en las restricciones de CHECK de base de datos.

## Deferred from: code review of 8-5-test-de-contrato-del-webhook-de-zafronix.md (2026-06-06)
- `[RESUELTO]` **Dangerous seconds-to-milliseconds heuristic in route handler for year 9999 sandbox timestamps** — Modificada la heurística en `route.ts` para soportar de manera segura timestamps del año 9999 tanto en segundos como en milisegundos mediante una validación dual de la ventana de replay.
- `[RESUELTO]` **Database query error during external_ref matching is silently ignored** — Corregida la función `findLocalMatch` en `route.ts` para que propague y maneje adecuadamente los errores devueltos por consultas a Supabase en lugar de omitirlos silenciosamente.
- `[RESUELTO]` **Failure during NextRequest text stream read returns 500 instead of 400** — La lectura del stream `req.text()` está envuelta en un bloque try/catch en `route.ts` que retorna un código de estado 400 Bad Request si la lectura del cuerpo falla por conexiones rotas o malformaciones.
- `[RESUELTO]` **Lack of logging for HMAC signature verification failures** — Se agregaron logs detallados de diagnóstico (warnings) en `route.ts` cuando falla la verificación de firmas HMAC, mostrando el timestamp recibido y las razones del descarte.
- `[RESUELTO]` **Weak validation of event ID format, timestamp string format, and status in schemas** — Robustecida la validación de Zod schemas en `contract.ts` forzando `.min(1)` para los identificadores de evento, `.datetime()` para el timestamp `ts` de eventos y un strict enum para el estatus de partidos suspendidos/cancelados.
- `[RESUELTO]` **Live sandbox rate limiting failure in zafronix-sandbox-e2e.test.ts** — Implementado reintento de backoff exponencial en `tests/integration/helpers/zafronix-sandbox.ts` que interpreta la cabecera `Retry-After`, con una política fail-fast si el retardo supera los 10 segundos para no bloquear la ejecución local de Vitest.

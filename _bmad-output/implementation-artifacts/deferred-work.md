# Deferred Work

## Deferred from: code review of story-4.2 (2026-06-04)

- Handler Realtime en `src/components/live/LiveStandingsBoard.tsx` migró de `setSnapshot(updater funcional)` a lectura/escritura directa de `snapshotRef.current`. Para eventos Realtime síncronos es equivalente, pero si `refreshSnapshot({allowWhenLive:true})` (rama de partido nuevo, heredada de 4.1) resuelve mientras llega un evento de marcador, su guarda de versión está bypasseada y puede clobberear el update concurrente. Pre-existente desde 4.1; evaluar serializar refreshSnapshot con el snapshotVersion al tocar este flujo.
- En modo polling (Realtime caído, `reconnecting`/`polling`) un gol detectado por el `refreshSnapshot` de 60s actualiza la tabla pero NO emite toast ni destello "Impacto de Gol" — la lógica vive solo en `handleMatchUpdate`. Es consistente con AC#6 (el toast se deriva del UPDATE de Realtime), pero degrada el feedback a cero durante la ventana de polling. Enhancement: comparar prev/next snapshot dentro de `refreshSnapshot` para emitir feedback también en polling.
- `toScore(null)` ⇒ `0` en `src/components/live/goalImpact.ts`: una transición de marcador `null → 1` (backfill de un marcador desconocido, no un gol en juego) cuenta como incremento y podría fabricar un toast/destello fantasma. Baja frecuencia (live suele traer 0-0, y `buildProjectedStandings` ya excluye live con score null) y el fix (exigir prev conocido) podría suprimir goles legítimos vistos primero por Realtime. Revisar si aparecen falsos positivos con datos reales del sync.
- Swipe del toast (`src/components/live/GoalToast.tsx`) sin gate de eje dominante: un arrastre intencionalmente vertical (scroll) sobre el toast lo desplaza horizontalmente por el jitter en `clientX`. Polish de UX; agregar chequeo `|dy| > |dx|` para ignorar intención vertical.

## Deferred from: code review of story-1.1 (2026-06-01)

- `[db.seed] enabled=true` apunta a `./seed.sql` inexistente (`supabase/config.toml:71`) — default de plantilla; `supabase start` lo tolera, pero conviene crear un `seed.sql` vacío o desactivar `[db.seed]`.
- `additional_redirect_urls = ["https://127.0.0.1:3000"]` con `site_url = "http://127.0.0.1:3000"` (`supabase/config.toml:163`) — corregir a `http://` cuando se implemente el flujo de auth/OAuth local.
- Defaults de auth sin endurecer: `minimum_password_length = 6`, `enable_confirmations = false`, `max_rows = 1000` (`supabase/config.toml`) — endurecer durante el hardening de producción.
- `cacheComponents: true` en `next.config.ts:4` — confirmar que la activación de esta flag de caché de Next 16 es intencional (válida y en verde, pero cambia el modelo de caché por defecto).
- `components.json` con `tailwind.config: ""` mientras existe `tailwind.config.ts` (Tailwind v3) — puede provocar configuración incorrecta en futuros `shadcn add`.
- `eslint-config-next` fijado en `15.3.1` mientras Next es `16.2.7` (`package.json`) — el bump a `eslint-config-next@^16` migra a flat config nativo (quitar `FlatCompat` en `eslint.config.mjs`) PERO activa la regla `react-hooks/set-state-in-effect`, que falla en `src/components/theme-switcher.tsx` (código de plantilla del Grupo B). Alinear la versión y resolver ese error de lint cuando se aborde el código de plantilla.

## Deferred from: code review of story-1.2 (2026-06-02)

- `profiles.email` legible por cualquier usuario autenticado vía `profiles_select_authenticated using (true)` (`supabase/migrations/20260602041455_rls_and_triggers.sql:49`) — PII expuesta. Antes de producción: restringir la exposición (p. ej. una vista pública sin `email`, o sacar `email` de la tabla pública y dejarlo solo en `auth.users`).
- Sin políticas UPDATE/DELETE en `league_members` y sin DELETE en `leagues` (`supabase/migrations/20260602041455_rls_and_triggers.sql`) — deny-by-default deja sin poder abandonar liga, cambiar `payment_status` ni borrar liga vía cliente. Añadir en Stories 1.3 (admin/pagos), 1.4 (alta/baja por invitación) y 3.3 (control de pagos).
- `profiles.email` no se re-sincroniza: el trigger es solo `AFTER INSERT` (`...20260602041455_rls_and_triggers.sql:139`). Añadir un trigger `AFTER UPDATE OF email ON auth.users` si se requiere email fresco en `profiles`.
- `payment_amount numeric(10,2)` sin `check (payment_amount >= 0)` ni coherencia `requires_payment=true ⇒ payment_amount not null` (`supabase/migrations/20260602041410_init_schema.sql`) — endurecer al implementar pagos en Story 1.3.
- `LeagueRole`/`PaymentStatus` en `src/types/index.ts` duplican manualmente los CHECK de la BD — riesgo de divergencia silenciosa; considerar derivarlos o añadir un test que valide los tipos contra los CHECK.

## Deferred from: code review of story-1.3 (2026-06-03)

- Validación a nivel de BD ausente en `fn_create_league` (`supabase/migrations/20260603014645_add_create_league_fn.sql`): no valida `payment_amount >= 0`, ni `prediction_mode ∈ {dual,jornada,grupos}`, ni `name` no vacío. Cualquier usuario `authenticated` puede invocar el RPC directo por PostgREST y saltarse la validación zod de la Server Action. Endurecer con CHECKs/validación dentro de la función (relacionado con la deuda de `payment_amount` diferida en 1.2).
- La guardia de sesión de `/leagues/new` (`src/app/leagues/new/page.tsx`) solo comprueba `getClaims()`; un usuario autenticado sin fila en `public.profiles` (p. ej. por fallo del trigger `fn_handle_new_user`) pasa la guardia y, al enviar, el INSERT del RPC viola la FK `created_by → profiles(id)` (Postgres 23503) mostrando un error crudo. Caso raro; mapear el error o garantizar la materialización del perfil.
- Código de Story 1.4 mezclado en el módulo 1.3 `src/app/actions/leagues.actions.ts` (`joinLeagueByInvite`, `normalizeInviteCode`) y RPCs 1.4 en `src/types/database.types.ts`. Auditar bajo Story 1.4 la superficie `fn_get_invite_landing` concedida a `anon` (posible enumeración de ligas/datos del creador con un `invite_code` de 8 chars).

## Deferred from: code review of story-2.1 (2026-06-03)

- Sin bloqueo de escritura por kickoff −1min en las políticas INSERT/UPDATE de `predictions` (`supabase/migrations/20260603144630_predictions_rls.sql`): el time-gating de LECTURA ya está activo, pero un usuario puede editar su predicción después del kickoff (partido `live`/`finished`). Asignado a Story 2.4 ("cuando falte 1 minuto... la UI bloquea") — pero debe enforcarse en servidor (RLS/trigger con `fn_match_unlocked` en el `with check`), no solo en UI. Exposición práctica nula hasta que existan GoalPicker/autosave (Stories 2.2-2.3).
- `MatchStatus` definido en tres lugares sincronizados a mano (CHECK de `matches.status` + literal en `src/types/index.ts` + literal en `src/utils/scoring.ts`); los tipos generados lo tipan como `string`. Riesgo de drift silencioso si cambia el set de estados. Mismo patrón ya diferido para `LeagueRole`/`PaymentStatus` en 1.2; considerar una fuente única (constante derivada o test que valide los literales contra el CHECK).

## Deferred from: code review of story-2.4 (2026-06-03)

- UI derivada de tiempo en `MatchCard` (`src/components/predictions/MatchCard.tsx`) evaluada solo en render (sin timer): (a) el candado `isMatchLocked` no se auto-bloquea al cruzar `match_time − 1min` con la tarjeta abierta; (b) el indicador de multiplicador / `nextMultiplier` quedan stale al cruzar un lote de días; (c) `degradeAckRef` (confirmación por sesión) podría tapar una degradación posterior mayor; (d) si la tarjeta se bloquea con la advertencia abierta, el diálogo sigue interactivo. Sin riesgo de datos (el servidor rechaza con RPC P0001). Solución única: un `setInterval` que re-renderice y reseteé el ack al cruzar umbrales. (Code review de 2.4 — Blind + Edge Case Hunter.)
- `fn_save_prediction` y la tabla `predictions` validan `>= 0` pero NO un tope superior de marcador (`MAX_PREDICTION_SCORE = 99` es solo cliente/zod). Una llamada directa a la RPC por un `authenticated` podría guardar un marcador enorme (cosmético, sin impacto de seguridad). Hardening futuro: CHECK de tope en la tabla + validación en la RPC. (Code review de 2.4 — Edge Case Hunter.)

## Deferred from: code review of story-3.1 (2026-06-03)

- Tabs por `matchday` en la tabla de posiciones (`src/utils/standings.ts` `finishedMatchdays` + `buildStandings`) no contemplan dos casos del esquema (matchday es `int` nullable y sin namespacing por fase): (a) un partido `finished` con `matchday = null` SÍ cuenta en la vista "General" pero NO genera pestaña → la suma de las pestañas de jornada no cuadra con el total General; (b) dos fases distintas con el mismo número de jornada (p. ej. group J1 y un knockout guardado como `matchday=1`) colapsan en una sola pestaña y se suman juntas. Latente: los datos reales (seed/sync) siempre fijan `matchday` de grupos; la story ya difirió las labels compactas por `stage` para knockout. Resolver cuando se modele el calendario de eliminatorias (Epic 4/6). (Code review de 3.1 — Blind + Edge Case Hunter + Acceptance Auditor, convergente.)
- Sin paginación en `src/app/standings/page.tsx`: los selects de `predictions` (`.in('match_id', finishedIds)`), `matches` (status='finished') y `league_members` no acotan filas ni pagina. El tope por defecto de PostgREST (~1000 filas) puede truncar SILENCIOSAMENTE las predicciones en un Mundial completo (p. ej. 15 miembros × >66 partidos finished > 1000) → puntajes subestimados sin error visible. Solapa con la persistencia oficial de standings (Epic 5.3), que reemplazará el cálculo on-the-fly por `points_earned` agregado en BD. Resolver al implementar 5.3 o antes con paginación/batch si la liga crece. (Code review de 3.1 — Blind + Edge Case Hunter.)
- Items deshabilitados de `BottomNavbar` (`src/components/layout/BottomNavbar.tsx`): Duelos y Mi Cuenta son placeholders con `aria-disabled="true"` sobre un `<span>` no enfocable (semántica de "disabled" en un elemento no interactivo) y contraste `text-muted-foreground/40` (exento de WCAG por ser control inactivo, pero confuso). Se reemplazan por destinos reales y navegación accesible al aterrizar Epic 5 (Duelos) y Story 3.2 (Mi Cuenta/perfil). (Code review de 3.1 — Blind Hunter.)

## Deferred from: code review of story-3.3 (2026-06-04)

- Admin de una liga que NO es su membresía más reciente no puede gestionarla: `/standings/manage` resuelve la "liga más reciente" igual que `/standings` y `/predictions` (`src/app/standings/manage/page.tsx`). Pre-existente; el selector multi-liga es trabajo futuro de toda la app.
- Fidelidad de mensajes de error en las server actions de admin: `P0002` (miembro no encontrado), auto-expulsión y único-admin colapsan a `ADMIN_SAVE_ERROR`/`ADMIN_NOT_AUTHORIZED_ERROR` genéricos (`src/app/actions/leagues.actions.ts`). Las guardas funcionan; solo el copy es genérico. Polish de UX.
- `isPending` (un solo `useTransition`) compartido entre el toggle de pago y el diálogo de baja en `MemberAdminList.tsx`: una operación en vuelo deshabilita la otra. Tradeoff aceptable a esta escala móvil; separar transiciones por acción es polish.

## Deferred from: code review (round 2) of story-3.3 (2026-06-04)

- `FOR UPDATE` en `fn_remove_member` (supabase/migrations/20260604120000_member_admin_management.sql) bloquea solo las filas `role='admin'` existentes; no serializa contra un futuro flujo de promote-to-admin o cambio de rol (hoy inexistente). Revisar el bloqueo cuando se añada promoción de admins.
- El test de "último admin" (tests/integration/member-admin-management.test.ts) valida el invariante (la liga conserva ≥1 admin) pero no ejercita la rama concurrente `count<=1`+`FOR UPDATE`, que requeriría un test de dos transacciones simultáneas. La carrera es difícil de reproducir en integración.

## Deferred from: mini-sesión de decisiones post-Epic 3 (2026-06-04)

- **Historia futura — Editar reglas de liga post-creación**: añadir al panel `/standings/manage` la edición de modo de predicción, monto e instrucciones de cobro (hoy solo se fijan al crear la liga en Story 1.3). Reusa el patrón Server Action + RPC `SECURITY DEFINER` (admin-gated) y `leagues.rules`/`payment_*`. Candidata a story propia cuando se priorice.
- **Deuda conocida — Transferir/otorgar rol admin (promote-to-admin)**: NO se hace para MVP (1 admin/liga = el creador). Cuando se implemente, endurecer la guarda de "último admin" en `fn_remove_member` (hoy `FOR UPDATE` defensivo) para serializar también contra cambios de rol.
- **Deuda recurrente — Selector multi-liga**: `/standings`, `/standings/manage`, `/account` y `/predictions` resuelven "liga más reciente". Evaluar una historia de selector multi-liga (diferido ya en 3.1 y 3.3).

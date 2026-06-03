# Deferred Work

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

## Deferred from: code review of 6-1-predicciones-de-premios-especiales-de-la-copa-campeon-goleador-mvp (2026-06-03)

- Fuga de datos de predicciones tras abandonar una liga (`supabase/migrations/20260603015757_special_awards_rls.sql:1439-1460`) — No existe limpieza automática ni restricción en RLS que evite que un usuario lea sus predicciones de una liga de la que ya no forma parte.
- Parseo repetitivo e ineficiente de fechas en `resolvePhase` (`src/utils/awardsScoring.ts:454-467`) — `TOURNAMENT_PHASES_2026` parsea cadenas de fecha dinámicamente en el bucle de clasificación de fase en cada invocación, lo cual es ineficiente al ser valores constantes.

## Deferred from: code review of 6-2-system-de-puntuacion-decreciente-y-cierre-por-semifinales (2026-06-03)

- Double Source of Truth for Phase Configuration (`src/config/tournamentPhases.ts:1`) — The server action and UI check hardcoded TypeScript dates instead of querying the `tournament_phases` table from the database.
- Inconsistent Time Resolution between Node.js and PostgreSQL (`src/app/actions/special-predictions.actions.ts:41`) — Node's `new Date()` vs. database `now()` can cause edge-case inconsistencies due to server clock drift.
- View Silently Drops Predictions on Candidate Deletion/Deactivation (`supabase/migrations/20260603155843_tournament_phases_schema.sql:460`) — The inner join on `award_candidates` silently excludes predictions for deleted/inactive candidates instead of showing them as orphaned.
- Hardcoded Lock Message in `AwardsBoard` (`src/components/awards/AwardsBoard.tsx:127`) — The UI locks predictions with a hardcoded warning message stating "Semifinales en adelante", which will become misleading if the locking logic changes.


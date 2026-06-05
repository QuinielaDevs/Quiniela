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
- `[ABIERTO]` Guardia de `/leagues/new` solo comprueba `getClaims()`; un usuario sin fila en `profiles` (fallo del trigger) violaría la FK al crear. Caso raro; mapear el error 23503 a mensaje legible. UI menor.
- `[RESUELTO/auditado]` `fn_get_invite_landing` concedida a `anon` → auditada: solo expone datos públicos (nombre liga, display_name/avatar del creador, pago), NO email/created_by/IDs. Único riesgo = enumeración por fuerza bruta de `invite_code` (8 chars) → `[ACEPTADO]`, mitigable con rate-limit en el edge, no en SQL. Mismo patrón que se cerró server-side en 5.4 (`fn_get_challenge_landing` SÍ filtra predicciones).

## Story 2.1 (code review 2026-06-03)
- `[RESUELTO]` Sin bloqueo de escritura por kickoff −1min en INSERT/UPDATE de `predictions` → Story 2.4 reemplazó las policies con versiones gated (server-side, `fn_save_prediction` + RLS con la guarda de kickoff). Confirmado en `20260603201630_*`.
- `[RESUELTO]` `MatchStatus` en tres lugares a mano → ahora deriva del array-constante `MATCH_STATUSES` en `src/types/index.ts` con test de paridad contra el CHECK. (Nota menor: `src/utils/scoring.ts` aún declara su propia unión `MatchStatus`; alinear o importar desde `@/types` en una limpieza futura — bajo riesgo, cubierto por el test de paridad del lado BD.)

## Story 2.4 (code review 2026-06-03)
- `[ABIERTO/UI]` UI derivada de tiempo en `MatchCard` evaluada solo en render (sin timer): el candado no se auto-bloquea al cruzar `match_time−1min`, el multiplicador queda stale, el ack de degradación podría tapar una mayor. Sin riesgo de datos (el servidor rechaza con P0001). Solución: un `setInterval` que re-renderice y reseteé el ack. **Batch UI pendiente.**
- `[RESUELTO]` `fn_save_prediction`/`predictions` sin tope superior de marcador → CHECK `predictions_score_max (<= 99)` en el hardening pass (enforcement de tabla; el RPC hereda el CHECK).

## Story 3.1 (code review 2026-06-03)
- `[BLOQUEADO]` Tabs por `matchday` no contemplan `matchday=null` ni colisión de fases con el mismo número. Depende del modelado del calendario de eliminatorias (**Epic 4/6**).
- `[ABIERTO]` Sin paginación en `/standings` — el tope de PostgREST (~1000 filas) puede truncar predicciones en un Mundial completo (liga grande). La clasificación sigue calculándose on-the-fly (5.3 añadió accrual a `wager_balance` pero NO reemplazó el cálculo de ranking, que es independiente por diseño). Implementar paginación/batch si la liga crece. Relacionado con `max_rows` (1.1).
- `[RESUELTO/parcial]` Items deshabilitados de `BottomNavbar`: **Duelos** ya es destino real (Epic 5). **Mi Cuenta** sigue placeholder → depende de **Story 3.2** (backlog). `[BLOQUEADO]`.

## Story 5.1 (code review 2026-06-04)
- `[ABIERTO/UI]` Carga diferida de retos históricos en `DuelsDashboard.tsx` no cancela peticiones previas al alternar pestañas rápido → posible condición de carrera de estado. Solución: `AbortController`. **Batch UI pendiente.**

## Story 5.4 (code review 2026-06-04)
- `[ABIERTO/UI]` Riesgo de hydration mismatch en `DesafioClient.tsx` por `toLocaleDateString` en cliente. Solución: formatear server-side o con locale/timezone fijos. **Batch UI pendiente.**
- `[ABIERTO/UI]` Tras unirse a la liga, la landing refresca pero no abre el modal de aceptación → fricción. Solución: auto-abrir `AcceptDuelDialog` tras el join exitoso. **Batch UI pendiente.**

---

## Resumen
- **Cerrado en hardening pass:** PII de email, validación de `fn_create_league`, CHECKs de `payment_amount` y tope de marcador, paridad de tipos, config (redirect/password/tailwind), seed.
- **Ya resuelto por stories posteriores:** write-lock de predictions (2.4), gate de `challenge_participants` (5.4), Duelos en navbar (Epic 5).
- **Batch UI pendiente (bajo riesgo, requiere correr la app):** MatchCard timer, DuelsDashboard race, DesafioClient hydration + post-join UX.
- **Bloqueado en stories futuras:** league_members UPDATE/DELETE (3.3, con cuidado de wager_balance), matchday tabs (Epic 4/6), Mi Cuenta navbar (3.2), eslint bump (código de plantilla).
- **Aceptado:** enumeración de invite_code (edge rate-limit), cacheComponents, confirmations/max_rows (hardening de producción).

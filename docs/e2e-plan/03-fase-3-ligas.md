# Fase 3 — Ciclo de vida de ligas: creación, invitación y unión

## Objetivo
Cubrir el funnel completo de adquisición: crear liga (con y sin pago), compartir invitación, landing pública, unión autenticada y por deep-link anónimo, idempotencia, estados de pago y la página de reglas.

## Dependencias
Fases 1 y 2 (helpers, testids, auth E2E estable).

## Contexto requerido
- `00-contexto.md` §2, §4.9.
- Leer: `src/app/leagues/new/page.tsx` + `src/components/leagues/LeagueCreateForm.tsx` + `src/app/actions/leagues.actions.ts` + `leagues.schema.ts` (validaciones exactas del form: límites de longitud, monto mínimo, condicionalidad de campos de pago), `src/app/join/[invite_code]/page.tsx` + `JoinByCodeForm.tsx`/`JoinLeagueCard.tsx`/`NoLeagueState.tsx`, `src/components/predictions/WelcomePaymentModal.tsx`, `src/app/rules/page.tsx`, RPCs `fn_create_league`, `fn_get_invite_landing`, `fn_join_league_by_invite` (migraciones citadas en `00-contexto.md`).
- Cómo resuelve la app la "liga activa" cuando el usuario pertenece a varias (investigar en `src/app/predictions/page.tsx` o layout antes de escribir LIG-17).

## Entregables
- `tests/e2e/league-create.spec.ts` (reemplaza/absorbe el actual `create-league.spec.ts`, conservando su caso de guard)
- `tests/e2e/league-join.spec.ts`

## Casos de prueba

### Creación (`league-create.spec.ts`)

| ID | Caso | Setup | Acción | Verificación |
|---|---|---|---|---|
| LIG-01 | Guard: `/leagues/new` sin sesión redirige a login | — | visita anon | redirect `/auth/login` (caso existente, migrado) |
| LIG-02 | Crear liga sin pago | usuario auth | nombre válido, sin pago, submit | redirect post-creación (verificar destino real), la liga aparece (en `/account` o donde corresponda) |
| LIG-03 | Crear liga con pago | usuario auth | activar `requires-payment-switch`, monto e instrucciones | creada; los datos de pago se reflejan en la landing de invitación (LIG-08) |
| LIG-04 | Nombre vacío rechazado | usuario auth | submit sin nombre | error de validación visible, no se crea |
| LIG-05 | Validaciones de monto | usuario auth | monto vacío/0/negativo con pago activado | errores según `leagues.schema.ts` (leer los límites exactos y probar cada rama) |
| LIG-06 | Creador queda admin (BD) | tras LIG-02 | — | `league_members`: role=admin del creador; `invite_code` generado no vacío |
| LIG-07 | Doble click en submit no duplica | usuario auth | doble click rápido en `create-league-submit` | una sola liga creada (BD) |

### Invitación y unión (`league-join.spec.ts`)

| ID | Caso | Setup | Acción | Verificación |
|---|---|---|---|---|
| LIG-08 | Landing anónima muestra datos públicos | liga con pago sembrada | visitar `/join/<code>` anon | nombre liga, nombre/avatar del creador, monto e instrucciones de pago visibles; **sin** datos privados |
| LIG-09 | Código inválido | — | `/join/NOEXISTE` | mensaje de error amable, sin crash |
| LIG-10 | Código case-insensitive y con espacios | liga sembrada | visitar con código en minúsculas / pegar con espacios en el form | landing resuelve igual (el RPC hace UPPER+TRIM) |
| LIG-11 | Unión autenticada | usuario auth + liga ajena | visitar `/join/<code>` y confirmar | miembro creado role=member, payment_status=pending; redirect a `/predictions` (verificar query `?joined=1` si existe) |
| LIG-12 | Re-unión idempotente | usuario ya miembro | repetir `/join/<code>` | sin error ni fila duplicada (UNIQUE league_id+user_id) |
| LIG-13 | Liga con pago → aviso al entrar | liga requires_payment, miembro pending | ir a `/predictions` | `welcome-payment-modal` (o banner) con monto e instrucciones; se puede cerrar |
| LIG-14 | Deep-link anónimo completo | liga sembrada, usuario NO logueado | `/join/<code>` → CTA → login → volver | tras autenticarse, el join se completa y termina en `/predictions` (flujo de `next`) |
| LIG-15 | Usuario sin ligas | usuario auth sin membresías | visitar `/predictions` (o donde aplique) | `no-league-state` visible con CTA a crear/unirse |
| LIG-16 | `/rules` refleja las reglas reales | miembro | visitar | la tabla de multiplicadores coincide con `MULTIPLIER_TIERS` de `src/utils/scoring.ts` (importar la constante en el test y comparar) |
| LIG-17 | Usuario en dos ligas | usuario miembro de 2 ligas sembradas | navegar la app | el mecanismo real de selección de liga funciona y los datos no se cruzan (investigar comportamiento primero; documentar en notas) |
| LIG-18 | Metadata OG de la landing | liga sembrada | `page.goto` + leer `<meta property="og:title">` etc. | título/descripción correctos para compartir en WhatsApp |

## Criterios de aceptación (DoD)
1. 18 casos implementados y verdes 3 ejecuciones seguidas.
2. `create-league.spec.ts` original eliminado/absorbido sin perder su caso.
3. Suite completa verde; lint/typecheck verdes.
4. Notas de ejecución: validaciones exactas encontradas en el schema, destino real post-creación, mecanismo real de liga activa (LIG-17).

## Riesgos y notas
- LIG-14 es el caso con más incógnitas (el retorno post-login depende de cómo la app preserva el invite code — `next` param o storage). Leer el flujo real en `JoinByCodeForm`/auth pages antes de implementar; si el producto NO preserva el código tras el login, eso contradice el Epic 1 Story 1.4 → candidato a `BUGS.md`.
- LIG-07: si el producto no protege el doble submit, registrar bug (no debilitar el assert).

## Notas de ejecución

**Ejecutada**: 2026-06-10 · rama `test/e2e-full` · 18 tests nuevos (el guard
LIG-01 migrado desde `create-league.spec.ts`, que se eliminó).

### Entregables
- `tests/e2e/league-create.spec.ts` — LIG-01..07.
- `tests/e2e/league-join.spec.ts` — LIG-08..18.
- `tests/e2e/helpers/seed/league.ts`: `inviteCodeFromRunId` ahora genera códigos
  dentro del **alfabeto real del producto** (`INVITE_CODE_ALPHABET`, sin
  O/0, I/1 ni L). Antes podía emitir `0`/`1` y la server action
  `joinLeagueByInvite` los rechaza ("Código de invitación inválido."), aunque
  la URL `/join/<code>` sí los acepte (la valida solo el RPC). Hallazgo clave
  para cualquier fase que use el form manual de código.

### Validaciones exactas encontradas (leagues.schema.ts + form)
- `name`: trim, min 1 ("El nombre de la liga es obligatorio."), max 80. El
  vacío lo bloquea el `required` nativo; "   " (solo espacios) llega al schema.
- `headerWord`: trim, min 1, max 20 (default "PIJA"; no se ejercita aparte).
- Con `requiresPayment`: monto e instrucciones obligatorios. El **vacío** y el
  **negativo** los bloquea la validación nativa del input (`required`,
  `min=0` → `rangeUnderflow`) antes de llegar al schema.
- **Monto 0 es VÁLIDO** (`z.number().nonnegative()`, decisión deliberada
  comentada en el schema): la liga se crea con `payment_amount = 0`.
  Desviación del plan (asumía error); LIG-05d lo cubre como comportamiento real.
- LIG-07: el doble click NO duplica (botón deshabilitado vía `useTransition`).

### Destino real post-creación
`router.push("/predictions")` (LeagueCreateForm). La liga se verifica en
`/account` (`account-league-item`) y en BD (creador `role=admin`,
`invite_code` ≥ 6 chars).

### Comportamientos reales relevantes
- **La landing `/join/<code>` AUTO-une al usuario autenticado** (server-side,
  sin click) y redirige a `/predictions?joined=1&league=<id>`: LIG-11/12 lo
  cubren; por eso LIG-03 verifica la landing con contexto ANÓNIMO (el creador
  logueado nunca la ve) y el flujo deep-link (LIG-14) termina sin pasar por
  ningún botón "Unirme".
- LIG-14: el invite se preserva vía `?next=/join/<code>` en el link "Inicia
  sesión o regístrate" de la tarjeta → login → vuelta a /join → auto-join.
  El producto SÍ cumple Story 1.4 (no hubo bug que registrar).
- Normalización del código: la página y el RPC hacen `UPPER(TRIM(...))`
  (case-insensitive en URL); la action además valida longitud 6-32 y alfabeto.
- Mecanismo real de **liga activa** (LIG-17): `profiles.active_league_id`
  resuelto por `getActiveLeagueMembership` (fallback: membresía más reciente);
  se cambia desde `/account` con el botón "Usar <liga> como liga actual"
  (action `setActiveLeague` → RPC `fn_set_active_league`) y el badge
  "Liga actual" se mueve tras `router.refresh()`. Verificado que los datos de
  `/standings` no se cruzan entre ligas.
- El modal de pago (`welcome-payment-modal`) es overlay `fixed` pero vive
  DOM-wise dentro de `<main>` → el patrón de anclaje anti-takeover aplica igual.

### Validación
`npm run lint` ✅ · `npm run typecheck` ✅ · `npm run test:unit` ✅ (470) ·
`npm run test:e2e` ✅ ×3 consecutivos (64 passed, 1 skipped por `fixme` BUG-001).

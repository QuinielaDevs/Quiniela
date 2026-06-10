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
_(rellenar al ejecutar)_

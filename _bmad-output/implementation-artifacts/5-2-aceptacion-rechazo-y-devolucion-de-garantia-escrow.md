---
baseline_commit: b764d5c0388002437728659c9998ee9daebf8d35
---
# Story 5.2: Aceptación, Rechazo y Devolución de Garantía (Escrow)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **jugador retado**,
I want **aceptar o rechazar un desafío directo, o unirme a un pozo abierto, asegurando que mis puntos apostados se congelen y liberen si el reto se cancela o expira**,
so that **mantener la integridad de mi balance de puntos en juego**.

## Acceptance Criteria

1. **Given** un desafío directo 1v1 recibido por un oponente (`challenged_id == auth.uid()`),
   **When** el oponente entra a la pestaña "Duelos" (`/duels`),
   **Then** en la sección "Retos Recibidos" visualiza una tarjeta para el reto con el botón "Aceptar" y el botón "Rechazar".

2. **And** al presionar el botón "Aceptar", se despliega un diálogo mobile-first (`AcceptDuelDialog.tsx`, con un contenedor modal `max-w-md` y estilos Championship Gold) que contiene:
   - El detalle del partido (equipos, fecha, hora).
   - Los puntos apostados por el creador.
   - Un GoalPicker táctil (`GoalPicker.tsx` de 48x48px que deshabilita focus para no desplegar teclado nativo) para ingresar la predicción de goles del local y visitante del oponente.
   - El saldo actual disponible del oponente (`league_members.wager_balance`).
   - Un botón de acción principal para confirmar la aceptación del duelo.

3. **And** si el saldo disponible actual del oponente que acepta es menor que los puntos apostados del desafío (`points_bet`), el botón de envío del diálogo se deshabilita y se muestra una advertencia visual en rojo (`text-destructive` o `text-red-500`) que dice: **"Saldo insuficiente para unirse a este desafío (Disponible: X.XX pts)"**.

4. **And** al confirmar la aceptación válida, se ejecuta la Server Action `acceptChallenge` que llama a la función RPC de Supabase `public.accept_challenge` (que corre con privilegios `SECURITY DEFINER`).

5. **And** la transacción ACID en Postgres (`public.accept_challenge`):
   - Valida la sesión del usuario (`auth.uid()`).
   - Bloquea la fila del desafío en `public.challenges` (`FOR UPDATE`) y verifica que el estado actual sea `'pending'`.
   - Si es un reto directo, valida que el usuario actual es el oponente desafiado (`challenged_id == auth.uid()`). Si es abierto, valida que el usuario actual no es el creador del desafío.
   - Valida que el participante no esté ya registrado en el desafío.
   - Verifica que el partido no haya comenzado aún (`now() < match_time`). Si el partido ya comenzó, **aborta la aceptación lanzando una excepción `'P0004'`** con mensaje `"El partido ya comenzó; este desafío ya no admite aceptaciones."`. **`accept_challenge` NO cancela ni reembolsa nada** (eso rompería la atomicidad: una RPC que lanza hace rollback de cualquier reembolso). La cancelación + reembolso de los retos que llegan al kickoff sin contraparte es responsabilidad EXCLUSIVA del trigger `tr_cancel_pending_challenges_on_match_start` (AC #8). [Decisión: opción B]
   - Bloquea la fila del oponente en `league_members` (`FOR UPDATE`) y verifica saldo suficiente (si no, lanza `'P0003'`).
   - Inserta la predicción del oponente en `public.challenge_participants`.
   - Si es directo (1v1), actualiza el estado del desafío a `'active'`. Si es abierto, mantiene el estado en `'pending'` para admitir más participantes (el pozo abierto poblado se bloquea a `'active'` en el kickoff vía el trigger de AC #8, NO se cancela).
   - Deduce de manera atómica los puntos apostados del saldo del oponente (`wager_balance`) y registra el movimiento de escrow negativo gemelo en `public.point_transactions` en la misma transacción (`description = 'challenge_escrow_hold'`, `reference_id = challenge_id`).

6. **And** al presionar el botón "Rechazar" en un reto directo, se ejecuta la Server Action `rejectChallenge` que llama a la función RPC `public.reject_challenge` (que corre con privilegios `SECURITY DEFINER`).

7. **And** la transacción ACID en Postgres (`public.reject_challenge`):
   - Valida la sesión del usuario (`auth.uid()`).
   - Bloquea la fila del desafío en `public.challenges` (`FOR UPDATE`) y verifica que esté `'pending'` (si no, lanza `'P0005'` — guarda de idempotencia), sea `'direct'` y `challenged_id == auth.uid()` (si no, `42501`).
   - Cambia el estado del desafío a `'canceled'`.
   - **Reembolsa a TODOS los tenedores de escrow del desafío** invocando el helper compartido `public.refund_challenge_escrow(p_challenge_id)` (ver Dev Notes), que revierte el ledger real. En un reto directo `'pending'` solo el creador tiene escrow, pero el helper es el mismo en todos los caminos de cancelación para no duplicar lógica.

8. **And** si un partido inicia (su `status` en `public.matches` pasa de `'scheduled'` a cualquier otro estado), el trigger `tr_cancel_pending_challenges_on_match_start` (`AFTER UPDATE OF status ON matches`, con guarda `WHEN (OLD.status = 'scheduled' AND NEW.status IS DISTINCT FROM 'scheduled')`) procesa los desafíos `'pending'` de ese partido **ramificando por número de participantes** (recordando que el creador SÍ cuenta como participante — decisión de diseño, ver Dev Notes):
   - **Pozo/reto `'pending'` con ≥ 2 participantes** (hay contraparte: pozo abierto poblado): transiciona a `'active'`, **NO reembolsa nada** — queda bloqueado para que Story 5.3 lo liquide. Sin este caso, un pozo abierto con jugadores se cancelaría al kickoff y nunca se jugaría.
   - **Reto `'pending'` con exactamente 1 participante** (solo el creador: directo sin aceptar, o pozo abierto sin adhesiones): transiciona a `'canceled'` y reembolsa vía `public.refund_challenge_escrow`.
   - **Idempotencia obligatoria:** las transiciones de estado se hacen con `UPDATE ... WHERE status = 'pending' ... RETURNING id`, y SOLO se reembolsan los `id` efectivamente cambiados por esa `UPDATE`. Un segundo disparo (p. ej. `live → finished`) no encuentra filas `'pending'` → 0 reembolsos. Combinado con la guarda `WHEN`, garantiza que ningún escrow se reembolse dos veces.

9. **And** el creador puede cancelar su propio reto **mientras no tenga contraparte**. Al presionar "Cancelar" en un reto `'pending'` propio, se ejecuta la Server Action `cancelChallenge` → RPC `public.cancel_challenge` (`SECURITY DEFINER`), que bajo `FOR UPDATE` valida: `status = 'pending'` (si no, `'P0005'`), `creator_id = auth.uid()` (si no, `42501`), y **exactamente 1 participante** (solo el creador; si ya hay adhesiones, lanza `'P0006'` con mensaje `"No puedes cancelar un pozo que ya tiene participantes."` — evita que el creador abandone al ver predicciones que no le gustan). Luego cambia a `'canceled'` y reembolsa vía `public.refund_challenge_escrow`.

10. **And** se deben incluir pruebas de integración (`Vitest DB-Integration`) en `tests/integration/triggers.test.ts` que validen:
    - **(a) Aceptación feliz de duelo directo:** acepta con saldo suficiente → baja su saldo exacto, crea participante, fila de ledger gemela, reto pasa a `'active'`.
    - **(b) Aceptación feliz de pozo abierto:** se une con saldo suficiente → baja su saldo, crea participante y transacción, reto se mantiene en `'pending'`.
    - **(c) Rechazo de desafío directo:** el oponente rechaza un directo `'pending'` → reto `'canceled'`, el creador recobra su escrow exacto, fila de ledger de reembolso.
    - **(d) Aceptar tras el Kickoff (opción B):** si `now() >= match_time`, `accept_challenge` lanza `'P0004'` y **NO altera ningún saldo ni estado** (rollback limpio; la cancelación/reembolso la hace el trigger, no accept).
    - **(e1) Pozo abierto poblado en kickoff → `'active'`:** pozo abierto con ≥ 2 participantes; al pasar el match a `'live'`, el reto transiciona a `'active'`, **NADIE es reembolsado**, los escrows siguen retenidos y la conservación se mantiene.
    - **(e2) Reto sin contraparte en kickoff → `'canceled'`:** directo sin aceptar (o pozo abierto con solo el creador); al `'live'` pasa a `'canceled'` y el creador recobra su escrow exacto.
    - **(f) Concurrencia de aceptación (double-spend):** usuario con saldo para 1 sola apuesta intenta aceptar dos desafíos concurrentemente vía **clientes independientes** (`Promise.allSettled`). Exactamente 1 `fulfilled`, 1 `rejected` con `'P0003'`, saldo final correcto y nunca negativo.
    - **(g) Reembolso multi-participante:** cancelar (por kickoff y por expiración/sin-contraparte) un pozo abierto con creador + ≥ 1 joiner → **CADA** participante recobra su escrow exacto (`balance_i_final == balance_i_inicial`), una fila de ledger de reembolso por participante.
    - **(h) Idempotencia / no doble reembolso (P0):**
      - **(h1)** doble disparo del trigger: `scheduled → live` y luego `live → finished` → el 2.º disparo es no-op (0 filas de ledger nuevas), el saldo del creador NO se incrementa dos veces.
      - **(h2)** `reject` + trigger de kickoff casi simultáneos sobre el mismo reto (clientes independientes) → exactamente uno realiza la transición `pending→canceled`; el otro es no-op; el creador recobra **exactamente un** escrow, no dos.
      - **(h3)** `cancel` + `accept` concurrentes sobre el mismo reto → exactamente uno gana sobre el `FOR UPDATE`; conservación intacta.
    - **(i) Invariante de conservación como POST-CONDICIÓN:** tras CADA escenario de concurrencia/idempotencia (f, h1-h3) y tras cada cancelación, re-afirmar para todos los actores: `wager_balance == COALESCE(SUM(point_transactions.amount), 0)` (comparar como `numeric` en SQL, no float en JS), y que la suma global de moneda no cambia salvo por el escrow legítimamente comprometido.
    - **(j) Atomicidad del reembolso múltiple (P1):** forzar un fallo en el k-ésimo reembolso del loop → rollback TOTAL (ningún participante reembolsado, el reto sigue `'pending'`).
    - **(k) Validación de cancelación (P0006):** intentar `cancel_challenge` sobre un pozo abierto que ya tiene adhesiones → falla `'P0006'`, sin cambios de estado ni saldo.

11. **And** todas las pruebas corren en verde (`npm run test:unit`, `npm run test:integration`), y no hay errores de TypeScript ni compilación.

## Tasks / Subtasks

- [x] **Tarea 1 — Migración SQL `supabase/migrations/20260604024800_accept_reject_challenges.sql`** (AC: #4-#9)
  - [x] **Helper compartido `public.refund_challenge_escrow(p_challenge_id uuid)`** (`security definer set search_path=''`, sin `GRANT` a `authenticated` — solo lo invocan otras RPCs/trigger). Revierte el ledger REAL del reto (no asume `points_bet`): para cada `user_id` con escrow neto retenido en ese challenge, acredita el opuesto y registra la fila gemela. Es naturalmente idempotente (si ya se reembolsó, el neto es 0). Ver snippet en Dev Notes. Lo usan `reject`, `cancel` y el trigger.
  - [x] **RPC `public.accept_challenge(p_challenge_id uuid, p_prediction_home int, p_prediction_away int)`** (`security definer set search_path=''`):
    - [x] Validar `auth.uid()` (si null → `42501`).
    - [x] `FOR UPDATE` sobre el challenge; verificar `status = 'pending'` (si no → `'P0005'`).
    - [x] Validar oponente: directo → `challenged_id = auth.uid()`; abierto → `creator_id <> auth.uid()` (si no → `42501`).
    - [x] Verificar que no esté ya en `challenge_participants` (si lo está → `'P0005'` o mensaje de duplicado).
    - [x] **Kickoff (opción B):** si `now() >= match_time` (o `match.status <> 'scheduled'`), lanzar `'P0004'` y NADA más (sin cancelar ni reembolsar — el trigger lo hará).
    - [x] `FOR UPDATE` sobre la fila del oponente en `league_members`; verificar saldo (si insuficiente → `'P0003'`).
    - [x] Insertar en `challenge_participants`; deducir `wager_balance` + fila gemela en `point_transactions` (`description='challenge_escrow_hold'`, `reference_id=challenge_id`) en la misma transacción.
    - [x] Si directo → `status = 'active'`. Si abierto → mantener `'pending'`.
  - [x] **RPC `public.reject_challenge(p_challenge_id uuid)`** (`security definer set search_path=''`): `auth.uid()`; `FOR UPDATE` + `status='pending'` (si no → `'P0005'`), `type='direct'`, `challenged_id=auth.uid()` (si no → `42501`); `status='canceled'`; **`refund_challenge_escrow(p_challenge_id)`**.
  - [x] **RPC `public.cancel_challenge(p_challenge_id uuid)`** (`security definer set search_path=''`): `auth.uid()`; `FOR UPDATE` + `status='pending'` (si no → `'P0005'`), `creator_id=auth.uid()` (si no → `42501`), **`count(challenge_participants) = 1`** (solo el creador; si hay adhesiones → `'P0006'`); `status='canceled'`; **`refund_challenge_escrow(p_challenge_id)`**.
  - [x] **Trigger `tr_cancel_pending_challenges_on_match_start`** + función `public.fn_cancel_pending_challenges_on_match_start()`: `AFTER UPDATE OF status ON public.matches` **`WHEN (OLD.status = 'scheduled' AND NEW.status IS DISTINCT FROM 'scheduled')`**. Lógica idempotente:
    - [x] `UPDATE challenges SET status='active' WHERE match_id=NEW.id AND status='pending' AND (SELECT count(*) FROM challenge_participants cp WHERE cp.challenge_id = challenges.id) >= 2` → pozos poblados se bloquean (NO se reembolsan).
    - [x] `UPDATE challenges SET status='canceled' WHERE match_id=NEW.id AND status='pending' RETURNING id` (los que quedan = 1 participante) → por cada `id` retornado, `refund_challenge_escrow(id)`. El `RETURNING` garantiza que un 2.º disparo no reembolse de nuevo.
  - [x] **`GRANT EXECUTE`** a `authenticated` SOLO sobre `accept_challenge`, `reject_challenge`, `cancel_challenge` (NO sobre `refund_challenge_escrow`).
  - [x] **Manejo de excepciones:** ninguna RPC usa `EXCEPTION WHEN OTHERS` que trague el error — dejar propagar para rollback total (coherente con 5.1).

- [x] **Tarea 2 — Pruebas de integración de base de datos `tests/integration/triggers.test.ts`** (AC: #10) — reutilizar helpers de `tests/integration/setup.ts` y patrón `createAuthedUser()` de `schema-rls.test.ts`; sembrar saldos con su fila gemela en `point_transactions` para no romper el invariante desde el fixture.
  - [x] **(a)** Aceptación directa feliz → saldo baja exacto, participante creado, ledger gemelo, reto `'active'`.
  - [x] **(b)** Aceptación de pozo abierto feliz → saldo baja, participante + transacción, reto sigue `'pending'`.
  - [x] **(c)** Rechazo de directo → `'canceled'`, creador recobra escrow exacto, fila de reembolso.
  - [x] **(d)** Aceptar tras kickoff (opción B) → `'P0004'`, **sin cambios de saldo ni estado**.
  - [x] **(e1)** Pozo abierto con ≥2 participantes en kickoff → `'active'`, nadie reembolsado, escrows retenidos.
  - [x] **(e2)** Reto sin contraparte (1 participante) en kickoff → `'canceled'`, creador recobra escrow exacto.
  - [x] **(f)** Concurrencia de aceptación: clientes independientes, saldo para 1 apuesta, `Promise.allSettled`, exactamente 1 `fulfilled` / 1 `rejected('P0003')`, saldo nunca negativo.
  - [x] **(g)** Reembolso multi-participante: cancelar pozo abierto con creador + ≥1 joiner (vía kickoff y vía sin-contraparte) → cada participante recobra su escrow exacto, N filas de reembolso.
  - [x] **(h)** Idempotencia: **(h1)** trigger doble disparo `scheduled→live→finished` (2.º = no-op, sin doble reembolso); **(h2)** `reject` + trigger casi simultáneos (un escrow reembolsado, no dos); **(h3)** `cancel` + `accept` concurrentes (uno gana el `FOR UPDATE`).
  - [x] **(i)** Conservación como post-condición de (f), (h1-h3) y de cada cancelación: `wager_balance == SUM(amount)` por miembro (comparar en SQL `numeric`).
  - [x] **(j) [P1]** Atomicidad del reembolso múltiple: fallo en el k-ésimo reembolso → rollback total.
  - [x] **(k)** `cancel_challenge` sobre pozo con adhesiones → `'P0006'`, sin cambios.

- [x] **Tarea 3 — Server Actions en `src/app/actions/duels.actions.ts` y Zod Schemas** (AC: #4, #6, #9)
  - [x] En `src/app/actions/duels.schema.ts`, definir y exportar `acceptChallengeSchema` y `challengeIdSchema`.
  - [x] En `src/app/actions/duels.actions.ts`, agregar e implementar las Server Actions `acceptChallenge`, `rejectChallenge` y `cancelChallenge`.
  - [x] En `getDuelsErrorMessage`, mapear TODOS los códigos de la tabla de errores (Dev Notes): `P0003` (saldo), `P0004` (partido iniciado), `P0005` (estado inválido), `P0006` (pozo con adhesiones), `42501` (no autorizado) a mensajes legibles en español.

- [x] **Tarea 4 — Diálogo de Aceptación `AcceptDuelDialog.tsx` y Botones en `DuelsDashboard.tsx`** (AC: #2, #3, #5, #6, #9)
  - [x] Crear el componente `src/components/duels/AcceptDuelDialog.tsx` utilizando Shadcn UI y estilos Championship Gold, con controles GoalPicker táctiles grandes de más/menos (+/-) de 48x48px (deshabilitando focus de teclado nativo).
  - [x] Implementar la validación visual de saldo: inhabilitar el botón de confirmación si `points_bet > wagerBalance` y mostrar la alerta en rojo.
  - [x] En `DuelsDashboard.tsx` (dentro de `renderChallengeCard` o como condicional):
    - [x] Si el desafío está en "Retos Recibidos" (`pendingReceived`), renderizar botones de "Aceptar" y "Rechazar".
    - [x] Si es un "Pozo Abierto" (`openPools`), renderizar botón "Unirse al Pozo".
    - [x] Si es un reto pendiente enviado por mí (`pendingSent`), renderizar un botón "Cancelar".
    - [x] Enlazar los botones "Aceptar" y "Unirse al Pozo" para abrir el modal `AcceptDuelDialog`.
    - [x] Enlazar los botones "Rechazar" y "Cancelar" a las Server Actions correspondientes utilizando `useTransition` para gestionar el estado de carga y deshabilitar los botones de forma reactiva mientras se ejecuta la acción.

- [x] **Tarea 5 — Validación del Proyecto y Tests** (AC: #11)
  - [x] Correr `npm run typecheck` y verificar que no existan errores de compilación de TypeScript.
  - [x] Correr `npm run test:integration` y `npm run test:unit` para verificar que la suite completa pase en verde.
  - [x] Probar el flujo manualmente en el navegador web local simulando dos cuentas en pestañas/navegadores diferentes.

### Review Findings

- [x] [Review][Decision] Escrow points locked indefinitely if a match is canceled or postponed — If a match transitions from `scheduled` to `canceled` or `postponed`, the trigger `tr_cancel_pending_challenges_on_match_start` transitions challenges with >= 2 participants to `active` (locking escrow), rather than canceling and refunding them. [supabase/migrations/20260604024800_accept_reject_challenges.sql:1119-1162]
- [x] [Review][Patch] Corrupt UTF-8 encoding in server actions, Zod schemas, UI components, and migrations [supabase/migrations/20260604024800_accept_reject_challenges.sql]
- [x] [Review][Patch] Hydration mismatch risk via `toLocaleDateString` in render [src/components/duels/AcceptDuelDialog.tsx:598-603]
- [x] [Review][Patch] Stale predictions state when dialog is closed and reopened [src/components/duels/AcceptDuelDialog.tsx]
- [x] [Review][Patch] Lack of active check for `isPending` in `handleSubmit` [src/components/duels/AcceptDuelDialog.tsx:571-596]
- [x] [Review][Patch] Dialog can be closed while action is executing [src/components/duels/AcceptDuelDialog.tsx:613-619]
- [x] [Review][Patch] Numeric overflow hazard in `v_current_points numeric(6, 2)` [supabase/migrations/20260604024800_accept_reject_challenges.sql:919]
- [x] [Review][Patch] Database deadlock risk during bulk updates in `refund_challenge_escrow` [supabase/migrations/20260604024800_accept_reject_challenges.sql:891-893]
- [x] [Review][Patch] Concurrent match status race condition in `accept_challenge` [supabase/migrations/20260604024800_accept_reject_challenges.sql:961-968]
- [x] [Review][Patch] Direct challenge authorization bypass if `challenged_id` is null during rejection [supabase/migrations/20260604024800_accept_reject_challenges.sql:1045]
- [x] [Review][Patch] Test check constraint `chk_point_transactions_refund_rollback_test` added to production schema [supabase/migrations/20260604024800_accept_reject_challenges.sql:1169]
- [x] [Review][Patch] Stale error messages in DuelsDashboard [src/components/duels/DuelsDashboard.tsx]
- [x] [Review][Patch] Font weight inconsistency between Accept and Reject buttons [src/components/duels/DuelsDashboard.tsx]
- [x] [Review][Patch] Missing null safety on transaction aggregation in integration tests [tests/integration/triggers.test.ts:1195]

## Dev Notes

### Decisión de diseño load-bearing: el creador ES participante
`create_challenge` (5.1) inserta al creador en `challenge_participants`. Por tanto el conteo de participantes es uniforme y define el ciclo de vida:
- **1 participante** = solo el creador → reto sin contraparte.
- **≥ 2 participantes** = hay contraparte (directo aceptado o pozo abierto poblado).

### Ciclo de vida del desafío (corrige la sobrecarga de `'pending'`)
- `pending`: creado, admite contraparte. Directo `pending` = sin aceptar; pozo abierto `pending` = admitiendo adhesiones.
- `active`: tiene contraparte y queda bloqueado para liquidación por **Story 5.3**. Se alcanza por: aceptación de un directo, o transición del trigger de kickoff para un pozo abierto con ≥ 2 participantes.
- `canceled`: sin contraparte al kickoff, o rechazado/cancelado. Dispara reembolso de TODOS los escrows del reto.
- `completed`: liquidado (territorio de 5.3).

> **Por qué importa:** sin el caso `pending(≥2) → active`, el trigger de kickoff cancelaría los pozos abiertos poblados y **nunca se jugarían**.

### Vocabulario de `description` en `point_transactions` (contrato fijo)
- `'challenge_escrow_hold'` — toda deducción al crear (5.1) o aceptar/unirse (5.2). `amount < 0`.
- `'challenge_escrow_refund'` — todo reembolso por cancelación. `amount > 0`.
- `'challenge_payout'` — reparto de premio (5.3). `amount > 0`.
- `'seed_initial_balance'` — saldo inicial (5.1).

Toda fila lleva `reference_id = challenge_id` (salvo el seed). El reembolso se calcula por `reference_id` + signo, NO depende del texto de `description` (robusto frente a strings de 5.1).

### Helper compartido de reembolso `public.refund_challenge_escrow`
Revierte el ledger real del reto. Idempotente por construcción: si ya se reembolsó, el neto por usuario es 0.

```sql
create or replace function public.refund_challenge_escrow(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_league_id uuid;
begin
  select league_id into v_league_id from public.challenges where id = p_challenge_id;
  -- Escrow neto retenido por usuario para ESTE reto = -SUM(amount). Si ya se reembolsó, da 0.
  for r in
    select user_id, -sum(amount) as refund
    from public.point_transactions
    where reference_id = p_challenge_id
    group by user_id
    having -sum(amount) > 0
  loop
    update public.league_members
      set wager_balance = wager_balance + r.refund
      where league_id = v_league_id and user_id = r.user_id;  -- fila ya bloqueada por el caller cuando aplica

    insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
    values (r.user_id, v_league_id, r.refund, 'challenge_escrow_refund', p_challenge_id);
  end loop;
end;
$$;
```

### Tabla de códigos de error (normativa)
| Código | Significado | Dónde |
|--------|-------------|-------|
| `P0001` | Apuesta `<= 0` | `create_challenge` (5.1) |
| `P0003` | Saldo insuficiente | `create_challenge`; `accept_challenge` |
| `P0004` | Partido ya iniciado al aceptar | `accept_challenge` (solo lanza; el trigger cancela/reembolsa) |
| `P0005` | Estado de reto inválido (no `'pending'`) tras `FOR UPDATE` | `accept`/`reject`/`cancel` |
| `P0006` | Cancelar un pozo con adhesiones | `cancel_challenge` |
| `42501` | No autenticado / no autorizado | las 3 RPCs |

La Server Action `getDuelsErrorMessage` mapea todos estos a español.

### Trigger de Expiración/Bloqueo Automático en `matches`
`AFTER UPDATE OF status ON public.matches` con guarda `WHEN (OLD.status = 'scheduled' AND NEW.status IS DISTINCT FROM 'scheduled')`. Ramifica por conteo de participantes: `pending(≥2) → active` (sin reembolso); `pending(=1) → canceled` (con `refund_challenge_escrow`). Usa `UPDATE ... RETURNING id` para reembolsar SOLO las filas efectivamente canceladas (idempotencia ante re-disparos).

### Consideraciones de Seguridad RLS
- Las políticas de select ya existen y permiten que todos los miembros de la liga lean desafíos y participantes.
- La inserción en `challenge_participants` la hace la RPC `accept_challenge` (que corre con privilegios `SECURITY DEFINER`), por lo que no es necesario añadir políticas de inserción directas desde el rol `authenticated`. Esto previene que un usuario inserte participaciones directamente eludiendo el pago o saldo.

### Manejo de Conexiones en Next.js Server Actions
Asegurarse de usar `createClient()` de servidor importado de `@/utils/supabase/server` que maneja correctamente las cookies y el middleware de Supabase.

### Puntos Clave de UX y Tokens HSL
- Fondo Indigo Oscuro (`#0D1B2A`), Carmesí de Acción (`#E63946`), Verde de Éxito (`#10B981`).
- Asegurar que los botones de acción tengan áreas de contacto óptimas (`48px` mínimo).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.2: Aceptación, Rechazo y Devolución de Garantía (Escrow)]
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns / #Complete Project Directory Structure]
- [Source: supabase/migrations/20260604024700_challenges_and_escrow.sql (esquema del módulo y tablas)]
- [Source: tests/integration/triggers.test.ts ( helpers e infraestructura de pruebas de integración )]

## Dev Agent Record

### Agent Model Used

Gemini 3.5 Flash (High)

### Debug Log References

- Las pruebas de integración se ejecutan localmente en el puerto `54321` configurando `.env.test.local`.
- Se requiere Docker activo.
- Se corrieron con éxito typecheck, Vitest Unit y Vitest Integration:
  - Unit tests: 123/123 pasados.
  - Integration tests: 60/60 pasados.

### Completion Notes List

- Implementada la migración SQL `20260604024800_accept_reject_challenges.sql` conteniendo el helper de reembolso atómico `refund_challenge_escrow`, las RPCs `accept_challenge`, `reject_challenge`, `cancel_challenge` y el trigger `tr_cancel_pending_challenges_on_match_start`.
- Integradas pruebas exhaustivas en `tests/integration/triggers.test.ts` para cubrir aceptación, rechazo, cancelación, expiración en kickoff (con/sin contraparte), idempotencia, concurrencia, invariante de conservación y rollback de reembolso múltiple (P1).
- Definidos los esquemas Zod en `duels.schema.ts` y las Server Actions `acceptChallenge`, `rejectChallenge` y `cancelChallenge` con mapeo de errores SQL en español en `duels.actions.ts`.
- Creado el componente mobile-first `AcceptDuelDialog.tsx` y adaptada la UI de `DuelsDashboard.tsx` para habilitar acciones reactivas de aceptación, rechazo y cancelación.

### File List

- [NEW] [20260604024800_accept_reject_challenges.sql](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/supabase/migrations/20260604024800_accept_reject_challenges.sql)
- [MODIFY] [triggers.test.ts](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/tests/integration/triggers.test.ts)
- [MODIFY] [duels.schema.ts](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/app/actions/duels.schema.ts)
- [MODIFY] [duels.actions.ts](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/app/actions/duels.actions.ts)
- [NEW] [AcceptDuelDialog.tsx](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/components/duels/AcceptDuelDialog.tsx)
- [MODIFY] [DuelsDashboard.tsx](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/components/duels/DuelsDashboard.tsx)
- [MODIFY] [5-2-aceptacion-rechazo-y-devolucion-de-garantia-escrow.md](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/implementation-artifacts/5-2-aceptacion-rechazo-y-devolucion-de-garantia-escrow.md)

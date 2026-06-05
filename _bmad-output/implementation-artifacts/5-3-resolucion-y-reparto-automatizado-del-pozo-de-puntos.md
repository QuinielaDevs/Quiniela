---
baseline_commit: dff538904fe8684b61fad1b281376a00fbe2f424
---
# Story 5.3: Resolución y Reparto Automatizado del Pozo de Puntos

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **jugador participante en apuestas**,
I want **que los desafíos se resuelvan y los pozos de puntos se repartan automáticamente al finalizar el partido**,
so that **recibir mis ganancias de forma inmediata e indiscutible**.

## Acceptance Criteria

1. **Given** un partido de la quiniela que transiciona a estado oficial `'finished'` con marcador real (`home_score` y `away_score` no nulos),
   **When** se actualiza el partido en la base de datos `public.matches` desde cualquier estado previo distinto a `'finished'`,
   **Then** se ejecuta un trigger SQL de forma atómica (`tr_resolve_challenges_on_match_status_change`) que procesa las predicciones normales y los duelos asociados.

2. **And** para el **Accrual Continuo de Predicciones de la Liga**:
   - Por cada predicción en `public.predictions` para ese partido (`match_id`) **no evaluada aún (`evaluated_at IS NULL`)** — guarda de idempotencia que NO depende del monto, para no re-procesar predicciones que legítimamente sacaron `0.00`:
     - Se calcula el puntaje final usando `public.score_prediction(home_score_pred, away_score_pred, home_score, away_score, multiplier)`.
     - Se guarda el puntaje en `predictions.points_earned` **y se marca `evaluated_at = now()`** (una sola vez).
     - Si el puntaje es mayor a 0, se suma de manera atómica a `wager_balance` del miembro y se registra un `point_transactions` positivo con `description = 'match_accrual'` y `reference_id = match_id`.
   - **Nota de modelo:** este accrual alimenta el `wager_balance` (moneda de duelos, modelo A); la clasificación deportiva de `standings.ts` sigue calculándose on-the-fly e independiente (no lee `points_earned`).

3. **And** para la **Resolución de Desafíos Activos (Duelos)**:
   - Por cada desafío en `public.challenges` asociado a ese partido (`match_id`) que tenga estado `'active'`:
     - Se obtienen todos los participantes de `public.challenge_participants`.
     - Se calcula el puntaje base (`multiplier = 1.00`, sin antelación) de cada participante con `public.score_prediction`.
     - Se determina el puntaje máximo (`v_max_score`) y los ganadores (score == max), **ordenados por `user_id`** (determinismo del residuo y del lock).
     - **Caso sin ganador (max = 0):** si `v_max_score = 0.00` (NINGÚN participante acertó), el desafío NO se liquida: se **reembolsa el escrow a todos** vía `public.refund_challenge_escrow(challenge_id)` (etiquetado `'challenge_escrow_refund'`), el estado pasa a `'completed'` y `winner_ids = '{}'`. [Decisión de diseño explícita]
     - **Caso con ganador(es) (max > 0):**
       - El **pozo total se computa desde el ledger real**, no por importe asumido: `v_total_pot := -SUM(point_transactions.amount) WHERE reference_id = challenge_id` (igual filosofía que `refund_challenge_escrow`; garantiza que se reparte EXACTAMENTE lo retenido).
       - Reparto con **residuo determinista** (conservación exacta): `v_base := trunc(v_total_pot / v_winner_count, 2)`; `v_remainder := v_total_pot - (v_base * v_winner_count)`. El primer ganador (menor `user_id`) recibe `v_base + v_remainder`; el resto `v_base`. Así `SUM(payouts) == v_total_pot` EXACTO (sin céntimos perdidos → no rompe conservación).
       - Por cada ganador se añade su payout a `wager_balance` (bloqueando filas en orden de `user_id`) y se registra `point_transactions` con `amount = payout_i`, `description = 'challenge_payout'`, `reference_id = challenge_id`.
       - El desafío pasa a `'completed'` con `winner_ids` (uuid[]).

4. **And** si un partido es marcado con estado `'canceled'` o `'suspended'` en `public.matches` (desde cualquier estado previo distinto):
   - El trigger `tr_resolve_challenges_on_match_status_change` cancela en cascada todos los desafíos asociados en estado `'pending'` o `'active'` mediante `UPDATE ... WHERE status IN ('pending','active') RETURNING id`, y por cada `id` retornado invoca `public.refund_challenge_escrow(challenge_id)` (reembolso a TODOS los participantes, idempotente).
   - Las predicciones normales de ese partido **simplemente no se evalúan** (el accrual vive solo en la rama `'finished'`): quedan con `evaluated_at IS NULL` / `points_earned NULL` y NO suman al `wager_balance`. (No se fuerza `points_earned = 0.00`.)
   - **Reconciliación de vocabulario de estados (corrige bug en 5.2 desplegado):** el trigger de kickoff de 5.2 (`fn_cancel_pending_challenges_on_match_start`) ramifica hoy sobre `('canceled', 'postponed')`, pero `'postponed'` NO existe en el `CHECK` de `matches.status` (`'scheduled','live','finished','suspended','canceled'`) y `'suspended'` cae por la rama incorrecta. La migración de 5.3 hace `CREATE OR REPLACE` de esa función cambiando la condición a `('canceled', 'suspended')` para alinear ambos triggers. Como `refund_challenge_escrow` es idempotente, el solape entre ambos triggers en una transición directa `scheduled→canceled/suspended` no produce doble reembolso.

5. **And** se diseña e implementa una **Ruta REST Segura `/api/sync`** (`src/app/api/sync/route.ts`):
   - Expone un método `POST` accesible únicamente con `Authorization: Bearer <CRON_SECRET>` (un solo mecanismo — estándar de Vercel Cron; sin `x-sync-secret` para reducir superficie). Si el secret falta o no coincide → `401`. Si la env `CRON_SECRET` no está configurada → `500` (no `401` silencioso).
   - **Devuelve `NextResponse.json(body, { status })` con códigos HTTP reales — NO `ServerActionResult`** (ese tipo es el contrato de las Server Actions del cliente; un cron espera status codes). El `body` puede usar la forma `{ success, error?, updated? }`, pero el status manda: `200` éxito (`{ updated: n }`), `400` payload inválido, `401` no autorizado, `500` fallo de BD/config.
   - **Valida el payload con Zod** (`syncMatchesSchema`: array de `{ external_ref | match_id (uuid), status (enum del CHECK), home_score int≥0?, away_score int≥0? }`); si no valida → `400`.
   - Eficiencia bajo Vercel Hobby (timeout 10s): actualización en bloque (bulk update/upsert) en una sola llamada de Supabase. (Nota: el bulk update dispara el trigger de resolución por-fila; si muchos partidos finalizan a la vez con loops pesados, vigilar el límite de 10s.)
   - Cliente Supabase con `SUPABASE_SERVICE_ROLE_KEY` (bypassa RLS para escribir el catálogo de partidos). Documentar `CRON_SECRET` y `SUPABASE_SERVICE_ROLE_KEY` en `.env.example` / Dev Notes.

6. **And** se deben incluir **Pruebas de Integración de Base de Datos** (`Vitest DB-Integration`) en `tests/integration/triggers.test.ts` que validen:
   - **(a) Duelo 1v1 directo sin empate:** gana el de marcador exacto → recibe el pozo completo, el perdedor 0, reto `'completed'`, `winner_ids` correcto.
   - **(b) Empate con pozo divisible:** 2 ganadores, pozo 150 → 75 cada uno, reto `'completed'`.
   - **(b') Empate con pozo NO divisible (rompe-conservación si está mal):** pozo abierto, 3 ganadores, pozo total 100 → **`SUM(challenge_payout) == 100.00` EXACTO**; el ganador de menor `user_id` recibe 33.34 y los otros 33.33 (residuo determinista); conservación de liga intacta. *(Sin este caso, el reparto puede perder céntimos y el test (b) lo enmascara.)*
   - **(c) Accrual continuo:** al `'finished'`, las predicciones actualizan `points_earned` + `evaluated_at`, suman a `wager_balance` y registran `'match_accrual'`.
   - **(d) Sin ganador (max = 0):** todos fallan su predicción → el reto se reembolsa a todos (`'challenge_escrow_refund'`), `'completed'`, `winner_ids = '{}'`; cada participante recobra su escrow exacto.
   - **(e) Cancelación/suspensión:** probar `'canceled'` Y `'suspended'` por separado (recorren ramas distintas en los dos triggers) → retos `'pending'`/`'active'` pasan a `'canceled'` y se reembolsan TODOS los participantes.
   - **(f) Transiciones directas (doble trigger):** **(f1)** `scheduled→finished` directo con pozo abierto poblado → el pozo se activa Y se resuelve a `'completed'` en el mismo UPDATE (NO se queda `'pending'`/`'active'` colgado con escrow huérfano). **(f2)** `scheduled→canceled` directo con pozo poblado → termina `'canceled'` y todos reembolsados (sin doble reembolso pese al solape de triggers).
   - **(g) Accrual + payout en el mismo match/usuario:** un usuario con predicción de liga Y participación en duelo del mismo partido → recibe DOS transacciones (`'match_accrual'` + `'challenge_payout'`), su `wager_balance` refleja ambas, conservación intacta (verifica que ninguna constraint colapse una de las corrientes).
   - **(h) Idempotencia de re-disparo (accrual Y payout):** re-actualizar un partido ya `'finished'` (`finished→finished` o cambio de `matchday`) → 0 transacciones nuevas, retos `'completed'` sin re-liquidar, `wager_balance` sin delta. Verificar también que una predicción con `points_earned = 0` legítimo NO se re-procesa (gracias a `evaluated_at`).
   - **(i) Atomicidad con fallo a mitad del reparto multi-ganador:** inyectar fallo al acreditar al k-ésimo ganador → rollback TOTAL (ni accrual, ni payouts parciales, ni cambio de estado del reto, ni del `match.status`); estado idéntico al previo.
   - **(j) Sin overflow:** un pozo grande (cercano al techo de `numeric(12,2)`) se acredita sin `22003 numeric field overflow`.
   - **(k) Invariante de conservación como POST-CONDICIÓN** de TODOS los casos anteriores: `wager_balance == COALESCE(SUM(point_transactions.amount), 0)` por miembro (comparar en SQL `numeric`).

7. **And** todas las pruebas unitarias y de integración corren y pasan en verde (`npm run test:unit`, `npm run test:integration`), y no hay errores de TypeScript ni compilación.

## Tasks / Subtasks

- [x] **Tarea 1 — Migración SQL `supabase/migrations/20260604195000_resolve_challenges.sql`** (AC: #1-#4)
  - [x] **Esquema:** añadir `predictions.evaluated_at timestamptz` (NULL = no evaluada) + índice parcial `where evaluated_at is null`. Migrar `league_members.wager_balance` y `point_transactions.amount` de `numeric(6,2)` → **`numeric(12,2)`** (evita `22003 numeric field overflow` al acreditar pozos/accruals grandes; el techo de 9999.99 es insuficiente para pozos abiertos). Migración forward (`ALTER TABLE ... TYPE numeric(12,2)`), no muta migraciones desplegadas.
  - [x] **`CREATE OR REPLACE FUNCTION public.fn_cancel_pending_challenges_on_match_start()`** para corregir el vocabulario de estados: cambiar la rama `if new.status in ('canceled', 'postponed')` → `in ('canceled', 'suspended')` (`'postponed'` no existe en el CHECK de `matches.status`). Alinea el trigger de kickoff de 5.2 con los estados reales.
  - [x] Crear `public.fn_resolve_challenges_on_match_status_change()` (`security definer set search_path=''`):
    - [x] **Rama finished** (guarda `new.status = 'finished' and old.status is distinct from 'finished'`, con `home_score`/`away_score` no nulos):
      - [x] Accrual: loop sobre `predictions where match_id = new.id and evaluated_at is null`; `score_prediction(...mult real...)`; set `points_earned` + `evaluated_at = now()`; si `>0` suma a `wager_balance` + `'match_accrual'`.
      - [x] Liquidación: loop sobre `challenges where match_id = new.id and status = 'active'`; calcular `v_max_score` y `v_winners` (orden `user_id`); **si `v_max_score = 0` → `refund_challenge_escrow` + `completed` + `winner_ids='{}'`**; si no, `v_total_pot := -SUM(point_transactions.amount where reference_id = challenge)`, repartir con `trunc` + residuo al primer ganador, acreditar + `'challenge_payout'`, `completed` + `winner_ids`. Bloqueo ordenado por `user_id`.
    - [x] **Rama cancel/suspend** (`new.status in ('canceled','suspended') and old.status is distinct from new.status`): `UPDATE challenges SET status='canceled' WHERE match_id=new.id AND status IN ('pending','active') RETURNING id` → `refund_challenge_escrow(id)` por cada uno.
  - [x] Crear el trigger `tr_resolve_challenges_on_match_status_change` `AFTER UPDATE ON public.matches`.
  - [x] **Dependencia de orden (invariante, no conveniencia):** Postgres dispara triggers `AFTER` en orden alfabético; `tr_cancel_pending_challenges_on_match_start` corre antes que `tr_resolve_challenges_on_match_status_change`, garantizando que un pozo poblado se active antes de resolverse en una transición directa `scheduled→finished`. Documentar en comentario: `-- ORDEN CRÍTICO: no renombrar sin revisar la interacción.`
  - [x] Idempotencia: accrual por `evaluated_at is null`; liquidación por `status='active'` + la guarda `old.status is distinct from 'finished'`. Ningún guard depende del MONTO.

- [x] **Tarea 2 — Pruebas de integración de base de datos en `tests/integration/triggers.test.ts`** (AC: #6) — reutilizar helpers de `setup.ts`; sembrar saldos con su fila gemela de ledger.
  - [x] **(a)** Duelo 1v1 sin empate: ganador recibe el pozo, perdedor 0, `'completed'`, `winner_ids`.
  - [x] **(b)** Empate con pozo divisible (150/2 = 75 exacto).
  - [x] **(b')** Empate con pozo NO divisible (3 ganadores, pozo 100): `SUM(challenge_payout) == 100.00`, residuo (33.34/33.33/33.33) al menor `user_id`, conservación intacta.
  - [x] **(c)** Accrual: `points_earned` + `evaluated_at` seteados, `wager_balance` sube, `'match_accrual'`.
  - [x] **(d)** Sin ganador (todos 0): reembolso a todos (`'challenge_escrow_refund'`), `'completed'`, `winner_ids='{}'`.
  - [x] **(e)** Cancelación y suspensión por separado (`'canceled'` y `'suspended'`): retos pending/active → canceled, todos reembolsados.
  - [x] **(f1)** `scheduled→finished` directo con pozo poblado → activado y resuelto a `'completed'` en un solo UPDATE (sin escrow huérfano). **(f2)** `scheduled→canceled` directo con pozo poblado → `'canceled'`, todos reembolsados, sin doble reembolso.
  - [x] **(g)** Accrual + payout en mismo match/usuario: 2 transacciones distintas, `wager_balance` refleja ambas, conservación.
  - [x] **(h)** Idempotencia de re-disparo (accrual Y payout): 2.º disparo = 0 transacciones nuevas; predicción con 0 legítimo no se re-procesa.
  - [x] **(i)** Atomicidad: fallo en el k-ésimo ganador → rollback total (accrual + payouts parciales + estado reto + `match.status`).
  - [x] **(j)** Sin overflow con pozo grande (cerca del techo `numeric(12,2)`).
  - [x] **(k)** Conservación como post-condición de TODOS los casos.

- [x] **Tarea 3 — Endpoint de sincronización REST `/api/sync/route.ts`** (AC: #5)
  - [x] Crear `src/app/api/sync/route.ts` (handler `POST`) que valide `Authorization: Bearer <CRON_SECRET>` (único mecanismo) → `401` si falta/no coincide, `500` si la env no está configurada.
  - [x] Validar el body con Zod (`syncMatchesSchema`); `400` si no valida.
  - [x] Bulk update/upsert de partidos en una sola llamada con cliente service role (`SUPABASE_SERVICE_ROLE_KEY`).
  - [x] **Devolver `NextResponse.json(body, { status })`** con status reales (200/400/401/500) — NO `ServerActionResult`.
  - [x] Documentar `CRON_SECRET` y `SUPABASE_SERVICE_ROLE_KEY` en `.env.example`.

- [x] **Tarea 4 — Validación del Proyecto y Tests** (AC: #7)
  - [x] Correr `npm run typecheck` y verificar que no existan errores de compilación de TypeScript.
  - [x] Correr `npm run test:integration` and `npm run test:unit` para verificar que la suite completa pase en verde.

## Dev Notes

### Fórmulas y Contrato SQL de Resolución
El cálculo de puntos de los retos y del accrual continuo de la liga se basa en la función `public.score_prediction` definida en la historia 5.1:
```sql
-- public.score_prediction(home_pred, away_pred, home_score, away_score, multiplier)
```
Para los retos se debe pasar `1.00` como multiplicador para ignorar la antelación de la predicción y obtener la puntuación base.

### Snippet de la Función Trigger de Resolución
Se propone la siguiente lógica autoritativa para el trigger:

```sql
create or replace function public.fn_resolve_challenges_on_match_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pred         record;
  v_challenge    record;
  v_winners      uuid[];
  v_winner_id    uuid;
  v_max_score    numeric(6, 2);
  v_winner_count int;
  v_part_count   int;
  v_total_pot    numeric(12, 2);
  v_payout       numeric(12, 2);
begin
  -- 1. Cuando el partido pasa a 'finished' desde un estado previo distinto
  if new.status = 'finished' and old.status is distinct from 'finished' then
    if new.home_score is not null and new.away_score is not null then
      
      -- (a) Accrual continuo de predicciones normales de liga
      for v_pred in 
        select id, league_id, user_id, home_score_pred, away_score_pred, multiplier
        from public.predictions
        where match_id = new.id
          and evaluated_at is null   -- guarda de idempotencia por ESTADO, no por monto
      loop
        declare
          v_points numeric(12, 2);
        begin
          v_points := public.score_prediction(
            v_pred.home_score_pred, v_pred.away_score_pred,
            new.home_score, new.away_score,
            v_pred.multiplier
          );
          
          update public.predictions
          set points_earned = v_points, evaluated_at = now()
          where id = v_pred.id;
          
          if v_points > 0.00 then
            update public.league_members
            set wager_balance = wager_balance + v_points
            where league_id = v_pred.league_id and user_id = v_pred.user_id;
            
            insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
            values (v_pred.user_id, v_pred.league_id, v_points, 'match_accrual', new.id);
          end if;
        end;
      end loop;

      -- (b) Liquidación de retos activos
      for v_challenge in
        select id, league_id, points_bet
        from public.challenges
        where match_id = new.id
          and status = 'active'
      loop
        -- Puntuación máxima del desafío (base, multiplier = 1.00)
        select max(public.score_prediction(cp.prediction_home, cp.prediction_away, new.home_score, new.away_score, 1.00))
        into v_max_score
        from public.challenge_participants cp
        where cp.challenge_id = v_challenge.id;

        if v_max_score = 0.00 then
          -- Sin ganador (nadie acertó): NO se liquida, se reembolsa a todos (idempotente, etiqueta refund).
          perform public.refund_challenge_escrow(v_challenge.id);
          update public.challenges
          set status = 'completed', winner_ids = '{}'::uuid[]
          where id = v_challenge.id;
        else
          -- Ganadores ORDENADOS por user_id (determinismo del residuo y del lock).
          select array_agg(cp.user_id order by cp.user_id)
          into v_winners
          from public.challenge_participants cp
          where cp.challenge_id = v_challenge.id
            and public.score_prediction(cp.prediction_home, cp.prediction_away, new.home_score, new.away_score, 1.00) = v_max_score;

          v_winner_count := cardinality(v_winners);

          -- Pozo = escrow REAL retenido en el ledger (no points_bet * count).
          select coalesce(-sum(amount), 0)
          into v_total_pot
          from public.point_transactions
          where reference_id = v_challenge.id;

          -- Reparto con residuo determinista: SUM(payouts) == v_total_pot EXACTO.
          declare
            v_base      numeric(12,2) := trunc(v_total_pot / v_winner_count::numeric, 2);
            v_remainder numeric(12,2) := v_total_pot - (trunc(v_total_pot / v_winner_count::numeric, 2) * v_winner_count);
            v_i         int := 0;
          begin
            -- Lock en orden para evitar deadlocks.
            perform 1 from public.league_members
            where league_id = v_challenge.league_id and user_id = any(v_winners)
            order by user_id for update;

            foreach v_winner_id in array v_winners loop
              v_payout := v_base + case when v_i = 0 then v_remainder else 0 end;  -- residuo al primer ganador (menor user_id)
              update public.league_members
              set wager_balance = wager_balance + v_payout
              where league_id = v_challenge.league_id and user_id = v_winner_id;

              insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
              values (v_winner_id, v_challenge.league_id, v_payout, 'challenge_payout', v_challenge.id);
              v_i := v_i + 1;
            end loop;
          end;

          update public.challenges
          set status = 'completed', winner_ids = v_winners
          where id = v_challenge.id;
        end if;
      end loop;
      
    end if;

  -- 2. Cuando el partido se cancela o suspende oficialmente desde un estado previo distinto
  elsif new.status in ('canceled', 'suspended') and old.status is distinct from new.status then
    -- Cancelar retos activos o pendientes y devolver escrow
    for v_challenge in
      update public.challenges
      set status = 'canceled'
      where match_id = new.id
        and status in ('pending', 'active')
      returning id
    loop
      perform public.refund_challenge_escrow(v_challenge.id);
    end loop;
  end if;

  return new;
end;
$$;
```

### Vocabulario de `description` en `point_transactions`
- `'match_accrual'` — puntos ganados por predicciones normales de liga (alimenta `wager_balance`, modelo A).
- `'challenge_payout'` — cobro de pozos ganados en duelos.
- `'challenge_escrow_refund'` — reembolso por cancelación/suspensión o por duelo sin ganador (vía `refund_challenge_escrow`).
- (de 5.1/5.2: `'challenge_escrow_hold'`, `'seed_initial_balance'`.)

### Reconciliación del trigger de 5.2 (corrección de bug desplegado)
La migración de 5.3 hace `CREATE OR REPLACE FUNCTION public.fn_cancel_pending_challenges_on_match_start()` cambiando `if new.status in ('canceled', 'postponed')` → `in ('canceled', 'suspended')`. Motivo: `'postponed'` NO está en el `CHECK` de `matches.status` (`'scheduled','live','finished','suspended','canceled'`) → era código muerto, y `'suspended'` desde `scheduled` caía por la rama `else` (movía pozos poblados a `'active'`). No se edita la migración ya desplegada (`20260604024800_*`); se corrige hacia adelante.

### Precisión numérica — evitar overflow
`league_members.wager_balance` y `point_transactions.amount` se migran a **`numeric(12,2)`** (antes `numeric(6,2)`, techo 9999.99). Un pozo abierto (`points_bet × N participantes`) supera fácilmente 9999.99; acreditar el payout a un ganador con `numeric(6,2)` lanzaría `22003 numeric field overflow` y revertiría todo el trigger (el partido nunca liquidaría). Variables internas del trigger ya usan `numeric(12,2)`.

### Dependencia de orden de triggers (invariante)
Postgres dispara triggers `AFTER UPDATE` en orden alfabético del nombre. `tr_cancel_pending_challenges_on_match_start` < `tr_resolve_challenges_on_match_status_change`, por lo que en una transición directa `scheduled→finished` el pozo poblado se transiciona a `'active'` (cancel trigger) ANTES de que el resolve trigger lo liquide. **No renombrar ninguno de los dos sin revisar esta interacción.**

### Consideraciones sobre deadlocks
Al realizar actualizaciones concurrentes en `league_members`, siempre bloquear y actualizar las filas ordenadas por `user_id` para garantizar que la adquisición de bloqueos sea determinista y no cause interbloqueos (deadlocks) en PostgreSQL.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.3: Resolución y Reparto Automatizado del Pozo de Puntos]
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns]
- [Source: supabase/migrations/20260604024800_accept_reject_challenges.sql]

## Dev Agent Record

### Agent Model Used

Gemini 3.5 Flash (High)

### Debug Log References

- N/A

### Completion Notes List

- **Esquema de BD ampliado:** Se alteraron las columnas `league_members.wager_balance` y `point_transactions.amount` a `numeric(12,2)` para evitar overflows en pozos grandes. Se añadió `predictions.evaluated_at` con índice parcial para acelerar búsquedas de no-evaluadas.
- **Triggers y Funciones de Base de Datos:** Se implementó `public.fn_resolve_challenges_on_match_status_change` y el trigger asociado que realiza el accrual de predicciones normales de liga y resuelve desafíos activos de forma atómica. Se resolvió el reparto de pozos con redondeo y residuo determinista asignado al ganador con menor ID (sin pérdida de céntimos).
- **Ruta REST Segura `/api/sync`:** Se creó el handler `POST` con autorización Bearer mediante `CRON_SECRET` y validación de payload con Zod (`syncMatchesSchema`) para realizar actualizaciones por lote con cliente service role.
- **Pruebas de Integración y Unidad:** Se expandió `tests/integration/triggers.test.ts` con casos para 1v1 directo, empates divisibles y no divisibles, reembolsos por cancelación/suspensión, idempotencia, atomicidad ante fallas, y conservación de saldo. Se añadió `tests/unit/sync-route.test.ts` con cobertura para validaciones y códigos HTTP de la ruta sync.

### File List

- [supabase/migrations/20260604195000_resolve_challenges.sql](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/supabase/migrations/20260604195000_resolve_challenges.sql)
- [tests/integration/triggers.test.ts](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/tests/integration/triggers.test.ts)
- [src/app/api/sync/route.ts](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/app/api/sync/route.ts)
- [tests/unit/sync-route.test.ts](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/tests/unit/sync-route.test.ts)
- [.env.example](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/.env.example)

### Change Log

- **2026-06-05:** Implementación completa de resolución y reparto de puntos automatizados, trigger de fin de partido, endpoint seguro de sincronización `/api/sync`, y suite de pruebas integral. Estado transicionado a `review`.

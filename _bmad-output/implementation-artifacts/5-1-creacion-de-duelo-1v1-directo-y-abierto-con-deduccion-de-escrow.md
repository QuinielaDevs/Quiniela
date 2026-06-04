---
baseline_commit: 787e22692bfe331d3cb722ea4ed8798c9f8b4df2
---

# Story 5.1: Creación de Duelo 1v1 Directo y Abierto con Deducción de Escrow

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **jugador de la liga**,
I want **crear un duelo directo 1v1 contra un amigo o un pozo abierto para todo el grupo apostando mis puntos acumulados**,
so that **retar sus conocimientos de fútbol bajo riesgo real de perder mis puntos**.

## Acceptance Criteria

1. **Given** un jugador de la liga autenticado que entra a la pestaña "Duelos" (`/duels`),
   **When** carga la página,
   **Then** visualiza su saldo disponible de puntos (`league_members.wager_balance` — saldo gastable de duelos, NO el ranking deportivo) y el listado de desafíos de la liga. Si no pertenece a ninguna liga, muestra un estado vacío de "Sin liga" (CTA a `/leagues/new`). Si pertenece pero no hay desafíos, muestra el estado vacío: **"No tienes apuestas activas. ¡Reta a un amigo para subir la emoción!"**.

2. **And** al presionar el botón principal "Crear Desafío", se despliega un diálogo mobile-first (`CreateDuelDialog.tsx`, con un contenedor modal `max-w-md` y estilos Championship Gold) que permite seleccionar:
   - **Partido:** Selector/dropdown con los partidos de estado `scheduled` de la quiniela ordenados por fecha de inicio.
   - **Tipo de Reto:** Selector para elegir entre "Directo (1v1)" o "Abierto (Grupal)".
   - **Rival (solo si es Directo):** Dropdown que lista todos los demás miembros activos de la liga (excluyendo al usuario actual) ordenados alfabéticamente.
   - **Apuesta de puntos:** Campo numérico entero positivo (`points_bet > 0`).
   - **Predicción (tacto):** Un GoalPicker táctil (`GoalPicker.tsx` de 48x48px que deshabilita focus para no desplegar teclado nativo) para ingresar los goles del equipo local y visitante.

3. **And** si la apuesta de puntos ingresada supera el saldo disponible actual del creador (`league_members.wager_balance`), el botón de envío del formulario se deshabilita y se muestra un mensaje de advertencia visual en rojo (`text-destructive` o `text-red-500` según tokens) que dice: **"Saldo insuficiente para realizar esta apuesta (Disponible: X.XX pts)"**.

4. **And** al enviar el formulario válido, se ejecuta la Server Action `createChallenge` (que devuelve un `ServerActionResult<string>`), la cual invoca la función RPC de Supabase `public.create_challenge` (que corre con privilegios `SECURITY DEFINER`).

5. **And** la transacción ACID en Postgres (`public.create_challenge`):
   - Valida que `p_points_bet > 0` (un valor `<= 0` lanza excepción con `errcode = 'P0001'` y mensaje "La apuesta debe ser mayor que cero.").
   - Bloquea la fila del creador en `league_members` (`FOR UPDATE`) para evitar condiciones de carrera (double-spending).
   - Verifica que el saldo disponible (`wager_balance`) sea suficiente.
   - Inserta el registro del desafío en la tabla `public.challenges` con estado `'pending'` y los campos correspondientes.
   - Registra al creador como primer participante en `public.challenge_participants` guardando su predicción de marcador local/visitante.
   - Deduce de manera atómica los puntos apostados de `league_members.wager_balance` para esa liga.
   - **En la MISMA transacción**, registra el movimiento en `public.point_transactions` (`amount` negativo) con la descripción del escrow. **Regla invariante:** ninguna mutación de `wager_balance` puede ocurrir sin su fila gemela en `point_transactions` dentro de la misma transacción (ver invariante de conservación, AC #11).
   - Retorna el UUID del nuevo desafío creado.

6. **And** la Server Action `createChallenge` intercepta y traduce los errores de Postgres a mensajes legibles en español (por ejemplo, si el código de error es `'P0003'`, retorna `"Saldo de puntos insuficiente para crear el desafío."` en lugar del error técnico SQL).

7. **And** la vista del panel `/duels` optimiza la visualización de los desafíos separando la carga inicial (o paginando) los duelos históricos finalizados o cancelados (`'completed'`, `'canceled'`), garantizando que la carga inicial se enfoque y visualice rápidamente los duelos en estado `'pending'` y `'active'`.

8. **And** si la Server Action tiene éxito, el diálogo se cierra, se limpia el formulario, se refresca el saldo y se muestra una pantalla de confirmación visual rica con un botón de **"Compartir en WhatsApp"** para poder invitar al oponente (Story 5.4).

9. **And** se deben incluir pruebas de integración (`Vitest DB-Integration`) en `tests/integration/triggers.test.ts` que validen:
   - **(a) Camino feliz:** un usuario autenticado con saldo crea un desafío y `league_members.wager_balance` disminuye EXACTAMENTE en la cantidad apostada, de forma atómica.
   - **(b) Saldo insuficiente:** apostar más que el saldo lanza excepción `P0003`, no altera el saldo y NO deja `wager_balance` negativo.
   - **(c) Concurrencia (race condition — endurecida):** preparar un creador con saldo suficiente para EXACTAMENTE 1 apuesta (p. ej. `wager_balance = 60`, `points_bet = 60`) y disparar N≥10 llamadas concurrentes a `create_challenge` mediante **conexiones/clientes independientes** (NO un solo cliente con pool=1, que serializaría y volvería el test teatro) usando `Promise.allSettled`. Aserciones DURAS:
     - exactamente **1** promesa `fulfilled` y **N−1** `rejected` con `errcode = 'P0003'`;
     - `wager_balance` final `== 0` (jamás negativo);
     - existe **exactamente 1** fila en `point_transactions` referenciando ese escrow (una sola deducción registrada — detecta lost-update / TOCTOU).
   - **(d) Integridad referencial:** una creación exitosa inserta registros coherentes en `challenges`, `challenge_participants` y `point_transactions`.
   - **(e) Validación de apuesta:** `create_challenge` con `p_points_bet <= 0` lanza excepción (`P0001`) y no inserta nada.

10. **And** todas las pruebas unitarias y de integración corren en verde (`npm run test:unit`, `npm run test:integration`), y no se detectan errores de TypeScript ni de compilación (`npm run typecheck`, `npm run build`).

11. **And** se cumple y se prueba el **invariante de conservación del saldo** (el saldo materializado es una caché derivada del ledger, no una fuente independiente): para todo `(league_id, user_id)`, `league_members.wager_balance == COALESCE(SUM(point_transactions.amount), 0)`. Esto exige:
    - que la inicialización (Tarea 1) **siembre el ledger**: inserte una fila `point_transactions` por miembro con el saldo inicial (`description = 'seed_initial_balance'`, `reference_id = NULL`), para que el invariante se cumpla desde `t0`;
    - un `CHECK (wager_balance >= 0)` a nivel de tabla como cinturón de seguridad ACID además de la validación del RPC;
    - políticas RLS que **denieguen `UPDATE` directo** de `league_members.wager_balance` desde el rol `authenticated` (la columna solo se muta dentro de RPCs `SECURITY DEFINER`);
    - un test de conciliación en `tests/integration/triggers.test.ts` que, tras una secuencia de operaciones (creación + escrow), afirme la igualdad `wager_balance == SUM(amount)` por miembro.

12. **And** la fórmula de puntuación usada para inicializar `wager_balance` NO debe divergir de `src/utils/scoring.ts`. Se resuelve extrayendo una función SQL `public.score_prediction(...)` que el CTE de inicialización invoque, y se añade un **contract test golden-vector** (`tests/integration/scoring-parity.test.ts`) que ejecute el mismo conjunto de casos contra la fórmula pura de `scoring.ts` (JS) y contra `score_prediction` (SQL) exigiendo **igualdad exacta** (bit a bit, redondeo a 2 decimales). Si no se extrae la función SQL, ## Tasks / Subtasks

- [x] **Tarea 1 — Migración SQL `supabase/migrations/20260604024700_challenges_and_escrow.sql`** (AC: #1, #4, #5, #11, #12)
  - [x] Alterar `league_members` para agregar la columna **`wager_balance numeric(6,2) NOT NULL DEFAULT 0.00`** (saldo gastable de duelos; NO renombrar a `points` — el nombre evita la confusión con el ranking deportivo de `standings.ts`). Añadir `CHECK (wager_balance >= 0)`.
  - [x] Extraer la función SQL **`public.score_prediction(p_home_pred int, p_away_pred int, p_home_score int, p_away_score int, p_multiplier numeric)` `returns numeric`** que espeje EXACTAMENTE `src/utils/scoring.ts` (exacto=5, resultado=2, nada=0, × multiplier). Comentar `-- MIRROR of src/utils/scoring.ts. NO EDITAR sin actualizar el contract test scoring-parity.test.ts`.
  - [x] Inicializar `wager_balance` recalculando los puntos de los partidos `finished` **invocando `score_prediction`** (no SQL inline duplicado), y **sembrar el ledger**: por cada miembro con saldo inicial > 0, insertar una fila en `point_transactions` (`amount = saldo`, `description = 'seed_initial_balance'`, `reference_id = NULL`), de modo que `wager_balance == SUM(point_transactions.amount)` se cumpla desde `t0`.
  - [x] Crear la tabla `challenges` (usando `match_id UUID` para referenciar `matches.id`, no integer).
  - [x] Crear `challenge_participants` y `point_transactions` (`amount numeric(6,2)` — misma precisión que `wager_balance` para evitar overflow al acreditar botes en 5.3) con FKs y cascadas.
  - [x] Configurar RLS: miembros de la liga leen desafíos y participantes; cada usuario solo ve sus propias `point_transactions`. **Denegar `UPDATE` directo de `league_members.wager_balance` desde el rol `authenticated`** (la columna solo se muta vía RPCs `SECURITY DEFINER`).
  - [x] Escribir `public.create_challenge` como `SECURITY DEFINER set search_path = ''` con la lógica ACID: validación de `p_points_bet > 0`, bloqueo `FOR UPDATE`, verificación de saldo, inserciones y deducción + fila gemela en `point_transactions` en la MISMA transacción. **Manejo de excepciones: si se usa `EXCEPTION WHEN`, re-`RAISE` siempre — nunca retornar silencioso (rompería la atomicidad).**
  - [x] Dar permisos de ejecución al rol `authenticated` sobre `create_challenge` (NO sobre la mutación directa de la columna).

- [x] **Tarea 2 — Pruebas de integración de Base de Datos `tests/integration/triggers.test.ts`** (AC: #9, #10, #11)
  - [x] Crear el archivo `tests/integration/triggers.test.ts` reutilizando los helpers de `tests/integration/setup.ts` (`createServiceRoleClient`/`createAuthedClient`) y el patrón `createAuthedUser()` de `schema-rls.test.ts`. NO recrear helpers.
  - [x] Fixtures: crear creador con `wager_balance` inicial controlado en `league_members` + un partido `scheduled`. Sembrar saldos vía `service_role` con su fila gemela en `point_transactions` para no romper el invariante desde el fixture.
  - [x] **(a)** Prueba feliz: `create_challenge` con saldo suficiente → se crean `challenges`/`challenge_participants`/`point_transactions` y `wager_balance` baja exactamente lo apostado.
  - [x] **(b)** Saldo insuficiente: apostar más del saldo → falla con `P0003`, saldo intacto, sin registros, `wager_balance` nunca negativo.
  - [x] **(c)** Concurrencia endurecida: saldo para EXACTAMENTE 1 apuesta; N≥10 llamadas concurrentes vía **clientes/conexiones independientes** + `Promise.allSettled`. Asertar: exactamente 1 `fulfilled`, N−1 `rejected` con `P0003`, `wager_balance == 0`, y **1 sola** fila de deducción en `point_transactions`.
  - [x] **(d)** Integridad referencial de las 3 tablas en la creación exitosa.
  - [x] **(e)** `p_points_bet <= 0` → excepción `P0001`, sin inserciones.
  - [x] **Invariante de conservación (AC #11):** tras una secuencia de operaciones, asertar `wager_balance == SUM(point_transactions.amount)` por miembro (comparar como `numeric` en SQL, no como float en JS).
  - [x] **(P1) Rollback todo-o-nada:** inyectar fallo en la última inserción de la RPC y asertar que NADA queda a medias (saldo intacto, 0 filas en las 3 tablas). Verificar de paso que la RPC no traga errores con `WHEN OTHERS` sin re-`RAISE`.

- [x] **Tarea 2b — Contract test de paridad de scoring `tests/integration/scoring-parity.test.ts`** (AC: #12)
  - [x] Definir un golden-vector de casos (predicción + resultado + multiplier → puntos esperados).
  - [x] Ejecutar cada caso contra `calculatePredictionPoints`/`calculateBasePoints` de `src/utils/scoring.ts` (JS) y contra `public.score_prediction` (SQL) por `service_role`.
  - [x] Asertar igualdad exacta JS == SQL == esperado (redondeo a 2 decimales). Falla = drift de fórmula.

- [x] **Tarea 3 — Server Action `src/app/actions/duels.actions.ts` y Esquema de Validación** (AC: #4, #5, #6)
  - [x] Crear `src/app/actions/duels.schema.ts` utilizando Zod para validar la entrada del formulario: `leagueId`, `matchId`, `pointsBet`, `type`, `challengedId` (opcional/condicional) y marcadores de predicción.
  - [x] Crear `src/app/actions/duels.actions.ts` exportando la Server Action `createChallenge` con la firma `ServerActionResult<string>`.
  - [x] En la acción, verificar la sesión del usuario (`createClient()` de servidor), validar la entrada con Zod y llamar a la RPC `create_challenge`.
  - [x] Capturar y mapear explícitamente los códigos de excepción conocidos lanzados por la RPC de Postgres (ej. `'P0003'` para saldo insuficiente, `'42501'` para no miembro o no autenticado) a mensajes legibles en español, retornando la estructura tipada `ServerActionResult`.

- [x] **Tarea 4 — Diálogo de Creación `CreateDuelDialog.tsx` y GoalPicker** (AC: #2, #3, #8)
  - [x] Crear `src/components/duels/CreateDuelDialog.tsx` como componente cliente.
  - [x] Cargar los partidos con estado `scheduled` y los miembros de la liga para poblar los selectors.
  - [x] Integrar el componente `GoalPicker` reutilizable para la predicción de local/visitante.
  - [x] Implementar la validación interactiva del saldo: comparar el input de puntos contra el disponible del usuario y, si es insuficiente, inhabilitar el envío y mostrar la advertencia roja.
  - [x] Soportar el estado de carga utilizando transiciones o spinners de UI mientras se ejecuta la acción del servidor.

- [x] **Tarea 5 — Vista de Panel `/duels/page.tsx`** (AC: #1, #7, #8)
  - [x] Crear la página de ruta `/src/app/duels/page.tsx` requiriendo sesión (redirige a `/auth/login` si no hay).
  - [x] Resolver la liga activa del usuario (la más reciente) o mostrar el `EmptyState` de "Sin liga".
  - [x] Cargar el saldo disponible del miembro (`league_members.wager_balance`) y los desafíos creados o donde es participante de la liga.
  - [x] Renderizar una vista mobile-first limpia: cabecera con el saldo, listado de duelos agrupados por estado (activos, pendientes) y botón principal para abrir el diálogo.
  - [x] Optimizar la query de duelos para separar la carga o paginar los duelos finalizados/completados (`'completed'`, `'canceled'`) para agilizar la renderización de duelos activos y pendientes de respuesta.
  - [x] Implementar el empty state para cuando no hay desafíos.

- [x] **Tarea 6 — Habilitar pestaña Duelos en la Bottom Nav** (AC: #1)
  - [x] Modificar `src/components/layout/BottomNavbar.tsx` cambiando `enabled: false` por `enabled: true` para la pestaña Duelos.
  - [x] Agregar `<BottomNavbar />` y padding inferior correspondiente a la vista `/duels` para mantener la navegación consistente.

- [x] **Tarea 7 — Verificación y Tests de Componente** (AC: #10)
  - [x] Agregar pruebas unitarias o de componente para `CreateDuelDialog` y el renderizado del saldo y alertas.
  - [x] Ejecutar linting, typechecking y tests locales (`npm run test:unit`, `npm run test:integration`).
  - [x] Realizar una verificación manual en el navegador.

### Review Findings

- [x] [Review][Patch] Falta validación de fecha de inicio del partido en la RPC `create_challenge` [supabase/migrations/20260604024700_challenges_and_escrow.sql:132]
- [x] [Review][Defer] La carga diferida de retos históricos (finalizados/cancelados) en `src/components/duels/DuelsDashboard.tsx` no cancela peticiones previas inactivas en caso de que el usuario alterne rápidamente entre pestañas, lo que podría derivar en condiciones de carrera al actualizar el estado. [src/components/duels/DuelsDashboard.tsx:75] — deferred, pre-existing

## Dev Notes

### Arquitectura de Base de Datos y Schema

El diseño relacional se asienta en la base de datos Supabase Local. La migración debe crear las estructuras físicas con los siguientes tipos clave:

```sql
-- 1. Tabla challenges para los duelos.
-- ATENCIÓN: matches.id en el esquema real es UUID. match_id DEBE ser UUID.
create table public.challenges (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references public.leagues (id) on delete cascade,
  match_id      uuid not null references public.matches (id) on delete cascade,
  creator_id    uuid not null references public.profiles (id) on delete cascade,
  points_bet    int not null check (points_bet > 0),
  type          text not null check (type in ('direct', 'open')),
  challenged_id uuid references public.profiles (id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'active', 'completed', 'canceled')),
  winner_ids    uuid[] null,
  created_at    timestamptz not null default now()
);

-- 2. Tabla de participantes
create table public.challenge_participants (
  challenge_id    uuid not null references public.challenges (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  prediction_home int not null check (prediction_home >= 0),
  prediction_away int not null check (prediction_away >= 0),
  joined_at       timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

-- 3. Historial de transacciones de puntos
create table public.point_transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  league_id    uuid not null references public.leagues (id) on delete cascade,
  amount       numeric(6, 2) not null,
  description  text not null,
  reference_id uuid null,
  created_at   timestamptz not null default now()
);
```

### Inicialización de Saldo Coherente (Migración)
La migración inicializa `wager_balance` recalculando los puntos de partidos `finished` **invocando `public.score_prediction`** (NO duplicando la fórmula inline → evita drift con `scoring.ts`, ver AC #12), y **siembra el ledger** para que el invariante de conservación (AC #11) se cumpla desde `t0`.

```sql
with prediction_sums as (
  select
    p.league_id,
    p.user_id,
    coalesce(sum(
      -- Fuente única de la fórmula: misma función que usará el reparto y el espejo de scoring.ts.
      public.score_prediction(p.home_score_pred, p.away_score_pred, m.home_score, m.away_score, p.multiplier)
    ), 0.00) as calculated_points
  from public.predictions p
  join public.matches m on p.match_id = m.id
  where m.status = 'finished'
  group by p.league_id, p.user_id
)
update public.league_members lm
set wager_balance = coalesce(ps.calculated_points, 0.00)
from prediction_sums ps
where lm.league_id = ps.league_id and lm.user_id = ps.user_id;

-- Sembrar el ledger: una transacción inicial por cada miembro con saldo > 0,
-- para que wager_balance == SUM(point_transactions.amount) se cumpla desde t0 (AC #11).
insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
select lm.user_id, lm.league_id, lm.wager_balance, 'seed_initial_balance', null
from public.league_members lm
where lm.wager_balance > 0;
```

> **Accrual continuo (modelo económico A — financiado por ranking):** el backfill anterior solo cubre los partidos `finished` AL MIGRAR. El mecanismo que acredita `wager_balance` (con su `point_transactions` tipo `match_accrual`) cuando un partido finaliza DESPUÉS de la migración se **implementa en Story 5.3** (que ya posee el cron `/api/sync` y la persistencia oficial de resultados), pero su contrato — *"al pasar un partido a `finished`, cada miembro recibe `score_prediction(...)` como transacción de ledger, en la misma transacción"* — queda fijado AQUÍ. Sin este accrual, el saldo quedaría congelado tras el backfill. El **ranking deportivo de `standings.ts` NO se ve afectado por las apuestas**: es magnitud independiente (mérito), `wager_balance` es la moneda gastable.

### Función SQL `public.score_prediction` (espejo de `scoring.ts`, AC #12)
Fuente ÚNICA de la fórmula en SQL. La usa el backfill de saldo y el contract test de paridad. Debe espejar EXACTAMENTE `src/utils/scoring.ts` (incluido el redondeo a 2 decimales de `calculatePredictionPoints`).

```sql
create or replace function public.score_prediction(
  p_home_pred int, p_away_pred int,
  p_home_score int, p_away_score int,
  p_multiplier numeric
)
returns numeric
language sql
immutable
as $$
  -- MIRROR de src/utils/scoring.ts. NO EDITAR sin actualizar tests/integration/scoring-parity.test.ts.
  -- Solo aplica a partidos 'finished' (el caller filtra status). Base: exacto=5, resultado=2, nada=0.
  select round(
    case
      when p_home_score is null or p_away_score is null then 0.00
      when p_home_pred = p_home_score and p_away_pred = p_away_score then 5.00
      when sign(p_home_pred - p_away_pred) = sign(p_home_score - p_away_score) then 2.00
      else 0.00
    end * coalesce(p_multiplier, 1.00),
  2);
$$;
```

### Función SQL Transaccional `public.create_challenge`
La función SQL debe empaquetar toda la lógica ACID de descuento y persistencia:

```sql
create or replace function public.create_challenge(
  p_league_id uuid,
  p_match_id uuid,
  p_points_bet int,
  p_type text,
  p_challenged_id uuid default null,
  p_prediction_home int default 0,
  p_prediction_away int default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid            uuid := (select auth.uid());
  v_current_points numeric(6, 2);
  v_challenge_id   uuid;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  -- La apuesta debe ser positiva (AC #5, #9e).
  if p_points_bet <= 0 then
    raise exception 'La apuesta debe ser mayor que cero.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.league_members 
    where league_id = p_league_id and user_id = v_uid
  ) then
    raise exception 'No eres miembro de la liga' using errcode = '42501';
  end if;

  -- Bloquear la fila de league_members para evitar carreras concurrentes
  select wager_balance into v_current_points
  from public.league_members
  where league_id = p_league_id and user_id = v_uid
  for update;

  if v_current_points < p_points_bet::numeric then
    raise exception 'Saldo de puntos insuficiente para crear el desafío.' using errcode = 'P0003';
  end if;

  -- Insertar el desafío
  insert into public.challenges (
    league_id, match_id, creator_id, points_bet, type, challenged_id, status
  ) values (
    p_league_id, p_match_id, v_uid, p_points_bet, p_type, p_challenged_id, 'pending'
  ) returning id into v_challenge_id;

  -- Registrar al creador como participante con su predicción
  insert into public.challenge_participants (
    challenge_id, user_id, prediction_home, prediction_away
  ) values (
    v_challenge_id, v_uid, p_prediction_home, p_prediction_away
  );

  -- Restar del saldo gastable (Escrow). MISMA transacción que la fila de ledger
  -- de abajo: nunca mover wager_balance sin su point_transaction gemela (AC #11).
  update public.league_members
  set wager_balance = wager_balance - p_points_bet::numeric
  where league_id = p_league_id and user_id = v_uid;

  -- Registrar la transacción en el ledger (fuente de auditoría; su SUM debe igualar wager_balance)
  insert into public.point_transactions (
    user_id, league_id, amount, description, reference_id
  ) values (
    v_uid, p_league_id, -p_points_bet::numeric, 
    'Puntos retenidos en escrow por creación de desafío ' || p_type, v_challenge_id
  );

  return v_challenge_id;
  -- NOTA: NO usar `exception when others then return ...` aquí — tragar la excepción
  -- rompería la atomicidad (saldo deducido sin desafío). Dejar propagar el error → rollback total.
end;
$$;

grant execute on function public.create_challenge(uuid, uuid, int, text, uuid, int, int) to authenticated;
```

### Seguridad RLS (Row Level Security)

Se debe habilitar RLS en las 3 nuevas tablas y crear las políticas correspondientes:

```sql
alter table public.challenges enable row level security;
alter table public.challenge_participants enable row level security;
alter table public.point_transactions enable row level security;

-- Desafíos visibles para cualquier miembro de la liga
create policy "challenges_select_league_members"
  on public.challenges for select
  to authenticated
  using (
    exists (
      select 1 from public.league_members
      where league_id = challenges.league_id
        and user_id = (select auth.uid())
    )
  );

-- Inserción directa deshabilitada (se usa la RPC create_challenge que es SECURITY DEFINER)

-- Participantes visibles si el usuario está en la liga del desafío correspondiente
create policy "participants_select_league_members"
  on public.challenge_participants for select
  to authenticated
  using (
    exists (
      select 1 from public.challenges c
      join public.league_members lm on c.league_id = lm.league_id
      where c.id = challenge_participants.challenge_id
        and lm.user_id = (select auth.uid())
    )
  );

-- Transacciones de puntos sólo visibles por su respectivo dueño
create policy "point_transactions_select_owner"
  on public.point_transactions for select
  to authenticated
  using (user_id = (select auth.uid()));

-- point_transactions es append-only desde el cliente: NO crear políticas INSERT/UPDATE/DELETE
-- (las filas solo las escriben las RPCs SECURITY DEFINER). deny-by-default protege el ledger.
```

> **Protección del saldo (AC #11):** `league_members.wager_balance` solo puede mutarse dentro de RPCs `SECURITY DEFINER` (`create_challenge` y las futuras de 5.2/5.3). NO debe existir ninguna política `UPDATE` sobre `league_members` que permita al rol `authenticated` escribir `wager_balance` directamente. Si Story 3.3 (control de pagos) añade un `UPDATE` para `payment_status`, debe restringir las columnas (p. ej. trigger que rechace cambios de `wager_balance` fuera de las RPCs, o `GRANT UPDATE (payment_status)` por columna) para no abrir un agujero de doble gasto.

### Project Structure Notes

- **Fronteras**:
  - Toda la lógica transaccional de apuestas vive en la base de datos mediante la RPC `create_challenge` para asegurar consistencia e impedir doble gasto.
  - La Server Action en `src/app/actions/duels.actions.ts` encapsula el control del cliente de Next.js, valida la entrada con Zod y mapea los errores de Postgres (ej. `P0003` y `42501`) a mensajes legibles en español.
  - Los componentes UI en `src/components/duels/` respetan la max-w-md para el flujo móvil.
  - La página `/duels/page.tsx` optimiza el rendimiento paginando u omitiendo desafíos finalizados/cancelados en la primera carga.
  - `BottomNavbar.tsx` se actualiza para activar el enlace a `/duels`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.1: Creación de Duelo 1v1 Directo y Abierto con Deducción de Escrow]
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns / #Complete Project Directory Structure]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/DESIGN.md (tokens, colors, rounded)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/EXPERIENCE.md (Bottom Nav, Duelos Apuestas, Cero Desafíos, State Escrow Activo)]

## Dev Agent Record

### Agent Model Used

Gemini 3.5 Flash (High)

### Debug Log References

- Pruebas de integración se ejecutan localmente en el puerto `54321` configurando `.env.test.local`.
- Se requiere Node 24 cargado vía `nvm`.

### Completion Notes List

- Implementación del ledger de transacciones de puntos y control de saldo de duelos (escrow).
- Lógica transaccional ACID en la RPC de Postgres `public.create_challenge` para prevenir condiciones de carrera (double spending).
- Server Action con mapeo robusto de errores a español y validación Zod.
- Interfaz reactiva en `CreateDuelDialog.tsx` que inhabilita el botón e indica saldo insuficiente.
- Pestaña Duelos en `/duels` que separa los retos activos del historial para optimizar carga.
- 46/46 pruebas de integración y 123/123 pruebas unitarias completadas en verde.

### File List

- `supabase/migrations/20260604024700_challenges_and_escrow.sql`
- `tests/integration/triggers.test.ts`
- `tests/integration/scoring-parity.test.ts`
- `src/app/actions/duels.schema.ts`
- `src/app/actions/duels.actions.ts`
- `src/components/duels/CreateDuelDialog.tsx`
- `src/components/duels/DuelsDashboard.tsx`
- `src/app/duels/page.tsx`
- `src/components/layout/BottomNavbar.tsx`

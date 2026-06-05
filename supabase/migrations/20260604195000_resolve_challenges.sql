-- Migración: resolve_challenges
-- Story 5.3: Resolución y Reparto Automatizado del Pozo de Puntos

-- Alterar tablas para ampliar precisión numérica y evitar overflow (numeric(6,2) -> numeric(12,2))
alter table public.league_members alter column wager_balance type numeric(12,2);
alter table public.point_transactions alter column amount type numeric(12,2);

-- Añadir predictions.evaluated_at
alter table public.predictions add column evaluated_at timestamptz;

-- Índice parcial para búsquedas rápidas de predicciones sin evaluar
create index idx_predictions_evaluated_at_null on public.predictions (match_id) where evaluated_at is null;

-- Actualizar la función create_challenge para ampliar la precisión de v_current_points y evitar overflow
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
  v_current_points numeric(12, 2);
  v_challenge_id   uuid;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  -- La apuesta debe ser positiva (AC #5, #9e).
  if p_points_bet <= 0 then
    raise exception 'La apuesta debe ser mayor que cero.' using errcode = 'P0001';
  end if;

  -- Verificar que el partido exista, esté programado y no haya comenzado
  if not exists (
    select 1 from public.matches
    where id = p_match_id 
      and status = 'scheduled' 
      and match_time > now()
  ) then
    raise exception 'El partido ya comenzó o no está disponible para apuestas.' using errcode = 'P0004';
  end if;

  -- Validación de tipo de reto
  if p_type not in ('direct', 'open') then
    raise exception 'Tipo de reto invalido.' using errcode = '23514';
  end if;

  -- El usuario debe pertenecer a la liga
  if not exists (
    select 1 from public.league_members 
    where league_id = p_league_id and user_id = v_uid
  ) then
    raise exception 'No eres miembro de la liga' using errcode = '42501';
  end if;

  -- Si es un duelo directo, el oponente debe existir en la liga y no ser el creador
  if p_type = 'direct' then
    if p_challenged_id is null then
      raise exception 'Debe especificar un rival para un duelo directo.' using errcode = '23502';
    end if;
    if p_challenged_id = v_uid then
      raise exception 'No puedes retarte a ti mismo.' using errcode = 'P0002';
    end if;
    if not exists (
      select 1 from public.league_members
      where league_id = p_league_id and user_id = p_challenged_id
    ) then
      raise exception 'El rival no es miembro de la liga.' using errcode = '42501';
    end if;
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
  update public.league_members
  set wager_balance = wager_balance - p_points_bet::numeric
  where league_id = p_league_id and user_id = v_uid;

  -- Registrar la transacción en el ledger
  insert into public.point_transactions (
    user_id, league_id, amount, description, reference_id
  ) values (
    v_uid, p_league_id, -p_points_bet::numeric, 
    'Puntos retenidos en escrow por creación de desafío ' || p_type, v_challenge_id
  );

  return v_challenge_id;
end;
$$;

grant execute on function public.create_challenge(uuid, uuid, int, text, uuid, int, int) to authenticated;

-- Corregir el vocabulario de estados en la función de kickoff
create or replace function public.fn_cancel_pending_challenges_on_match_start()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chal record;
begin
  if new.status in ('canceled', 'suspended') then
    -- Cancelar y reembolsar TODOS los desafíos pendientes de este partido
    for v_chal in
      update public.challenges
      set status = 'canceled'
      where match_id = new.id
        and status = 'pending'
      returning id
    loop
      perform public.refund_challenge_escrow(v_chal.id);
    end loop;
  else
    -- 1. Pozos o retos pendientes con ≥ 2 participantes se mueven a 'active'
    update public.challenges
    set status = 'active'
    where match_id = new.id
      and status = 'pending'
      and (
        select count(*)
        from public.challenge_participants cp
        where cp.challenge_id = challenges.id
      ) >= 2;

    -- 2. Retos sin contraparte (con exactamente 1 participante: solo el creador) pasan a 'canceled' y reembolsan
    for v_chal in
      update public.challenges
      set status = 'canceled'
      where match_id = new.id
        and status = 'pending'
      returning id
    loop
      perform public.refund_challenge_escrow(v_chal.id);
    end loop;
  end if;

  return new;
end;
$$;

-- Crear o reemplazar la función trigger de resolución
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
  v_max_score    numeric(12, 2);
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

-- ORDEN CRÍTICO: no renombrar sin revisar la interacción.
-- Postgres dispara triggers AFTER en orden alfabético.
-- tr_cancel_pending_challenges_on_match_start corre antes que tr_resolve_challenges_on_match_status_change,
-- garantizando que un pozo poblado se active antes de resolverse en una transición directa scheduled→finished.
create trigger tr_resolve_challenges_on_match_status_change
  after update of status on public.matches
  for each row
  when (old.status is distinct from new.status)
  execute function public.fn_resolve_challenges_on_match_status_change();

-- Migración: accrual_correction_rpc
-- Story 8.3 — AC #5: Recálculo de clasificaciones al restaurar datos de Zafronix.
--
-- Define una función SECURITY DEFINER que aplica, de forma ATÓMICA, la corrección
-- de puntos de UNA predicción ya evaluada cuando el marcador oficial cambia.
--
-- El motor de puntuación ÚNICO vive en src/utils/scoring.ts (Dev Notes 8.3); el
-- script administrativo calcula allí los puntos nuevos y pasa el resultado en
-- `p_new_points`. Esta función NO duplica la fórmula: solo aplica el delta
-- (nuevo - viejo) sobre las tres tablas del ledger en una única transacción, con
-- locks de fila, para preservar el invariante de conservación
-- (wager_balance == SUM(point_transactions.amount)) bajo ejecución concurrente
-- (Promise.all) del script de restauración.
--
-- Idempotencia: si la predicción NO está evaluada (evaluated_at IS NULL) el
-- recálculo lo realiza el trigger tr_resolve_challenges_on_match_status_change
-- al actualizar el partido, por lo que esta función la ignora (retorna 0).

create or replace function public.fn_apply_accrual_correction(
  p_prediction_id uuid,
  p_new_points numeric,
  p_match_id uuid,
  p_match_status text
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pred   record;
  v_new    numeric(12, 2);
  v_delta  numeric(12, 2);
begin
  -- Bloquear la predicción para una lectura/escritura consistente.
  select id, league_id, user_id,
         coalesce(points_earned, 0.00) as points_earned,
         evaluated_at
  into v_pred
  from public.predictions
  where id = p_prediction_id
  for update;

  if not found then
    raise exception 'Predicción % no encontrada', p_prediction_id using errcode = 'P0001';
  end if;

  -- Guarda de idempotencia POR ESTADO: solo corregimos predicciones ya evaluadas.
  -- Las no evaluadas las puntúa el trigger al pasar el partido a 'finished'.
  if v_pred.evaluated_at is null then
    return 0.00;
  end if;

  if p_match_status <> 'finished' then
    v_new := null;
    v_delta := - v_pred.points_earned;
  else
    v_new := round(coalesce(p_new_points, 0)::numeric, 2);
    v_delta := v_new - v_pred.points_earned;
  end if;

  if v_delta = 0.00 then
    return 0.00;
  end if;

  -- 1. Actualizar los puntos de la predicción al nuevo valor calculado en TS (o null si no está finalizado).
  update public.predictions
  set points_earned = v_new,
      evaluated_at = case when p_match_status = 'finished' then now() else null end,
      updated_at = now()
  where id = p_prediction_id;

  -- 2. Ajustar el saldo del miembro sumando el DELTA exacto (suma atómica con lock).
  perform 1 from public.league_members
  where league_id = v_pred.league_id and user_id = v_pred.user_id
  for update;

  if not found then
    raise exception 'Miembro de liga no encontrado para league_id: %, user_id: %', v_pred.league_id, v_pred.user_id using errcode = 'P0002';
  end if;

  update public.league_members
  set wager_balance = wager_balance + v_delta
  where league_id = v_pred.league_id and user_id = v_pred.user_id;

  -- 3. Registrar la corrección en el ledger (preserva el invariante de conservación).
  insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
  values (v_pred.user_id, v_pred.league_id, v_delta, 'match_accrual_correction', p_match_id);

  return v_delta;
end;
$$;

-- El script administrativo usa la service_role key (bypass RLS). Concedemos
-- execute también a service_role de forma explícita por claridad operativa.
grant execute on function public.fn_apply_accrual_correction(uuid, numeric, uuid, text) to service_role;


-- Redefinir la función trigger de resolución para soportar reversión y re-resolución de desafíos completados
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
  v_reversal     record;
begin
  -- 1. Cuando el partido está o pasa a 'finished'
  if new.status = 'finished' then
    if new.home_score is not null and new.away_score is not null then
      
      -- (a) Accrual continuo de predicciones normales de liga (ordenados por user_id para evitar deadlocks)
      for v_pred in 
        select id, league_id, user_id, home_score_pred, away_score_pred, multiplier
        from public.predictions
        where match_id = new.id
          and evaluated_at is null   -- guarda de idempotencia por ESTADO, no por monto
        order by user_id
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

      -- (b) Revertir y re-resolver desafíos completados si el marcador cambió
      if TG_OP = 'UPDATE' and (old.home_score is distinct from new.home_score or old.away_score is distinct from new.away_score) then
        for v_challenge in
          select id, league_id, points_bet
          from public.challenges
          where match_id = new.id
            and status = 'completed'
        loop
          -- Revertir transacciones previas de payout o refund
          for v_reversal in
            select user_id, amount
            from public.point_transactions
            where reference_id = v_challenge.id
              and description in ('challenge_payout', 'challenge_escrow_refund')
          loop
            update public.league_members
            set wager_balance = wager_balance - v_reversal.amount
            where league_id = v_challenge.league_id and user_id = v_reversal.user_id;

            insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
            values (v_reversal.user_id, v_challenge.league_id, -v_reversal.amount, 'challenge_payout_reversal', v_challenge.id);
          end loop;

          update public.challenges
          set status = 'active'
          where id = v_challenge.id;
        end loop;
      end if;

      -- (c) Liquidación de retos activos (incluyendo los que acabamos de revertir a 'active')
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

        if v_max_score is null or v_max_score = 0.00 then
          perform public.refund_challenge_escrow(v_challenge.id);
          update public.challenges
          set status = 'completed', winner_ids = '{}'::uuid[]
          where id = v_challenge.id;
        else
          select array_agg(cp.user_id order by cp.user_id)
          into v_winners
          from public.challenge_participants cp
          where cp.challenge_id = v_challenge.id
            and public.score_prediction(cp.prediction_home, cp.prediction_away, new.home_score, new.away_score, 1.00) = v_max_score;

          v_winner_count := cardinality(v_winners);

          select coalesce(-sum(amount), 0)
          into v_total_pot
          from public.point_transactions
          where reference_id = v_challenge.id
            and description not in ('challenge_payout', 'challenge_escrow_refund', 'challenge_payout_reversal');

          declare
            v_base      numeric(12,2) := trunc(v_total_pot / v_winner_count::numeric, 2);
            v_remainder numeric(12,2) := v_total_pot - (trunc(v_total_pot / v_winner_count::numeric, 2) * v_winner_count);
            v_i         int := 0;
          begin
            perform 1 from public.league_members
            where league_id = v_challenge.league_id and user_id = any(v_winners)
            order by user_id for update;

            foreach v_winner_id in array v_winners loop
              v_payout := v_base + case when v_i = 0 then v_remainder else 0 end;
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
    for v_challenge in
      update public.challenges
      set status = 'canceled'
      where match_id = new.id
        and status in ('pending', 'active')
      returning id
    loop
      perform public.refund_challenge_escrow(v_challenge.id);
    end loop;

    if old.status = 'finished' then
      for v_challenge in
        select id, league_id
        from public.challenges
        where match_id = new.id
          and status = 'completed'
      loop
        for v_reversal in
          select user_id, amount
          from public.point_transactions
          where reference_id = v_challenge.id
            and description in ('challenge_payout', 'challenge_escrow_refund')
        loop
          update public.league_members
          set wager_balance = wager_balance - v_reversal.amount
          where league_id = v_challenge.league_id and user_id = v_reversal.user_id;

          insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
          values (v_reversal.user_id, v_challenge.league_id, -v_reversal.amount, 'challenge_payout_reversal', v_challenge.id);
        end loop;

        perform public.refund_challenge_escrow(v_challenge.id);

        update public.challenges
        set status = 'canceled'
        where id = v_challenge.id;
      end loop;
    end if;

  -- 3. Si el partido revierte de finished a scheduled o live
  elsif new.status in ('scheduled', 'live') and old.status = 'finished' then
    for v_challenge in
      select id, league_id
      from public.challenges
      where match_id = new.id
        and status = 'completed'
    loop
      for v_reversal in
        select user_id, amount
        from public.point_transactions
        where reference_id = v_challenge.id
          and description in ('challenge_payout', 'challenge_escrow_refund')
      loop
        update public.league_members
        set wager_balance = wager_balance - v_reversal.amount
        where league_id = v_challenge.league_id and user_id = v_reversal.user_id;

        insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
        values (v_reversal.user_id, v_challenge.league_id, -v_reversal.amount, 'challenge_payout_reversal', v_challenge.id);
      end loop;

      update public.challenges
      set status = 'active', winner_ids = null
      where id = v_challenge.id;
    end loop;
  end if;

  return new;
end;
$$;

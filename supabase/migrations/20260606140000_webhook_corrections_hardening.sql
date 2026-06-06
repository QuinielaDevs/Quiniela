-- Migración: webhook_corrections_hardening
-- Story 8.1 / 8.3 Trabajo Diferido: Robustecimiento y corrección del ledger ante actualizaciones y cambios de estado del webhook.

-- 1. Agregar columna external_last_sync_at a la tabla public.matches para control de concurrencia y orden.
alter table public.matches add column if not exists external_last_sync_at timestamptz;

comment on column public.matches.external_last_sync_at is 'Marca de tiempo (ts) del último evento de Zafronix integrado, usado para evitar procesamiento fuera de orden.';

-- 2. Redefinir la función trigger de resolución para soportar delta-corrección de predicciones y reversiones.
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
      
      -- (a) Accrual continuo y corrección de predicciones normales de liga (ordenados por user_id para evitar deadlocks)
      for v_pred in 
        select id, league_id, user_id, home_score_pred, away_score_pred, multiplier, points_earned, evaluated_at
        from public.predictions
        where match_id = new.id
        order by user_id
      loop
        declare
          v_points numeric(12, 2);
          v_delta  numeric(12, 2);
        begin
          v_points := public.score_prediction(
            v_pred.home_score_pred, v_pred.away_score_pred,
            new.home_score, new.away_score,
            v_pred.multiplier
          );
          
          if v_pred.evaluated_at is null then
            v_delta := v_points;
          else
            v_delta := v_points - coalesce(v_pred.points_earned, 0.00);
          end if;
          
          -- Si hay cambio de puntos, o si nunca se había evaluado, actualizamos la predicción.
          if v_pred.evaluated_at is null or v_delta <> 0.00 then
            update public.predictions
            set points_earned = v_points, evaluated_at = now(), updated_at = now()
            where id = v_pred.id;
          end if;
          
          -- Solo aplicamos transacciones y balances si el delta es distinto de cero.
          if v_delta <> 0.00 then
            -- Bloquear la fila de league_members para evitar carreras de actualización concurrente
            perform 1 from public.league_members
            where league_id = v_pred.league_id and user_id = v_pred.user_id
            for update;

            update public.league_members
            set wager_balance = wager_balance + v_delta
            where league_id = v_pred.league_id and user_id = v_pred.user_id;
            
            insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
            values (v_pred.user_id, v_pred.league_id, v_delta, 
                    case when v_pred.evaluated_at is null then 'match_accrual' else 'match_accrual_correction' end,
                    new.id);
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
            -- Lock league_members before update
            perform 1 from public.league_members
            where league_id = v_challenge.league_id and user_id = v_reversal.user_id
            for update;

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
    -- (a) Revertir predicciones normales de liga que ya habían sido evaluadas
    if old.status = 'finished' then
      for v_pred in
        select id, league_id, user_id, points_earned
        from public.predictions
        where match_id = new.id
          and evaluated_at is not null
        order by user_id
      loop
        if coalesce(v_pred.points_earned, 0.00) > 0.00 then
          perform 1 from public.league_members
          where league_id = v_pred.league_id and user_id = v_pred.user_id
          for update;

          update public.league_members
          set wager_balance = wager_balance - v_pred.points_earned
          where league_id = v_pred.league_id and user_id = v_pred.user_id;

          insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
          values (v_pred.user_id, v_pred.league_id, -v_pred.points_earned, 'match_accrual_reversal', new.id);
        end if;
      end loop;
    end if;

    -- Anular/actualizar todas las predicciones del partido a 0 puntos y evaluado_at = now()
    update public.predictions
    set points_earned = 0.00,
        evaluated_at = now(),
        updated_at = now()
    where match_id = new.id;

    -- (b) Revertir y reembolsar desafíos
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
          perform 1 from public.league_members
          where league_id = v_challenge.league_id and user_id = v_reversal.user_id
          for update;

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
    -- (a) Revertir predicciones normales de liga que ya habían sido evaluadas
    for v_pred in
      select id, league_id, user_id, points_earned
      from public.predictions
      where match_id = new.id
        and evaluated_at is not null
      order by user_id
    loop
      if coalesce(v_pred.points_earned, 0.00) > 0.00 then
        perform 1 from public.league_members
        where league_id = v_pred.league_id and user_id = v_pred.user_id
        for update;

        update public.league_members
        set wager_balance = wager_balance - v_pred.points_earned
        where league_id = v_pred.league_id and user_id = v_pred.user_id;

        insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
        values (v_pred.user_id, v_pred.league_id, -v_pred.points_earned, 'match_accrual_reversal', new.id);
      end if;
    end loop;

    -- Poner las predicciones como no evaluadas
    update public.predictions
    set points_earned = null,
        evaluated_at = null,
        updated_at = now()
    where match_id = new.id;

    -- (b) Revertir desafíos
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
        perform 1 from public.league_members
        where league_id = v_challenge.league_id and user_id = v_reversal.user_id
        for update;

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

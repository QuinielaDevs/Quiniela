-- Materializa predicciones default 0-0 para partidos que se vuelven disponibles
-- sin depender de que cada usuario abra /predictions en la ventana exacta.
--
-- Contexto: los slots de eliminatoria nacen TBD y fn_ensure_default_predictions
-- solo crea defaults al cargar el tablero, para partidos editables. Si un slot
-- se resuelve cerca del kickoff y un miembro no vuelve a entrar, no existe fila
-- en predictions y standings/live lo muestran como "Sin pronóstico". Este trigger
-- convierte el acuerdo de producto ("sin tocar = 0-0") en una fila real.

create or replace function public.fn_materialize_match_default_predictions(
  p_match_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with target_match as (
    select
      m.id,
      m.match_time,
      m.matchday,
      m.stage,
      m.status
    from public.matches m
    where m.id = p_match_id
      and (
        (m.status = 'scheduled' and public.fn_match_editable(m.id))
        or m.status in ('live', 'finished')
      )
  ),
  inserted as (
    insert into public.predictions (
      league_id,
      match_id,
      user_id,
      home_score_pred,
      away_score_pred,
      multiplier
    )
    select
      lm.league_id,
      tm.id,
      lm.user_id,
      0,
      0,
      public.fn_prediction_multiplier(tm.matchday, tm.stage)
    from target_match tm
    join public.league_members lm
      on lm.joined_at <= tm.match_time
    where not exists (
      select 1
      from public.predictions p
      where p.league_id = lm.league_id
        and p.user_id = lm.user_id
        and p.match_id = tm.id
    )
    on conflict (league_id, user_id, match_id) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;

  return coalesce(v_count, 0);
end;
$$;

comment on function public.fn_materialize_match_default_predictions(uuid) is
  'Crea filas 0-0 para todos los miembros elegibles de liga cuando un partido está editable o ya cerró/live, sin sobrescribir predicciones existentes. Usado por trigger de matches y backfills.';

grant execute on function public.fn_materialize_match_default_predictions(uuid) to service_role;

create or replace function public.fn_materialize_default_predictions_on_match_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.fn_materialize_match_default_predictions(new.id);
  return new;
end;
$$;

comment on function public.fn_materialize_default_predictions_on_match_update() is
  'Trigger helper: materializa defaults 0-0 cuando un partido se resuelve, entra en vivo o finaliza.';

drop trigger if exists tr_default_predictions_on_match_update on public.matches;

-- Orden: AFTER triggers corren alfabéticamente. Este trigger debe ejecutarse
-- antes de tr_resolve_challenges_on_match_status_change para que el accrual de
-- finished evalúe también los defaults recién creados.
create trigger tr_default_predictions_on_match_update
  after update on public.matches
  for each row
  when (
    (new.bracket_slot is not null and new.status in ('live', 'finished'))
    or (
      new.status = 'scheduled'
      and new.bracket_slot is not null
      and (old.home_team_code is null or old.away_team_code is null)
      and new.home_team_code is not null
      and new.away_team_code is not null
    )
  )
  execute function public.fn_materialize_default_predictions_on_match_update();

-- Backfill idempotente para partidos que ya estaban live/finished antes de esta
-- migración. Las filas nuevas quedan reales en predictions; si el partido ya
-- terminó, también se evalúan y se aplica el ledger una sola vez.
do $$
declare
  v_match record;
  v_pred record;
  v_points numeric(12, 2);
  v_existing_accrual numeric(12, 2);
  v_delta numeric(12, 2);
begin
  for v_match in
    select id
    from public.matches
    where status in ('live', 'finished')
      and bracket_slot is not null
  loop
    perform public.fn_materialize_match_default_predictions(v_match.id);
  end loop;

  for v_pred in
    select
      p.id,
      p.league_id,
      p.user_id,
      p.home_score_pred,
      p.away_score_pred,
      p.multiplier,
      m.id as match_id,
      m.home_score,
      m.away_score
    from public.predictions p
    join public.matches m on m.id = p.match_id
    where m.status = 'finished'
      and m.bracket_slot is not null
      and m.home_score is not null
      and m.away_score is not null
      and p.evaluated_at is null
    order by p.user_id, p.id
  loop
    v_points := public.score_prediction(
      v_pred.home_score_pred,
      v_pred.away_score_pred,
      v_pred.home_score,
      v_pred.away_score,
      v_pred.multiplier
    );
    select coalesce(sum(pt.amount), 0.00)
    into v_existing_accrual
    from public.point_transactions pt
    where pt.user_id = v_pred.user_id
      and pt.league_id = v_pred.league_id
      and pt.reference_id = v_pred.match_id
      and pt.description like 'match_accrual%';

    v_delta := v_points - v_existing_accrual;

    update public.predictions
    set points_earned = v_points,
        evaluated_at = now(),
        updated_at = now()
    where id = v_pred.id;

    if v_delta <> 0.00 then
      perform 1
      from public.league_members
      where league_id = v_pred.league_id
        and user_id = v_pred.user_id
      for update;

      update public.league_members
      set wager_balance = wager_balance + v_delta
      where league_id = v_pred.league_id
        and user_id = v_pred.user_id;

      insert into public.point_transactions (
        user_id,
        league_id,
        amount,
        description,
        reference_id
      )
      values (
        v_pred.user_id,
        v_pred.league_id,
        v_delta,
        'match_accrual_backfill',
        v_pred.match_id
      );
    end if;
  end loop;
end;
$$;

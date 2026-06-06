-- Migración: baseline_multiplier_matchday1
-- Regla de negocio: la Jornada 1 del torneo es la línea base y SIEMPRE vale
-- 1.00x, sin importar la antelación. Los multiplicadores empiezan a aplicar
-- desde la Jornada 2 en adelante (y en las eliminatorias, que no tienen matchday).
--
-- Se aplica en fn_save_prediction (única vía de escritura de `multiplier`), que
-- ahora también lee matches.matchday. fn_prediction_multiplier(timestamptz) se
-- mantiene puro (antelación por-partido) — la regla de Jornada 1 vive aquí.
-- Espejo en TS: src/utils/scoring.ts (BASELINE_MATCHDAY / calculatePredictionMultiplier).

create or replace function public.fn_save_prediction(
  p_league_id uuid,
  p_match_id uuid,
  p_home_score_pred int,
  p_away_score_pred int
)
returns public.predictions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_match_time timestamptz;
  v_matchday   int;
  v_multiplier numeric(3, 2);
  v_row        public.predictions;
begin
  -- Usuario autenticado.
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  -- Pertenencia a la liga (reusa el helper de 1.2).
  if not public.fn_user_in_league(p_league_id) then
    raise exception 'No eres miembro de la liga' using errcode = '42501';
  end if;

  -- Scores válidos (espeja el CHECK de la tabla).
  if p_home_score_pred is null or p_away_score_pred is null
     or p_home_score_pred < 0 or p_away_score_pred < 0 then
    raise exception 'Marcador invalido' using errcode = '23514';
  end if;

  -- El partido debe existir.
  select m.match_time, m.matchday into v_match_time, v_matchday
  from public.matches m
  where m.id = p_match_id;
  if v_match_time is null then
    raise exception 'Partido inexistente' using errcode = 'P0002';
  end if;

  -- Bloqueo de escritura por kickoff (server-authoritative). Mensaje estable
  -- 'Pronostico cerrado' → la Server Action lo mapea a un error definitivo
  -- (no reintentable). Cierra el diferido de 2.1.
  if not public.fn_match_editable(p_match_id) then
    raise exception 'Pronostico cerrado' using errcode = 'P0001';
  end if;

  -- Multiplicador con la hora del SERVIDOR (no del cliente).
  -- Jornada 1 (línea base): 1.00x fijo. Resto: antelación por-partido.
  if v_matchday = 1 then
    v_multiplier := 1.00;
  else
    v_multiplier := public.fn_prediction_multiplier(v_match_time);
  end if;

  insert into public.predictions (
    league_id, match_id, user_id, home_score_pred, away_score_pred, multiplier
  ) values (
    p_league_id, p_match_id, v_uid, p_home_score_pred, p_away_score_pred, v_multiplier
  )
  on conflict (league_id, user_id, match_id) do update
    set home_score_pred = excluded.home_score_pred,
        away_score_pred = excluded.away_score_pred,
        multiplier      = excluded.multiplier
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.fn_save_prediction(uuid, uuid, int, int) is
  'Guarda (crea/actualiza) la predicción del usuario actual validando usuario, pertenencia, scores y kickoff. Calcula multiplier con now() del servidor: Jornada 1 = 1.00x fijo (línea base), resto por antelación al kickoff. Única vía de escritura de multiplier para el cliente.';

grant execute on function public.fn_save_prediction(uuid, uuid, int, int) to authenticated;

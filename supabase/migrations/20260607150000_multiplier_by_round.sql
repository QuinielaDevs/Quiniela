-- Migración: multiplier_by_round
-- Cambia el multiplicador por antelación de "días al kickoff" a "DISTANCIA EN
-- JORNADAS" respecto a la jornada en curso.
--
-- Reglas (decisión de producto 2026-06-07):
--   - Jornada 1 = 1.00x SIEMPRE (línea base).
--   - El resto escala LINEAL +0.25 por jornada de distancia, tope 2.50x:
--       distancia 0 → 1.00x, 1 → 1.25x, 2 → 1.50x, ... 6+ → 2.50x.
--   - "Jornada en curso" = la última ronda cuyo primer partido ya empezó
--     (match_time <= now()). Conforme avanza el torneo la distancia se acorta y
--     el multiplicador baja: esa es la penalización (igual que antes, pero en
--     jornadas en vez de días).
--   - Rondas de eliminatoria cuentan como jornadas consecutivas:
--       J1=1, J2=2, J3=3, 32avos=4, Octavos=5, Cuartos=6, Semis=7,
--       3er puesto=8, Final=8.
--
-- Espejo en TS: src/utils/scoring.ts (roundOrdinal / calculatePredictionMultiplier).

-- ============================================================
-- 1) Ordinal de ronda a partir de (matchday, stage). Puro/inmutable.
-- ============================================================
create or replace function public.fn_match_round_ordinal(
  p_matchday int,
  p_stage text
)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when p_stage = 'group' or (p_matchday is not null and p_stage is null)
      then p_matchday
    when p_stage = 'round-32'    then 4
    when p_stage = 'round-16'    then 5
    when p_stage = 'quarter'     then 6
    when p_stage = 'semi'        then 7
    when p_stage = 'third-place' then 8
    when p_stage = 'final'       then 8
    else null
  end;
$$;

comment on function public.fn_match_round_ordinal(int, text) is
  'Ordinal secuencial de la ronda de un partido (J1=1..Final=8) a partir de matchday/stage. Base de la distancia entre jornadas para el multiplicador.';

-- ============================================================
-- 2) Ordinal de la "jornada en curso": la mayor ronda cuyo primer partido ya
--    empezó (match_time <= now()). 0 si el torneo aún no inicia. SECURITY
--    DEFINER porque lee matches y usa now() del servidor.
-- ============================================================
create or replace function public.fn_current_round_ordinal()
returns int
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(
    max(public.fn_match_round_ordinal(m.matchday, m.stage)),
    0
  )
  from public.matches m
  where m.match_time <= now()
    and m.status <> 'canceled';
$$;

comment on function public.fn_current_round_ordinal() is
  'Ordinal de la jornada en curso = mayor ronda cuyo primer partido ya empezó (now()). 0 antes del inicio del torneo.';

-- El tablero (server component) lo consulta para alimentar el multiplicador
-- predictivo de la UI con la jornada en curso real (incluye rondas ya iniciadas).
grant execute on function public.fn_current_round_ordinal() to authenticated;

-- ============================================================
-- 3) Multiplicador por distancia de jornadas. Nueva firma (matchday, stage).
--    Convive temporalmente con la versión antigua (timestamptz), que se
--    elimina al final tras migrar a los llamadores.
-- ============================================================
create or replace function public.fn_prediction_multiplier(
  p_matchday int,
  p_stage text
)
returns numeric
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_target   int := public.fn_match_round_ordinal(p_matchday, p_stage);
  v_current  int;
  v_distance int;
begin
  -- Jornada 1 (línea base) o ronda desconocida → 1.00x.
  if v_target is null or v_target <= 1 then
    return 1.00;
  end if;

  v_current  := public.fn_current_round_ordinal();
  v_distance := greatest(0, v_target - v_current);

  -- Lineal +0.25 por jornada de distancia, tope 2.50x.
  return least(2.50, 1.00 + 0.25 * v_distance)::numeric(3, 2);
end;
$$;

comment on function public.fn_prediction_multiplier(int, text) is
  'Multiplicador por antelación basado en la distancia (en jornadas) entre la ronda del partido y la jornada en curso. Jornada 1 = 1.00x. Lineal +0.25/jornada, tope 2.50x.';

-- ============================================================
-- 4) fn_save_prediction: mismo cuerpo (con stash de prev_* para deshacer), pero
--    el multiplicador ahora se calcula por jornada (matchday + stage), no por
--    la hora del partido.
-- ============================================================
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
  v_stage      text;
  v_multiplier numeric(3, 2);
  v_row        public.predictions;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  if not public.fn_user_in_league(p_league_id) then
    raise exception 'No eres miembro de la liga' using errcode = '42501';
  end if;

  if p_home_score_pred is null or p_away_score_pred is null
     or p_home_score_pred < 0 or p_away_score_pred < 0 then
    raise exception 'Marcador invalido' using errcode = '23514';
  end if;

  select m.match_time, m.matchday, m.stage
    into v_match_time, v_matchday, v_stage
  from public.matches m
  where m.id = p_match_id;
  if v_match_time is null then
    raise exception 'Partido inexistente' using errcode = 'P0002';
  end if;

  if not public.fn_match_editable(p_match_id) then
    raise exception 'Pronostico cerrado' using errcode = 'P0001';
  end if;

  -- Multiplicador por distancia de jornadas (server-authoritative).
  v_multiplier := public.fn_prediction_multiplier(v_matchday, v_stage);

  insert into public.predictions (
    league_id, match_id, user_id, home_score_pred, away_score_pred, multiplier
  ) values (
    p_league_id, p_match_id, v_uid, p_home_score_pred, p_away_score_pred, v_multiplier
  )
  on conflict (league_id, user_id, match_id) do update
    set prev_home_score_pred = case
          when predictions.home_score_pred is distinct from excluded.home_score_pred
            or predictions.away_score_pred is distinct from excluded.away_score_pred
          then predictions.home_score_pred
          else predictions.prev_home_score_pred
        end,
        prev_away_score_pred = case
          when predictions.home_score_pred is distinct from excluded.home_score_pred
            or predictions.away_score_pred is distinct from excluded.away_score_pred
          then predictions.away_score_pred
          else predictions.prev_away_score_pred
        end,
        prev_multiplier = case
          when predictions.home_score_pred is distinct from excluded.home_score_pred
            or predictions.away_score_pred is distinct from excluded.away_score_pred
          then predictions.multiplier
          else predictions.prev_multiplier
        end,
        prev_saved_at = case
          when predictions.home_score_pred is distinct from excluded.home_score_pred
            or predictions.away_score_pred is distinct from excluded.away_score_pred
          then now()
          else predictions.prev_saved_at
        end,
        home_score_pred = excluded.home_score_pred,
        away_score_pred = excluded.away_score_pred,
        multiplier      = excluded.multiplier
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.fn_save_prediction(uuid, uuid, int, int) is
  'Guarda (crea/actualiza) la predicción validando usuario, pertenencia, scores y kickoff. Multiplier por distancia de jornadas (fn_prediction_multiplier(matchday, stage)). Al cambiar el marcador stashea prev_* para deshacer.';

grant execute on function public.fn_save_prediction(uuid, uuid, int, int) to authenticated;

-- ============================================================
-- 5) fn_ensure_default_predictions: usa el multiplicador por jornada.
-- ============================================================
create or replace function public.fn_ensure_default_predictions(p_league_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_count integer;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  if not public.fn_user_in_league(p_league_id) then
    raise exception 'No eres miembro de la liga' using errcode = '42501';
  end if;

  with inserted as (
    insert into public.predictions (
      league_id, match_id, user_id, home_score_pred, away_score_pred, multiplier
    )
    select
      p_league_id,
      m.id,
      v_uid,
      0,
      0,
      public.fn_prediction_multiplier(m.matchday, m.stage)
    from public.matches m
    where public.fn_match_editable(m.id)
      and not exists (
        select 1
        from public.predictions p
        where p.league_id = p_league_id
          and p.user_id = v_uid
          and p.match_id = m.id
      )
    on conflict (league_id, user_id, match_id) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;

comment on function public.fn_ensure_default_predictions(uuid) is
  'Crea predicciones por defecto (0-0) con el multiplicador por jornada para cada partido editable sin predicción previa del usuario en la liga. Idempotente.';

grant execute on function public.fn_ensure_default_predictions(uuid) to authenticated;

-- ============================================================
-- 6) Eliminar la versión antigua del multiplicador por kickoff (ya nadie la usa).
-- ============================================================
drop function if exists public.fn_prediction_multiplier(timestamptz);

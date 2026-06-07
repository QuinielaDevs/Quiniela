-- Migración: default_predictions
-- Auto-guardado de predicciones por defecto (0-0).
--
-- Garantiza que el usuario SIEMPRE tenga una predicción para cada partido
-- editable: al cargar el tablero se crea un 0-0 por defecto para los partidos
-- programados, abiertos a edición (antes del kickoff) y con equipos resueltos,
-- donde el usuario aún no tiene predicción. Así, dejar un 0-0 sin tocar cuenta
-- como pronóstico (suma puntos si el resultado es 0-0) en vez de no existir como
-- fila (que no puntúa). El usuario puede editarlo después como cualquier otro.
--
-- Reusa fn_match_editable (kickoff exacto + status 'scheduled' + bloqueo de slots
-- TBD de eliminatoria) y fn_prediction_multiplier (multiplicador por antelación),
-- exactamente como fn_save_prediction. SECURITY DEFINER: única vía masiva de
-- escritura de `multiplier` para el cliente; todas las guardas viven dentro.

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
  -- Usuario autenticado.
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  -- Pertenencia a la liga (reusa el helper de 1.2).
  if not public.fn_user_in_league(p_league_id) then
    raise exception 'No eres miembro de la liga' using errcode = '42501';
  end if;

  -- Inserta 0-0 con el multiplicador del SERVIDOR para cada partido editable
  -- (fn_match_editable: scheduled, antes del kickoff y equipos resueltos) sin
  -- predicción previa del usuario en esta liga. Idempotente vía on conflict:
  -- ejecutarla de nuevo no toca las predicciones existentes.
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
      -- Jornada 1 (línea base): 1.00x fijo. Resto: antelación por-partido.
      -- Espeja la regla de fn_save_prediction (baseline_multiplier_matchday1).
      case
        when m.matchday = 1 then 1.00
        else public.fn_prediction_multiplier(m.match_time)
      end
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
  'Crea predicciones por defecto (0-0) con el multiplicador del servidor para cada partido editable (fn_match_editable) sin predicción previa del usuario en la liga. Idempotente. Garantiza que dejar 0-0 cuente como pronóstico.';

grant execute on function public.fn_ensure_default_predictions(uuid) to authenticated;

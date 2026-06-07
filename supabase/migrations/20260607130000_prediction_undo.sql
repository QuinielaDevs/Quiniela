-- Migración: prediction_undo
-- "Deshacer cambio" de predicción con ventana de gracia (2 minutos).
--
-- Problema: al editar una predicción guardada (p. ej. 3-2 a 2.50x) y luego
-- querer volver a ella, el multiplicador se recalculaba con la hora actual y se
-- degradaba, aunque el marcador final fuese idéntico al original. El usuario
-- quiere poder deshacer un cambio reciente SIN penalización, pero conservando la
-- penalización legítima si vuelve mucho después (otro día).
--
-- Solución: fn_save_prediction "stashea" el estado anterior (marcador +
-- multiplicador + hora) cada vez que el MARCADOR cambia. fn_revert_prediction
-- restaura ese estado anterior, pero SOLO dentro de la ventana de gracia. El
-- multiplicador restaurado lo provee el SERVIDOR (el valor stasheado), nunca el
-- cliente → no es manipulable. Pasada la ventana, deshacer queda inhabilitado y
-- cualquier cambio recalcula el multiplicador (penalización).

-- ============================================================
-- 1) Columnas de "estado anterior" (un nivel de undo). Nullable: sin cambio
--    reciente no hay nada que deshacer.
-- ============================================================
alter table public.predictions
  add column if not exists prev_home_score_pred int,
  add column if not exists prev_away_score_pred int,
  add column if not exists prev_multiplier numeric(3, 2),
  add column if not exists prev_saved_at timestamptz;

comment on column public.predictions.prev_saved_at is
  'Hora en que el marcador actual reemplazó al anterior. Base de la ventana de gracia para deshacer (fn_revert_prediction).';

-- ============================================================
-- 2) fn_save_prediction: igual que antes, pero al ACTUALIZAR stashea el estado
--    previo cuando el marcador cambia (no en re-guardados del mismo marcador).
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

  -- Bloqueo de escritura por kickoff (server-authoritative).
  if not public.fn_match_editable(p_match_id) then
    raise exception 'Pronostico cerrado' using errcode = 'P0001';
  end if;

  -- Multiplicador con la hora del SERVIDOR. Jornada 1 = 1.00x fijo (línea base).
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
    -- Stashea el estado previo SOLO si el marcador cambia (para poder deshacerlo).
    -- Un re-guardado del mismo marcador no toca prev_* ni la ventana de gracia.
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
  'Guarda (crea/actualiza) la predicción del usuario validando usuario, pertenencia, scores y kickoff. Multiplier server-side: Jornada 1 = 1.00x, resto por antelación. Al cambiar el marcador stashea el estado previo (prev_*) para permitir deshacer.';

grant execute on function public.fn_save_prediction(uuid, uuid, int, int) to authenticated;

-- ============================================================
-- 3) fn_revert_prediction: restaura el estado previo stasheado dentro de la
--    ventana de gracia (2 min). El multiplicador restaurado es el del SERVIDOR,
--    no lo provee el cliente → no manipulable. Tras restaurar limpia prev_*
--    (un solo nivel de undo). Bloquea tras el kickoff como el guardado.
-- ============================================================
create or replace function public.fn_revert_prediction(
  p_league_id uuid,
  p_match_id uuid
)
returns public.predictions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_window constant interval := interval '2 minutes';
  v_row    public.predictions;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  if not public.fn_user_in_league(p_league_id) then
    raise exception 'No eres miembro de la liga' using errcode = '42501';
  end if;

  -- No se puede deshacer tras el kickoff (mismo candado que el guardado).
  if not public.fn_match_editable(p_match_id) then
    raise exception 'Pronostico cerrado' using errcode = 'P0001';
  end if;

  select * into v_row
  from public.predictions
  where league_id = p_league_id
    and user_id = v_uid
    and match_id = p_match_id;

  if v_row.id is null then
    raise exception 'Prediccion inexistente' using errcode = 'P0002';
  end if;

  -- Solo un cambio dentro de la ventana de gracia es reversible.
  if v_row.prev_saved_at is null
     or now() - v_row.prev_saved_at > v_window then
    raise exception 'Ventana de deshacer expirada' using errcode = 'P0003';
  end if;

  update public.predictions set
    home_score_pred      = v_row.prev_home_score_pred,
    away_score_pred      = v_row.prev_away_score_pred,
    multiplier           = v_row.prev_multiplier,
    prev_home_score_pred = null,
    prev_away_score_pred = null,
    prev_multiplier      = null,
    prev_saved_at        = null
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.fn_revert_prediction(uuid, uuid) is
  'Deshace el último cambio de marcador del usuario restaurando el estado previo (marcador + multiplicador) si está dentro de la ventana de gracia de 2 minutos. El multiplicador restaurado es el stasheado por el servidor (no manipulable). Un solo nivel de undo.';

grant execute on function public.fn_revert_prediction(uuid, uuid) to authenticated;

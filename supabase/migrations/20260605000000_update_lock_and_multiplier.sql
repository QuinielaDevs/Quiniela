-- Migración: update_lock_and_multiplier
-- Actualiza:
--   1) public.fn_match_editable(p_match_id uuid): permite editar el pronóstico hasta el kickoff exacto y sólo si está 'scheduled'.
--   2) public.fn_prediction_multiplier(p_match_time timestamptz): calcula el multiplicador en base al kickoff del primer partido de todo el torneo.

create or replace function public.fn_match_editable(p_match_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.matches m
    where m.id = p_match_id
      and now() < m.match_time
      and m.status = 'scheduled'
  );
$$;

comment on function public.fn_match_editable(uuid) is
  'Devuelve true si el partido aún admite escritura de predicciones (now() < match_time y status es scheduled).';

create or replace function public.fn_match_unlocked(p_match_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.matches m
    where m.id = p_match_id
      and (now() >= m.match_time or m.status != 'scheduled')
  );
$$;

comment on function public.fn_match_unlocked(uuid) is
  'Devuelve true si el partido ya comenzó o pasó de la hora de inicio, permitiendo lectura pública de las predicciones.';

create or replace function public.fn_prediction_multiplier(p_match_time timestamptz)
returns numeric
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_first_match_time timestamptz;
begin
  select min(match_time) into v_first_match_time
  from public.matches;

  -- Respaldo defensivo si no hay partidos.
  if v_first_match_time is null then
    v_first_match_time := p_match_time;
  end if;

  return (
    case
      when extract(epoch from (v_first_match_time - now())) / 86400.0 >= 35 then 2.50
      when extract(epoch from (v_first_match_time - now())) / 86400.0 >= 28 then 2.20
      when extract(epoch from (v_first_match_time - now())) / 86400.0 >= 21 then 1.90
      when extract(epoch from (v_first_match_time - now())) / 86400.0 >= 14 then 1.60
      when extract(epoch from (v_first_match_time - now())) / 86400.0 >= 7  then 1.30
      else 1.00
    end
  )::numeric(3, 2);
end;
$$;

comment on function public.fn_prediction_multiplier(timestamptz) is
  'Calcula el multiplicador por antelación al kickoff (1.00-2.50) basado en la antelación al primer partido del torneo.';

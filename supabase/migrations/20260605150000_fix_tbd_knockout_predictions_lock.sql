-- Migración: fix_tbd_knockout_predictions_lock
-- Restaura el chequeo de partidos de eliminatoria "Por definir" (TBD) en fn_match_editable,
-- manteniendo la regla de kickoff exacto (now() < match_time) introducida en Epic 7.

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
      and (
        m.bracket_slot is null
        or (
          m.home_team_code is not null
          and m.away_team_code is not null
        )
      )
  );
$$;

comment on function public.fn_match_editable(uuid) is
  'Devuelve true si el partido admite predicciones: antes del kickoff exacto y, para eliminatorias, con equipos reales resueltos. No controla edición admin de resultados.';

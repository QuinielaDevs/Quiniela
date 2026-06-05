-- Migracion: block_tbd_knockout_predictions
-- Story 7.1 review: los placeholders de eliminatoria ("Por definir") no deben
-- aceptar predicciones hasta que Story 7.3 resuelva equipos reales.
-- Mantiene intacto el futuro flujo admin de resultados (Story 7.2), que usara
-- un RPC admin-gated separado y no depende de fn_match_editable.

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
      and now() < m.match_time - interval '1 minute'
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
  'Devuelve true si el partido admite predicciones: antes del bloqueo por kickoff y, para eliminatorias, con equipos reales resueltos. No controla edicion admin de resultados.';

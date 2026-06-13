-- Migración: league_award_points_rpc (fix BUG-004, docs/e2e-plan/BUGS.md)
-- Los puntos de premios especiales (campeón/goleador/MVP) existían solo en la
-- vista special_predictions_with_points, desconectados del front-end. Decisión
-- de producto (2026-06-11): los premios SUMAN al ranking oficial de /standings
-- (y a la proyectada de /live), con desglose en /awards.
--
-- Problema de acceso: la vista es security_invoker y la policy
-- special_predictions_select_own solo deja leer las filas PROPIAS (privacidad
-- deliberada de los picks rivales, Story 6.1). Para agregar el ranking sin
-- exponer los picks, este RPC SECURITY DEFINER devuelve SOLO el total de puntos
-- por usuario de la liga:
--   - No revela candidate_id ni categoría: solo (user_id, award_points).
--   - Pre-resolución no filtra nada: la vista da points = 0 para todo el mundo
--     hasta que el admin marca award_candidates.is_winner.
--   - Gate de membresía: solo miembros de la liga pueden invocarlo (42501).

create or replace function public.fn_get_league_award_points(p_league_id uuid)
returns table (user_id uuid, award_points numeric)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not public.fn_user_in_league(p_league_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  return query
    select sp.user_id, coalesce(sum(sp.points), 0)::numeric as award_points
    from public.special_predictions_with_points sp
    where sp.league_id = p_league_id
    group by sp.user_id;
end;
$$;

comment on function public.fn_get_league_award_points(uuid) is
  'Total de puntos de premios especiales por usuario de la liga (suma de special_predictions_with_points.points). SECURITY DEFINER: agrega sobre filas que la RLS oculta entre rivales, exponiendo SOLO el total por usuario (nunca los picks). Gate: miembros de la liga.';

grant execute on function public.fn_get_league_award_points(uuid) to authenticated;

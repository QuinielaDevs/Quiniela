-- supabase/migrations/20260603183500_fix_deferred_work.sql
-- Resolución de elementos diferidos de la Épica 6.

-- 1) Diferido 1: Trigger para limpiar predicciones especiales de una liga cuando el usuario la abandona o es expulsado.
create or replace function public.fn_cleanup_predictions_on_member_leave()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.special_predictions
  where user_id = old.user_id
    and league_id = old.league_id;
  return old;
end;
$$;

comment on function public.fn_cleanup_predictions_on_member_leave() is
  'Elimina automáticamente las predicciones especiales de un usuario para una liga cuando este deja de pertenecer a la misma.';

drop trigger if exists tr_cleanup_predictions_on_member_leave on public.league_members;

create trigger tr_cleanup_predictions_on_member_leave
  after delete on public.league_members
  for each row
  execute function public.fn_cleanup_predictions_on_member_leave();


-- 2) Diferido 3 y 5: RPC para consultar el registro completo de la fase activa actual en la base de datos usando now().
create or replace function public.fn_get_active_tournament_phase()
returns setof public.tournament_phases
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select *
  from public.tournament_phases
  where (starts_at is null or now() >= starts_at)
    and (ends_at is null or now() < ends_at)
  order by sort_order asc
  limit 1;
end;
$$;

comment on function public.fn_get_active_tournament_phase() is
  'Retorna el registro completo de la fase activa del torneo en base a la hora actual de la base de datos (now()).';


-- 3) Diferido 4: Modificar la vista special_predictions_with_points a LEFT JOIN contra award_candidates.
-- Esto evita que los pronósticos desaparezcan de la vista si un candidato es desactivado o eliminado.
create or replace view public.special_predictions_with_points
with (security_invoker = true) as
select
  sp.id,
  sp.user_id,
  sp.league_id,
  sp.category,
  sp.candidate_id,
  sp.predicted_at,
  sp.created_at,
  coalesce(ac.is_winner = true, false) as is_correct,
  case
    when ac.is_winner = true then
      coalesce(
        (select case when tp.edits_locked then 0 else tp.reward_points end
         from public.tournament_phases tp
         where (tp.starts_at is null or sp.predicted_at >= tp.starts_at)
           and (tp.ends_at is null or sp.predicted_at < tp.ends_at)
         order by tp.sort_order asc
         limit 1),
        0
      )
    else 0
  end as points
from public.special_predictions sp
left join public.award_candidates ac on sp.candidate_id = ac.id and sp.category = ac.category;

comment on view public.special_predictions_with_points is
  'Vista dinámica de puntos de predicciones especiales. Usa LEFT JOIN para mantener visibles los registros huérfanos.';

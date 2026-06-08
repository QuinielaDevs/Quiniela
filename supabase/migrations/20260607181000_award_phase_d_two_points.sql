-- Migración: award_phase_d_two_points
-- Ajusta los Premios Copa para que la fase "Semifinales en adelante" otorgue
-- 2 pts si la predicción especial es correcta. La edición sigue bloqueada en
-- Fase D; el bloqueo no debe anular la recompensa.

alter table public.tournament_phases
  drop constraint if exists tournament_phases_reward_check;

update public.tournament_phases
set reward_points = 2
where phase_code = 'D';

alter table public.tournament_phases
  add constraint tournament_phases_reward_check
  check (reward_points in (50, 25, 10, 2));

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
        (select tp.reward_points
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
  'Vista dinámica de puntos de predicciones especiales. Usa LEFT JOIN para mantener visibles los registros huérfanos; Fase D bloquea edición pero conserva su recompensa de 2 pts.';

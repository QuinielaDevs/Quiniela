-- supabase/migrations/20260603155843_tournament_phases_schema.sql
-- Migración para Story 6.2: Sistema de Puntuación Decreciente y Cierre por Semifinales.
-- Crea la tabla tournament_phases, agrega la columna is_winner a award_candidates,
-- define la vista special_predictions_with_points, e implementa el trigger de bloqueo.

create table public.tournament_phases (
  id            uuid primary key default gen_random_uuid(),
  phase_code    text not null,
  reward_points integer not null,
  starts_at     timestamptz,            -- null = open-ended start (Fase A)
  ends_at       timestamptz,            -- null = open-ended end   (Fase D)
  edits_locked  boolean not null default false,
  label         text not null,
  sort_order    integer not null,       -- 0..3, mirrors array index in config
  created_at    timestamptz not null default now(),

  constraint tournament_phases_phase_code_key   unique (phase_code),
  constraint tournament_phases_sort_order_key   unique (sort_order),
  constraint tournament_phases_phase_code_check check (phase_code in ('A','B','C','D')),
  constraint tournament_phases_reward_check     check (reward_points in (50, 25, 10, 0)),
  -- [starts_at, ends_at): enforce ordering when both present.
  constraint tournament_phases_bounds_check     check (starts_at is null or ends_at is null or starts_at < ends_at)
);

comment on table public.tournament_phases is
  'WC2026 phase boundaries for FR-16 decreasing-points scoring. Derived from src/config/tournamentPhases.ts. Read-only for clients.';

-- RLS: deny-by-default. Authenticated read-only. No client writes.
alter table public.tournament_phases enable row level security;

create policy "tournament_phases_select_authenticated"
  on public.tournament_phases
  for select
  to authenticated
  using (true);

-- Seeding (TEMPORARILY DISABLED).
do $$
begin
  if false then
insert into public.tournament_phases
  (phase_code, reward_points, starts_at,                ends_at,                  edits_locked, label,                                          sort_order)
values
  ('A', 50, null,                     '2026-06-11T18:00:00Z', false, 'Before inaugural match',                          0),
  ('B', 25, '2026-06-11T18:00:00Z',   '2026-06-28T16:00:00Z', false, 'Group stage',                                     1),
  ('C', 10, '2026-06-28T16:00:00Z',   '2026-07-14T18:00:00Z', false, 'Round of 32 + Round of 16 + Quarterfinals',       2),
  ('D', 0,  '2026-07-14T18:00:00Z',   null,                   true,  'Semifinals onward',                               3);
  end if;
end;
$$;

-- Agregar is_winner a award_candidates.
alter table public.award_candidates
  add column is_winner boolean not null default false;

comment on column public.award_candidates.is_winner is
  'Indica si el candidato es el ganador oficial de la categoría.';

-- Crear vista special_predictions_with_points.
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
  (ac.is_winner = true) as is_correct,
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
join public.award_candidates ac on sp.candidate_id = ac.id and sp.category = ac.category;

comment on view public.special_predictions_with_points is
  'Vista dinámica que expone el estado de acierto y los puntos calculados por cada predicción especial según predicted_at.';

-- Crear función de trigger para bloqueo de modificaciones en Fase D.
create or replace function public.fn_check_awards_locked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edits_locked boolean;
begin
  select edits_locked into v_edits_locked
  from public.tournament_phases
  where (starts_at is null or now() >= starts_at)
    and (ends_at is null or now() < ends_at)
  order by sort_order asc
  limit 1;

  if v_edits_locked is null then
    raise exception 'No se encontró una fase activa del torneo para la fecha actual.';
  end if;

  if v_edits_locked then
    raise exception 'Las predicciones de premios especiales están bloqueadas en esta fase del torneo.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger tr_check_awards_locked
  before insert or update or delete
  on public.special_predictions
  for each row
  execute function public.fn_check_awards_locked();

-- Migración: awards_lock_at_final
-- Cambia el bloqueo de premios especiales para que dependa del inicio de la final.
-- Permite lectura cruzada de picks una vez bloqueado, y agrega función de administración
-- para declarar ganadores oficiales.

-- 1) Cambiar edits_locked de la Fase D a false
update public.tournament_phases
set edits_locked = false
where phase_code = 'D';

-- 2) Redefinir fn_are_special_predictions_locked para que sea dinámico según la final
create or replace function public.fn_are_special_predictions_locked()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_final_kickoff timestamptz;
  v_matches_exist boolean;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'matches'
  ) into v_matches_exist;

  if not v_matches_exist then
    return false;
  end if;

  select min(match_time) into v_final_kickoff
  from public.matches
  where stage = 'final';

  if v_final_kickoff is not null and now() >= v_final_kickoff then
    return true;
  end if;

  return false;
end;
$$;

comment on function public.fn_are_special_predictions_locked() is
  'Retorna true si las predicciones especiales están bloqueadas porque ya comenzó el partido de la final.';

-- 3) Redefinir fn_check_awards_locked para usar el bloqueo dinámico
create or replace function public.fn_check_awards_locked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.fn_are_special_predictions_locked() then
    raise exception 'Las predicciones de premios especiales están bloqueadas en esta fase del torneo.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- 4) Redefinir fn_get_active_tournament_phase para computar edits_locked dinámicamente
create or replace function public.fn_get_active_tournament_phase()
returns setof public.tournament_phases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.tournament_phases%rowtype;
begin
  select * into v_row
  from public.tournament_phases
  where (starts_at is null or now() >= starts_at)
    and (ends_at is null or now() < ends_at)
  order by sort_order asc
  limit 1;

  if v_row.id is not null then
    v_row.edits_locked := public.fn_are_special_predictions_locked();
    return next v_row;
  end if;
  return;
end;
$$;

-- 5) Actualizar RLS: select cruzado de special_predictions tras bloqueo
drop policy if exists "special_predictions_select_own" on public.special_predictions;
create policy "special_predictions_select_own_or_after_lock"
  on public.special_predictions for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.fn_are_special_predictions_locked()
  );

-- 6) Crear función de administración fn_admin_resolve_award_winner
create or replace function public.fn_admin_resolve_award_winner(
  p_category text,
  p_winner_candidate_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- (a) Sesión.
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  -- (b) Admin de alguna liga.
  if not public.fn_user_is_any_league_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  -- (c) Validar categoría.
  if p_category not in ('champion', 'top_scorer', 'mvp') then
    raise exception 'Categoría de premio inválida' using errcode = '22023';
  end if;

  -- (d) Si p_winner_candidate_id es null, se limpia el ganador para esa categoría.
  -- De lo contrario, se valida que el candidato exista y pertenezca a la misma categoría.
  if p_winner_candidate_id is not null then
    if not exists (
      select 1 from public.award_candidates
      where id = p_winner_candidate_id and category = p_category
    ) then
      raise exception 'El candidato no existe o no corresponde a esta categoría.' using errcode = 'P0002';
    end if;
  end if;

  -- (e) Actualizar todos los candidatos de esta categoría.
  update public.award_candidates
  set is_winner = (id = p_winner_candidate_id)
  where category = p_category;
end;
$$;

comment on function public.fn_admin_resolve_award_winner(text, uuid) is
  'Establece el candidato ganador oficial de una categoría (is_winner = true) y marca el resto como false. Requiere rol de administrador de liga.';

grant execute on function public.fn_admin_resolve_award_winner(text, uuid) to authenticated;

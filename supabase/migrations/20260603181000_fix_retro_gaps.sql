-- supabase/migrations/20260603181000_fix_retro_gaps.sql
-- Correcciones de la retrospectiva de la Épica 6.

-- 1) Caso 1: Modificar tr_check_awards_locked para que no se ejecute en DELETE.
-- Esto permite que los usuarios sean eliminados o abandonen ligas sin fallar por bloqueo.
drop trigger if exists tr_check_awards_locked on public.special_predictions;

create trigger tr_check_awards_locked
  before insert or update
  on public.special_predictions
  for each row
  execute function public.fn_check_awards_locked();

-- 2) Caso 3: Sincronización automática de fechas de fase desde la tabla matches.
-- Esta función actualiza tournament_phases dinámicamente según el fixture de partidos.
-- Se ejecutará en la Épica 2 mediante un trigger en la tabla matches (cuando exista).
create or replace function public.fn_sync_tournament_phases_from_matches()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inaugural_kickoff timestamptz;
  v_knockout_kickoff timestamptz;
  v_semifinal_kickoff timestamptz;
  v_matches_exist boolean;
begin
  -- Verificar si la tabla 'matches' existe en el esquema public
  select exists (
    select 1
    from information_schema.tables 
    where table_schema = 'public' 
      and table_name = 'matches'
  ) into v_matches_exist;

  if not v_matches_exist then
    return;
  end if;

  -- 1) Inicio del torneo (MIN de todos los partidos)
  execute 'select min(kickoff_at) from public.matches' into v_inaugural_kickoff;

  -- 2) Inicio de eliminatorias (MIN de partidos que no son fase de grupos)
  execute 'select min(kickoff_at) from public.matches where stage is distinct from ''group''' into v_knockout_kickoff;

  -- 3) Inicio de semifinales (MIN de partidos de semifinales)
  execute 'select min(kickoff_at) from public.matches where stage = ''semifinals'' or stage = ''semifinal''' into v_semifinal_kickoff;

  -- Actualizar límites de Fase A y Fase B
  if v_inaugural_kickoff is not null then
    update public.tournament_phases
    set ends_at = v_inaugural_kickoff
    where phase_code = 'A';

    update public.tournament_phases
    set starts_at = v_inaugural_kickoff
    where phase_code = 'B';
  end if;

  -- Actualizar límites de Fase B y Fase C
  if v_knockout_kickoff is not null then
    update public.tournament_phases
    set ends_at = v_knockout_kickoff
    where phase_code = 'B';

    update public.tournament_phases
    set starts_at = v_knockout_kickoff
    where phase_code = 'C';
  end if;

  -- Actualizar límites de Fase C y Fase D
  if v_semifinal_kickoff is not null then
    update public.tournament_phases
    set ends_at = v_semifinal_kickoff
    where phase_code = 'C';

    update public.tournament_phases
    set starts_at = v_semifinal_kickoff
    where phase_code = 'D';
  end if;
end;
$$;

comment on function public.fn_sync_tournament_phases_from_matches() is
  'Sincroniza los límites de fechas en tournament_phases a partir del fixture de partidos en matches. Ejecutado vía trigger en matches (Épica 2).';

-- 3) Caso 2: Resolver desincronización horaria (Node vs Postgres)
-- Función RPC que consulta el estado de bloqueo directamente usando now() del servidor de base de datos.
create or replace function public.fn_are_special_predictions_locked()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locked boolean;
begin
  select edits_locked into v_locked
  from public.tournament_phases
  where (starts_at is null or now() >= starts_at)
    and (ends_at is null or now() < ends_at)
  order by sort_order asc
  limit 1;
  return coalesce(v_locked, true); -- default to locked (fail closed)
end;
$$;

comment on function public.fn_are_special_predictions_locked() is
  'Retorna true si las predicciones especiales están bloqueadas en la fase actual según la hora del servidor de base de datos.';


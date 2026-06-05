-- supabase/migrations/20260605140000_sync_tournament_phases.sql
-- Integración Epic-6 ↔ Epic-7 (resuelta en el merge 2026-06-05).
--
-- La función fn_sync_tournament_phases_from_matches (20260603181000_fix_retro_gaps.sql)
-- se escribió contra un esquema de `matches` IMAGINADO por Epic-6:
--   * usaba la columna `kickoff_at` → el esquema real de Epic-7 usa `match_time`.
--   * buscaba `stage in ('semifinals','semifinal')` → el vocabulario real es 'semi'.
-- Quedaba además DORMIDA (ningún trigger la invocaba), por lo que tournament_phases
-- conservaba las fechas HARDCODEADAS del seed de 20260603155843, desalineadas del
-- calendario real (hasta 3h de diferencia).
--
-- Aquí: (1) corregimos la función contra el esquema real y (2) la EJECUTAMOS una vez
-- para que las fronteras de fase deriven del calendario WC2026 ya sembrado por Epic-7
-- (20260604131000_seed_worldcup_2026.sql). El contract test valida config ↔ BD ↔ calendario.

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
  -- La función es robusta a que `matches` aún no exista (orden de migraciones).
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'matches'
  ) into v_matches_exist;

  if not v_matches_exist then
    return;
  end if;

  -- Hitos del calendario real (columna `match_time`, vocabulario de stage de Epic-7).
  select min(match_time) into v_inaugural_kickoff from public.matches;
  select min(match_time) into v_knockout_kickoff  from public.matches where stage is distinct from 'group';
  select min(match_time) into v_semifinal_kickoff from public.matches where stage = 'semi';

  -- Fase A → B: partido inaugural.
  if v_inaugural_kickoff is not null then
    update public.tournament_phases set ends_at   = v_inaugural_kickoff where phase_code = 'A';
    update public.tournament_phases set starts_at = v_inaugural_kickoff where phase_code = 'B';
  end if;

  -- Fase B → C: inicio de eliminatorias (primer partido que no es de grupos).
  if v_knockout_kickoff is not null then
    update public.tournament_phases set ends_at   = v_knockout_kickoff where phase_code = 'B';
    update public.tournament_phases set starts_at = v_knockout_kickoff where phase_code = 'C';
  end if;

  -- Fase C → D: inicio de semifinales (cierre de edición).
  if v_semifinal_kickoff is not null then
    update public.tournament_phases set ends_at   = v_semifinal_kickoff where phase_code = 'C';
    update public.tournament_phases set starts_at = v_semifinal_kickoff where phase_code = 'D';
  end if;
end;
$$;

comment on function public.fn_sync_tournament_phases_from_matches() is
  'Sincroniza tournament_phases (starts_at/ends_at) desde los hitos del calendario en matches (match_time, stage de Epic-7). Corrige el desfase del seed hardcodeado de Epic-6.';

-- Wire-up: sincronizar ahora contra el calendario ya sembrado por Epic-7.
select public.fn_sync_tournament_phases_from_matches();

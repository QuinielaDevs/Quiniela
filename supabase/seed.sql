-- Seed de desarrollo local.
-- Resuelve [db.seed] enabled=true → ./seed.sql, evitando warnings en `db reset`.
--
-- NO se siembran usuarios/perfiles (los crea el trigger desde auth.users) ni
-- ligas (requieren un creador real). Las pruebas de integración crean sus
-- propios fixtures de forma aislada; esto es solo para desarrollo manual.

-- ============================================================
-- Partidos demo (Story 2.1). Datos de catálogo, sin dependencias de usuario.
-- Idempotente: external_ref es unique → on conflict do nothing permite
-- re-ejecutar `supabase db reset` sin duplicar. match_time relativos a now()
-- para tener siempre un partido futuro (predicción editable) y uno finalizado.
-- ============================================================
do $$
declare
  v_worldcup_count int;
begin
  select count(*) into v_worldcup_count
  from public.matches
  where external_ref like 'wc2026:%';

  if v_worldcup_count not in (0, 104) then
    raise exception 'Seed local inconsistente: calendario wc2026 parcial (% filas, esperado 0 o 104)', v_worldcup_count;
  end if;
end;
$$;

insert into public.matches
  (external_ref, home_team, away_team, home_team_code, away_team_code, home_score, away_score, match_time, status, matchday, stage)
select *
from (
  values
  ('demo-001', 'Argentina', 'México',    'ARG', 'MEX', null::int, null::int, now() + interval '2 days',  'scheduled', 1, 'group'),
  ('demo-002', 'España',    'Alemania',  'ESP', 'GER', null::int, null::int, now() + interval '3 hours', 'scheduled', 1, 'group'),
  ('demo-003', 'Brasil',    'Ecuador',   'BRA', 'ECU', 3,         1,         now() - interval '2 hours',  'finished',  1, 'group'),
  -- Story 3.1: un finished de OTRA jornada para probar el filtro por jornada.
  ('demo-004', 'Francia',   'Croacia',   'FRA', 'CRO', 2,         0,         now() - interval '1 day',    'finished',  2, 'group')
) as demo_matches (
  external_ref,
  home_team,
  away_team,
  home_team_code,
  away_team_code,
  home_score,
  away_score,
  match_time,
  status,
  matchday,
  stage
)
where not exists (
  select 1
  from public.matches
  where external_ref like 'wc2026:%'
)
on conflict (external_ref) do nothing;

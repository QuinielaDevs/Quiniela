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
insert into public.matches
  (external_ref, home_team, away_team, home_team_code, away_team_code, home_score, away_score, match_time, status, matchday, stage)
values
  ('demo-001', 'Argentina', 'México',    'ARG', 'MEX', null, null, now() + interval '2 days',  'scheduled', 1, 'group'),
  ('demo-002', 'España',    'Alemania',  'ESP', 'GER', null, null, now() + interval '3 hours', 'scheduled', 1, 'group'),
  ('demo-003', 'Brasil',    'Ecuador',   'BRA', 'ECU', 3,    1,    now() - interval '2 hours',  'finished',  1, 'group')
on conflict (external_ref) do nothing;

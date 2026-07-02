-- Migración: seed_tournament_phases_production
-- Garantiza que las 4 fases del torneo existan con sus valores y limites iniciales en producción,
-- y ejecuta la sincronización dinámica basada en el calendario de partidos.

insert into public.tournament_phases (phase_code, reward_points, starts_at, ends_at, edits_locked, label, sort_order)
values
  ('A', 50, null,                     '2026-06-11T19:00:00+00:00', false, 'Before inaugural match',                          0),
  ('B', 25, '2026-06-11T19:00:00+00:00',   '2026-06-28T19:00:00+00:00', false, 'Group stage',                                     1),
  ('C', 10, '2026-06-28T19:00:00+00:00',   '2026-07-14T19:00:00+00:00', false, 'Round of 32 + Round of 16 + Quarterfinals',       2),
  ('D', 2,  '2026-07-14T19:00:00+00:00',   null,                        true,  'Semifinals onward',                               3)
on conflict (phase_code) do update set
  reward_points = excluded.reward_points,
  label = excluded.label,
  sort_order = excluded.sort_order;

-- Sincronizar límites con los partidos reales si ya están sembrados en producción
select public.fn_sync_tournament_phases_from_matches();

-- Seed de desarrollo local (Story 1.2).
-- Resuelve [db.seed] enabled=true → ./seed.sql, evitando warnings en `db reset`.
--
-- Intencionadamente vacío de datos por ahora: NO se siembran usuarios/perfiles
-- (los crea el trigger desde auth.users) ni partidos (llegan en Story 2.1).
-- Las pruebas de integración crean sus propios fixtures de forma aislada.
--
-- Añade aquí ligas/usuarios demo si quieres datos para desarrollo manual.

-- ============================================================
-- Story 6.1 — Catálogo demo de candidatos a Premios Especiales.
-- En PRODUCCIÓN este catálogo lo carga el admin de plataforma vía service_role
-- (los usuarios solo lo leen por RLS). Aquí sembramos un set ilustrativo para
-- poder probar /awards manualmente. NO sembramos usuarios ni predicciones.
-- Idempotente: 'on conflict do nothing' permite re-ejecutar `supabase db reset`.
-- ============================================================
insert into public.award_candidates (category, name, team_name, flag_code, display_order) values
  -- Campeón del Mundo (selecciones nacionales; team_name = null)
  ('champion',   'Argentina',         null,        'ar', 1),
  ('champion',   'Francia',           null,        'fr', 2),
  ('champion',   'Brasil',            null,        'br', 3),
  ('champion',   'España',            null,        'es', 4),
  ('champion',   'Inglaterra',        null,        'gb', 5),
  -- Máximo Goleador (jugadores)
  ('top_scorer', 'Kylian Mbappé',     'Francia',   'fr', 1),
  ('top_scorer', 'Lionel Messi',      'Argentina', 'ar', 2),
  ('top_scorer', 'Erling Haaland',    'Noruega',   'no', 3),
  ('top_scorer', 'Harry Kane',        'Inglaterra','gb', 4),
  ('top_scorer', 'Vinícius Júnior',   'Brasil',    'br', 5),
  -- MVP / Mejor Jugador del Torneo
  ('mvp',        'Lionel Messi',      'Argentina', 'ar', 1),
  ('mvp',        'Kylian Mbappé',     'Francia',   'fr', 2),
  ('mvp',        'Jude Bellingham',   'Inglaterra','gb', 3),
  ('mvp',        'Rodri',             'España',    'es', 4),
  ('mvp',        'Vinícius Júnior',   'Brasil',    'br', 5)
on conflict do nothing;

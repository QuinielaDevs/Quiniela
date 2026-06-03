-- Migración: matches_and_predictions
-- Esquema de partidos y predicciones (Story 2.1 — AC #1).
-- Define las tablas `matches` (catálogo de partidos del Mundial) y `predictions`
-- (pronóstico de un usuario para un partido dentro de una liga). RLS y triggers
-- viven en la migración predictions_rls (siguiente). Nomenclatura: tablas
-- snake_case plural, FKs terminadas en _id, on delete cascade.
--
-- Columnas marcadas (Story X / Epic X) se definen AHORA para evitar ALTER TABLE
-- repetidos; su lógica de escritura/UI pertenece a esas historias.

-- ============================================================
-- matches — calendario de partidos del Mundial. Es catálogo común:
-- lo escribe el cron /api/sync con service_role (bypassa RLS), NO el cliente.
-- ============================================================
create table public.matches (
  id              uuid primary key default gen_random_uuid(),
  external_ref    text unique,                       -- id de API-Football (cron sync, Epic 5/NFR-5). Nullable hasta integrar el sync.
  home_team       text not null,
  away_team       text not null,
  home_team_code  text,                              -- ISO3 para banderas en public/assets/flags/ (Epic 4). Nullable.
  away_team_code  text,
  home_score      int check (home_score >= 0),       -- resultado REAL; lo llena el sync al finalizar. Nullable, pero nunca negativo.
  away_score      int check (away_score >= 0),
  match_time      timestamptz not null,              -- kickoff UTC: base del time-gating RLS, multiplicador (2.4) y bloqueo (2.4).
  status          text not null default 'scheduled'
                    check (status in ('scheduled', 'live', 'finished', 'suspended', 'canceled')),
  matchday        int,                               -- jornada oficial (Story 3.1 filtra por jornada). Nullable.
  stage           text,                              -- fase: group/round-16/quarter/semi/final (Epic 6). Nullable.
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.matches is 'Calendario de partidos del Mundial. Lo escribe el cron /api/sync (service_role). status restringido por CHECK; match_time en UTC del servidor.';

-- ============================================================
-- predictions — pronóstico de un usuario para un partido DENTRO de una liga.
-- Decisión de diseño: predicciones POR-LIGA (no globales). La visibilidad de la
-- AC se define respecto a los rivales de la liga, y standings/duelos son por-liga.
-- unique(league_id,user_id,match_id) = un pronóstico por usuario/partido/liga.
-- ============================================================
create table public.predictions (
  id               uuid primary key default gen_random_uuid(),
  league_id        uuid not null references public.leagues (id) on delete cascade,
  match_id         uuid not null references public.matches (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  home_score_pred  int not null check (home_score_pred >= 0),
  away_score_pred  int not null check (away_score_pred >= 0),
  multiplier       numeric(3, 2) not null default 1.00 check (multiplier >= 1.00),  -- Story 2.4 escribe el valor real por antelación; aquí baseline 1.00.
  points_earned    numeric(6, 2),                     -- nullable hasta evaluar; canceled/suspended → 0.00. Persistencia tras 'finished' en Epic 5.
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (league_id, user_id, match_id)
);

comment on table public.predictions is 'Pronóstico de un usuario para un partido dentro de una liga. unique(league_id,user_id,match_id) evita duplicados. RLS hace time-gating de lectura.';

-- ============================================================
-- Índices de apoyo a los joins/filtros más frecuentes.
-- (unique(league_id,user_id,match_id) y unique(external_ref) ya crean sus índices.)
-- ============================================================
create index idx_predictions_match_id on public.predictions (match_id);
create index idx_predictions_user_id on public.predictions (user_id);
create index idx_predictions_league_id on public.predictions (league_id);
create index idx_matches_match_time on public.matches (match_time);
create index idx_matches_status on public.matches (status);

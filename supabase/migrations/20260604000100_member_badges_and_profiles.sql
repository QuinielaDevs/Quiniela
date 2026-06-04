-- Migración: member_badges_and_profiles
-- Story 3.2 — historial de insignias humorísticas y perfiles psicológicos
-- por liga, usuario y jornada. La materialización inicial ocurre lazy desde
-- /account usando el cliente autenticado del usuario; service_role queda solo
-- para fixtures/tests y procesos internos futuros.

-- ============================================================
-- member_badges — medallas obtenidas por un miembro en una jornada.
-- Permite varias insignias en la misma jornada, una por badge_type.
-- ============================================================
create table public.member_badges (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references public.leagues (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  matchday    int not null check (matchday > 0),
  badge_type  text not null
                check (badge_type in ('nostradamus', 'el_salado', 'el_tibio')),
  badge_label text not null,
  reason      text not null,
  points      numeric(6, 2) not null default 0,
  earned_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (league_id, user_id, matchday, badge_type)
);

comment on table public.member_badges is
  'Historial de insignias humorísticas por liga, usuario y jornada. Story 3.2.';

-- ============================================================
-- member_game_profiles — perfil psicológico calculado por jornada.
-- Separado de profiles porque profiles es identidad global, no historial de
-- juego por liga/jornada.
-- ============================================================
create table public.member_game_profiles (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references public.leagues (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  matchday      int not null check (matchday > 0),
  profile_type  text not null
                  check (profile_type in ('optimista', 'conservador', 'cazador_sorpresas')),
  profile_label text not null,
  summary       text not null,
  computed_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (league_id, user_id, matchday)
);

comment on table public.member_game_profiles is
  'Perfil psicológico de juego por liga, usuario y jornada. Story 3.2.';

-- ============================================================
-- Índices de apoyo a las lecturas de /account y vistas de liga.
-- ============================================================
create index idx_member_badges_league_user_matchday
  on public.member_badges (league_id, user_id, matchday desc);

create index idx_member_badges_league_matchday
  on public.member_badges (league_id, matchday);

create index idx_member_game_profiles_league_user_matchday
  on public.member_game_profiles (league_id, user_id, matchday desc);

-- ============================================================
-- RLS. Las insignias/perfiles son visibles para miembros de la misma liga,
-- pero cada usuario solo materializa/escribe sus propios registros.
-- ============================================================
alter table public.member_badges enable row level security;
alter table public.member_game_profiles enable row level security;

create policy "member_badges_select_same_league"
  on public.member_badges for select
  to authenticated
  using (public.fn_user_in_league(league_id));

create policy "member_badges_insert_own"
  on public.member_badges for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.fn_user_in_league(league_id)
  );

create policy "member_badges_update_own"
  on public.member_badges for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and public.fn_user_in_league(league_id)
  )
  with check (
    user_id = (select auth.uid())
    and public.fn_user_in_league(league_id)
  );

create policy "member_game_profiles_select_same_league"
  on public.member_game_profiles for select
  to authenticated
  using (public.fn_user_in_league(league_id));

create policy "member_game_profiles_insert_own"
  on public.member_game_profiles for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.fn_user_in_league(league_id)
  );

create policy "member_game_profiles_update_own"
  on public.member_game_profiles for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and public.fn_user_in_league(league_id)
  )
  with check (
    user_id = (select auth.uid())
    and public.fn_user_in_league(league_id)
  );

-- Grants explícitos: anon puede hacer SELECT, pero RLS sin política para anon
-- devuelve 0 filas. authenticated puede leer/escribir lo propio según políticas.
revoke all on public.member_badges from anon, authenticated;
revoke all on public.member_game_profiles from anon, authenticated;

grant select on public.member_badges to anon, authenticated;
grant insert, update on public.member_badges to authenticated;

grant select on public.member_game_profiles to anon, authenticated;
grant insert, update on public.member_game_profiles to authenticated;

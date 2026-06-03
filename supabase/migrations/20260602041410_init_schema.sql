-- Migración: init_schema
-- Esquema relacional fundacional de Pija Quiniela (Story 1.2).
-- Define profiles, leagues y league_members. RLS y triggers viven en la
-- migración rls_and_triggers (siguiente). Nomenclatura: tablas snake_case
-- plural, FKs terminadas en _id, on delete cascade.

-- ============================================================
-- profiles — espeja auth.users (1:1). La fila la crea el trigger
-- fn_handle_new_user (migración rls_and_triggers), NO el cliente.
-- ============================================================
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text not null default 'Jugador Anónimo',
  avatar_url   text not null default '/assets/avatars/default-player.svg',
  created_at   timestamptz not null default now()
);

comment on table public.profiles is 'Perfil público de cada usuario; espeja auth.users vía trigger.';

-- ============================================================
-- leagues — quinielas privadas creadas por un usuario admin.
-- Columnas marcadas (Story X) se definen ahora para evitar ALTER TABLE
-- repetidos; su lógica de escritura/UI pertenece a esas historias.
-- ============================================================
create table public.leagues (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  created_by           uuid not null references public.profiles (id) on delete cascade,
  invite_code          text not null unique,            -- Story 1.4: /join/[invite_code]
  requires_payment     boolean not null default false,  -- Story 1.3 / FR-5
  payment_amount       numeric(10, 2),                  -- Story 1.3
  payment_instructions text,                            -- Story 1.3 (Bizum/Zelle)
  rules                jsonb not null default '{}'::jsonb, -- Story 1.3 (modo de predicción)
  created_at           timestamptz not null default now()
);

comment on table public.leagues is 'Liga/quiniela privada. invite_code, payment_* y rules se consumen en stories 1.3/1.4.';

-- ============================================================
-- league_members — pertenencia usuario↔liga (N:M) con rol y pago.
-- ============================================================
create table public.league_members (
  id             uuid primary key default gen_random_uuid(),
  league_id      uuid not null references public.leagues (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  role           text not null default 'member' check (role in ('admin', 'member')),       -- Story 1.3
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid')), -- FR-5 / Story 3.3
  joined_at      timestamptz not null default now(),    -- Story 3.1: criterio de desempate
  unique (league_id, user_id)
);

comment on table public.league_members is 'Membresía de un usuario en una liga. unique(league_id,user_id) evita duplicados.';

-- ============================================================
-- Índices de apoyo a los joins más frecuentes.
-- (unique(invite_code) y unique(league_id,user_id) ya crean sus índices.)
-- ============================================================
create index idx_league_members_user_id on public.league_members (user_id);
create index idx_league_members_league_id on public.league_members (league_id);
create index idx_leagues_created_by on public.leagues (created_by);

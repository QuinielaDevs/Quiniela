-- Migración: special_awards_schema
-- Esquema de Premios Especiales de la Copa (Story 6.1).
-- Define award_candidates (catálogo de favoritos, precargado por el admin de
-- plataforma) y special_predictions (la apuesta de largo plazo de cada usuario:
-- Campeón / Goleador / MVP). La lógica de PUNTUACIÓN decreciente y el cierre por
-- semifinales pertenecen a la Story 6.2 — aquí solo dejamos la estructura lista.
--
-- Decisión de alcance confirmada con el dueño del producto: las predicciones son
-- POR LIGA (no globales por perfil). Un usuario tiene UN set por cada liga a la
-- que pertenece → la clave única es (user_id, league_id, category).
--
-- RLS, trigger de predicted_at y seed viven en la migración special_awards_rls.
-- Nomenclatura: tablas snake_case plural, FKs _id, on delete cascade.

-- ============================================================
-- award_candidates — catálogo de candidatos a cada galardón.
-- Lo gestiona el admin de plataforma vía service_role/seed; los usuarios
-- solo lo LEEN (RLS en la siguiente migración). category fija el tipo de
-- galardón y habilita, junto con id, la FK compuesta de integridad.
-- ============================================================
create table public.award_candidates (
  id            uuid primary key default gen_random_uuid(),
  category      text not null check (category in ('champion', 'top_scorer', 'mvp')),
  name          text not null,                 -- selección nacional (champion) o jugador (top_scorer/mvp)
  team_name     text,                          -- selección del jugador; null para champion
  flag_code     text,                          -- código de bandera para public/assets/flags/ (opcional)
  image_url     text,                          -- foto/escudo (opcional)
  display_order int not null default 0,        -- orden del listado de favoritos
  is_active     boolean not null default true, -- permite ocultar candidatos sin borrarlos
  created_at    timestamptz not null default now(),
  -- Clave para la FK compuesta de special_predictions: Postgres exige una
  -- restricción UNIQUE exacta sobre las columnas referenciadas (id, category).
  -- id ya es único por PK, pero la FK compuesta necesita ESTA restricción.
  unique (id, category)
);

comment on table public.award_candidates is
  'Catálogo de candidatos a los galardones del Mundial (Campeón/Goleador/MVP). Solo lectura para usuarios; lo carga el admin de plataforma. La puntuación se calcula en Story 6.2.';

-- ============================================================
-- special_predictions — predicción de largo plazo de un usuario en UNA liga.
-- unique (user_id, league_id, category): una predicción por galardón, por liga,
-- por usuario → habilita el upsert con on conflict de la Server Action.
-- ============================================================
create table public.special_predictions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  league_id    uuid not null references public.leagues (id) on delete cascade,
  category     text not null check (category in ('champion', 'top_scorer', 'mvp')),
  candidate_id uuid not null,
  -- Marca server-side (nunca provista por el cliente). El trigger la refresca a
  -- now() cuando el usuario cambia de candidato; Story 6.2 calcula la fase de
  -- recompensa (50/25/10/0 pts) a partir de este valor.
  predicted_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (user_id, league_id, category),
  -- FK compuesta: garantiza a nivel de BD que el candidato pertenece a la MISMA
  -- categoría que la predicción (imposible pronosticar un goleador como campeón).
  -- on delete restrict: no se puede borrar un candidato que tenga predicciones.
  foreign key (candidate_id, category)
    references public.award_candidates (id, category) on delete restrict
);

comment on table public.special_predictions is
  'Predicción de premios (Campeón/Goleador/MVP) de un usuario EN UNA LIGA. predicted_at es server-side y se refresca al cambiar de candidato (trigger). La puntuación se calcula en Story 6.2.';

-- ============================================================
-- Índices de apoyo.
-- unique(user_id, league_id, category) ya cubre las búsquedas por user_id y por
-- (user_id, league_id); añadimos league_id para los listados por liga (6.2/clasificación).
-- ============================================================
create index idx_special_predictions_league_id on public.special_predictions (league_id);
create index idx_award_candidates_category on public.award_candidates (category);

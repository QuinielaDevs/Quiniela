-- Migración: predictions_rls
-- Seguridad (Row Level Security) de matches/predictions + helper de time-gating
-- + trigger genérico de updated_at. Depende de matches_and_predictions.
-- (Story 2.1 — AC #2, #3)

-- ============================================================
-- 1) Habilitar RLS. Sin políticas, RLS activo = denegar todo por defecto.
-- ============================================================
alter table public.matches      enable row level security;
alter table public.predictions  enable row level security;

-- ============================================================
-- 2) Helper de time-gating (anti-recursión).
--    Centraliza la regla "match_time - 1 minuto" en UN solo lugar y lee
--    `matches` SIN re-disparar RLS (igual patrón que public.fn_user_in_league
--    de Story 1.2). Usa now() del SERVIDOR → control horario server-authoritative
--    (no confía en el reloj del cliente).
-- ============================================================
create or replace function public.fn_match_unlocked(p_match_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.matches m
    where m.id = p_match_id
      and now() >= m.match_time - interval '1 minute'
  );
$$;

comment on function public.fn_match_unlocked(uuid) is
  'Devuelve true si el partido ya está desbloqueado por tiempo (now() >= match_time - 1 min). SECURITY DEFINER para leer matches sin RLS y centralizar el umbral.';

-- ============================================================
-- 3) Trigger genérico de updated_at.
--    Mantiene updated_at fresco en cada UPDATE. Lo consumen el multiplicador
--    por timestamp (Story 2.4) y el auto-guardado debounced (Story 2.3).
-- ============================================================
create or replace function public.fn_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- now() vive en pg_catalog (siempre en el search_path implícito), así que
  -- funciona con search_path=''. Se fija para silenciar el lint de Supabase
  -- function_search_path_mutable y alinear con el resto de funciones del proyecto.
  new.updated_at = now();
  return new;
end;
$$;

create trigger tr_set_matches_updated_at
  before update on public.matches
  for each row execute function public.fn_set_updated_at();

create trigger tr_set_predictions_updated_at
  before update on public.predictions
  for each row execute function public.fn_set_updated_at();

-- ============================================================
-- 4) Políticas RLS
-- ------------------------------------------------------------
-- matches:
--   * select: cualquier autenticado (el calendario es catálogo común).
--   * SIN insert/update/delete para usuarios → deny-by-default. El cron
--     /api/sync escribe con service_role (bypassa RLS).
-- ============================================================
create policy "matches_select_authenticated"
  on public.matches for select
  to authenticated
  using (true);

-- ------------------------------------------------------------
-- predictions:
--   * insert: el usuario solo crea predicciones PROPIAS en ligas a las que
--     pertenece.
--   * update: solo edita las propias. (El bloqueo de escritura por kickoff −1min
--     lo REFINA Story 2.4; aquí no se aplica.)
--   * select (CORAZÓN de la AC #2/#3): el dueño siempre; un rival de la misma
--     liga solo si el partido está desbloqueado por tiempo; ajeno/anon nunca.
-- ============================================================
create policy "predictions_insert_own"
  on public.predictions for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.fn_user_in_league(league_id)
  );

create policy "predictions_update_own"
  on public.predictions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    -- Misma guarda de pertenencia que el INSERT: sin esto, un usuario podría
    -- reubicar su predicción (cambiar league_id) a una liga a la que NO pertenece.
    and public.fn_user_in_league(league_id)
  );

create policy "predictions_select_gated"
  on public.predictions for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (
      public.fn_user_in_league(league_id)
      and public.fn_match_unlocked(match_id)
    )
  );

-- ============================================================
-- 5) Protección de columnas calculadas por el sistema.
--    `points_earned` (lo persiste el sync, Epic 5) y `multiplier` (lo calcula
--    una función SECURITY DEFINER en Story 2.4) NO deben ser escribibles por el
--    cliente: de lo contrario un usuario podría auto-asignarse puntos o un
--    multiplicador. RLS gatea FILAS, no COLUMNAS, así que la protección va por
--    privilegios de columna. Supabase concede INSERT/UPDATE a nivel de TABLA a
--    `authenticated` (eso anula un simple REVOKE de columna), por lo que primero
--    se revoca el privilegio de tabla y se reconcede SOLO sobre las columnas que
--    el cliente sí escribe. service_role y las funciones DEFINER (propiedad de
--    postgres) ignoran estos grants y siguen pudiendo escribir todo.
-- ============================================================
revoke insert, update on public.predictions from authenticated;

grant insert (league_id, match_id, user_id, home_score_pred, away_score_pred)
  on public.predictions to authenticated;

grant update (home_score_pred, away_score_pred)
  on public.predictions to authenticated;

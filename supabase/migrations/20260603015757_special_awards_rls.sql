-- Migración: special_awards_rls
-- RLS + trigger de predicted_at para los Premios Especiales (Story 6.1).
-- Depende de special_awards_schema. Sigue el patrón establecido en 1.2:
-- habilitar RLS = denegar por defecto; políticas to authenticated;
-- usar (select auth.uid()) para que el planner cachee el valor.

-- ============================================================
-- 1) Habilitar RLS en ambas tablas (sin políticas = denegar todo).
-- ============================================================
alter table public.award_candidates    enable row level security;
alter table public.special_predictions enable row level security;

-- ============================================================
-- 2) Políticas de award_candidates (catálogo de SOLO LECTURA).
--    * select: cualquier autenticado, limitado a los candidatos activos
--      (no exponer los desactivados).
--    * SIN insert/update/delete → deny-by-default: el catálogo lo gestiona
--      service_role/seed, nunca el cliente (anon ni authenticated).
-- ============================================================
create policy "award_candidates_select_active_authenticated"
  on public.award_candidates for select
  to authenticated
  using (is_active = true);

-- ============================================================
-- 3) Políticas de special_predictions (privadas por usuario y por liga).
--    Las predicciones son por liga; además de exigir que la fila sea del
--    propio usuario, en la ESCRITURA exigimos que pertenezca a la liga
--    (fn_user_in_league, helper SECURITY DEFINER ya existente de 1.2) para
--    que nadie cree predicciones en ligas ajenas. El select es solo de las
--    propias filas (la visibilidad para rivales se decide en una story futura).
-- ============================================================
create policy "special_predictions_select_own"
  on public.special_predictions for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "special_predictions_insert_own_in_league"
  on public.special_predictions for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.fn_user_in_league(league_id)
  );

create policy "special_predictions_update_own_in_league"
  on public.special_predictions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.fn_user_in_league(league_id)
  );

-- ============================================================
-- 4) Trigger de refresco de predicted_at.
--    Solo refrescamos la marca si el usuario realmente cambió de candidato:
--    cambiar tu pick más tarde = registrarte más tarde = menor recompensa en
--    Story 6.2. SECURITY DEFINER set search_path='' por consistencia con el
--    resto de funciones del proyecto y referencias fully-qualified.
-- ============================================================
create or replace function public.fn_touch_special_prediction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.candidate_id is distinct from old.candidate_id then
    new.predicted_at = now();
  end if;
  return new;
end;
$$;

comment on function public.fn_touch_special_prediction() is
  'Refresca special_predictions.predicted_at a now() cuando cambia el candidato. Base del cálculo de fase de Story 6.2.';

create trigger tr_touch_special_prediction
  before update on public.special_predictions
  for each row execute function public.fn_touch_special_prediction();

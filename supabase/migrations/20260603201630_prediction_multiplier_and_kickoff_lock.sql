-- Migración: prediction_multiplier_and_kickoff_lock
-- Story 2.4 — Multiplicador por antelación + bloqueo de escritura por kickoff.
-- Depende de matches_and_predictions y predictions_rls (Story 2.1).
--
-- Aporta:
--   1) fn_match_editable(match_id): true si now() < match_time - 1 min (escritura).
--   2) fn_prediction_multiplier(match_time): multiplicador por lotes de días
--      (espeja EXACTAMENTE src/utils/scoring.ts → MULTIPLIER_TIERS).
--   3) fn_save_prediction(...): RPC SECURITY DEFINER que valida usuario, pertenencia,
--      scores y kickoff, calcula el multiplier con now() del SERVIDOR y hace
--      upsert de score+multiplier. Es la ÚNICA vía por la que el cliente escribe
--      `multiplier` (que NO tiene grant de columna para `authenticated`).
--   4) Refuerza las políticas directas de insert/update con fn_match_editable
--      (cierra el diferido de 2.1: la escritura directa tras kickoff también falla).

-- ============================================================
-- 1) Helper de "editable": escritura permitida hasta match_time - 1 minuto.
--    Distinto de fn_match_unlocked (lectura), que es el complemento temporal.
--    SECURITY DEFINER para leer matches sin RLS y usar now() del servidor.
-- ============================================================
create or replace function public.fn_match_editable(p_match_id uuid)
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
      and now() < m.match_time - interval '1 minute'
  );
$$;

comment on function public.fn_match_editable(uuid) is
  'Devuelve true si el partido aún admite escritura de predicciones (now() < match_time - 1 min). Server-authoritative; cierra el bloqueo de escritura por kickoff (Story 2.4).';

-- ============================================================
-- 2) Multiplicador por antelación (lotes de días). Espeja MULTIPLIER_TIERS de
--    src/utils/scoring.ts. Usa epoch/86400 (días fraccionarios), no date_part,
--    para no driftar contra la versión TS. case ordenado de mayor a menor.
-- ============================================================
-- NO es SECURITY DEFINER: solo hace aritmética sobre su argumento + now(), sin
-- acceso a tablas → no necesita privilegios elevados (mínimo privilegio). Se
-- invoca desde fn_save_prediction (DEFINER) sin problema.
create or replace function public.fn_prediction_multiplier(p_match_time timestamptz)
returns numeric
language sql
set search_path = ''
stable
as $$
  select (
    case
      when extract(epoch from (p_match_time - now())) / 86400.0 >= 35 then 2.50
      when extract(epoch from (p_match_time - now())) / 86400.0 >= 28 then 2.20
      when extract(epoch from (p_match_time - now())) / 86400.0 >= 21 then 1.90
      when extract(epoch from (p_match_time - now())) / 86400.0 >= 14 then 1.60
      when extract(epoch from (p_match_time - now())) / 86400.0 >= 7  then 1.30
      else 1.00
    end
  )::numeric(3, 2);
$$;

comment on function public.fn_prediction_multiplier(timestamptz) is
  'Multiplicador por antelación al kickoff (1.00–2.50) por lotes de días. Espeja src/utils/scoring.ts MULTIPLIER_TIERS.';

-- ============================================================
-- 3) RPC de guardado server-authoritative. Única vía de escritura de `multiplier`.
--    SECURITY DEFINER: opera con privilegios del owner (postgres) → puede escribir
--    multiplier (el rol authenticated NO tiene ese grant). Por eso TODAS las
--    guardas (usuario, pertenencia, scores, kickoff) van DENTRO de la función.
-- ============================================================
create or replace function public.fn_save_prediction(
  p_league_id uuid,
  p_match_id uuid,
  p_home_score_pred int,
  p_away_score_pred int
)
returns public.predictions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_match_time timestamptz;
  v_multiplier numeric(3, 2);
  v_row        public.predictions;
begin
  -- Usuario autenticado.
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  -- Pertenencia a la liga (reusa el helper de 1.2).
  if not public.fn_user_in_league(p_league_id) then
    raise exception 'No eres miembro de la liga' using errcode = '42501';
  end if;

  -- Scores válidos (espeja el CHECK de la tabla).
  if p_home_score_pred is null or p_away_score_pred is null
     or p_home_score_pred < 0 or p_away_score_pred < 0 then
    raise exception 'Marcador invalido' using errcode = '23514';
  end if;

  -- El partido debe existir.
  select m.match_time into v_match_time
  from public.matches m
  where m.id = p_match_id;
  if v_match_time is null then
    raise exception 'Partido inexistente' using errcode = 'P0002';
  end if;

  -- Bloqueo de escritura por kickoff (server-authoritative). Mensaje estable
  -- 'Pronostico cerrado' → la Server Action lo mapea a un error definitivo
  -- (no reintentable). Cierra el diferido de 2.1.
  if not public.fn_match_editable(p_match_id) then
    raise exception 'Pronostico cerrado' using errcode = 'P0001';
  end if;

  -- Multiplicador con la hora del SERVIDOR (no del cliente).
  v_multiplier := public.fn_prediction_multiplier(v_match_time);

  insert into public.predictions (
    league_id, match_id, user_id, home_score_pred, away_score_pred, multiplier
  ) values (
    p_league_id, p_match_id, v_uid, p_home_score_pred, p_away_score_pred, v_multiplier
  )
  on conflict (league_id, user_id, match_id) do update
    set home_score_pred = excluded.home_score_pred,
        away_score_pred = excluded.away_score_pred,
        multiplier      = excluded.multiplier
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.fn_save_prediction(uuid, uuid, int, int) is
  'Guarda (crea/actualiza) la predicción del usuario actual validando usuario, pertenencia, scores y kickoff, y calcula multiplier con now() del servidor. Única vía de escritura de multiplier para el cliente.';

grant execute on function public.fn_save_prediction(uuid, uuid, int, int) to authenticated;

-- ============================================================
-- 4) Refuerzo de las políticas directas con el bloqueo de kickoff.
--    Aunque el cliente ahora guarda vía fn_save_prediction (DEFINER, que ignora
--    estas políticas), un acceso directo por PostgREST debe fallar también tras
--    el umbral. Recreamos insert/update añadiendo fn_match_editable(match_id).
-- ============================================================
drop policy if exists "predictions_insert_own" on public.predictions;
create policy "predictions_insert_own"
  on public.predictions for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.fn_user_in_league(league_id)
    and public.fn_match_editable(match_id)
  );

drop policy if exists "predictions_update_own" on public.predictions;
create policy "predictions_update_own"
  on public.predictions for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and public.fn_match_editable(match_id)
  )
  with check (
    user_id = (select auth.uid())
    and public.fn_user_in_league(league_id)
    and public.fn_match_editable(match_id)
  );

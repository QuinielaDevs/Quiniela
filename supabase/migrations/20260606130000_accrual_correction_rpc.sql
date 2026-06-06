-- Migración: accrual_correction_rpc
-- Story 8.3 — AC #5: Recálculo de clasificaciones al restaurar datos de Zafronix.
--
-- Define una función SECURITY DEFINER que aplica, de forma ATÓMICA, la corrección
-- de puntos de UNA predicción ya evaluada cuando el marcador oficial cambia.
--
-- El motor de puntuación ÚNICO vive en src/utils/scoring.ts (Dev Notes 8.3); el
-- script administrativo calcula allí los puntos nuevos y pasa el resultado en
-- `p_new_points`. Esta función NO duplica la fórmula: solo aplica el delta
-- (nuevo - viejo) sobre las tres tablas del ledger en una única transacción, con
-- locks de fila, para preservar el invariante de conservación
-- (wager_balance == SUM(point_transactions.amount)) bajo ejecución concurrente
-- (Promise.all) del script de restauración.
--
-- Idempotencia: si la predicción NO está evaluada (evaluated_at IS NULL) el
-- recálculo lo realiza el trigger tr_resolve_challenges_on_match_status_change
-- al actualizar el partido, por lo que esta función la ignora (retorna 0).

create or replace function public.fn_apply_accrual_correction(
  p_prediction_id uuid,
  p_new_points numeric,
  p_match_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pred   record;
  v_new    numeric(12, 2);
  v_delta  numeric(12, 2);
begin
  -- Bloquear la predicción para una lectura/escritura consistente.
  select id, league_id, user_id,
         coalesce(points_earned, 0.00) as points_earned,
         evaluated_at
  into v_pred
  from public.predictions
  where id = p_prediction_id
  for update;

  if not found then
    raise exception 'Predicción % no encontrada', p_prediction_id using errcode = 'P0001';
  end if;

  -- Guarda de idempotencia POR ESTADO: solo corregimos predicciones ya evaluadas.
  -- Las no evaluadas las puntúa el trigger al pasar el partido a 'finished'.
  if v_pred.evaluated_at is null then
    return 0.00;
  end if;

  v_new := round(coalesce(p_new_points, 0)::numeric, 2);
  v_delta := v_new - v_pred.points_earned;

  if v_delta = 0.00 then
    return 0.00;
  end if;

  -- 1. Actualizar los puntos de la predicción al nuevo valor calculado en TS.
  update public.predictions
  set points_earned = v_new,
      updated_at = now()
  where id = p_prediction_id;

  -- 2. Ajustar el saldo del miembro sumando el DELTA exacto (suma atómica con lock).
  perform 1 from public.league_members
  where league_id = v_pred.league_id and user_id = v_pred.user_id
  for update;

  update public.league_members
  set wager_balance = wager_balance + v_delta
  where league_id = v_pred.league_id and user_id = v_pred.user_id;

  -- 3. Registrar la corrección en el ledger (preserva el invariante de conservación).
  insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
  values (v_pred.user_id, v_pred.league_id, v_delta, 'match_accrual_correction', p_match_id);

  return v_delta;
end;
$$;

-- El script administrativo usa la service_role key (bypass RLS). Concedemos
-- execute también a service_role de forma explícita por claridad operativa.
grant execute on function public.fn_apply_accrual_correction(uuid, numeric, uuid) to service_role;

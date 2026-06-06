-- Migración: postpone_match_rpc
-- Story 8.1 — AC #5: Transaccionalidad en suspensión de partidos y anulación de predicciones.
-- Define una función SECURITY DEFINER para actualizar el partido y anular
-- todas sus predicciones en una única transacción de base de datos.

create or replace function public.fn_postpone_match_and_predictions(
  p_match_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 1. Actualizar el estado del partido
  -- Esto disparará tr_resolve_challenges_on_match_status_change para cancelar
  -- desafíos activos/pendientes y reembolsar el escrow en el ledger.
  update public.matches
  set status = p_status,
      updated_at = now()
  where id = p_match_id;

  -- 2. Anular todas las predicciones del partido (puntos = 0.00, evaluated_at = now())
  -- Se anulan todas, incluso las previamente evaluadas, por consistencia ante posposición.
  update public.predictions
  set points_earned = 0.00,
      evaluated_at = now()
  where match_id = p_match_id;
end;
$$;

grant execute on function public.fn_postpone_match_and_predictions(uuid, text) to authenticated;

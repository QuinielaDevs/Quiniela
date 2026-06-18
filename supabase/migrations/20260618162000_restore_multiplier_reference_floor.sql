-- Migración: restore_multiplier_reference_floor
-- Redefine public.fn_prediction_multiplier para volver a anclar la jornada de referencia
-- con un piso en 1 (BASELINE_MATCHDAY = 1).
-- Esto asegura que 1 jornada de distancia (distance = 1) mantenga el multiplicador de 1.25x
-- y 2 jornadas de distancia (distance = 2) mantenga el de 1.50x, etc.

create or replace function public.fn_prediction_multiplier(
  p_matchday int,
  p_stage text
)
returns numeric
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_target   int := public.fn_match_round_ordinal(p_matchday, p_stage);
  v_current  int;
  v_distance int;
begin
  -- Jornada 1 (línea base) o ronda desconocida → 1.00x.
  if v_target is null or v_target <= 1 then
    return 1.00;
  end if;

  -- Referencia = jornada en curso, con piso en 1.
  v_current  := greatest(public.fn_current_round_ordinal(), 1);
  v_distance := greatest(0, v_target - v_current);

  -- Lineal +0.25 por jornada de distancia, tope 2.50x.
  return least(2.50, 1.00 + 0.25 * v_distance)::numeric(3, 2);
end;
$$;

comment on function public.fn_prediction_multiplier(int, text) is
  'Multiplicador por distancia (en jornadas) entre la ronda del partido y la jornada en curso (referencia con piso en 1). Jornada 1 = 1.00x. Lineal +0.25/jornada, tope 2.50x.';

-- Recalcular las predicciones editables con la nueva fórmula para asegurar consistencia
update public.predictions p
set multiplier = public.fn_prediction_multiplier(m.matchday, m.stage)
from public.matches m
where p.match_id = m.id
  and public.fn_match_editable(m.id)
  and p.multiplier
      is distinct from public.fn_prediction_multiplier(m.matchday, m.stage);

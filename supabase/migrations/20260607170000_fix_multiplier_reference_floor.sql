-- Migración: fix_multiplier_reference_floor
-- Corrige el ANCLAJE de la "jornada en curso" en el multiplicador por jornadas.
--
-- Antes: distancia = target - current, con current = 0 antes de que empiece el
-- torneo. Eso hacía que la J2 quedara a distancia 2 (1.50x) en vez de 1 (1.25x).
--
-- Ahora: la referencia tiene PISO en la jornada 1 (la J1 es la jornada base de
-- referencia aunque no haya arrancado). Así "predecir la jornada siguiente" vale
-- 1.25x. Pre-torneo: J2=1.25, J3=1.50, 32avos=1.75 … tope 2.50x. La penalización
-- se mantiene: cuando avanza el torneo (current >= 2) el piso ya no aplica.

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

  -- Referencia = jornada en curso, con piso en 1 (la J1 es la base aunque el
  -- torneo no haya empezado). distancia = jornadas por delante de la referencia.
  v_current  := greatest(public.fn_current_round_ordinal(), 1);
  v_distance := greatest(0, v_target - v_current);

  -- Lineal +0.25 por jornada de distancia, tope 2.50x.
  return least(2.50, 1.00 + 0.25 * v_distance)::numeric(3, 2);
end;
$$;

comment on function public.fn_prediction_multiplier(int, text) is
  'Multiplicador por distancia (en jornadas) entre la ronda del partido y la jornada en curso (referencia con piso en 1). Jornada 1 = 1.00x. Lineal +0.25/jornada, tope 2.50x.';

-- Re-backfill de las predicciones editables con la fórmula corregida.
update public.predictions p
set multiplier = public.fn_prediction_multiplier(m.matchday, m.stage)
from public.matches m
where p.match_id = m.id
  and public.fn_match_editable(m.id)
  and p.multiplier
      is distinct from public.fn_prediction_multiplier(m.matchday, m.stage);

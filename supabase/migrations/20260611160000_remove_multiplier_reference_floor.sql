-- Migración: remove_multiplier_reference_floor
-- Redefine public.fn_prediction_multiplier para eliminar el piso en 1 (BASELINE_MATCHDAY)
-- de la jornada de referencia. Esto corrige la inconsistencia por la cual los multiplicadores
-- de la Jornada 2 y 3 no disminuían al iniciar el torneo (Jornada 1).
--
-- Ahora:
--   - Antes del torneo (current = 0): J2 está a distancia 2 (1.25x), J3 a distancia 3 (1.50x).
--   - Al iniciar el torneo (current = 1): J2 pasa a distancia 1 (1.00x), J3 a distancia 2 (1.25x).
--     Esto penaliza legítimamente a quien edita sus predicciones una vez comenzado el torneo.
--
-- Progresión de escala (distancia = target - current):
--   - Distancia 0 (en curso): 1.00x
--   - Distancia 1 (siguiente jornada): 1.00x
--   - Distancia 2: 1.25x
--   - Distancia 3: 1.50x
--   - Distancia 4: 1.75x
--   - Distancia 5: 2.00x
--   - Distancia 6: 2.25x
--   - Distancia 7+: 2.50x

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

  v_current  := public.fn_current_round_ordinal();
  v_distance := greatest(0, v_target - v_current);

  -- Escala: distancia 0 y 1 = 1.00x. A partir de distancia 2 aumenta +0.25 por paso.
  return least(2.50, 1.00 + 0.25 * greatest(0, v_distance - 1))::numeric(3, 2);
end;
$$
;
comment on function public.fn_prediction_multiplier(int, text) is
  'Multiplicador por distancia (en jornadas) entre la ronda del partido y la jornada en curso. Jornada 1 = 1.00x. Distancia 0 y 1 = 1.00x. Lineal +0.25/jornada a partir de distancia 2, tope 2.50x.'
;
-- Recalcular las predicciones editables con la nueva fórmula para asegurar consistencia
update public.predictions p
set multiplier = public.fn_prediction_multiplier(m.matchday, m.stage)
from public.matches m
where p.match_id = m.id
  and public.fn_match_editable(m.id)
  and p.multiplier
      is distinct from public.fn_prediction_multiplier(m.matchday, m.stage)
;
-- Permitir SELECT a anon sobre predictions para que RLS filtre las filas (retorne 0 filas sin error 42501)
grant select on public.predictions to anon
;

-- Migración: backfill_multiplier_by_round
-- Recalcula el `multiplier` de las predicciones existentes al modelo por
-- DISTANCIA EN JORNADAS (migración 20260607150000). Necesario porque las
-- predicciones creadas antes de ese cambio —incluyendo los 0-0 por defecto—
-- quedaron con el multiplicador VIEJO por días al kickoff (p. ej. 1.3/1.6 dentro
-- de una misma jornada), generando inconsistencias visibles.
--
-- Alcance: SOLO partidos aún editables (no empezados, scheduled, equipos
-- resueltos) vía fn_match_editable. Las predicciones de partidos ya
-- bloqueados/jugados conservan su multiplicador (ya estaba "fijado"). NO toca
-- marcadores (home/away) ni el estado de deshacer (prev_*); solo `multiplier`.
-- Idempotente: el guard `is distinct from` evita reescrituras no-op.

update public.predictions p
set multiplier = public.fn_prediction_multiplier(m.matchday, m.stage)
from public.matches m
where p.match_id = m.id
  and public.fn_match_editable(m.id)
  and p.multiplier
      is distinct from public.fn_prediction_multiplier(m.matchday, m.stage);

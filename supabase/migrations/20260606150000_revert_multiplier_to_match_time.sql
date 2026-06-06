-- Migración: revert_multiplier_to_match_time
-- Redefine public.fn_prediction_multiplier(p_match_time timestamptz) para calcular el multiplicador
-- basado en la fecha de kickoff de cada partido individual, tal como indica la sección 4.5 del PRD.

create or replace function public.fn_prediction_multiplier(p_match_time timestamptz)
returns numeric
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  return (
    case
      when extract(epoch from (p_match_time - now())) / 86400.0 >= 35 then 2.50
      when extract(epoch from (p_match_time - now())) / 86400.0 >= 28 then 2.20
      when extract(epoch from (p_match_time - now())) / 86400.0 >= 21 then 1.90
      when extract(epoch from (p_match_time - now())) / 86400.0 >= 14 then 1.60
      when extract(epoch from (p_match_time - now())) / 86400.0 >= 7  then 1.30
      else 1.00
    end
  )::numeric(3, 2);
end;
$$;

comment on function public.fn_prediction_multiplier(timestamptz) is
  'Calcula el multiplicador por antelación al kickoff (1.00-2.50) basado en la antelación a cada partido individual.';

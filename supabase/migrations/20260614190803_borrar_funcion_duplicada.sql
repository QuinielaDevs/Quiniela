-- Eliminar la función duplicada antigua de duelos en local y en producción
DROP FUNCTION IF EXISTS public.league_duel_points(uuid);
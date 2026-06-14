-- function: fn_should_run_sync
-- description: Determina si el endpoint de sincronización de partidos debe ejecutarse 
-- basándose en ventanas de tiempo críticas (daily window, pre-match, post-match).

CREATE OR REPLACE FUNCTION fn_should_run_sync()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_utc_hour int;
  v_utc_minute int;
  v_active_matches int;
BEGIN
  -- 1. Ventana diaria completa: 3:00 AM - 3:10 AM UTC
  v_utc_hour := extract(hour from (now() at time zone 'UTC'));
  v_utc_minute := extract(minute from (now() at time zone 'UTC'));
  
  IF v_utc_hour = 3 AND v_utc_minute < 10 THEN
    RETURN true;
  END IF;

  -- 2. Buscar si hay algún partido activo en las ventanas de tiempo críticas
  SELECT count(*) INTO v_active_matches
  FROM matches
  WHERE status IN ('scheduled', 'live')
    AND (
      -- A) Faltan 10 minutos o menos para el inicio del partido
      (now() >= match_time - interval '10 minutes' AND now() < match_time)
      OR
      -- B) Han pasado entre 100 y 210 minutos desde el inicio del partido
      (now() >= match_time + interval '100 minutes' AND now() < match_time + interval '210 minutes')
    );

  IF v_active_matches > 0 THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- Conceder permisos para que pueda ser ejecutado por roles autenticados o anónimos si es necesario 
-- (n8n usará service_role, que es superuser y tiene acceso de todas formas).
GRANT EXECUTE ON FUNCTION fn_should_run_sync() TO authenticated, anon, service_role;

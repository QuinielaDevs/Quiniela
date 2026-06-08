-- Migración: restore_authenticated_grants
-- Fix de raíz: el rol `authenticated` no tenía privilegios base (GRANT) sobre
-- casi ninguna tabla de `public`. El esquema asumía el modelo por defecto de
-- Supabase (las tablas se conceden a anon/authenticated y RLS gatea las FILAS),
-- pero en este proyecto los DEFAULT PRIVILEGES nunca aplicaron, así que toda
-- lectura directa desde las páginas (league_members, leagues, predictions, etc.)
-- fallaba con «permission denied for table». Las escrituras funcionaban porque
-- pasan por RPCs SECURITY DEFINER, lo que enmascaraba el problema: una liga se
-- creaba/unía bien en la BD pero la app no podía LEERLA → vista «sin liga».
--
-- RLS sigue activo en las 14 tablas (verificado), por lo que conceder los
-- privilegios CRUD a `authenticated` NO expone datos: cada fila se sigue
-- gateando por las políticas existentes. Una tabla con RLS y sin política de
-- escritura simplemente deniega INSERT/UPDATE/DELETE aunque exista el GRANT.
--
-- Forward-only e idempotente (GRANT/REVOKE son idempotentes).

-- 1) Restaurar los privilegios base que el modelo RLS da por sentado.
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Secuencias (por si alguna tabla usa serial/identity): el uso lo necesita el
-- rol al insertar. Inocuo para tablas con default uuid.
grant usage, select on all sequences in schema public to authenticated;

-- 2) Reaplicar el endurecimiento de PII sobre profiles (ver hardening_pass):
--    `email` NO debe ser legible por el cliente. RLS gatea filas, no columnas,
--    así que la protección va por privilegio de COLUMNA. Se revoca el SELECT de
--    tabla que acaba de conceder el paso 1 y se reconcede solo sobre columnas
--    públicas — AHORA incluyendo `active_league_id` (que se añadió después del
--    hardening y por eso se había quedado sin grant: ésa era la causa directa
--    del «no se puede cargar el perfil» y de la liga activa invisible).
revoke select on public.profiles from authenticated;
grant select (id, display_name, avatar_url, created_at, active_league_id)
  on public.profiles to authenticated;

-- 3) Mantener el comportamiento por defecto para tablas/secuencias FUTURAS, de
--    modo que no vuelva a ocurrir que una tabla nueva nazca sin privilegios.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

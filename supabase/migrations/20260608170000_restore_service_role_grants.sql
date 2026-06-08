-- Migración: restore_service_role_grants
-- Continuación de restore_authenticated_grants: el rol `service_role` TAMPOCO
-- tenía privilegios sobre ninguna tabla de `public` (mismo origen: los DEFAULT
-- PRIVILEGES de Supabase nunca aplicaron en este proyecto). `service_role` es la
-- clave de backend de confianza (nunca se expone al cliente) y por diseño debe
-- tener acceso TOTAL saltándose RLS; sin GRANTs de tabla, los procesos backend
-- fallan con «permission denied». Esto rompía el cron `scripts/sync-matches.ts`
-- (lee/escribe system_config, matches, etc. con la service_role key) y cualquier
-- otro uso de service_role (webhooks).
--
-- service_role tiene BYPASSRLS, pero BYPASSRLS NO concede privilegios de tabla:
-- igualmente necesita el GRANT. Conceder ALL es lo que hace Supabase por defecto
-- para este rol y es seguro (la key vive solo en el servidor/secrets de CI).
--
-- Forward-only e idempotente.

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all routines in schema public to service_role;

-- Tablas/secuencias/funciones FUTURAS: que nazcan ya con acceso para service_role
-- (evita que vuelva a ocurrir el mismo «permission denied» con una tabla nueva).
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant all on sequences to service_role;
alter default privileges in schema public
  grant all on routines to service_role;

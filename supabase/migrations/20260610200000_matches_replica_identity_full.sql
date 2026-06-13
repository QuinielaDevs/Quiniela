-- Migración: matches_replica_identity_full
-- Habilita REPLICA IDENTITY FULL en la tabla matches para que Supabase Realtime
-- pueda entregar eventos postgres_changes de tipo UPDATE.
--
-- Contexto técnico (Fase 8 del plan E2E):
--   Con REPLICA IDENTITY DEFAULT (solo PK en el tuple OLD), walrus no puede
--   construir el payload completo de un evento UPDATE y silenciosamente descarta
--   el evento. Con FULL, el tuple OLD incluye todas las columnas y los eventos
--   llegan correctamente a los suscriptores autenticados.
--
-- Referencia: https://supabase.com/docs/guides/realtime/postgres-changes
--   "For Update and Delete, you need to set REPLICA IDENTITY to FULL."

alter table public.matches replica identity full;

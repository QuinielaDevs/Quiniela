-- Migracion: matches_realtime_publication
-- Habilita Supabase Realtime solo para public.matches (Story 4.1).
-- La tabla es catalogo comun y mantiene RLS select para authenticated; el cron
-- /api/sync sigue siendo el unico escritor previsto mediante service_role.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'matches'
  ) then
    alter publication supabase_realtime add table public.matches;
  end if;
end;
$$;

-- Migración: fix_service_role_rpc_access
--
-- Redefine fn_user_in_league y fn_user_is_league_admin para permitir
-- la ejecución desde el service_role (clientes de backend / bots como n8n)
-- que no tienen un auth.uid() configurado.

create or replace function public.fn_user_in_league(p_league_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select auth.role() = 'service_role' or exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = (select auth.uid())
  );
$$;

create or replace function public.fn_user_is_league_admin(p_league_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select auth.role() = 'service_role' or exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = (select auth.uid())
      and lm.role = 'admin'
  );
$$;

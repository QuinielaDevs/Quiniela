-- Migración fake para sincronizar el estado sin ejecutar nada en producción

-- 1. Definición del trigger de n8n (se creará solo en local, en prod no se toca)
CREATE TRIGGER notify_n8n_match_update
AFTER UPDATE ON public.matches
FOR EACH ROW
EXECUTE FUNCTION supabase_functions.http_request(
  'https://n8n.7app.org/webhook/quiniela-match-update',
  'POST',
  '{"Content-type":"application/json","Authorization":"MutYJlJZWv88kpQK5XiTqXpAEWd5XitmAzBBDWdqWFmJCdcvh8wktd2rq3u1RJzX"}',
  '{}',
  '10000'
);

-- 2. Definición de la función vieja de duelos (se creará solo en local)
create or replace function public.league_duel_points(p_league_id uuid)
returns table (user_id uuid, duel_points numeric)
language sql
security definer
set search_path = ''
as $$
  select pt.user_id, coalesce(sum(pt.amount), 0.00)::numeric as duel_points
  from public.point_transactions pt
  where pt.league_id = p_league_id
    and pt.description <> 'seed_initial_balance'
    and pt.description not like 'match_accrual%'
    and exists (
      select 1 from public.league_members lm
      where lm.league_id = p_league_id
        and lm.user_id = (select auth.uid())
    )
  group by pt.user_id;
$$;
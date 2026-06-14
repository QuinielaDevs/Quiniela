-- Migración: league_duel_points_rpc (Desempates por victorias reales en duelos)
--
-- Actualmente se usa wager_balance como criterio de desempate de duelos. Esto
-- duplica puntos y penaliza a quien tiene fondos retenidos en escrow.
-- Para corregirlo, este RPC calcula de forma segura la suma de ganancias reales
-- obtenidas por duelos (transacciones 'challenge_payout') por usuario.
--
-- Gate de membresía: solo miembros de la liga pueden invocarlo (42501).

create or replace function public.fn_get_league_duel_points(p_league_id uuid)
returns table (user_id uuid, duel_points numeric)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not public.fn_user_in_league(p_league_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  return query
    select pt.user_id, coalesce(sum(pt.amount), 0)::numeric as duel_points
    from public.point_transactions pt
    where pt.league_id = p_league_id
      and pt.description = 'challenge_payout'
    group by pt.user_id;
end;
$$;

comment on function public.fn_get_league_duel_points(uuid) is
  'Total de puntos ganados en duelos (challenge_payout) por usuario en una liga. SECURITY DEFINER: agg sobre point_transactions, accesible solo por miembros de la liga.';

grant execute on function public.fn_get_league_duel_points(uuid) to authenticated;

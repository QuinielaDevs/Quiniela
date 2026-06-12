-- Migración: league_duel_points_rpc
-- La columna "duelos" de la tabla de posiciones debe reflejar EXCLUSIVAMENTE el
-- neto ganado/perdido en duelos, no el saldo apostable (wager_balance). Ese
-- saldo se siembra con los puntos de jornada (seed_initial_balance) y crece con
-- cada partido (match_accrual), por lo que aparecía como "duelos" aun sin haber
-- jugado ningún desafío.
--
-- point_transactions tiene RLS por-dueño (point_transactions_select_owner), así
-- que un miembro no puede agregar el neto del resto desde el cliente. Esta
-- función SECURITY DEFINER lo calcula en el servidor y solo responde si el
-- llamante es miembro de la liga consultada.
--
-- Neto de duelos = SUM(amount) de TODO lo que NO sea acreditación de quiniela.
-- Se excluyen 'seed_initial_balance' y 'match_accrual%' (acreditación, corrección
-- y reversión de jornada). El resto —escrow holds/refunds y payouts/reversals de
-- desafíos— es movimiento de duelos. Nota: filtrar por 'challenge%' sería
-- incorrecto, porque el escrow al CREAR un desafío usa una descripción en
-- español ('Puntos retenidos en escrow por creación de desafío ...'), no ese
-- prefijo; excluir las acreditaciones de jornada captura todos los duelos.

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
    -- Autorización: solo un miembro de la liga puede agregar estos netos. Si el
    -- llamante no pertenece a la liga, el EXISTS es falso y no se devuelven filas.
    and exists (
      select 1 from public.league_members lm
      where lm.league_id = p_league_id
        and lm.user_id = (select auth.uid())
    )
  group by pt.user_id;
$$;

comment on function public.league_duel_points(uuid) is
  'Neto de puntos ganados/perdidos en duelos por miembro de una liga (excluye las acreditaciones de jornada seed_initial_balance/match_accrual). SECURITY DEFINER porque point_transactions tiene RLS por-dueño; autoriza solo a miembros de la liga.';

grant execute on function public.league_duel_points(uuid) to authenticated;

-- Migración: member_removal_duel_cascade (fix BUG-002, docs/e2e-plan/BUGS.md)
-- Cierra el seam de Epic 5 anunciado en 20260604120000_member_admin_management.sql
-- (§4 "SEAM Epic 5 — NO implementar aquí todavía") que nunca llegó a implementarse:
-- al desaparecer una membresía —expulsión (fn_remove_member) o auto-baja
-- (fn_leave_league), ambas borran la fila y disparan tr_cleanup_on_member_removed—
-- los duelos abiertos del usuario en ESA liga quedaban 'pending'/'active' para
-- siempre y el escrow de las contrapartes no se devolvía jamás.
--
-- Comportamiento añadido (dentro de la misma transacción del DELETE):
--   a) Se cancelan los retos 'pending'/'active' de la liga donde el saliente es
--      creador, retado directo o participante (incluye pozos abiertos: sin esa
--      contraparte el reto ya no puede resolverse de forma justa).
--   b) refund_challenge_escrow (idempotente) devuelve el escrow neto del ledger
--      a TODOS los tenedores. Como el trigger es AFTER DELETE, el UPDATE del
--      wager_balance del saliente no afecta filas (su membresía ya no existe),
--      pero su fila de reembolso en point_transactions SÍ se inserta: el neto
--      del reto queda en 0 también para él (relevante si se re-une a la liga).
--
-- Se preserva intacto el resto de la limpieza (predicciones, medallas, perfil de
-- juego) y la reasignación de active_league_id de
-- 20260608120000_active_league_selection.sql. El trigger
-- tr_cleanup_on_member_removed no se recrea: solo se redefine la función.

create or replace function public.fn_cleanup_on_member_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next_league_id uuid;
  v_chal record;
begin
  delete from public.predictions
   where league_id = old.league_id
     and user_id = old.user_id;

  delete from public.member_badges
   where league_id = old.league_id
     and user_id = old.user_id;

  delete from public.member_game_profiles
   where league_id = old.league_id
     and user_id = old.user_id;

  -- BUG-002: cancelar los duelos abiertos del saliente en esta liga y devolver
  -- el escrow a todos los participantes (mismo patrón que
  -- fn_cancel_pending_challenges_on_match_start).
  --
  -- GUARDA ANTI-CASCADA: este trigger también se dispara cuando league_members
  -- cae por cascada de FK al borrar la LIGA entera o el PERFIL del usuario
  -- (cleanups de tests, futuro borrado de cuenta). En esos casos el padre ya no
  -- existe en el snapshot de la transacción y el INSERT de reembolso en
  -- point_transactions violaría su FK (league_id/user_id) abortando el borrado.
  -- Solo se cancela/reembolsa en bajas reales de membresía (fn_remove_member /
  -- fn_leave_league), donde liga y perfil siguen existiendo; en los borrados en
  -- cascada los propios challenges/point_transactions caen por FK igualmente.
  if exists (select 1 from public.leagues l where l.id = old.league_id)
     and exists (select 1 from public.profiles p where p.id = old.user_id)
  then
    for v_chal in
      update public.challenges c
         set status = 'canceled'
       where c.league_id = old.league_id
         and c.status in ('pending', 'active')
         and (
           c.creator_id = old.user_id
           or c.challenged_id = old.user_id
           or exists (
             select 1
             from public.challenge_participants cp
             where cp.challenge_id = c.id
               and cp.user_id = old.user_id
           )
         )
      returning c.id
    loop
      perform public.refund_challenge_escrow(v_chal.id);
    end loop;
  end if;

  if exists (
    select 1
    from public.profiles p
    where p.id = old.user_id
      and p.active_league_id = old.league_id
  ) then
    select lm.league_id
      into v_next_league_id
    from public.league_members lm
    where lm.user_id = old.user_id
      and lm.league_id <> old.league_id
    order by lm.joined_at desc
    limit 1;

    update public.profiles
       set active_league_id = v_next_league_id
     where id = old.user_id;
  end if;

  return old;
end;
$$;

comment on function public.fn_cleanup_on_member_removed() is
  'Trigger AFTER DELETE on league_members: limpia datos por liga (predicciones, medallas, perfil de juego), cancela los duelos pending/active del saliente en esa liga reembolsando el escrow (BUG-002) y reubica active_league_id si la membresía borrada era la liga activa.';

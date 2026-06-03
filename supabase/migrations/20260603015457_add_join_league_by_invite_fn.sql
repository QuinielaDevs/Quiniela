-- Migración: add_join_league_by_invite_fn
-- Alta idempotente por enlace inteligente (Story 1.4 — AC #4, #7).
--
-- La UI nunca envía league_id, role ni payment_status. La función resuelve el
-- código en servidor, inserta siempre como member/pending y tolera reintentos
-- contra la restricción unique(league_id, user_id).

create or replace function public.fn_join_league_by_invite(
  p_invite_code text
) returns public.league_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_invite_code text := upper(trim(coalesce(p_invite_code, '')));
  v_league_id uuid;
  v_member public.league_members;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  if v_invite_code = '' then
    raise exception 'Invitación inválida' using errcode = '22023';
  end if;

  select l.id
    into v_league_id
  from public.leagues l
  where l.invite_code = v_invite_code;

  if v_league_id is null then
    raise exception 'Invitación inválida' using errcode = '22023';
  end if;

  insert into public.league_members (league_id, user_id, role, payment_status)
  values (v_league_id, v_uid, 'member', 'pending')
  on conflict (league_id, user_id) do update
    set user_id = excluded.user_id
  returning * into v_member;

  return v_member;
end;
$$;

comment on function public.fn_join_league_by_invite(text) is
  'Une al usuario autenticado a una liga por invite_code, siempre como member/pending, de forma idempotente.';

grant execute on function public.fn_join_league_by_invite(text) to authenticated;

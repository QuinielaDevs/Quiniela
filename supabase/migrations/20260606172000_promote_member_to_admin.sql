-- Migración: promote_member_to_admin
-- Permite que un admin de liga asigne rol admin a otro miembro de esa misma
-- quiniela sin abrir políticas UPDATE directas sobre public.league_members.

create or replace function public.fn_promote_member_to_admin(
  p_league_id uuid,
  p_user_id uuid
) returns public.league_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_member public.league_members;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  if not public.fn_user_is_league_admin(p_league_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  update public.league_members
     set role = 'admin'
   where league_id = p_league_id
     and user_id = p_user_id
  returning * into v_member;

  if v_member.id is null then
    raise exception 'Miembro no encontrado' using errcode = 'P0002';
  end if;

  return v_member;
end;
$$;

comment on function public.fn_promote_member_to_admin(uuid, uuid) is
  'Promueve a un miembro existente a admin de la liga. SECURITY DEFINER + admin-gating: solo un admin de esa liga puede invocarla.';

grant execute on function public.fn_promote_member_to_admin(uuid, uuid) to authenticated;

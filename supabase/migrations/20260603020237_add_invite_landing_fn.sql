-- Migración: add_invite_landing_fn
-- Datos públicos mínimos para la landing /join/[invite_code] (Story 1.4).
--
-- La política RLS de leagues sólo permite leer a creadores/miembros. La
-- landing necesita mostrar una bienvenida antes del login, así que esta RPC
-- SECURITY DEFINER expone únicamente campos no sensibles y evita `email`,
-- `created_by` e IDs internos.

create or replace function public.fn_get_invite_landing(
  p_invite_code text
) returns table (
  league_name text,
  creator_display_name text,
  creator_avatar_url text,
  requires_payment boolean,
  payment_amount numeric,
  payment_instructions text,
  invite_code text
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_invite_code text := upper(trim(coalesce(p_invite_code, '')));
begin
  if v_invite_code = '' then
    raise exception 'Invitación inválida' using errcode = '22023';
  end if;

  return query
  select
    l.name as league_name,
    p.display_name as creator_display_name,
    p.avatar_url as creator_avatar_url,
    l.requires_payment,
    l.payment_amount,
    l.payment_instructions,
    l.invite_code
  from public.leagues l
  join public.profiles p on p.id = l.created_by
  where l.invite_code = v_invite_code;

  if not found then
    raise exception 'Invitación inválida' using errcode = '22023';
  end if;
end;
$$;

comment on function public.fn_get_invite_landing(text) is
  'Devuelve datos públicos mínimos de una liga para renderizar /join/[invite_code] antes del login. No expone email, created_by ni IDs internos.';

grant execute on function public.fn_get_invite_landing(text) to anon, authenticated;

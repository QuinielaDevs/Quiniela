-- Migración: leave_league
-- Permite que un miembro ABANDONE voluntariamente una liga (auto-baja).
--
-- Espeja las guardas de fn_remove_member (admin) pero para el propio usuario:
--   - debe ser miembro de la liga,
--   - si es el ÚNICO admin, no puede salir (dejaría la liga sin administración);
--     debe transferir la administración primero.
-- La limpieza en cascada (predicciones, medallas, perfil de juego) la hace el
-- trigger existente tr_cleanup_on_member_removed (AFTER DELETE on league_members).

create or replace function public.fn_leave_league(p_league_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := (select auth.uid());
  v_role        text;
  v_admin_count int;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  select lm.role
    into v_role
  from public.league_members lm
  where lm.league_id = p_league_id
    and lm.user_id = v_uid;

  if v_role is null then
    raise exception 'No eres miembro de la liga' using errcode = 'P0002';
  end if;

  -- No dejar la liga sin admin: si eres el único admin, debes transferir la
  -- administración antes de salir. Se bloquean (FOR UPDATE) las filas admin para
  -- serializar salidas concurrentes y que el conteo sea consistente.
  if v_role = 'admin' then
    perform 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.role = 'admin'
    for update;

    select count(*)
      into v_admin_count
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.role = 'admin';

    if v_admin_count <= 1 then
      raise exception
        'Eres el único admin de la liga: transfiere la administración antes de salir'
        using errcode = '42501';
    end if;
  end if;

  -- El AFTER DELETE trigger (tr_cleanup_on_member_removed) borra en cascada las
  -- predicciones, medallas y perfil de juego del miembro en esta liga.
  delete from public.league_members
   where league_id = p_league_id
     and user_id = v_uid;
end;
$$;

comment on function public.fn_leave_league(uuid) is
  'Auto-baja: el usuario actual abandona la liga. Bloquea salir si es el único admin. El trigger tr_cleanup_on_member_removed limpia sus predicciones/medallas/perfil en esa liga.';

grant execute on function public.fn_leave_league(uuid) to authenticated;

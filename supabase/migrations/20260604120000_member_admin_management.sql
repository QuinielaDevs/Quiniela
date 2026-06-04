-- Migración: member_admin_management
-- Panel rápido de administración y control de pagos (Story 3.3 — AC #3, #4, #5).
--
-- Contexto de seguridad: la tabla public.league_members SOLO tiene políticas RLS
-- de insert (self/member) y select (misma liga). NO hay políticas de UPDATE ni
-- DELETE → con RLS activo, cualquier mutación desde un cliente autenticado está
-- denegada por defecto. En vez de abrir políticas update/delete sobre la tabla,
-- exponemos RPCs SECURITY DEFINER admin-gated (mismo patrón que fn_create_league
-- y fn_join_league_by_invite): la función baja al rol propietario (postgres),
-- valida que el llamante es admin de ESA liga vía auth.uid(), y muta. Esto
-- centraliza el control de acceso en el servidor y habilita la cascada atómica
-- de expulsión mediante un trigger. `set search_path = ''` es obligatorio en
-- funciones SECURITY DEFINER (evita secuestro de search_path) → todo va
-- fully-qualified.

-- ============================================================
-- 1) Helper admin (anti-recursión).
--    Espeja public.fn_user_in_league (Story 1.2) pero además exige role='admin'.
--    SECURITY DEFINER para leer league_members SIN re-disparar RLS.
-- ============================================================
create or replace function public.fn_user_is_league_admin(p_league_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = (select auth.uid())
      and lm.role = 'admin'
  );
$$;

comment on function public.fn_user_is_league_admin(uuid) is
  'Devuelve true si el usuario actual es admin de la liga. SECURITY DEFINER para evitar recursión de RLS sobre league_members.';

-- ============================================================
-- 2) RPC: alternar/fijar el estado de pago de un miembro (admin-only).
--    Valida sesión, valor de estado y rol admin sobre la MISMA liga del target.
-- ============================================================
create or replace function public.fn_set_member_payment_status(
  p_league_id uuid,
  p_user_id uuid,
  p_status text
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

  if p_status not in ('pending', 'paid') then
    raise exception 'Estado de pago inválido' using errcode = '22023';
  end if;

  if not public.fn_user_is_league_admin(p_league_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  update public.league_members
     set payment_status = p_status
   where league_id = p_league_id
     and user_id = p_user_id
  returning * into v_member;

  if v_member.id is null then
    raise exception 'Miembro no encontrado' using errcode = 'P0002';
  end if;

  return v_member;
end;
$$;

comment on function public.fn_set_member_payment_status(uuid, uuid, text) is
  'Fija el payment_status (pending/paid) de un miembro. SECURITY DEFINER + admin-gating: solo un admin de esa liga puede invocarla (league_members no tiene política RLS de update).';

-- ============================================================
-- 3) RPC: expulsar (dar de baja) a un miembro (admin-only).
--    Guardas: no auto-expulsión, no dejar la liga sin ningún admin, aislamiento
--    por liga. El borrado de la fila dispara el trigger de cascada (4).
-- ============================================================
create or replace function public.fn_remove_member(
  p_league_id uuid,
  p_user_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_target_role text;
  v_admin_count int;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  if not public.fn_user_is_league_admin(p_league_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  -- Guarda: un admin no puede expulsarse a sí mismo (dejaría su sesión huérfana
  -- y puede romper la integridad administrativa de la liga).
  if p_user_id = v_uid then
    raise exception 'Un admin no puede expulsarse a sí mismo' using errcode = '42501';
  end if;

  select lm.role
    into v_target_role
  from public.league_members lm
  where lm.league_id = p_league_id
    and lm.user_id = p_user_id;

  if v_target_role is null then
    raise exception 'Miembro no encontrado' using errcode = 'P0002';
  end if;

  -- Guarda: no permitir quedarse sin ningún admin en la liga.
  -- Se bloquean (FOR UPDATE) las filas admin de la liga ANTES de contar para que
  -- dos expulsiones concurrentes (p. ej. dos admins dándose de baja mutuamente)
  -- se serialicen y no puedan ambas pasar el conteo dejando la liga con 0 admins.
  if v_target_role = 'admin' then
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
      raise exception 'No puedes dar de baja al único admin de la liga' using errcode = '42501';
    end if;
  end if;

  -- El AFTER DELETE trigger (tr_cleanup_on_member_removed) limpia las
  -- predicciones del expulsado y, en Epic 5, cancelará sus duelos + reembolsos.
  delete from public.league_members
   where league_id = p_league_id
     and user_id = p_user_id;
end;
$$;

comment on function public.fn_remove_member(uuid, uuid) is
  'Expulsa a un miembro de la liga (admin-only). Bloquea auto-expulsión y quedarse sin admin. El AFTER DELETE trigger hace la limpieza en cascada de predicciones (y duelos/escrow en Epic 5).';

-- ============================================================
-- 4) Cascada de expulsión: trigger AFTER DELETE on league_members.
--    predictions referencia profiles/leagues (NO league_members), por lo que
--    borrar la membresía no propaga por FK → hay que borrar explícitamente las
--    predicciones del usuario EN ESA liga. Arquitectura: "Cascada de Expulsión
--    en Postgres".
-- ============================================================
create or replace function public.fn_cleanup_on_member_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 1) Borrar las predicciones del expulsado en la liga de la que sale.
  delete from public.predictions
   where league_id = old.league_id
     and user_id = old.user_id;

  -- 2) Borrar el historial de premios por jornada del expulsado en esa liga
  --    (Story 3.2). Estas tablas referencian profiles/leagues, NO league_members,
  --    así que no caen por cascada de FK: hay que borrarlas explícitamente para
  --    cumplir la "baja permanente" y no dejar datos de un no-miembro.
  delete from public.member_badges
   where league_id = old.league_id
     and user_id = old.user_id;

  delete from public.member_game_profiles
   where league_id = old.league_id
     and user_id = old.user_id;

  -- 3) SEAM Epic 5 (Duelos/Escrow) — NO implementar aquí todavía:
  --    Cuando existan las tablas challenges/challenge_participants/
  --    point_transactions, esta función debe, dentro de la misma transacción:
  --      a) cancelar los duelos 1v1 activos del expulsado en esta liga, y
  --      b) reembolsar (point_transactions) los puntos en escrow a sus rivales.
  --    Epic 5.x extiende ESTA función (no recrea el trigger).

  return old;
end;
$$;

comment on function public.fn_cleanup_on_member_removed() is
  'Trigger AFTER DELETE on league_members: borra predicciones, medallas (member_badges) y perfil de juego (member_game_profiles) del miembro expulsado en esa liga. Seam para cancelación de duelos y reembolso de escrow en Epic 5.';

create trigger tr_cleanup_on_member_removed
  after delete on public.league_members
  for each row execute function public.fn_cleanup_on_member_removed();

-- ============================================================
-- 5) Grants: solo usuarios autenticados invocan los RPCs (anon queda fuera).
-- ============================================================
grant execute on function public.fn_set_member_payment_status(uuid, uuid, text) to authenticated;
grant execute on function public.fn_remove_member(uuid, uuid) to authenticated;

-- Migración: rls_and_triggers
-- Seguridad (Row Level Security) + trigger de materialización de perfil.
-- Depende de init_schema. (Story 1.2 — AC #2, #3, #4)

-- ============================================================
-- 1) Habilitar RLS en las tres tablas.
--    Sin políticas, RLS activo = denegar todo por defecto.
-- ============================================================
alter table public.profiles        enable row level security;
alter table public.leagues         enable row level security;
alter table public.league_members  enable row level security;

-- ============================================================
-- 2) Helper anti-recursión.
--    Una política de select sobre league_members que vuelva a consultar
--    league_members re-dispara RLS → "infinite recursion detected in policy".
--    Encapsular la comprobación de pertenencia en una función SECURITY DEFINER
--    (se evalúa SIN RLS) rompe el ciclo. Se reutiliza en las políticas de
--    select de leagues y league_members.
-- ============================================================
create or replace function public.fn_user_in_league(p_league_id uuid)
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
  );
$$;

comment on function public.fn_user_in_league(uuid) is
  'Devuelve true si el usuario actual pertenece a la liga. SECURITY DEFINER para evitar recursión de RLS.';

-- ============================================================
-- 3) Políticas RLS
-- ------------------------------------------------------------
-- profiles:
--   * select: cualquier autenticado (necesario para ver avatares/nombres de
--     rivales en clasificaciones).
--   * update: solo el propio perfil.
--   * SIN insert para usuarios → la fila la crea el trigger SECURITY DEFINER,
--     de modo que anon/authenticated no pueden insertar perfiles a mano.
-- ============================================================
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ------------------------------------------------------------
-- leagues:
--   * insert: autenticado, debe declararse como creador.
--   * select: creador o miembro de la liga.
--   * update: baseline = solo el creador (Story 1.3 refinará rol admin).
-- ============================================================
create policy "leagues_insert_own"
  on public.leagues for insert
  to authenticated
  with check (created_by = (select auth.uid()));

create policy "leagues_select_member_or_owner"
  on public.leagues for select
  to authenticated
  using (
    created_by = (select auth.uid())
    or public.fn_user_in_league(id)
  );

create policy "leagues_update_owner"
  on public.leagues for update
  to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

-- ------------------------------------------------------------
-- league_members:
--   * insert: el propio usuario se une (Story 1.4 refinará alta por invitación).
--   * select: el propio registro o cualquier miembro de la misma liga.
-- ============================================================
create policy "league_members_insert_self"
  on public.league_members for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    -- Impide la auto-promoción: un usuario solo puede insertarse como 'member'.
    -- La asignación de 'admin' es responsabilidad del flujo de creación de liga
    -- y del refinamiento de roles de Story 1.3 (no auto-servicio del cliente).
    and role = 'member'
  );

create policy "league_members_select_same_league"
  on public.league_members for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.fn_user_in_league(league_id)
  );

-- ============================================================
-- 4) Trigger de materialización de perfil.
--    SECURITY DEFINER + set search_path = '' es OBLIGATORIO: el rol
--    supabase_auth_admin que dispara el trigger no tiene permisos fuera del
--    schema auth; la función (propiedad de postgres) sí. Referencias siempre
--    fully-qualified. Si el trigger falla, BLOQUEA el alta de usuarios →
--    mantenerlo defensivo con coalesce/nullif.
--    Google deposita full_name/name, avatar_url/picture y email en
--    raw_user_meta_data; por eso el coalesce cubre ambos nombres de clave.
-- ============================================================
create or replace function public.fn_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      'Jugador Anónimo'
    ),
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'picture'), ''),
      '/assets/avatars/default-player.svg'
    )
  )
  -- Defensivo: si ya existiera un perfil para este id (reintento/colisión), no
  -- propagar unique_violation, que abortaría el INSERT en auth.users y bloquearía
  -- el alta del usuario. Las Dev Notes exigen que el trigger nunca rompa el signup.
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger tr_on_auth_user_created
  after insert on auth.users
  for each row execute function public.fn_handle_new_user();

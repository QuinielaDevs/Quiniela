-- Migración: active_league_selection
-- Permite que un usuario pertenezca a varias ligas y elija cuál es su liga
-- activa para predicciones, posiciones, duelos, premios y administración.

alter table public.profiles
  add column if not exists active_league_id uuid
    references public.leagues (id) on delete set null;

comment on column public.profiles.active_league_id is
  'Liga activa elegida por el usuario para pantallas multi-liga. Debe pertenecer al usuario.';

create index if not exists idx_profiles_active_league_id
  on public.profiles (active_league_id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check (
    (select auth.uid()) = id
    and (
      active_league_id is null
      or public.fn_user_in_league(active_league_id)
    )
  );

-- Backfill conservador: usuarios existentes quedan apuntando a su membresía más
-- reciente, que era el comportamiento efectivo antes de esta migración.
with latest_membership as (
  select distinct on (lm.user_id)
    lm.user_id,
    lm.league_id
  from public.league_members lm
  order by lm.user_id, lm.joined_at desc
)
update public.profiles p
set active_league_id = latest_membership.league_id
from latest_membership
where latest_membership.user_id = p.id
  and p.active_league_id is null;

create or replace function public.fn_set_active_league(p_league_id uuid)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = v_uid
  ) then
    raise exception 'No perteneces a esta liga' using errcode = '42501';
  end if;

  update public.profiles
     set active_league_id = p_league_id
   where id = v_uid
   returning * into v_profile;

  return v_profile;
end;
$$;

comment on function public.fn_set_active_league(uuid) is
  'Cambia la liga activa del usuario autenticado, validando membresía.';

grant execute on function public.fn_set_active_league(uuid) to authenticated;

-- Crear una liga o unirse por invitación conserva el comportamiento anterior:
-- la liga nueva pasa a ser la activa automáticamente.
create or replace function public.fn_create_league(
  p_name text,
  p_invite_code text,
  p_prediction_mode text,
  p_requires_payment boolean default false,
  p_payment_amount numeric default null,
  p_payment_instructions text default null
) returns public.leagues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_league public.leagues;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  insert into public.leagues
    (name, created_by, invite_code, requires_payment, payment_amount, payment_instructions, rules)
  values
    (p_name, v_uid, p_invite_code, coalesce(p_requires_payment, false),
     p_payment_amount, p_payment_instructions,
     jsonb_build_object('predictionMode', p_prediction_mode))
  returning * into v_league;

  insert into public.league_members (league_id, user_id, role, payment_status)
  values (v_league.id, v_uid, 'admin', 'pending');

  update public.profiles
     set active_league_id = v_league.id
   where id = v_uid;

  return v_league;
end;
$$;

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

  update public.profiles
     set active_league_id = v_league_id
   where id = v_uid;

  return v_member;
end;
$$;

-- Si una membresía desaparece y era la liga activa del usuario, moverlo a la
-- membresía restante más reciente o dejarlo sin activa si ya no pertenece a
-- ninguna liga.
create or replace function public.fn_cleanup_on_member_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next_league_id uuid;
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
  'Trigger AFTER DELETE on league_members: limpia datos por liga y reubica active_league_id si la membresía borrada era la liga activa.';

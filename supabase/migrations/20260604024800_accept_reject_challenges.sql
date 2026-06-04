-- Migración: accept_reject_challenges
-- Story 5.2 — Aceptación, Rechazo y Devolución de Garantía (Escrow)

-- 1. Helper de Reembolso Compartido
create or replace function public.refund_challenge_escrow(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_league_id uuid;
begin
  select league_id into v_league_id from public.challenges where id = p_challenge_id;
  
  -- Escrow neto retenido por usuario para ESTE reto = -SUM(amount). Si ya se reembolsó, da 0.
  for r in
    select user_id, -sum(amount) as refund
    from public.point_transactions
    where reference_id = p_challenge_id
    group by user_id
    having -sum(amount) > 0
  loop
    update public.league_members
      set wager_balance = wager_balance + r.refund
      where league_id = v_league_id and user_id = r.user_id;

    insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
    values (r.user_id, v_league_id, r.refund, 'challenge_escrow_refund', p_challenge_id);
  end loop;
end;
$$;

comment on function public.refund_challenge_escrow(uuid) is
  'Reembolsa los montos retenidos en escrow de un desafío de forma atómica e idempotente.';

-- 2. RPC para Aceptar Desafío
create or replace function public.accept_challenge(
  p_challenge_id uuid,
  p_prediction_home int,
  p_prediction_away int
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid            uuid := (select auth.uid());
  v_challenge      record;
  v_match          record;
  v_current_points numeric(6, 2);
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  -- Bloquear fila del desafío para evitar race conditions
  select * into v_challenge
  from public.challenges
  where id = p_challenge_id
  for update;

  if v_challenge is null then
    raise exception 'Desafío no encontrado.' using errcode = 'P0005';
  end if;

  if v_challenge.status <> 'pending' then
    raise exception 'El desafío ya no se encuentra pendiente.' using errcode = 'P0005';
  end if;

  -- Validar oponente
  if v_challenge.type = 'direct' then
    if v_challenge.challenged_id is null or v_challenge.challenged_id <> v_uid then
      raise exception 'No autorizado para aceptar este desafío directo.' using errcode = '42501';
    end if;
  elsif v_challenge.type = 'open' then
    if v_challenge.creator_id = v_uid then
      raise exception 'No puedes unirte a tu propio pozo abierto.' using errcode = '42501';
    end if;
  else
    raise exception 'Tipo de desafío inválido.' using errcode = 'P0005';
  end if;

  -- Verificar si el participante ya se unió
  if exists (
    select 1 from public.challenge_participants
    where challenge_id = p_challenge_id and user_id = v_uid
  ) then
    raise exception 'Ya eres participante de este desafío.' using errcode = 'P0005';
  end if;

  -- Obtener info del partido
  select * into v_match
  from public.matches
  where id = v_challenge.match_id;

  -- Verificar si el partido ya comenzó (Kickoff - Opción B)
  if v_match.match_time <= now() or v_match.status <> 'scheduled' then
    raise exception 'El partido ya comenzó; este desafío ya no admite aceptaciones.' using errcode = 'P0004';
  end if;

  -- Bloquear fila de saldo del miembro y verificar saldo suficiente
  select wager_balance into v_current_points
  from public.league_members
  where league_id = v_challenge.league_id and user_id = v_uid
  for update;

  if v_current_points is null then
    raise exception 'No eres miembro de esta liga.' using errcode = '42501';
  end if;

  if v_current_points < v_challenge.points_bet::numeric then
    raise exception 'Saldo de puntos insuficiente para aceptar el desafío.' using errcode = 'P0003';
  end if;

  -- Insertar la predicción en participantes
  insert into public.challenge_participants (
    challenge_id, user_id, prediction_home, prediction_away
  ) values (
    p_challenge_id, v_uid, p_prediction_home, p_prediction_away
  );

  -- Deducción atómica del balance de apuestas del oponente
  update public.league_members
  set wager_balance = wager_balance - v_challenge.points_bet::numeric
  where league_id = v_challenge.league_id and user_id = v_uid;

  -- Registrar movimiento en el ledger
  insert into public.point_transactions (
    user_id, league_id, amount, description, reference_id
  ) values (
    v_uid, v_challenge.league_id, -v_challenge.points_bet::numeric,
    'challenge_escrow_hold', p_challenge_id
  );

  -- Transicionar estado del desafío si es directo
  if v_challenge.type = 'direct' then
    update public.challenges
    set status = 'active'
    where id = p_challenge_id;
  end if;
end;
$$;

comment on function public.accept_challenge(uuid, int, int) is
  'Acepta un desafío 1v1 directo o se une a un pozo abierto deduciendo el saldo de escrow e insertando la predicción.';

-- 3. RPC para Rechazar Desafío Directo
create or replace function public.reject_challenge(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_challenge record;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  -- Bloquear desafío
  select * into v_challenge
  from public.challenges
  where id = p_challenge_id
  for update;

  if v_challenge is null then
    raise exception 'Desafío no encontrado.' using errcode = 'P0005';
  end if;

  if v_challenge.status <> 'pending' then
    raise exception 'El desafío ya no se encuentra pendiente.' using errcode = 'P0005';
  end if;

  if v_challenge.type <> 'direct' or v_challenge.challenged_id <> v_uid then
    raise exception 'No autorizado para rechazar este desafío.' using errcode = '42501';
  end if;

  -- Actualizar estado a cancelado
  update public.challenges
  set status = 'canceled'
  where id = p_challenge_id;

  -- Reembolsar a todos los tenedores de escrow del desafío
  perform public.refund_challenge_escrow(p_challenge_id);
end;
$$;

comment on function public.reject_challenge(uuid) is
  'Rechaza un desafío 1v1 directo pendiente y devuelve el escrow depositado por el creador.';

-- 4. RPC para Cancelar Desafío
create or replace function public.cancel_challenge(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_challenge  record;
  v_part_count int;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  -- Bloquear desafío
  select * into v_challenge
  from public.challenges
  where id = p_challenge_id
  for update;

  if v_challenge is null then
    raise exception 'Desafío no encontrado.' using errcode = 'P0005';
  end if;

  if v_challenge.status <> 'pending' then
    raise exception 'El desafío ya no se encuentra pendiente.' using errcode = 'P0005';
  end if;

  if v_challenge.creator_id <> v_uid then
    raise exception 'No autorizado para cancelar este desafío.' using errcode = '42501';
  end if;

  -- Contar participantes
  select count(*) into v_part_count
  from public.challenge_participants
  where challenge_id = p_challenge_id;

  if v_part_count > 1 then
    raise exception 'No puedes cancelar un pozo que ya tiene participantes.' using errcode = 'P0006';
  end if;

  -- Cambiar estado a cancelado
  update public.challenges
  set status = 'canceled'
  where id = p_challenge_id;

  -- Reembolsar escrow depositado
  perform public.refund_challenge_escrow(p_challenge_id);
end;
$$;

comment on function public.cancel_challenge(uuid) is
  'Cancela un desafío propio si todavía no se ha unido ningún rival/participante.';

-- 5. Trigger y Función para la Expiración / Bloqueo en Kickoff
create or replace function public.fn_cancel_pending_challenges_on_match_start()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chal record;
begin
  -- 1. Pozos o retos pendientes con ≥ 2 participantes se mueven a 'active'
  update public.challenges
  set status = 'active'
  where match_id = new.id
    and status = 'pending'
    and (
      select count(*)
      from public.challenge_participants cp
      where cp.challenge_id = challenges.id
    ) >= 2;

  -- 2. Retos sin contraparte (con exactamente 1 participante: solo el creador) pasan a 'canceled' y reembolsan
  for v_chal in
    update public.challenges
    set status = 'canceled'
    where match_id = new.id
      and status = 'pending'
    returning id
  loop
    perform public.refund_challenge_escrow(v_chal.id);
  end loop;

  return new;
end;
$$;

comment on function public.fn_cancel_pending_challenges_on_match_start() is
  'Maneja la expiración de desafíos en el kickoff de un partido.';

create trigger tr_cancel_pending_challenges_on_match_start
  after update of status on public.matches
  for each row
  when (old.status = 'scheduled' and new.status is distinct from 'scheduled')
  execute function public.fn_cancel_pending_challenges_on_match_start();

-- 6. Asignación de Permisos de Ejecución
grant execute on function public.accept_challenge(uuid, int, int) to authenticated;
grant execute on function public.reject_challenge(uuid) to authenticated;
grant execute on function public.cancel_challenge(uuid) to authenticated;

-- 7. Restricción check para pruebas de rollback en reembolso (Story 5.2 AC 10j)
alter table public.point_transactions add constraint chk_point_transactions_refund_rollback_test check (amount <> 888.00);

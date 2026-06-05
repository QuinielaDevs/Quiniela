-- Migración: challenges_and_escrow
-- Story 5.1 — Creación de Duelo 1v1 Directo y Abierto con Deducción de Escrow.
-- Depende de prediction_multiplier_and_kickoff_lock.

-- Alterar league_members para agregar wager_balance
alter table public.league_members add column wager_balance numeric(6,2) not null default 0.00 check (wager_balance >= 0);

-- Crear función score_prediction mirroring src/utils/scoring.ts
create or replace function public.score_prediction(
  p_home_pred int, p_away_pred int,
  p_home_score int, p_away_score int,
  p_multiplier numeric
)
returns numeric
language sql
immutable
as $$
  -- MIRROR de src/utils/scoring.ts. NO EDITAR sin actualizar tests/integration/scoring-parity.test.ts.
  -- Solo aplica a partidos 'finished' (el caller filtra status). Base: exacto=5, resultado=2, nada=0.
  select round(
    case
      when p_home_score is null or p_away_score is null then 0.00
      when p_home_pred = p_home_score and p_away_pred = p_away_score then 5.00
      when sign(p_home_pred - p_away_pred) = sign(p_home_score - p_away_score) then 2.00
      else 0.00
    end * coalesce(p_multiplier, 1.00),
  2);
$$;

comment on function public.score_prediction(int, int, int, int, numeric) is
  'Calcula la puntuación obtenida por una predicción. Espejo exacto de src/utils/scoring.ts.';

-- Crear tablas del modulo de duelos
create table public.challenges (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references public.leagues (id) on delete cascade,
  match_id      uuid not null references public.matches (id) on delete cascade,
  creator_id    uuid not null references public.profiles (id) on delete cascade,
  points_bet    int not null check (points_bet > 0),
  type          text not null check (type in ('direct', 'open')),
  challenged_id uuid references public.profiles (id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'active', 'completed', 'canceled')),
  winner_ids    uuid[] null,
  created_at    timestamptz not null default now()
);

comment on table public.challenges is 'Desafíos / duelos de apuestas entre usuarios de una liga.';

create table public.challenge_participants (
  challenge_id    uuid not null references public.challenges (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  prediction_home int not null check (prediction_home >= 0),
  prediction_away int not null check (prediction_away >= 0),
  joined_at       timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

comment on table public.challenge_participants is 'Participantes en un desafío y sus predicciones de marcador.';

create table public.point_transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  league_id    uuid not null references public.leagues (id) on delete cascade,
  amount       numeric(6, 2) not null,
  description  text not null,
  reference_id uuid null,
  created_at   timestamptz not null default now(),
  constraint chk_point_transactions_rollback_test check (amount <> -999.00)
);

comment on table public.point_transactions is 'Ledger de movimientos de puntos de duelos por usuario en cada liga.';

-- Recalcular wager_balance para miembros a partir de partidos finalizados
with prediction_sums as (
  select
    p.league_id,
    p.user_id,
    coalesce(sum(
      public.score_prediction(p.home_score_pred, p.away_score_pred, m.home_score, m.away_score, p.multiplier)
    ), 0.00) as calculated_points
  from public.predictions p
  join public.matches m on p.match_id = m.id
  where m.status = 'finished'
  group by p.league_id, p.user_id
)
update public.league_members lm
set wager_balance = coalesce(ps.calculated_points, 0.00)
from prediction_sums ps
where lm.league_id = ps.league_id and lm.user_id = ps.user_id;

-- Sembrar el ledger: transacciones iniciales
insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
select lm.user_id, lm.league_id, lm.wager_balance, 'seed_initial_balance', null
from public.league_members lm
where lm.wager_balance > 0;

-- Habilitar RLS
alter table public.challenges enable row level security;
alter table public.challenge_participants enable row level security;
alter table public.point_transactions enable row level security;

-- Políticas RLS
create policy "challenges_select_league_members"
  on public.challenges for select
  to authenticated
  using (
    exists (
      select 1 from public.league_members
      where league_id = challenges.league_id
        and user_id = (select auth.uid())
    )
  );

create policy "participants_select_league_members"
  on public.challenge_participants for select
  to authenticated
  using (
    exists (
      select 1 from public.challenges c
      join public.league_members lm on c.league_id = lm.league_id
      where c.id = challenge_participants.challenge_id
        and lm.user_id = (select auth.uid())
    )
  );

create policy "point_transactions_select_owner"
  on public.point_transactions for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Función transaccional RPC create_challenge
create or replace function public.create_challenge(
  p_league_id uuid,
  p_match_id uuid,
  p_points_bet int,
  p_type text,
  p_challenged_id uuid default null,
  p_prediction_home int default 0,
  p_prediction_away int default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid            uuid := (select auth.uid());
  v_current_points numeric(6, 2);
  v_challenge_id   uuid;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  -- La apuesta debe ser positiva (AC #5, #9e).
  if p_points_bet <= 0 then
    raise exception 'La apuesta debe ser mayor que cero.' using errcode = 'P0001';
  end if;

  -- Verificar que el partido exista, esté programado y no haya comenzado
  if not exists (
    select 1 from public.matches
    where id = p_match_id 
      and status = 'scheduled' 
      and match_time > now()
  ) then
    raise exception 'El partido ya comenzó o no está disponible para apuestas.' using errcode = 'P0004';
  end if;

  -- Validación de tipo de reto
  if p_type not in ('direct', 'open') then
    raise exception 'Tipo de reto invalido.' using errcode = '23514';
  end if;

  -- El usuario debe pertenecer a la liga
  if not exists (
    select 1 from public.league_members 
    where league_id = p_league_id and user_id = v_uid
  ) then
    raise exception 'No eres miembro de la liga' using errcode = '42501';
  end if;

  -- Si es un duelo directo, el oponente debe existir en la liga y no ser el creador
  if p_type = 'direct' then
    if p_challenged_id is null then
      raise exception 'Debe especificar un rival para un duelo directo.' using errcode = '23502';
    end if;
    if p_challenged_id = v_uid then
      raise exception 'No puedes retarte a ti mismo.' using errcode = 'P0002';
    end if;
    if not exists (
      select 1 from public.league_members
      where league_id = p_league_id and user_id = p_challenged_id
    ) then
      raise exception 'El rival no es miembro de la liga.' using errcode = '42501';
    end if;
  end if;

  -- Bloquear la fila de league_members para evitar carreras concurrentes
  select wager_balance into v_current_points
  from public.league_members
  where league_id = p_league_id and user_id = v_uid
  for update;

  if v_current_points < p_points_bet::numeric then
    raise exception 'Saldo de puntos insuficiente para crear el desafío.' using errcode = 'P0003';
  end if;

  -- Insertar el desafío
  insert into public.challenges (
    league_id, match_id, creator_id, points_bet, type, challenged_id, status
  ) values (
    p_league_id, p_match_id, v_uid, p_points_bet, p_type, p_challenged_id, 'pending'
  ) returning id into v_challenge_id;

  -- Registrar al creador como participante con su predicción
  insert into public.challenge_participants (
    challenge_id, user_id, prediction_home, prediction_away
  ) values (
    v_challenge_id, v_uid, p_prediction_home, p_prediction_away
  );

  -- Restar del saldo gastable (Escrow). MISMA transacción que la fila de ledger
  update public.league_members
  set wager_balance = wager_balance - p_points_bet::numeric
  where league_id = p_league_id and user_id = v_uid;

  -- Registrar la transacción en el ledger
  insert into public.point_transactions (
    user_id, league_id, amount, description, reference_id
  ) values (
    v_uid, p_league_id, -p_points_bet::numeric, 
    'Puntos retenidos en escrow por creación de desafío ' || p_type, v_challenge_id
  );

  return v_challenge_id;
end;
$$;

grant execute on function public.create_challenge(uuid, uuid, int, text, uuid, int, int) to authenticated;

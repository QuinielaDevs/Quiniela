-- Migración: challenge_landing_rpc
-- Story 5.4 — Compartir de Forma Viral por WhatsApp y Landing Page (Banter Preview)
-- Implementa la RPC fn_get_challenge_landing y actualiza RLS de challenge_participants.

-- ============================================================
-- 1) Actualizar Políticas RLS en challenge_participants
-- ============================================================
drop policy if exists "participants_select_league_members" on public.challenge_participants;

create policy "participants_select_gated"
  on public.challenge_participants for select
  to authenticated
  using (
    -- El propio participante siempre puede ver su predicción
    user_id = (select auth.uid())
    or (
      -- Otros miembros de la liga sólo pueden verla si el partido comenzó (kickoff - 1min)
      exists (
        select 1 from public.challenges c
        join public.league_members lm on c.league_id = lm.league_id
        where c.id = challenge_participants.challenge_id
          and lm.user_id = (select auth.uid())
          and public.fn_match_unlocked(c.match_id)
      )
    )
  );

-- ============================================================
-- 2) Crear RPC fn_get_challenge_landing
-- ============================================================
create or replace function public.fn_get_challenge_landing(p_challenge_id uuid)
returns table (
  challenge_id uuid,
  points_bet int,
  type text,
  status text,
  league_id uuid,
  league_name text,
  invite_code text,
  creator_id uuid,
  creator_display_name text,
  creator_avatar_url text,
  challenged_id uuid,
  challenged_display_name text,
  match_id uuid,
  home_team text,
  away_team text,
  home_team_code text,
  away_team_code text,
  match_time timestamptz,
  match_status text,
  creator_prediction_home int,
  creator_prediction_away int,
  challenged_prediction_home int,
  challenged_prediction_away int
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_unlocked boolean;
  v_viewer   uuid;
begin
  -- Resolver viewer (null si es anon / no autenticado)
  v_viewer := (select auth.uid());

  -- Resolver si el partido ya comenzó / gate temporal
  select public.fn_match_unlocked(c.match_id) into v_unlocked
  from public.challenges c
  where c.id = p_challenge_id;

  if v_unlocked is null then
    return;
  end if;

  return query
  select
    c.id as challenge_id,
    c.points_bet,
    c.type,
    c.status,
    c.league_id,
    l.name as league_name,
    case when c.type = 'open' then l.invite_code else null end as invite_code,
    c.creator_id,
    p_creator.display_name as creator_display_name,
    p_creator.avatar_url as creator_avatar_url,
    p_challenged.id as challenged_id,
    p_challenged.display_name as challenged_display_name,
    c.match_id,
    m.home_team,
    m.away_team,
    m.home_team_code,
    m.away_team_code,
    m.match_time,
    m.status as match_status,
    -- Predicción del creador
    case
      when v_unlocked or v_viewer = c.creator_id then cp_creator.prediction_home
      else null
    end as creator_prediction_home,
    case
      when v_unlocked or v_viewer = c.creator_id then cp_creator.prediction_away
      else null
    end as creator_prediction_away,
    -- Predicción del retado/visualizador
    case
      when v_unlocked or v_viewer = p_challenged.id then cp_challenged.prediction_home
      else null
    end as challenged_prediction_home,
    case
      when v_unlocked or v_viewer = p_challenged.id then cp_challenged.prediction_away
      else null
    end as challenged_prediction_away
  from public.challenges c
  join public.leagues l on c.league_id = l.id
  join public.matches m on c.match_id = m.id
  join public.profiles p_creator on c.creator_id = p_creator.id
  -- Join dinámico para oponente: challenged_id para directos, o el primer participante que no sea el creador para abiertos
  left join public.profiles p_challenged on
    p_challenged.id = (
      case
        when c.type = 'direct' then c.challenged_id
        else (
          select cp.user_id
          from public.challenge_participants cp
          where cp.challenge_id = c.id and cp.user_id <> c.creator_id
          limit 1
        )
      end
    )
  -- Participación del creador
  left join public.challenge_participants cp_creator 
    on c.id = cp_creator.challenge_id and c.creator_id = cp_creator.user_id
  -- Participación del retado/visualizador
  left join public.challenge_participants cp_challenged 
    on c.id = cp_challenged.challenge_id and cp_challenged.user_id = p_challenged.id
  where c.id = p_challenge_id;
end;
$$;

-- ============================================================
-- 3) Asignación de Permisos de Ejecución
-- ============================================================
grant execute on function public.fn_get_challenge_landing(uuid) to anon, authenticated;

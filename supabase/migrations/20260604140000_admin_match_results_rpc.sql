-- Migración: admin_match_results_rpc
-- Captura y edición de resultados por el administrador (Story 7.2 — AC #2, #3).
--
-- Contexto de seguridad: public.matches es un CATÁLOGO GLOBAL del torneo (un solo
-- Mundial compartido por todas las ligas) y su RLS sólo tiene política SELECT para
-- authenticated → cualquier UPDATE desde el cliente está denegado por defecto. En
-- vez de abrir una política UPDATE, exponemos un RPC SECURITY DEFINER admin-gated
-- (mismo patrón que fn_set_member_payment_status / fn_remove_member de Story 3.3):
-- la función baja al rol propietario, valida que el llamante es admin de ALGUNA
-- liga (el marcador es global, no por-liga), valida marcadores y la transición de
-- estado, y muta. `set search_path = ''` es obligatorio en SECURITY DEFINER →
-- todo fully-qualified. El UPDATE se propaga solo a la tabla en vivo (Epic 4) vía
-- la publicación supabase_realtime, y la clasificación oficial lo incorpora
-- on-the-fly al leer matches.finished (Epic 3). NO se persiste points_earned.

-- ============================================================
-- 1) Helper admin global (anti-recursión).
--    Espeja public.fn_user_is_league_admin (Story 3.3) pero SIN parámetro de liga:
--    como matches es catálogo global, basta con ser admin de cualquier liga.
--    SECURITY DEFINER para leer league_members SIN re-disparar RLS.
-- ============================================================
create or replace function public.fn_user_is_any_league_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.league_members lm
    where lm.user_id = (select auth.uid())
      and lm.role = 'admin'
  );
$$;

comment on function public.fn_user_is_any_league_admin() is
  'Devuelve true si el usuario actual es admin de AL MENOS una liga. SECURITY DEFINER para evitar recursión de RLS sobre league_members. Gate de la edición de resultados (matches es catálogo global).';

-- ============================================================
-- 2) RPC: fijar marcador + estado de un partido (admin-only global).
--    Valida sesión, rol admin (global), marcadores >= 0, transición de status
--    válida y la regla marcador↔estado. Bloquea capturar resultado sobre un
--    knockout TBD (sin equipos reales hasta Story 7.3).
-- ============================================================
create or replace function public.fn_admin_set_match_result(
  p_match_id uuid,
  p_home_score int,
  p_away_score int,
  p_status text
) returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches;
  v_from text;
  v_ok boolean;
  v_home int;
  v_away int;
begin
  -- (a) Sesión.
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  -- (b) Admin de alguna liga (matches es global).
  if not public.fn_user_is_any_league_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  -- Cargar el partido actual (estado origen para validar la transición). FOR
  -- UPDATE bloquea la fila para serializar ediciones concurrentes de dos admins
  -- sobre el mismo partido (matches es catálogo global): sin el lock, ambos leen
  -- el mismo estado origen, ambos pasan la validación de transición y el segundo
  -- UPDATE pisa al primero (lost-update).
  select * into v_match from public.matches m where m.id = p_match_id for update;
  if v_match.id is null then
    raise exception 'Partido no encontrado' using errcode = 'P0002';
  end if;

  -- Estado destino dentro del set permitido (espeja el CHECK de la tabla).
  if p_status not in ('scheduled', 'live', 'finished', 'suspended', 'canceled') then
    raise exception 'Estado de partido inválido' using errcode = '22023';
  end if;

  -- (d) Transición de estado válida (matriz Story 7.2). Un admin de confianza
  -- puede corregir errores, pero no se permiten saltos sin sentido (p. ej.
  -- canceled→finished o finished→scheduled).
  v_from := v_match.status;
  v_ok := case v_from
    when 'scheduled' then p_status in ('scheduled', 'live', 'finished', 'suspended', 'canceled')
    when 'live'      then p_status in ('scheduled', 'live', 'finished', 'suspended', 'canceled')
    when 'finished'  then p_status in ('finished', 'live')
    when 'suspended' then p_status in ('scheduled', 'live', 'finished', 'suspended', 'canceled')
    when 'canceled'  then p_status in ('scheduled', 'canceled')
    else false
  end;
  if not v_ok then
    raise exception 'Transición de estado inválida (% → %)', v_from, p_status using errcode = '22023';
  end if;

  -- Guarda de integridad: no se puede capturar resultado de un knockout TBD
  -- (equipos "Por definir" hasta que Story 7.3 resuelva el bracket). Se detecta
  -- por bracket_slot presente sin códigos de equipo reales.
  if v_match.bracket_slot is not null
     and (v_match.home_team_code is null or v_match.away_team_code is null)
     and p_status in ('live', 'finished') then
    raise exception 'No se puede capturar el resultado de un partido sin equipos definidos' using errcode = '22023';
  end if;

  -- (c)+(e) Regla marcador↔estado.
  if p_status in ('live', 'finished') then
    -- Marcador requerido y no negativo.
    if p_home_score is null or p_away_score is null then
      raise exception 'El marcador es obligatorio para un partido en vivo o finalizado' using errcode = '22023';
    end if;
    if p_home_score < 0 or p_away_score < 0 then
      raise exception 'El marcador no puede ser negativo' using errcode = '22023';
    end if;
    if v_match.bracket_slot is not null
       and p_status = 'finished'
       and p_home_score = p_away_score then
      raise exception 'Un partido knockout finalizado necesita ganador; registra un marcador no empatado hasta modelar penales' using errcode = '22023';
    end if;
    v_home := p_home_score;
    v_away := p_away_score;
  else
    -- scheduled / suspended / canceled → sin marcador persistido.
    if (p_home_score is not null and p_home_score < 0)
       or (p_away_score is not null and p_away_score < 0) then
      raise exception 'El marcador no puede ser negativo' using errcode = '22023';
    end if;
    v_home := null;
    v_away := null;
  end if;

  update public.matches
     set home_score = v_home,
         away_score = v_away,
         status = p_status,
         updated_at = now()
   where id = p_match_id
  returning * into v_match;

  return v_match;
end;
$$;

comment on function public.fn_admin_set_match_result(uuid, int, int, text) is
  'Fija home_score/away_score/status de un partido (admin global). SECURITY DEFINER + gating fn_user_is_any_league_admin: matches no tiene política RLS de update. Valida marcadores, transición de estado y bloquea knockout TBD. El UPDATE se propaga a Realtime (Epic 4); la clasificación oficial lo lee on-the-fly (Epic 3).';

-- ============================================================
-- 3) Grants: sólo usuarios autenticados invocan los RPCs (anon queda fuera).
-- ============================================================
grant execute on function public.fn_user_is_any_league_admin() to authenticated;
grant execute on function public.fn_admin_set_match_result(uuid, int, int, text) to authenticated;

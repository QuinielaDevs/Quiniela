


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."accept_challenge"("p_challenge_id" "uuid", "p_prediction_home" integer, "p_prediction_away" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid            uuid := (select auth.uid());
  v_challenge      record;
  v_match          record;
  v_current_points numeric(12, 2);
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

  -- Obtener info del partido y bloquear para lectura (prevent status updates)
  select * into v_match
  from public.matches
  where id = v_challenge.match_id
  for share;

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


ALTER FUNCTION "public"."accept_challenge"("p_challenge_id" "uuid", "p_prediction_home" integer, "p_prediction_away" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."accept_challenge"("p_challenge_id" "uuid", "p_prediction_home" integer, "p_prediction_away" integer) IS 'Acepta un desafío 1v1 directo o se une a un pozo abierto deduciendo el saldo de escrow e insertando la predicción.';



CREATE OR REPLACE FUNCTION "public"."cancel_challenge"("p_challenge_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."cancel_challenge"("p_challenge_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cancel_challenge"("p_challenge_id" "uuid") IS 'Cancela un desafío propio si todavía no se ha unido ningún rival/participante.';



CREATE OR REPLACE FUNCTION "public"."check_conservation_invariant"("p_league_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_balance numeric(12, 2);
  v_sum     numeric(12, 2);
begin
  select wager_balance into v_balance
  from public.league_members
  where league_id = p_league_id and user_id = p_user_id;
  
  select coalesce(sum(amount), 0) into v_sum
  from public.point_transactions
  where league_id = p_league_id and user_id = p_user_id;
  
  return v_balance = v_sum;
end;
$$;


ALTER FUNCTION "public"."check_conservation_invariant"("p_league_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_challenge"("p_league_id" "uuid", "p_match_id" "uuid", "p_points_bet" integer, "p_type" "text", "p_challenged_id" "uuid" DEFAULT NULL::"uuid", "p_prediction_home" integer DEFAULT 0, "p_prediction_away" integer DEFAULT 0) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid            uuid := (select auth.uid());
  v_current_points numeric(12, 2);
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


ALTER FUNCTION "public"."create_challenge"("p_league_id" "uuid", "p_match_id" "uuid", "p_points_bet" integer, "p_type" "text", "p_challenged_id" "uuid", "p_prediction_home" integer, "p_prediction_away" integer) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."matches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "external_ref" "text",
    "home_team" "text" NOT NULL,
    "away_team" "text" NOT NULL,
    "home_team_code" "text",
    "away_team_code" "text",
    "home_score" integer,
    "away_score" integer,
    "match_time" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "matchday" integer,
    "stage" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "group_label" "text",
    "bracket_slot" integer,
    "home_source" "text",
    "away_source" "text",
    "venue" "text",
    "external_last_sync_at" timestamp with time zone,
    CONSTRAINT "matches_away_score_check" CHECK (("away_score" >= 0)),
    CONSTRAINT "matches_group_label_check" CHECK ((("group_label" IS NULL) OR ("group_label" = ANY (ARRAY['A'::"text", 'B'::"text", 'C'::"text", 'D'::"text", 'E'::"text", 'F'::"text", 'G'::"text", 'H'::"text", 'I'::"text", 'J'::"text", 'K'::"text", 'L'::"text"])))),
    CONSTRAINT "matches_home_score_check" CHECK (("home_score" >= 0)),
    CONSTRAINT "matches_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'live'::"text", 'finished'::"text", 'suspended'::"text", 'canceled'::"text"])))
);


ALTER TABLE "public"."matches" OWNER TO "postgres";


COMMENT ON TABLE "public"."matches" IS 'Calendario de partidos del Mundial. Lo escribe el cron /api/sync (service_role). status restringido por CHECK; match_time en UTC del servidor.';



COMMENT ON COLUMN "public"."matches"."stage" IS 'Fase del torneo: group, round-32, round-16, quarter, semi, third-place o final.';



COMMENT ON COLUMN "public"."matches"."group_label" IS 'Grupo FIFA 2026 A-L. Null para eliminatorias.';



COMMENT ON COLUMN "public"."matches"."bracket_slot" IS 'Numero oficial del partido de eliminatoria en el bracket FIFA 2026 (73-104). Null en fase de grupos.';



COMMENT ON COLUMN "public"."matches"."home_source" IS 'Codigo fuente del local para slots TBD de eliminatoria, por ejemplo 1A, 3A/B/C/D/F, W74 o L101.';



COMMENT ON COLUMN "public"."matches"."away_source" IS 'Codigo fuente del visitante para slots TBD de eliminatoria, por ejemplo 2B, 3A/B/C/D/F, W74 o L101.';



COMMENT ON COLUMN "public"."matches"."venue" IS 'Sede del partido resuelta desde ground/stadiums.json o fallback del calendario fuente.';



COMMENT ON COLUMN "public"."matches"."external_last_sync_at" IS 'Marca de tiempo (ts) del último evento de Zafronix integrado, usado para evitar procesamiento fuera de orden.';



CREATE OR REPLACE FUNCTION "public"."fn_admin_apply_knockout_advancement"("p_slots" "jsonb") RETURNS SETOF "public"."matches"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_uid uuid := auth.uid();
  v_slot record;
  v_match public.matches;
  v_home_team text;
  v_away_team text;
  v_home_code text;
  v_away_code text;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  if not public.fn_user_is_any_league_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then
    raise exception 'Payload de avance inválido' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_slots) as elem(value)
    where jsonb_typeof(elem.value) <> 'object'
       or not (
         elem.value ? 'bracket_slot'
         and elem.value ? 'home_team'
         and elem.value ? 'away_team'
         and elem.value ? 'home_team_code'
         and elem.value ? 'away_team_code'
       )
       or jsonb_typeof(elem.value -> 'bracket_slot') <> 'number'
       or (elem.value ->> 'bracket_slot') !~ '^[0-9]+$'
       or jsonb_typeof(elem.value -> 'home_team') <> 'string'
       or jsonb_typeof(elem.value -> 'away_team') <> 'string'
       or jsonb_typeof(elem.value -> 'home_team_code') not in ('string', 'null')
       or jsonb_typeof(elem.value -> 'away_team_code') not in ('string', 'null')
  ) then
    raise exception 'Payload de avance inválido' using errcode = '22023';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(p_slots)
  ) <> (
    select count(distinct (elem.value ->> 'bracket_slot')::int)
    from jsonb_array_elements(p_slots) as elem(value)
  ) then
    raise exception 'Payload de avance contiene slots duplicados' using errcode = '22023';
  end if;

  for v_slot in
    select *
    from jsonb_to_recordset(p_slots) as slot(
      bracket_slot int,
      home_team text,
      away_team text,
      home_team_code text,
      away_team_code text
    )
  loop
    if v_slot.bracket_slot is null
       or v_slot.bracket_slot < 73
       or v_slot.bracket_slot > 104 then
      raise exception 'Slot de bracket inválido' using errcode = '22023';
    end if;

    v_home_team := coalesce(nullif(trim(v_slot.home_team), ''), 'Por definir');
    v_away_team := coalesce(nullif(trim(v_slot.away_team), ''), 'Por definir');
    v_home_code := nullif(trim(v_slot.home_team_code), '');
    v_away_code := nullif(trim(v_slot.away_team_code), '');

    if (v_home_team = 'Por definir' and v_home_code is not null)
       or (v_home_team <> 'Por definir' and v_home_code is null)
       or (v_away_team = 'Por definir' and v_away_code is not null)
       or (v_away_team <> 'Por definir' and v_away_code is null) then
      raise exception 'Payload de avance inconsistente' using errcode = '22023';
    end if;

    update public.matches
       set home_team = v_home_team,
           away_team = v_away_team,
           home_team_code = v_home_code,
           away_team_code = v_away_code,
           updated_at = now()
     where bracket_slot = v_slot.bracket_slot
       and stage <> 'group'
    returning * into v_match;

    if v_match.id is null then
      raise exception 'Partido knockout no encontrado para bracket_slot %', v_slot.bracket_slot using errcode = 'P0002';
    end if;

    return next v_match;
  end loop;

  return;
end;
$_$;


ALTER FUNCTION "public"."fn_admin_apply_knockout_advancement"("p_slots" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_admin_apply_knockout_advancement"("p_slots" "jsonb") IS 'Aplica participantes resueltos del bracket FIFA 2026 a public.matches. SECURITY DEFINER + admin global; actualiza solo equipos/códigos de slots knockout 73-104 y preserva resultados/estado/fuentes/horarios. Format-agnostic: identifica filas por bracket_slot + stage (no por external_ref).';



CREATE OR REPLACE FUNCTION "public"."fn_admin_set_match_result"("p_match_id" "uuid", "p_home_score" integer, "p_away_score" integer, "p_status" "text") RETURNS "public"."matches"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."fn_admin_set_match_result"("p_match_id" "uuid", "p_home_score" integer, "p_away_score" integer, "p_status" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_admin_set_match_result"("p_match_id" "uuid", "p_home_score" integer, "p_away_score" integer, "p_status" "text") IS 'Fija home_score/away_score/status de un partido (admin global). SECURITY DEFINER + gating fn_user_is_any_league_admin: matches no tiene política RLS de update. Valida marcadores, transición de estado y bloquea knockout TBD. El UPDATE se propaga a Realtime (Epic 4); la clasificación oficial lo lee on-the-fly (Epic 3).';



CREATE OR REPLACE FUNCTION "public"."fn_apply_accrual_correction"("p_prediction_id" "uuid", "p_new_points" numeric, "p_match_id" "uuid", "p_match_status" "text") RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_pred   record;
  v_new    numeric(12, 2);
  v_delta  numeric(12, 2);
begin
  -- Bloquear la predicción para una lectura/escritura consistente.
  select id, league_id, user_id,
         coalesce(points_earned, 0.00) as points_earned,
         evaluated_at
  into v_pred
  from public.predictions
  where id = p_prediction_id
  for update;

  if not found then
    raise exception 'Predicción % no encontrada', p_prediction_id using errcode = 'P0001';
  end if;

  -- Guarda de idempotencia POR ESTADO: solo corregimos predicciones ya evaluadas.
  -- Las no evaluadas las puntúa el trigger al pasar el partido a 'finished'.
  if v_pred.evaluated_at is null then
    return 0.00;
  end if;

  if p_match_status <> 'finished' then
    v_new := null;
    v_delta := - v_pred.points_earned;
  else
    v_new := round(coalesce(p_new_points, 0)::numeric, 2);
    v_delta := v_new - v_pred.points_earned;
  end if;

  if v_delta = 0.00 then
    return 0.00;
  end if;

  -- 1. Actualizar los puntos de la predicción al nuevo valor calculado en TS (o null si no está finalizado).
  update public.predictions
  set points_earned = v_new,
      evaluated_at = case when p_match_status = 'finished' then now() else null end,
      updated_at = now()
  where id = p_prediction_id;

  -- 2. Ajustar el saldo del miembro sumando el DELTA exacto (suma atómica con lock).
  perform 1 from public.league_members
  where league_id = v_pred.league_id and user_id = v_pred.user_id
  for update;

  if not found then
    raise exception 'Miembro de liga no encontrado para league_id: %, user_id: %', v_pred.league_id, v_pred.user_id using errcode = 'P0002';
  end if;

  update public.league_members
  set wager_balance = wager_balance + v_delta
  where league_id = v_pred.league_id and user_id = v_pred.user_id;

  -- 3. Registrar la corrección en el ledger (preserva el invariante de conservación).
  insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
  values (v_pred.user_id, v_pred.league_id, v_delta, 'match_accrual_correction', p_match_id);

  return v_delta;
end;
$$;


ALTER FUNCTION "public"."fn_apply_accrual_correction"("p_prediction_id" "uuid", "p_new_points" numeric, "p_match_id" "uuid", "p_match_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_are_special_predictions_locked"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_locked boolean;
begin
  select edits_locked into v_locked
  from public.tournament_phases
  where (starts_at is null or now() >= starts_at)
    and (ends_at is null or now() < ends_at)
  order by sort_order asc
  limit 1;
  return coalesce(v_locked, true); -- default to locked (fail closed)
end;
$$;


ALTER FUNCTION "public"."fn_are_special_predictions_locked"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_are_special_predictions_locked"() IS 'Retorna true si las predicciones especiales están bloqueadas en la fase actual según la hora del servidor de base de datos.';



CREATE OR REPLACE FUNCTION "public"."fn_cancel_pending_challenges_on_match_start"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_chal record;
begin
  if new.status in ('canceled', 'suspended') then
    -- Cancelar y reembolsar TODOS los desafíos pendientes de este partido
    for v_chal in
      update public.challenges
      set status = 'canceled'
      where match_id = new.id
        and status = 'pending'
      returning id
    loop
      perform public.refund_challenge_escrow(v_chal.id);
    end loop;
  else
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
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."fn_cancel_pending_challenges_on_match_start"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_cancel_pending_challenges_on_match_start"() IS 'Maneja la expiración de desafíos en el kickoff de un partido.';



CREATE OR REPLACE FUNCTION "public"."fn_check_awards_locked"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_edits_locked boolean;
begin
  select edits_locked into v_edits_locked
  from public.tournament_phases
  where (starts_at is null or now() >= starts_at)
    and (ends_at is null or now() < ends_at)
  order by sort_order asc
  limit 1;

  if v_edits_locked is null then
    raise exception 'No se encontró una fase activa del torneo para la fecha actual.';
  end if;

  if v_edits_locked then
    raise exception 'Las predicciones de premios especiales están bloqueadas en esta fase del torneo.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_check_awards_locked"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_cleanup_on_member_removed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."fn_cleanup_on_member_removed"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_cleanup_on_member_removed"() IS 'Trigger AFTER DELETE on league_members: limpia datos por liga y reubica active_league_id si la membresía borrada era la liga activa.';



CREATE OR REPLACE FUNCTION "public"."fn_cleanup_predictions_on_member_leave"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  delete from public.special_predictions
  where user_id = old.user_id
    and league_id = old.league_id;
  return old;
end;
$$;


ALTER FUNCTION "public"."fn_cleanup_predictions_on_member_leave"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_cleanup_predictions_on_member_leave"() IS 'Elimina automáticamente las predicciones especiales de un usuario para una liga cuando este deja de pertenecer a la misma.';



CREATE TABLE IF NOT EXISTS "public"."leagues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "invite_code" "text" NOT NULL,
    "requires_payment" boolean DEFAULT false NOT NULL,
    "payment_amount" numeric(10,2),
    "payment_instructions" "text",
    "rules" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "leagues_payment_amount_nonneg" CHECK ((("payment_amount" IS NULL) OR ("payment_amount" >= (0)::numeric)))
);


ALTER TABLE "public"."leagues" OWNER TO "postgres";


COMMENT ON TABLE "public"."leagues" IS 'Liga/quiniela privada. invite_code, payment_* y rules se consumen en stories 1.3/1.4.';



CREATE OR REPLACE FUNCTION "public"."fn_create_league"("p_name" "text", "p_invite_code" "text", "p_prediction_mode" "text", "p_requires_payment" boolean DEFAULT false, "p_payment_amount" numeric DEFAULT NULL::numeric, "p_payment_instructions" "text" DEFAULT NULL::"text") RETURNS "public"."leagues"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."fn_create_league"("p_name" "text", "p_invite_code" "text", "p_prediction_mode" "text", "p_requires_payment" boolean, "p_payment_amount" numeric, "p_payment_instructions" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_create_league"("p_name" "text", "p_invite_code" "text", "p_prediction_mode" "text", "p_requires_payment" boolean, "p_payment_amount" numeric, "p_payment_instructions" "text") IS 'Crea una liga y registra al creador como miembro admin de forma atómica. SECURITY DEFINER + validación de dominio (nombre, modo, monto) enforced también para llamadas directas al RPC.';



CREATE OR REPLACE FUNCTION "public"."fn_current_round_ordinal"() RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(
    max(public.fn_match_round_ordinal(m.matchday, m.stage)),
    0
  )
  from public.matches m
  where m.match_time <= now()
    and m.status <> 'canceled';
$$;


ALTER FUNCTION "public"."fn_current_round_ordinal"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_current_round_ordinal"() IS 'Ordinal de la jornada en curso = mayor ronda cuyo primer partido ya empezó (now()). 0 antes del inicio del torneo.';



CREATE OR REPLACE FUNCTION "public"."fn_ensure_default_predictions"("p_league_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid   uuid := (select auth.uid());
  v_count integer;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  if not public.fn_user_in_league(p_league_id) then
    raise exception 'No eres miembro de la liga' using errcode = '42501';
  end if;

  with inserted as (
    insert into public.predictions (
      league_id, match_id, user_id, home_score_pred, away_score_pred, multiplier
    )
    select
      p_league_id,
      m.id,
      v_uid,
      0,
      0,
      public.fn_prediction_multiplier(m.matchday, m.stage)
    from public.matches m
    where public.fn_match_editable(m.id)
      and not exists (
        select 1
        from public.predictions p
        where p.league_id = p_league_id
          and p.user_id = v_uid
          and p.match_id = m.id
      )
    on conflict (league_id, user_id, match_id) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;


ALTER FUNCTION "public"."fn_ensure_default_predictions"("p_league_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_ensure_default_predictions"("p_league_id" "uuid") IS 'Crea predicciones por defecto (0-0) con el multiplicador por jornada para cada partido editable sin predicción previa del usuario en la liga. Idempotente.';



CREATE TABLE IF NOT EXISTS "public"."tournament_phases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phase_code" "text" NOT NULL,
    "reward_points" integer NOT NULL,
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "edits_locked" boolean DEFAULT false NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tournament_phases_bounds_check" CHECK ((("starts_at" IS NULL) OR ("ends_at" IS NULL) OR ("starts_at" < "ends_at"))),
    CONSTRAINT "tournament_phases_phase_code_check" CHECK (("phase_code" = ANY (ARRAY['A'::"text", 'B'::"text", 'C'::"text", 'D'::"text"]))),
    CONSTRAINT "tournament_phases_reward_check" CHECK (("reward_points" = ANY (ARRAY[50, 25, 10, 2])))
);


ALTER TABLE "public"."tournament_phases" OWNER TO "postgres";


COMMENT ON TABLE "public"."tournament_phases" IS 'WC2026 phase boundaries for FR-16 decreasing-points scoring. Derived from src/config/tournamentPhases.ts. Read-only for clients.';



CREATE OR REPLACE FUNCTION "public"."fn_get_active_tournament_phase"() RETURNS SETOF "public"."tournament_phases"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return query
  select *
  from public.tournament_phases
  where (starts_at is null or now() >= starts_at)
    and (ends_at is null or now() < ends_at)
  order by sort_order asc
  limit 1;
end;
$$;


ALTER FUNCTION "public"."fn_get_active_tournament_phase"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_get_active_tournament_phase"() IS 'Retorna el registro completo de la fase activa del torneo en base a la hora actual de la base de datos (now()).';



CREATE OR REPLACE FUNCTION "public"."fn_get_challenge_landing"("p_challenge_id" "uuid") RETURNS TABLE("challenge_id" "uuid", "points_bet" integer, "type" "text", "status" "text", "league_id" "uuid", "league_name" "text", "invite_code" "text", "creator_id" "uuid", "creator_display_name" "text", "creator_avatar_url" "text", "challenged_id" "uuid", "challenged_display_name" "text", "match_id" "uuid", "home_team" "text", "away_team" "text", "home_team_code" "text", "away_team_code" "text", "match_time" timestamp with time zone, "match_status" "text", "creator_prediction_home" integer, "creator_prediction_away" integer, "challenged_prediction_home" integer, "challenged_prediction_away" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."fn_get_challenge_landing"("p_challenge_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_get_invite_landing"("p_invite_code" "text") RETURNS TABLE("league_name" "text", "creator_display_name" "text", "creator_avatar_url" "text", "requires_payment" boolean, "payment_amount" numeric, "payment_instructions" "text", "invite_code" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."fn_get_invite_landing"("p_invite_code" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_get_invite_landing"("p_invite_code" "text") IS 'Devuelve datos públicos mínimos de una liga para renderizar /join/[invite_code] antes del login. No expone email, created_by ni IDs internos.';



CREATE OR REPLACE FUNCTION "public"."fn_handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."fn_handle_new_user"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."league_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "payment_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "wager_balance" numeric(12,2) DEFAULT 0.00 NOT NULL,
    CONSTRAINT "league_members_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['pending'::"text", 'paid'::"text"]))),
    CONSTRAINT "league_members_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'member'::"text"]))),
    CONSTRAINT "league_members_wager_balance_check" CHECK (("wager_balance" >= (0)::numeric))
);


ALTER TABLE "public"."league_members" OWNER TO "postgres";


COMMENT ON TABLE "public"."league_members" IS 'Membresía de un usuario en una liga. unique(league_id,user_id) evita duplicados.';



CREATE OR REPLACE FUNCTION "public"."fn_join_league_by_invite"("p_invite_code" "text") RETURNS "public"."league_members"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."fn_join_league_by_invite"("p_invite_code" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_join_league_by_invite"("p_invite_code" "text") IS 'Une al usuario autenticado a una liga por invite_code, siempre como member/pending, de forma idempotente.';



CREATE OR REPLACE FUNCTION "public"."fn_leave_league"("p_league_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."fn_leave_league"("p_league_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_leave_league"("p_league_id" "uuid") IS 'Auto-baja: el usuario actual abandona la liga. Bloquea salir si es el único admin. El trigger tr_cleanup_on_member_removed limpia sus predicciones/medallas/perfil en esa liga.';



CREATE OR REPLACE FUNCTION "public"."fn_match_editable"("p_match_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.matches m
    where m.id = p_match_id
      and now() < m.match_time
      and m.status = 'scheduled'
      and (
        m.bracket_slot is null
        or (
          m.home_team_code is not null
          and m.away_team_code is not null
        )
      )
  );
$$;


ALTER FUNCTION "public"."fn_match_editable"("p_match_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_match_editable"("p_match_id" "uuid") IS 'Devuelve true si el partido admite predicciones: antes del kickoff exacto y, para eliminatorias, con equipos reales resueltos. No controla edición admin de resultados.';



CREATE OR REPLACE FUNCTION "public"."fn_match_round_ordinal"("p_matchday" integer, "p_stage" "text") RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case
    when p_stage = 'group' or (p_matchday is not null and p_stage is null)
      then p_matchday
    when p_stage = 'round-32'    then 4
    when p_stage = 'round-16'    then 5
    when p_stage = 'quarter'     then 6
    when p_stage = 'semi'        then 7
    when p_stage = 'third-place' then 8
    when p_stage = 'final'       then 8
    else null
  end;
$$;


ALTER FUNCTION "public"."fn_match_round_ordinal"("p_matchday" integer, "p_stage" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_match_round_ordinal"("p_matchday" integer, "p_stage" "text") IS 'Ordinal secuencial de la ronda de un partido (J1=1..Final=8) a partir de matchday/stage. Base de la distancia entre jornadas para el multiplicador.';



CREATE OR REPLACE FUNCTION "public"."fn_match_unlocked"("p_match_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.matches m
    where m.id = p_match_id
      and (now() >= m.match_time or m.status != 'scheduled')
  );
$$;


ALTER FUNCTION "public"."fn_match_unlocked"("p_match_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_match_unlocked"("p_match_id" "uuid") IS 'Devuelve true si el partido ya comenzó o pasó de la hora de inicio, permitiendo lectura pública de las predicciones.';



CREATE OR REPLACE FUNCTION "public"."fn_postpone_match_and_predictions"("p_match_id" "uuid", "p_status" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  -- 1. Actualizar el estado del partido
  -- Esto disparará tr_resolve_challenges_on_match_status_change para cancelar
  -- desafíos activos/pendientes y reembolsar el escrow en el ledger.
  update public.matches
  set status = p_status,
      updated_at = now()
  where id = p_match_id;

  -- 2. Anular todas las predicciones del partido (puntos = 0.00, evaluated_at = now())
  -- Se anulan todas, incluso las previamente evaluadas, por consistencia ante posposición.
  update public.predictions
  set points_earned = 0.00,
      evaluated_at = now()
  where match_id = p_match_id;
end;
$$;


ALTER FUNCTION "public"."fn_postpone_match_and_predictions"("p_match_id" "uuid", "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_prediction_multiplier"("p_matchday" integer, "p_stage" "text") RETURNS numeric
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_target   int := public.fn_match_round_ordinal(p_matchday, p_stage);
  v_current  int;
  v_distance int;
begin
  -- Jornada 1 (línea base) o ronda desconocida → 1.00x.
  if v_target is null or v_target <= 1 then
    return 1.00;
  end if;

  -- Referencia = jornada en curso, con piso en 1 (la J1 es la base aunque el
  -- torneo no haya empezado). distancia = jornadas por delante de la referencia.
  v_current  := greatest(public.fn_current_round_ordinal(), 1);
  v_distance := greatest(0, v_target - v_current);

  -- Lineal +0.25 por jornada de distancia, tope 2.50x.
  return least(2.50, 1.00 + 0.25 * v_distance)::numeric(3, 2);
end;
$$;


ALTER FUNCTION "public"."fn_prediction_multiplier"("p_matchday" integer, "p_stage" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_prediction_multiplier"("p_matchday" integer, "p_stage" "text") IS 'Multiplicador por distancia (en jornadas) entre la ronda del partido y la jornada en curso (referencia con piso en 1). Jornada 1 = 1.00x. Lineal +0.25/jornada, tope 2.50x.';



CREATE OR REPLACE FUNCTION "public"."fn_promote_member_to_admin"("p_league_id" "uuid", "p_user_id" "uuid") RETURNS "public"."league_members"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."fn_promote_member_to_admin"("p_league_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_promote_member_to_admin"("p_league_id" "uuid", "p_user_id" "uuid") IS 'Promueve a un miembro existente a admin de la liga. SECURITY DEFINER + admin-gating: solo un admin de esa liga puede invocarla.';



CREATE OR REPLACE FUNCTION "public"."fn_remove_member"("p_league_id" "uuid", "p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."fn_remove_member"("p_league_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_remove_member"("p_league_id" "uuid", "p_user_id" "uuid") IS 'Expulsa a un miembro de la liga (admin-only). Bloquea auto-expulsión y quedarse sin admin. El AFTER DELETE trigger hace la limpieza en cascada de predicciones (y duelos/escrow en Epic 5).';



CREATE OR REPLACE FUNCTION "public"."fn_resolve_challenges_on_match_status_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_pred         record;
  v_challenge    record;
  v_winners      uuid[];
  v_winner_id    uuid;
  v_max_score    numeric(12, 2);
  v_winner_count int;
  v_part_count   int;
  v_total_pot    numeric(12, 2);
  v_payout       numeric(12, 2);
  v_reversal     record;
begin
  -- 1. Cuando el partido está o pasa a 'finished'
  if new.status = 'finished' then
    if new.home_score is not null and new.away_score is not null then
      
      -- (a) Accrual continuo y corrección de predicciones normales de liga (ordenados por user_id para evitar deadlocks)
      for v_pred in 
        select id, league_id, user_id, home_score_pred, away_score_pred, multiplier, points_earned, evaluated_at
        from public.predictions
        where match_id = new.id
        order by user_id
      loop
        declare
          v_points numeric(12, 2);
          v_delta  numeric(12, 2);
        begin
          v_points := public.score_prediction(
            v_pred.home_score_pred, v_pred.away_score_pred,
            new.home_score, new.away_score,
            v_pred.multiplier
          );
          
          if v_pred.evaluated_at is null then
            v_delta := v_points;
          else
            v_delta := v_points - coalesce(v_pred.points_earned, 0.00);
          end if;
          
          -- Si hay cambio de puntos, o si nunca se había evaluado, actualizamos la predicción.
          if v_pred.evaluated_at is null or v_delta <> 0.00 then
            update public.predictions
            set points_earned = v_points, evaluated_at = now(), updated_at = now()
            where id = v_pred.id;
          end if;
          
          -- Solo aplicamos transacciones y balances si el delta es distinto de cero.
          if v_delta <> 0.00 then
            -- Bloquear la fila de league_members para evitar carreras de actualización concurrente
            perform 1 from public.league_members
            where league_id = v_pred.league_id and user_id = v_pred.user_id
            for update;

            update public.league_members
            set wager_balance = wager_balance + v_delta
            where league_id = v_pred.league_id and user_id = v_pred.user_id;
            
            insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
            values (v_pred.user_id, v_pred.league_id, v_delta, 
                    case when v_pred.evaluated_at is null then 'match_accrual' else 'match_accrual_correction' end,
                    new.id);
          end if;
        end;
      end loop;

      -- (b) Revertir y re-resolver desafíos completados si el marcador cambió
      if TG_OP = 'UPDATE' and (old.home_score is distinct from new.home_score or old.away_score is distinct from new.away_score) then
        for v_challenge in
          select id, league_id, points_bet
          from public.challenges
          where match_id = new.id
            and status = 'completed'
        loop
          -- Revertir transacciones previas de payout o refund
          for v_reversal in
            select user_id, amount
            from public.point_transactions
            where reference_id = v_challenge.id
              and description in ('challenge_payout', 'challenge_escrow_refund')
          loop
            -- Lock league_members before update
            perform 1 from public.league_members
            where league_id = v_challenge.league_id and user_id = v_reversal.user_id
            for update;

            update public.league_members
            set wager_balance = wager_balance - v_reversal.amount
            where league_id = v_challenge.league_id and user_id = v_reversal.user_id;

            insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
            values (v_reversal.user_id, v_challenge.league_id, -v_reversal.amount, 'challenge_payout_reversal', v_challenge.id);
          end loop;

          update public.challenges
          set status = 'active'
          where id = v_challenge.id;
        end loop;
      end if;

      -- (c) Liquidación de retos activos (incluyendo los que acabamos de revertir a 'active')
      for v_challenge in
        select id, league_id, points_bet
        from public.challenges
        where match_id = new.id
          and status = 'active'
      loop
        -- Puntuación máxima del desafío (base, multiplier = 1.00)
        select max(public.score_prediction(cp.prediction_home, cp.prediction_away, new.home_score, new.away_score, 1.00))
        into v_max_score
        from public.challenge_participants cp
        where cp.challenge_id = v_challenge.id;

        if v_max_score is null or v_max_score = 0.00 then
          perform public.refund_challenge_escrow(v_challenge.id);
          update public.challenges
          set status = 'completed', winner_ids = '{}'::uuid[]
          where id = v_challenge.id;
        else
          select array_agg(cp.user_id order by cp.user_id)
          into v_winners
          from public.challenge_participants cp
          where cp.challenge_id = v_challenge.id
            and public.score_prediction(cp.prediction_home, cp.prediction_away, new.home_score, new.away_score, 1.00) = v_max_score;

          v_winner_count := cardinality(v_winners);

          select coalesce(-sum(amount), 0)
          into v_total_pot
          from public.point_transactions
          where reference_id = v_challenge.id
            and description not in ('challenge_payout', 'challenge_escrow_refund', 'challenge_payout_reversal');

          declare
            v_base      numeric(12,2) := trunc(v_total_pot / v_winner_count::numeric, 2);
            v_remainder numeric(12,2) := v_total_pot - (trunc(v_total_pot / v_winner_count::numeric, 2) * v_winner_count);
            v_i         int := 0;
          begin
            perform 1 from public.league_members
            where league_id = v_challenge.league_id and user_id = any(v_winners)
            order by user_id for update;

            foreach v_winner_id in array v_winners loop
              v_payout := v_base + case when v_i = 0 then v_remainder else 0 end;
              update public.league_members
              set wager_balance = wager_balance + v_payout
              where league_id = v_challenge.league_id and user_id = v_winner_id;

              insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
              values (v_winner_id, v_challenge.league_id, v_payout, 'challenge_payout', v_challenge.id);
              v_i := v_i + 1;
            end loop;
          end;

          update public.challenges
          set status = 'completed', winner_ids = v_winners
          where id = v_challenge.id;
        end if;
      end loop;
      
    end if;

  -- 2. Cuando el partido se cancela o suspende oficialmente desde un estado previo distinto
  elsif new.status in ('canceled', 'suspended') and old.status is distinct from new.status then
    -- (a) Revertir predicciones normales de liga que ya habían sido evaluadas
    if old.status = 'finished' then
      for v_pred in
        select id, league_id, user_id, points_earned
        from public.predictions
        where match_id = new.id
          and evaluated_at is not null
        order by user_id
      loop
        if coalesce(v_pred.points_earned, 0.00) > 0.00 then
          perform 1 from public.league_members
          where league_id = v_pred.league_id and user_id = v_pred.user_id
          for update;

          update public.league_members
          set wager_balance = wager_balance - v_pred.points_earned
          where league_id = v_pred.league_id and user_id = v_pred.user_id;

          insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
          values (v_pred.user_id, v_pred.league_id, -v_pred.points_earned, 'match_accrual_reversal', new.id);
        end if;
      end loop;
    end if;

    -- Anular/actualizar todas las predicciones del partido a 0 puntos y evaluado_at = now()
    update public.predictions
    set points_earned = 0.00,
        evaluated_at = now(),
        updated_at = now()
    where match_id = new.id;

    -- (b) Revertir y reembolsar desafíos
    for v_challenge in
      update public.challenges
      set status = 'canceled'
      where match_id = new.id
        and status in ('pending', 'active')
      returning id
    loop
      perform public.refund_challenge_escrow(v_challenge.id);
    end loop;

    if old.status = 'finished' then
      for v_challenge in
        select id, league_id
        from public.challenges
        where match_id = new.id
          and status = 'completed'
      loop
        for v_reversal in
          select user_id, amount
          from public.point_transactions
          where reference_id = v_challenge.id
            and description in ('challenge_payout', 'challenge_escrow_refund')
        loop
          perform 1 from public.league_members
          where league_id = v_challenge.league_id and user_id = v_reversal.user_id
          for update;

          update public.league_members
          set wager_balance = wager_balance - v_reversal.amount
          where league_id = v_challenge.league_id and user_id = v_reversal.user_id;

          insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
          values (v_reversal.user_id, v_challenge.league_id, -v_reversal.amount, 'challenge_payout_reversal', v_challenge.id);
        end loop;

        perform public.refund_challenge_escrow(v_challenge.id);

        update public.challenges
        set status = 'canceled'
        where id = v_challenge.id;
      end loop;
    end if;

  -- 3. Si el partido revierte de finished a scheduled o live
  elsif new.status in ('scheduled', 'live') and old.status = 'finished' then
    -- (a) Revertir predicciones normales de liga que ya habían sido evaluadas
    for v_pred in
      select id, league_id, user_id, points_earned
      from public.predictions
      where match_id = new.id
        and evaluated_at is not null
      order by user_id
    loop
      if coalesce(v_pred.points_earned, 0.00) > 0.00 then
        perform 1 from public.league_members
        where league_id = v_pred.league_id and user_id = v_pred.user_id
        for update;

        update public.league_members
        set wager_balance = wager_balance - v_pred.points_earned
        where league_id = v_pred.league_id and user_id = v_pred.user_id;

        insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
        values (v_pred.user_id, v_pred.league_id, -v_pred.points_earned, 'match_accrual_reversal', new.id);
      end if;
    end loop;

    -- Poner las predicciones como no evaluadas
    update public.predictions
    set points_earned = null,
        evaluated_at = null,
        updated_at = now()
    where match_id = new.id;

    -- (b) Revertir desafíos
    for v_challenge in
      select id, league_id
      from public.challenges
      where match_id = new.id
        and status = 'completed'
    loop
      for v_reversal in
        select user_id, amount
        from public.point_transactions
        where reference_id = v_challenge.id
          and description in ('challenge_payout', 'challenge_escrow_refund')
      loop
        perform 1 from public.league_members
        where league_id = v_challenge.league_id and user_id = v_reversal.user_id
        for update;

        update public.league_members
        set wager_balance = wager_balance - v_reversal.amount
        where league_id = v_challenge.league_id and user_id = v_reversal.user_id;

        insert into public.point_transactions (user_id, league_id, amount, description, reference_id)
        values (v_reversal.user_id, v_challenge.league_id, -v_reversal.amount, 'challenge_payout_reversal', v_challenge.id);
      end loop;

      update public.challenges
      set status = 'active', winner_ids = null
      where id = v_challenge.id;
    end loop;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."fn_resolve_challenges_on_match_status_change"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."predictions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "match_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "home_score_pred" integer NOT NULL,
    "away_score_pred" integer NOT NULL,
    "multiplier" numeric(3,2) DEFAULT 1.00 NOT NULL,
    "points_earned" numeric(6,2),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "evaluated_at" timestamp with time zone,
    "prev_home_score_pred" integer,
    "prev_away_score_pred" integer,
    "prev_multiplier" numeric(3,2),
    "prev_saved_at" timestamp with time zone,
    CONSTRAINT "predictions_away_score_pred_check" CHECK (("away_score_pred" >= 0)),
    CONSTRAINT "predictions_home_score_pred_check" CHECK (("home_score_pred" >= 0)),
    CONSTRAINT "predictions_multiplier_check" CHECK (("multiplier" >= 1.00)),
    CONSTRAINT "predictions_score_max" CHECK ((("home_score_pred" <= 99) AND ("away_score_pred" <= 99)))
);


ALTER TABLE "public"."predictions" OWNER TO "postgres";


COMMENT ON TABLE "public"."predictions" IS 'Pronóstico de un usuario para un partido dentro de una liga. unique(league_id,user_id,match_id) evita duplicados. RLS hace time-gating de lectura.';



COMMENT ON COLUMN "public"."predictions"."prev_saved_at" IS 'Hora en que el marcador actual reemplazó al anterior. Base de la ventana de gracia para deshacer (fn_revert_prediction).';



CREATE OR REPLACE FUNCTION "public"."fn_revert_prediction"("p_league_id" "uuid", "p_match_id" "uuid") RETURNS "public"."predictions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid    uuid := (select auth.uid());
  v_window constant interval := interval '2 minutes';
  v_row    public.predictions;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  if not public.fn_user_in_league(p_league_id) then
    raise exception 'No eres miembro de la liga' using errcode = '42501';
  end if;

  -- No se puede deshacer tras el kickoff (mismo candado que el guardado).
  if not public.fn_match_editable(p_match_id) then
    raise exception 'Pronostico cerrado' using errcode = 'P0001';
  end if;

  select * into v_row
  from public.predictions
  where league_id = p_league_id
    and user_id = v_uid
    and match_id = p_match_id;

  if v_row.id is null then
    raise exception 'Prediccion inexistente' using errcode = 'P0002';
  end if;

  -- Solo un cambio dentro de la ventana de gracia es reversible.
  if v_row.prev_saved_at is null
     or now() - v_row.prev_saved_at > v_window then
    raise exception 'Ventana de deshacer expirada' using errcode = 'P0003';
  end if;

  update public.predictions set
    home_score_pred      = v_row.prev_home_score_pred,
    away_score_pred      = v_row.prev_away_score_pred,
    multiplier           = v_row.prev_multiplier,
    prev_home_score_pred = null,
    prev_away_score_pred = null,
    prev_multiplier      = null,
    prev_saved_at        = null
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."fn_revert_prediction"("p_league_id" "uuid", "p_match_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_revert_prediction"("p_league_id" "uuid", "p_match_id" "uuid") IS 'Deshace el último cambio de marcador del usuario restaurando el estado previo (marcador + multiplicador) si está dentro de la ventana de gracia de 2 minutos. El multiplicador restaurado es el stasheado por el servidor (no manipulable). Un solo nivel de undo.';



CREATE OR REPLACE FUNCTION "public"."fn_save_prediction"("p_league_id" "uuid", "p_match_id" "uuid", "p_home_score_pred" integer, "p_away_score_pred" integer) RETURNS "public"."predictions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid        uuid := (select auth.uid());
  v_match_time timestamptz;
  v_matchday   int;
  v_stage      text;
  v_multiplier numeric(3, 2);
  v_row        public.predictions;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  if not public.fn_user_in_league(p_league_id) then
    raise exception 'No eres miembro de la liga' using errcode = '42501';
  end if;

  if p_home_score_pred is null or p_away_score_pred is null
     or p_home_score_pred < 0 or p_away_score_pred < 0 then
    raise exception 'Marcador invalido' using errcode = '23514';
  end if;

  select m.match_time, m.matchday, m.stage
    into v_match_time, v_matchday, v_stage
  from public.matches m
  where m.id = p_match_id;
  if v_match_time is null then
    raise exception 'Partido inexistente' using errcode = 'P0002';
  end if;

  if not public.fn_match_editable(p_match_id) then
    raise exception 'Pronostico cerrado' using errcode = 'P0001';
  end if;

  -- Multiplicador por distancia de jornadas (server-authoritative).
  v_multiplier := public.fn_prediction_multiplier(v_matchday, v_stage);

  insert into public.predictions (
    league_id, match_id, user_id, home_score_pred, away_score_pred, multiplier
  ) values (
    p_league_id, p_match_id, v_uid, p_home_score_pred, p_away_score_pred, v_multiplier
  )
  on conflict (league_id, user_id, match_id) do update
    set prev_home_score_pred = case
          when predictions.home_score_pred is distinct from excluded.home_score_pred
            or predictions.away_score_pred is distinct from excluded.away_score_pred
          then predictions.home_score_pred
          else predictions.prev_home_score_pred
        end,
        prev_away_score_pred = case
          when predictions.home_score_pred is distinct from excluded.home_score_pred
            or predictions.away_score_pred is distinct from excluded.away_score_pred
          then predictions.away_score_pred
          else predictions.prev_away_score_pred
        end,
        prev_multiplier = case
          when predictions.home_score_pred is distinct from excluded.home_score_pred
            or predictions.away_score_pred is distinct from excluded.away_score_pred
          then predictions.multiplier
          else predictions.prev_multiplier
        end,
        prev_saved_at = case
          when predictions.home_score_pred is distinct from excluded.home_score_pred
            or predictions.away_score_pred is distinct from excluded.away_score_pred
          then now()
          else predictions.prev_saved_at
        end,
        home_score_pred = excluded.home_score_pred,
        away_score_pred = excluded.away_score_pred,
        multiplier      = excluded.multiplier
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."fn_save_prediction"("p_league_id" "uuid", "p_match_id" "uuid", "p_home_score_pred" integer, "p_away_score_pred" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_save_prediction"("p_league_id" "uuid", "p_match_id" "uuid", "p_home_score_pred" integer, "p_away_score_pred" integer) IS 'Guarda (crea/actualiza) la predicción validando usuario, pertenencia, scores y kickoff. Multiplier por distancia de jornadas (fn_prediction_multiplier(matchday, stage)). Al cambiar el marcador stashea prev_* para deshacer.';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "display_name" "text" DEFAULT 'Jugador Anónimo'::"text" NOT NULL,
    "avatar_url" "text" DEFAULT '/assets/avatars/default-player.svg'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "active_league_id" "uuid"
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."profiles" IS 'Perfil público de cada usuario; espeja auth.users vía trigger.';



COMMENT ON COLUMN "public"."profiles"."active_league_id" IS 'Liga activa elegida por el usuario para pantallas multi-liga. Debe pertenecer al usuario.';



CREATE OR REPLACE FUNCTION "public"."fn_set_active_league"("p_league_id" "uuid") RETURNS "public"."profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."fn_set_active_league"("p_league_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_set_active_league"("p_league_id" "uuid") IS 'Cambia la liga activa del usuario autenticado, validando membresía.';



CREATE OR REPLACE FUNCTION "public"."fn_set_member_payment_status"("p_league_id" "uuid", "p_user_id" "uuid", "p_status" "text") RETURNS "public"."league_members"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."fn_set_member_payment_status"("p_league_id" "uuid", "p_user_id" "uuid", "p_status" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_set_member_payment_status"("p_league_id" "uuid", "p_user_id" "uuid", "p_status" "text") IS 'Fija el payment_status (pending/paid) de un miembro. SECURITY DEFINER + admin-gating: solo un admin de esa liga puede invocarla (league_members no tiene política RLS de update).';



CREATE OR REPLACE FUNCTION "public"."fn_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  -- now() vive en pg_catalog (siempre en el search_path implícito), así que
  -- funciona con search_path=''. Se fija para silenciar el lint de Supabase
  -- function_search_path_mutable y alinear con el resto de funciones del proyecto.
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_sync_tournament_phases_from_matches"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_inaugural_kickoff timestamptz;
  v_knockout_kickoff timestamptz;
  v_semifinal_kickoff timestamptz;
  v_matches_exist boolean;
begin
  -- La función es robusta a que `matches` aún no exista (orden de migraciones).
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'matches'
  ) into v_matches_exist;

  if not v_matches_exist then
    return;
  end if;

  -- Hitos del calendario real (columna `match_time`, vocabulario de stage de Epic-7).
  select min(match_time) into v_inaugural_kickoff from public.matches;
  select min(match_time) into v_knockout_kickoff  from public.matches where stage is distinct from 'group';
  select min(match_time) into v_semifinal_kickoff from public.matches where stage = 'semi';

  -- Fase A → B: partido inaugural.
  if v_inaugural_kickoff is not null then
    update public.tournament_phases set ends_at   = v_inaugural_kickoff where phase_code = 'A';
    update public.tournament_phases set starts_at = v_inaugural_kickoff where phase_code = 'B';
  end if;

  -- Fase B → C: inicio de eliminatorias (primer partido que no es de grupos).
  if v_knockout_kickoff is not null then
    update public.tournament_phases set ends_at   = v_knockout_kickoff where phase_code = 'B';
    update public.tournament_phases set starts_at = v_knockout_kickoff where phase_code = 'C';
  end if;

  -- Fase C → D: inicio de semifinales (cierre de edición).
  if v_semifinal_kickoff is not null then
    update public.tournament_phases set ends_at   = v_semifinal_kickoff where phase_code = 'C';
    update public.tournament_phases set starts_at = v_semifinal_kickoff where phase_code = 'D';
  end if;
end;
$$;


ALTER FUNCTION "public"."fn_sync_tournament_phases_from_matches"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_sync_tournament_phases_from_matches"() IS 'Sincroniza tournament_phases (starts_at/ends_at) desde los hitos del calendario en matches (match_time, stage de Epic-7). Corrige el desfase del seed hardcodeado de Epic-6.';



CREATE OR REPLACE FUNCTION "public"."fn_touch_special_prediction"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if TG_OP = 'INSERT' then
    new.predicted_at = now();
  elseif TG_OP = 'UPDATE' then
    if new.candidate_id is distinct from old.candidate_id then
      new.predicted_at = now();
    else
      -- Si el candidato no cambia, no permitimos al cliente manipular la fecha
      new.predicted_at = old.predicted_at;
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_touch_special_prediction"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_touch_special_prediction"() IS 'Refresca o fuerza special_predictions.predicted_at a now() en inserts o cambios de candidato, impidiendo manipulación del cliente. Base del cálculo de fase de Story 6.2.';



CREATE OR REPLACE FUNCTION "public"."fn_touch_system_config"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_touch_system_config"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_touch_system_config"() IS 'Actualiza automáticamente updated_at a la hora actual del servidor en modificaciones de configuración.';



CREATE OR REPLACE FUNCTION "public"."fn_user_in_league"("p_league_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = (select auth.uid())
  );
$$;


ALTER FUNCTION "public"."fn_user_in_league"("p_league_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_user_in_league"("p_league_id" "uuid") IS 'Devuelve true si el usuario actual pertenece a la liga. SECURITY DEFINER para evitar recursión de RLS.';



CREATE OR REPLACE FUNCTION "public"."fn_user_is_any_league_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.league_members lm
    where lm.user_id = (select auth.uid())
      and lm.role = 'admin'
  );
$$;


ALTER FUNCTION "public"."fn_user_is_any_league_admin"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_user_is_any_league_admin"() IS 'Devuelve true si el usuario actual es admin de AL MENOS una liga. SECURITY DEFINER para evitar recursión de RLS sobre league_members. Gate de la edición de resultados (matches es catálogo global).';



CREATE OR REPLACE FUNCTION "public"."fn_user_is_league_admin"("p_league_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = (select auth.uid())
      and lm.role = 'admin'
  );
$$;


ALTER FUNCTION "public"."fn_user_is_league_admin"("p_league_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_user_is_league_admin"("p_league_id" "uuid") IS 'Devuelve true si el usuario actual es admin de la liga. SECURITY DEFINER para evitar recursión de RLS sobre league_members.';



CREATE OR REPLACE FUNCTION "public"."refund_challenge_escrow"("p_challenge_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  r record;
  v_league_id uuid;
begin
  select league_id into v_league_id from public.challenges where id = p_challenge_id;
  
  -- Bloquear las filas de league_members en orden consistente (por user_id) para evitar deadlocks
  perform 1
  from public.league_members
  where league_id = v_league_id
    and user_id in (
      select user_id
      from public.point_transactions
      where reference_id = p_challenge_id
      group by user_id
      having -sum(amount) > 0
    )
  order by user_id
  for update;

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


ALTER FUNCTION "public"."refund_challenge_escrow"("p_challenge_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."refund_challenge_escrow"("p_challenge_id" "uuid") IS 'Reembolsa los montos retenidos en escrow de un desafío de forma atómica e idempotente.';



CREATE OR REPLACE FUNCTION "public"."reject_challenge"("p_challenge_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

  if v_challenge.type <> 'direct' or v_challenge.challenged_id is null or v_challenge.challenged_id <> v_uid then
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


ALTER FUNCTION "public"."reject_challenge"("p_challenge_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reject_challenge"("p_challenge_id" "uuid") IS 'Rechaza un desafío 1v1 directo pendiente y devuelve el escrow depositado por el creador.';



CREATE OR REPLACE FUNCTION "public"."score_prediction"("p_home_pred" integer, "p_away_pred" integer, "p_home_score" integer, "p_away_score" integer, "p_multiplier" numeric) RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    AS $$
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


ALTER FUNCTION "public"."score_prediction"("p_home_pred" integer, "p_away_pred" integer, "p_home_score" integer, "p_away_score" integer, "p_multiplier" numeric) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."score_prediction"("p_home_pred" integer, "p_away_pred" integer, "p_home_score" integer, "p_away_score" integer, "p_multiplier" numeric) IS 'Calcula la puntuación obtenida por una predicción. Espejo exacto de src/utils/scoring.ts.';



CREATE TABLE IF NOT EXISTS "public"."award_candidates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category" "text" NOT NULL,
    "name" "text" NOT NULL,
    "team_name" "text",
    "flag_code" "text",
    "image_url" "text",
    "display_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_winner" boolean DEFAULT false NOT NULL,
    CONSTRAINT "award_candidates_category_check" CHECK (("category" = ANY (ARRAY['champion'::"text", 'top_scorer'::"text", 'mvp'::"text"])))
);


ALTER TABLE "public"."award_candidates" OWNER TO "postgres";


COMMENT ON TABLE "public"."award_candidates" IS 'Catálogo de candidatos a los galardones del Mundial (Campeón/Goleador/MVP). Solo lectura para usuarios; lo carga el admin de plataforma. La puntuación se calcula en Story 6.2.';



COMMENT ON COLUMN "public"."award_candidates"."is_winner" IS 'Indica si el candidato es el ganador oficial de la categoría.';



CREATE TABLE IF NOT EXISTS "public"."challenge_participants" (
    "challenge_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "prediction_home" integer NOT NULL,
    "prediction_away" integer NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "challenge_participants_prediction_away_check" CHECK (("prediction_away" >= 0)),
    CONSTRAINT "challenge_participants_prediction_home_check" CHECK (("prediction_home" >= 0))
);


ALTER TABLE "public"."challenge_participants" OWNER TO "postgres";


COMMENT ON TABLE "public"."challenge_participants" IS 'Participantes en un desafío y sus predicciones de marcador.';



CREATE TABLE IF NOT EXISTS "public"."challenges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "match_id" "uuid" NOT NULL,
    "creator_id" "uuid" NOT NULL,
    "points_bet" integer NOT NULL,
    "type" "text" NOT NULL,
    "challenged_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "winner_ids" "uuid"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "challenges_points_bet_check" CHECK (("points_bet" > 0)),
    CONSTRAINT "challenges_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'completed'::"text", 'canceled'::"text"]))),
    CONSTRAINT "challenges_type_check" CHECK (("type" = ANY (ARRAY['direct'::"text", 'open'::"text"])))
);


ALTER TABLE "public"."challenges" OWNER TO "postgres";


COMMENT ON TABLE "public"."challenges" IS 'Desafíos / duelos de apuestas entre usuarios de una liga.';



CREATE TABLE IF NOT EXISTS "public"."member_badges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "matchday" integer NOT NULL,
    "badge_type" "text" NOT NULL,
    "badge_label" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "points" numeric(6,2) DEFAULT 0 NOT NULL,
    "earned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "member_badges_badge_type_check" CHECK (("badge_type" = ANY (ARRAY['nostradamus'::"text", 'el_salado'::"text", 'el_tibio'::"text"]))),
    CONSTRAINT "member_badges_matchday_check" CHECK (("matchday" > 0))
);


ALTER TABLE "public"."member_badges" OWNER TO "postgres";


COMMENT ON TABLE "public"."member_badges" IS 'Historial de insignias humorísticas por liga, usuario y jornada. Story 3.2.';



CREATE TABLE IF NOT EXISTS "public"."member_game_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "matchday" integer NOT NULL,
    "profile_type" "text" NOT NULL,
    "profile_label" "text" NOT NULL,
    "summary" "text" NOT NULL,
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "member_game_profiles_matchday_check" CHECK (("matchday" > 0)),
    CONSTRAINT "member_game_profiles_profile_type_check" CHECK (("profile_type" = ANY (ARRAY['optimista'::"text", 'conservador'::"text", 'cazador_sorpresas'::"text"])))
);


ALTER TABLE "public"."member_game_profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."member_game_profiles" IS 'Perfil psicológico de juego por liga, usuario y jornada. Story 3.2.';



CREATE TABLE IF NOT EXISTS "public"."point_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "league_id" "uuid" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "description" "text" NOT NULL,
    "reference_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_point_transactions_refund_rollback_test" CHECK (("amount" <> 888.00)),
    CONSTRAINT "chk_point_transactions_rollback_test" CHECK (("amount" <> '-999.00'::numeric))
);


ALTER TABLE "public"."point_transactions" OWNER TO "postgres";


COMMENT ON TABLE "public"."point_transactions" IS 'Ledger de movimientos de puntos de duelos por usuario en cada liga.';



CREATE TABLE IF NOT EXISTS "public"."special_predictions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "league_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "candidate_id" "uuid" NOT NULL,
    "predicted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "special_predictions_category_check" CHECK (("category" = ANY (ARRAY['champion'::"text", 'top_scorer'::"text", 'mvp'::"text"])))
);


ALTER TABLE "public"."special_predictions" OWNER TO "postgres";


COMMENT ON TABLE "public"."special_predictions" IS 'Predicción de premios (Campeón/Goleador/MVP) de un usuario EN UNA LIGA. predicted_at es server-side y se refresca al cambiar de candidato (trigger). La puntuación se calcula en Story 6.2.';



CREATE OR REPLACE VIEW "public"."special_predictions_with_points" WITH ("security_invoker"='true') AS
 SELECT "sp"."id",
    "sp"."user_id",
    "sp"."league_id",
    "sp"."category",
    "sp"."candidate_id",
    "sp"."predicted_at",
    "sp"."created_at",
    COALESCE(("ac"."is_winner" = true), false) AS "is_correct",
        CASE
            WHEN ("ac"."is_winner" = true) THEN COALESCE(( SELECT "tp"."reward_points"
               FROM "public"."tournament_phases" "tp"
              WHERE ((("tp"."starts_at" IS NULL) OR ("sp"."predicted_at" >= "tp"."starts_at")) AND (("tp"."ends_at" IS NULL) OR ("sp"."predicted_at" < "tp"."ends_at")))
              ORDER BY "tp"."sort_order"
             LIMIT 1), 0)
            ELSE 0
        END AS "points"
   FROM ("public"."special_predictions" "sp"
     LEFT JOIN "public"."award_candidates" "ac" ON ((("sp"."candidate_id" = "ac"."id") AND ("sp"."category" = "ac"."category"))));


ALTER VIEW "public"."special_predictions_with_points" OWNER TO "postgres";


COMMENT ON VIEW "public"."special_predictions_with_points" IS 'Vista dinámica de puntos de predicciones especiales. Usa LEFT JOIN para mantener visibles los registros huérfanos; Fase D bloquea edición pero conserva su recompensa de 2 pts.';



CREATE TABLE IF NOT EXISTS "public"."system_config" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL,
    "description" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."system_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "iso_alpha2" "text",
    "fifa_code" "text" NOT NULL,
    "flag_url" "text",
    "group_label" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "teams_group_label_check" CHECK ((("group_label" IS NULL) OR ("group_label" = ANY (ARRAY['A'::"text", 'B'::"text", 'C'::"text", 'D'::"text", 'E'::"text", 'F'::"text", 'G'::"text", 'H'::"text", 'I'::"text", 'J'::"text", 'K'::"text", 'L'::"text"]))))
);


ALTER TABLE "public"."teams" OWNER TO "postgres";


COMMENT ON TABLE "public"."teams" IS 'Catálogo de los 48 equipos del Mundial 2026 sembrado desde la API de Zafronix. Sirve como referencia de normalización y banderas.';



COMMENT ON COLUMN "public"."teams"."name" IS 'Nombre canónico del equipo según la API de Zafronix (ej: South Korea, Czechia).';



COMMENT ON COLUMN "public"."teams"."iso_alpha2" IS 'Código ISO-3166-1 alpha-2 para banderas (ej: mx, kr, cz).';



COMMENT ON COLUMN "public"."teams"."fifa_code" IS 'Código FIFA de 3 letras (ej: MEX, KOR, CZE). Coincide con matches.home_team_code.';



COMMENT ON COLUMN "public"."teams"."flag_url" IS 'URL directa a la bandera PNG desde flagcdn.com.';



COMMENT ON COLUMN "public"."teams"."group_label" IS 'Grupo FIFA 2026 A-L. Null si el equipo no está en fase de grupos.';



ALTER TABLE ONLY "public"."award_candidates"
    ADD CONSTRAINT "award_candidates_id_category_key" UNIQUE ("id", "category");



ALTER TABLE ONLY "public"."award_candidates"
    ADD CONSTRAINT "award_candidates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."challenge_participants"
    ADD CONSTRAINT "challenge_participants_pkey" PRIMARY KEY ("challenge_id", "user_id");



ALTER TABLE ONLY "public"."challenges"
    ADD CONSTRAINT "challenges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."league_members"
    ADD CONSTRAINT "league_members_league_id_user_id_key" UNIQUE ("league_id", "user_id");



ALTER TABLE ONLY "public"."league_members"
    ADD CONSTRAINT "league_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leagues"
    ADD CONSTRAINT "leagues_invite_code_key" UNIQUE ("invite_code");



ALTER TABLE ONLY "public"."leagues"
    ADD CONSTRAINT "leagues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_external_ref_key" UNIQUE ("external_ref");



ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."member_badges"
    ADD CONSTRAINT "member_badges_league_id_user_id_matchday_badge_type_key" UNIQUE ("league_id", "user_id", "matchday", "badge_type");



ALTER TABLE ONLY "public"."member_badges"
    ADD CONSTRAINT "member_badges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."member_game_profiles"
    ADD CONSTRAINT "member_game_profiles_league_id_user_id_matchday_key" UNIQUE ("league_id", "user_id", "matchday");



ALTER TABLE ONLY "public"."member_game_profiles"
    ADD CONSTRAINT "member_game_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."point_transactions"
    ADD CONSTRAINT "point_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."predictions"
    ADD CONSTRAINT "predictions_league_id_user_id_match_id_key" UNIQUE ("league_id", "user_id", "match_id");



ALTER TABLE ONLY "public"."predictions"
    ADD CONSTRAINT "predictions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."special_predictions"
    ADD CONSTRAINT "special_predictions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."special_predictions"
    ADD CONSTRAINT "special_predictions_user_id_league_id_category_key" UNIQUE ("user_id", "league_id", "category");



ALTER TABLE ONLY "public"."system_config"
    ADD CONSTRAINT "system_config_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_fifa_code_key" UNIQUE ("fifa_code");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tournament_phases"
    ADD CONSTRAINT "tournament_phases_phase_code_key" UNIQUE ("phase_code");



ALTER TABLE ONLY "public"."tournament_phases"
    ADD CONSTRAINT "tournament_phases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tournament_phases"
    ADD CONSTRAINT "tournament_phases_sort_order_key" UNIQUE ("sort_order");



CREATE INDEX "idx_award_candidates_category" ON "public"."award_candidates" USING "btree" ("category");



CREATE INDEX "idx_league_members_league_id" ON "public"."league_members" USING "btree" ("league_id");



CREATE INDEX "idx_league_members_user_id" ON "public"."league_members" USING "btree" ("user_id");



CREATE INDEX "idx_leagues_created_by" ON "public"."leagues" USING "btree" ("created_by");



CREATE UNIQUE INDEX "idx_matches_bracket_slot_unique" ON "public"."matches" USING "btree" ("bracket_slot") WHERE ("bracket_slot" IS NOT NULL);



CREATE INDEX "idx_matches_match_time" ON "public"."matches" USING "btree" ("match_time");



CREATE INDEX "idx_matches_status" ON "public"."matches" USING "btree" ("status");



CREATE INDEX "idx_member_badges_league_matchday" ON "public"."member_badges" USING "btree" ("league_id", "matchday");



CREATE INDEX "idx_member_badges_league_user_matchday" ON "public"."member_badges" USING "btree" ("league_id", "user_id", "matchday" DESC);



CREATE INDEX "idx_member_game_profiles_league_user_matchday" ON "public"."member_game_profiles" USING "btree" ("league_id", "user_id", "matchday" DESC);



CREATE INDEX "idx_predictions_evaluated_at_null" ON "public"."predictions" USING "btree" ("match_id") WHERE ("evaluated_at" IS NULL);



CREATE INDEX "idx_predictions_league_id" ON "public"."predictions" USING "btree" ("league_id");



CREATE INDEX "idx_predictions_match_id" ON "public"."predictions" USING "btree" ("match_id");



CREATE INDEX "idx_predictions_user_id" ON "public"."predictions" USING "btree" ("user_id");



CREATE INDEX "idx_profiles_active_league_id" ON "public"."profiles" USING "btree" ("active_league_id");



CREATE INDEX "idx_special_predictions_league_id" ON "public"."special_predictions" USING "btree" ("league_id");



CREATE OR REPLACE TRIGGER "tr_cancel_pending_challenges_on_match_start" AFTER UPDATE OF "status" ON "public"."matches" FOR EACH ROW WHEN ((("old"."status" = 'scheduled'::"text") AND ("new"."status" IS DISTINCT FROM 'scheduled'::"text"))) EXECUTE FUNCTION "public"."fn_cancel_pending_challenges_on_match_start"();



CREATE OR REPLACE TRIGGER "tr_check_awards_locked" BEFORE INSERT OR UPDATE ON "public"."special_predictions" FOR EACH ROW EXECUTE FUNCTION "public"."fn_check_awards_locked"();



CREATE OR REPLACE TRIGGER "tr_cleanup_on_member_removed" AFTER DELETE ON "public"."league_members" FOR EACH ROW EXECUTE FUNCTION "public"."fn_cleanup_on_member_removed"();



CREATE OR REPLACE TRIGGER "tr_cleanup_predictions_on_member_leave" AFTER DELETE ON "public"."league_members" FOR EACH ROW EXECUTE FUNCTION "public"."fn_cleanup_predictions_on_member_leave"();



CREATE OR REPLACE TRIGGER "tr_resolve_challenges_on_match_status_change" AFTER UPDATE ON "public"."matches" FOR EACH ROW WHEN ((("old"."status" IS DISTINCT FROM "new"."status") OR ("old"."home_score" IS DISTINCT FROM "new"."home_score") OR ("old"."away_score" IS DISTINCT FROM "new"."away_score"))) EXECUTE FUNCTION "public"."fn_resolve_challenges_on_match_status_change"();



CREATE OR REPLACE TRIGGER "tr_set_matches_updated_at" BEFORE UPDATE ON "public"."matches" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "tr_set_predictions_updated_at" BEFORE UPDATE ON "public"."predictions" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "tr_touch_special_prediction" BEFORE INSERT OR UPDATE ON "public"."special_predictions" FOR EACH ROW EXECUTE FUNCTION "public"."fn_touch_special_prediction"();



CREATE OR REPLACE TRIGGER "tr_touch_system_config" BEFORE UPDATE ON "public"."system_config" FOR EACH ROW EXECUTE FUNCTION "public"."fn_touch_system_config"();



ALTER TABLE ONLY "public"."challenge_participants"
    ADD CONSTRAINT "challenge_participants_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."challenge_participants"
    ADD CONSTRAINT "challenge_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."challenges"
    ADD CONSTRAINT "challenges_challenged_id_fkey" FOREIGN KEY ("challenged_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."challenges"
    ADD CONSTRAINT "challenges_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."challenges"
    ADD CONSTRAINT "challenges_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."challenges"
    ADD CONSTRAINT "challenges_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."league_members"
    ADD CONSTRAINT "league_members_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."league_members"
    ADD CONSTRAINT "league_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leagues"
    ADD CONSTRAINT "leagues_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."member_badges"
    ADD CONSTRAINT "member_badges_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."member_badges"
    ADD CONSTRAINT "member_badges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."member_game_profiles"
    ADD CONSTRAINT "member_game_profiles_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."member_game_profiles"
    ADD CONSTRAINT "member_game_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."point_transactions"
    ADD CONSTRAINT "point_transactions_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."point_transactions"
    ADD CONSTRAINT "point_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."predictions"
    ADD CONSTRAINT "predictions_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."predictions"
    ADD CONSTRAINT "predictions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."predictions"
    ADD CONSTRAINT "predictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_active_league_id_fkey" FOREIGN KEY ("active_league_id") REFERENCES "public"."leagues"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."special_predictions"
    ADD CONSTRAINT "special_predictions_candidate_id_category_fkey" FOREIGN KEY ("candidate_id", "category") REFERENCES "public"."award_candidates"("id", "category") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."special_predictions"
    ADD CONSTRAINT "special_predictions_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."special_predictions"
    ADD CONSTRAINT "special_predictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



CREATE POLICY "Usuarios autenticados pueden leer equipos" ON "public"."teams" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."award_candidates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "award_candidates_select_authenticated" ON "public"."award_candidates" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."challenge_participants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."challenges" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "challenges_select_league_members" ON "public"."challenges" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."league_members"
  WHERE (("league_members"."league_id" = "challenges"."league_id") AND ("league_members"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."league_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "league_members_insert_self" ON "public"."league_members" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("role" = 'member'::"text")));



CREATE POLICY "league_members_select_same_league" ON "public"."league_members" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."fn_user_in_league"("league_id")));



ALTER TABLE "public"."leagues" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "leagues_insert_own" ON "public"."leagues" FOR INSERT TO "authenticated" WITH CHECK (("created_by" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "leagues_select_member_or_owner" ON "public"."leagues" FOR SELECT TO "authenticated" USING ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."fn_user_in_league"("id")));



CREATE POLICY "leagues_update_owner" ON "public"."leagues" FOR UPDATE TO "authenticated" USING (("created_by" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("created_by" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."matches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "matches_select_authenticated" ON "public"."matches" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."member_badges" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "member_badges_insert_own" ON "public"."member_badges" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."fn_user_in_league"("league_id")));



CREATE POLICY "member_badges_select_same_league" ON "public"."member_badges" FOR SELECT TO "authenticated" USING ("public"."fn_user_in_league"("league_id"));



CREATE POLICY "member_badges_update_own" ON "public"."member_badges" FOR UPDATE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."fn_user_in_league"("league_id"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."fn_user_in_league"("league_id")));



ALTER TABLE "public"."member_game_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "member_game_profiles_insert_own" ON "public"."member_game_profiles" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."fn_user_in_league"("league_id")));



CREATE POLICY "member_game_profiles_select_same_league" ON "public"."member_game_profiles" FOR SELECT TO "authenticated" USING ("public"."fn_user_in_league"("league_id"));



CREATE POLICY "member_game_profiles_update_own" ON "public"."member_game_profiles" FOR UPDATE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."fn_user_in_league"("league_id"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."fn_user_in_league"("league_id")));



CREATE POLICY "participants_select_gated" ON "public"."challenge_participants" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM ("public"."challenges" "c"
     JOIN "public"."league_members" "lm" ON (("c"."league_id" = "lm"."league_id")))
  WHERE (("c"."id" = "challenge_participants"."challenge_id") AND ("lm"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."fn_match_unlocked"("c"."match_id"))))));



ALTER TABLE "public"."point_transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "point_transactions_select_owner" ON "public"."point_transactions" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."predictions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "predictions_insert_own" ON "public"."predictions" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."fn_user_in_league"("league_id") AND "public"."fn_match_editable"("match_id")));



CREATE POLICY "predictions_select_gated" ON "public"."predictions" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("public"."fn_user_in_league"("league_id") AND "public"."fn_match_unlocked"("match_id"))));



CREATE POLICY "predictions_update_own" ON "public"."predictions" FOR UPDATE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."fn_match_editable"("match_id"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."fn_user_in_league"("league_id") AND "public"."fn_match_editable"("match_id")));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_authenticated" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id")) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "id") AND (("active_league_id" IS NULL) OR "public"."fn_user_in_league"("active_league_id"))));



ALTER TABLE "public"."special_predictions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "special_predictions_insert_own_in_league" ON "public"."special_predictions" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."fn_user_in_league"("league_id")));



CREATE POLICY "special_predictions_select_own" ON "public"."special_predictions" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "special_predictions_update_own_in_league" ON "public"."special_predictions" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."fn_user_in_league"("league_id")));



ALTER TABLE "public"."system_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "system_config_select_authenticated" ON "public"."system_config" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."teams" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tournament_phases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tournament_phases_select_authenticated" ON "public"."tournament_phases" FOR SELECT TO "authenticated" USING (true);





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."matches";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."accept_challenge"("p_challenge_id" "uuid", "p_prediction_home" integer, "p_prediction_away" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."accept_challenge"("p_challenge_id" "uuid", "p_prediction_home" integer, "p_prediction_away" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_challenge"("p_challenge_id" "uuid", "p_prediction_home" integer, "p_prediction_away" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."cancel_challenge"("p_challenge_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_challenge"("p_challenge_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_challenge"("p_challenge_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_conservation_invariant"("p_league_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."check_conservation_invariant"("p_league_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_conservation_invariant"("p_league_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_challenge"("p_league_id" "uuid", "p_match_id" "uuid", "p_points_bet" integer, "p_type" "text", "p_challenged_id" "uuid", "p_prediction_home" integer, "p_prediction_away" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."create_challenge"("p_league_id" "uuid", "p_match_id" "uuid", "p_points_bet" integer, "p_type" "text", "p_challenged_id" "uuid", "p_prediction_home" integer, "p_prediction_away" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_challenge"("p_league_id" "uuid", "p_match_id" "uuid", "p_points_bet" integer, "p_type" "text", "p_challenged_id" "uuid", "p_prediction_home" integer, "p_prediction_away" integer) TO "service_role";



GRANT ALL ON TABLE "public"."matches" TO "anon";
GRANT ALL ON TABLE "public"."matches" TO "authenticated";
GRANT ALL ON TABLE "public"."matches" TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_admin_apply_knockout_advancement"("p_slots" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_admin_apply_knockout_advancement"("p_slots" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_admin_apply_knockout_advancement"("p_slots" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_admin_set_match_result"("p_match_id" "uuid", "p_home_score" integer, "p_away_score" integer, "p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_admin_set_match_result"("p_match_id" "uuid", "p_home_score" integer, "p_away_score" integer, "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_admin_set_match_result"("p_match_id" "uuid", "p_home_score" integer, "p_away_score" integer, "p_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_apply_accrual_correction"("p_prediction_id" "uuid", "p_new_points" numeric, "p_match_id" "uuid", "p_match_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_apply_accrual_correction"("p_prediction_id" "uuid", "p_new_points" numeric, "p_match_id" "uuid", "p_match_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_apply_accrual_correction"("p_prediction_id" "uuid", "p_new_points" numeric, "p_match_id" "uuid", "p_match_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_are_special_predictions_locked"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_are_special_predictions_locked"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_are_special_predictions_locked"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_cancel_pending_challenges_on_match_start"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_cancel_pending_challenges_on_match_start"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_cancel_pending_challenges_on_match_start"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_check_awards_locked"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_check_awards_locked"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_check_awards_locked"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_cleanup_on_member_removed"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_cleanup_on_member_removed"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_cleanup_on_member_removed"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_cleanup_predictions_on_member_leave"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_cleanup_predictions_on_member_leave"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_cleanup_predictions_on_member_leave"() TO "service_role";



GRANT ALL ON TABLE "public"."leagues" TO "anon";
GRANT ALL ON TABLE "public"."leagues" TO "authenticated";
GRANT ALL ON TABLE "public"."leagues" TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_create_league"("p_name" "text", "p_invite_code" "text", "p_prediction_mode" "text", "p_requires_payment" boolean, "p_payment_amount" numeric, "p_payment_instructions" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_create_league"("p_name" "text", "p_invite_code" "text", "p_prediction_mode" "text", "p_requires_payment" boolean, "p_payment_amount" numeric, "p_payment_instructions" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_create_league"("p_name" "text", "p_invite_code" "text", "p_prediction_mode" "text", "p_requires_payment" boolean, "p_payment_amount" numeric, "p_payment_instructions" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_current_round_ordinal"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_current_round_ordinal"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_current_round_ordinal"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_ensure_default_predictions"("p_league_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_ensure_default_predictions"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_ensure_default_predictions"("p_league_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."tournament_phases" TO "anon";
GRANT ALL ON TABLE "public"."tournament_phases" TO "authenticated";
GRANT ALL ON TABLE "public"."tournament_phases" TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_get_active_tournament_phase"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_get_active_tournament_phase"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_get_active_tournament_phase"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_get_challenge_landing"("p_challenge_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_get_challenge_landing"("p_challenge_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_get_challenge_landing"("p_challenge_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_get_invite_landing"("p_invite_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_get_invite_landing"("p_invite_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_get_invite_landing"("p_invite_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_handle_new_user"() TO "service_role";



GRANT ALL ON TABLE "public"."league_members" TO "anon";
GRANT ALL ON TABLE "public"."league_members" TO "authenticated";
GRANT ALL ON TABLE "public"."league_members" TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_join_league_by_invite"("p_invite_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_join_league_by_invite"("p_invite_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_join_league_by_invite"("p_invite_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_leave_league"("p_league_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_leave_league"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_leave_league"("p_league_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_match_editable"("p_match_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_match_editable"("p_match_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_match_editable"("p_match_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_match_round_ordinal"("p_matchday" integer, "p_stage" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_match_round_ordinal"("p_matchday" integer, "p_stage" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_match_round_ordinal"("p_matchday" integer, "p_stage" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_match_unlocked"("p_match_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_match_unlocked"("p_match_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_match_unlocked"("p_match_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_postpone_match_and_predictions"("p_match_id" "uuid", "p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_postpone_match_and_predictions"("p_match_id" "uuid", "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_postpone_match_and_predictions"("p_match_id" "uuid", "p_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_prediction_multiplier"("p_matchday" integer, "p_stage" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_prediction_multiplier"("p_matchday" integer, "p_stage" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_prediction_multiplier"("p_matchday" integer, "p_stage" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_promote_member_to_admin"("p_league_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_promote_member_to_admin"("p_league_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_promote_member_to_admin"("p_league_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_remove_member"("p_league_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_remove_member"("p_league_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_remove_member"("p_league_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_resolve_challenges_on_match_status_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_resolve_challenges_on_match_status_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_resolve_challenges_on_match_status_change"() TO "service_role";



GRANT ALL ON TABLE "public"."predictions" TO "anon";
GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."predictions" TO "authenticated";
GRANT ALL ON TABLE "public"."predictions" TO "service_role";



GRANT INSERT("league_id") ON TABLE "public"."predictions" TO "authenticated";



GRANT INSERT("match_id") ON TABLE "public"."predictions" TO "authenticated";



GRANT INSERT("user_id") ON TABLE "public"."predictions" TO "authenticated";



GRANT INSERT("home_score_pred"),UPDATE("home_score_pred") ON TABLE "public"."predictions" TO "authenticated";



GRANT INSERT("away_score_pred"),UPDATE("away_score_pred") ON TABLE "public"."predictions" TO "authenticated";



GRANT ALL ON FUNCTION "public"."fn_revert_prediction"("p_league_id" "uuid", "p_match_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_revert_prediction"("p_league_id" "uuid", "p_match_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_revert_prediction"("p_league_id" "uuid", "p_match_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_save_prediction"("p_league_id" "uuid", "p_match_id" "uuid", "p_home_score_pred" integer, "p_away_score_pred" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_save_prediction"("p_league_id" "uuid", "p_match_id" "uuid", "p_home_score_pred" integer, "p_away_score_pred" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_save_prediction"("p_league_id" "uuid", "p_match_id" "uuid", "p_home_score_pred" integer, "p_away_score_pred" integer) TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("display_name") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("avatar_url") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON FUNCTION "public"."fn_set_active_league"("p_league_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_set_active_league"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_set_active_league"("p_league_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_set_member_payment_status"("p_league_id" "uuid", "p_user_id" "uuid", "p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_set_member_payment_status"("p_league_id" "uuid", "p_user_id" "uuid", "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_set_member_payment_status"("p_league_id" "uuid", "p_user_id" "uuid", "p_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_sync_tournament_phases_from_matches"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_sync_tournament_phases_from_matches"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_sync_tournament_phases_from_matches"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_touch_special_prediction"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_touch_special_prediction"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_touch_special_prediction"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_touch_system_config"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_touch_system_config"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_touch_system_config"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_user_in_league"("p_league_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_user_in_league"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_user_in_league"("p_league_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_user_is_any_league_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_user_is_any_league_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_user_is_any_league_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_user_is_league_admin"("p_league_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_user_is_league_admin"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_user_is_league_admin"("p_league_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."refund_challenge_escrow"("p_challenge_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."refund_challenge_escrow"("p_challenge_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."refund_challenge_escrow"("p_challenge_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."reject_challenge"("p_challenge_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."reject_challenge"("p_challenge_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_challenge"("p_challenge_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."score_prediction"("p_home_pred" integer, "p_away_pred" integer, "p_home_score" integer, "p_away_score" integer, "p_multiplier" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."score_prediction"("p_home_pred" integer, "p_away_pred" integer, "p_home_score" integer, "p_away_score" integer, "p_multiplier" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."score_prediction"("p_home_pred" integer, "p_away_pred" integer, "p_home_score" integer, "p_away_score" integer, "p_multiplier" numeric) TO "service_role";


















GRANT ALL ON TABLE "public"."award_candidates" TO "anon";
GRANT ALL ON TABLE "public"."award_candidates" TO "authenticated";
GRANT ALL ON TABLE "public"."award_candidates" TO "service_role";



GRANT ALL ON TABLE "public"."challenge_participants" TO "anon";
GRANT ALL ON TABLE "public"."challenge_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."challenge_participants" TO "service_role";



GRANT ALL ON TABLE "public"."challenges" TO "anon";
GRANT ALL ON TABLE "public"."challenges" TO "authenticated";
GRANT ALL ON TABLE "public"."challenges" TO "service_role";



GRANT ALL ON TABLE "public"."member_badges" TO "service_role";
GRANT SELECT ON TABLE "public"."member_badges" TO "anon";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."member_badges" TO "authenticated";



GRANT ALL ON TABLE "public"."member_game_profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."member_game_profiles" TO "anon";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."member_game_profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."point_transactions" TO "anon";
GRANT ALL ON TABLE "public"."point_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."point_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."special_predictions" TO "anon";
GRANT ALL ON TABLE "public"."special_predictions" TO "authenticated";
GRANT ALL ON TABLE "public"."special_predictions" TO "service_role";



GRANT ALL ON TABLE "public"."special_predictions_with_points" TO "anon";
GRANT ALL ON TABLE "public"."special_predictions_with_points" TO "authenticated";
GRANT ALL ON TABLE "public"."special_predictions_with_points" TO "service_role";



GRANT ALL ON TABLE "public"."system_config" TO "anon";
GRANT ALL ON TABLE "public"."system_config" TO "authenticated";
GRANT ALL ON TABLE "public"."system_config" TO "service_role";



GRANT ALL ON TABLE "public"."teams" TO "anon";
GRANT ALL ON TABLE "public"."teams" TO "authenticated";
GRANT ALL ON TABLE "public"."teams" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
































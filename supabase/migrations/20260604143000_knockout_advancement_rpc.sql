-- Migracion: knockout_advancement_rpc
-- Story 7.3: aplica equipos resueltos del motor puro al bracket knockout.
--
-- Seguridad: public.matches no tiene politica UPDATE. Esta funcion SECURITY
-- DEFINER reutiliza el gate global de admin de Story 7.2 y solo permite mutar
-- participantes de partidos knockout; nunca toca resultados, estado, fuentes,
-- horarios ni sedes.

create or replace function public.fn_admin_apply_knockout_advancement(
  p_slots jsonb
) returns setof public.matches
language plpgsql
security definer
set search_path = ''
as $$
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
       and external_ref = format('wc2026:ko:%s', v_slot.bracket_slot)
    returning * into v_match;

    if v_match.id is null then
      raise exception 'Partido knockout no encontrado' using errcode = 'P0002';
    end if;

    return next v_match;
  end loop;

  return;
end;
$$;

comment on function public.fn_admin_apply_knockout_advancement(jsonb) is
  'Aplica participantes resueltos del bracket FIFA 2026 a public.matches. SECURITY DEFINER + admin global; actualiza solo equipos/códigos de slots knockout 73-104 y preserva resultados/estado/fuentes/horarios.';

revoke execute on function public.fn_admin_apply_knockout_advancement(jsonb) from public;
revoke execute on function public.fn_admin_apply_knockout_advancement(jsonb) from anon;
grant execute on function public.fn_admin_apply_knockout_advancement(jsonb) to authenticated;

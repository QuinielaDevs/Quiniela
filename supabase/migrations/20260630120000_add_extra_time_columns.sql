-- Migración: add_extra_time_columns
-- Agrega columnas extra_time_home_score y extra_time_away_score a public.matches,
-- y actualiza la función RPC fn_admin_set_match_result para soportarlas.

-- 1. Agregar columnas a matches
alter table public.matches
  add column if not exists extra_time_home_score int check (extra_time_home_score >= 0),
  add column if not exists extra_time_away_score int check (extra_time_away_score >= 0);

comment on column public.matches.extra_time_home_score is 'Goles anotados tras prórroga (120 minutos) por el equipo local. Nullable.';
comment on column public.matches.extra_time_away_score is 'Goles anotados tras prórroga (120 minutos) por el equipo visitante. Nullable.';

-- 2. Eliminar la firma anterior de fn_admin_set_match_result (con 6 parámetros)
drop function if exists public.fn_admin_set_match_result(uuid, int, int, text, int, int);

-- 3. Redefinir fn_admin_set_match_result con los nuevos parámetros de prórroga y penales
create or replace function public.fn_admin_set_match_result(
  p_match_id uuid,
  p_home_score int,
  p_away_score int,
  p_status text,
  p_penalties_home_score int default null,
  p_penalties_away_score int default null,
  p_extra_time_home_score int default null,
  p_extra_time_away_score int default null
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
  v_pen_home int;
  v_pen_away int;
  v_ext_home int;
  v_ext_away int;
begin
  -- (a) Sesión.
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  -- (b) Admin de alguna liga (matches es global).
  if not public.fn_user_is_any_league_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  -- Cargar y bloquear la fila del partido
  select * into v_match from public.matches m where m.id = p_match_id for update;
  if v_match.id is null then
    raise exception 'Partido no encontrado' using errcode = 'P0002';
  end if;

  -- Estado destino dentro del set permitido (espeja el CHECK de la tabla).
  if p_status not in ('scheduled', 'live', 'finished', 'suspended', 'canceled') then
    raise exception 'Estado de partido inválido' using errcode = '22023';
  end if;

  -- Transición de estado válida
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

  -- Bloquear knockout TBD sin equipos
  if v_match.bracket_slot is not null
     and (v_match.home_team_code is null or v_match.away_team_code is null)
     and p_status in ('live', 'finished') then
    raise exception 'No se puede capturar el resultado de un partido sin equipos definidos' using errcode = '22023';
  end if;

  -- Regla marcador↔estado
  if p_status in ('live', 'finished') then
    if p_home_score is null or p_away_score is null then
      raise exception 'El marcador es obligatorio para un partido en vivo o finalizado' using errcode = '22023';
    end if;
    if p_home_score < 0 or p_away_score < 0 then
      raise exception 'El marcador no puede ser negativo' using errcode = '22023';
    end if;

    -- Validaciones para tanda de penales y prórroga en partidos knockout
    v_pen_home := null;
    v_pen_away := null;
    v_ext_home := null;
    v_ext_away := null;

    if v_match.bracket_slot is not null and p_status = 'finished' then
      if p_home_score = p_away_score then
        -- Caso 1: Se especifica prórroga
        if p_extra_time_home_score is not null or p_extra_time_away_score is not null then
          if p_extra_time_home_score is null or p_extra_time_away_score is null then
            raise exception 'Ambos marcadores de prórroga son requeridos si se especifica prórroga' using errcode = '22023';
          end if;
          if p_extra_time_home_score < 0 or p_extra_time_away_score < 0 then
            raise exception 'Los goles de prórroga no pueden ser negativos' using errcode = '22023';
          end if;
          v_ext_home := p_extra_time_home_score;
          v_ext_away := p_extra_time_away_score;
        end if;

        -- Caso 2: Se especifican penales
        if p_penalties_home_score is not null or p_penalties_away_score is not null then
          if p_penalties_home_score is null or p_penalties_away_score is null then
            raise exception 'Ambos marcadores de penales son requeridos si se especifica tanda de penales' using errcode = '22023';
          end if;
          if p_penalties_home_score < 0 or p_penalties_away_score < 0 then
            raise exception 'Los goles de penales no pueden ser negativos' using errcode = '22023';
          end if;
          if p_penalties_home_score = p_penalties_away_score then
            raise exception 'La tanda de penales no puede terminar en empate' using errcode = '22023';
          end if;
          v_pen_home := p_penalties_home_score;
          v_pen_away := p_penalties_away_score;
        end if;

        -- Validar resolución del ganador
        if v_ext_home is not null and v_ext_away is not null then
          if v_ext_home = v_ext_away then
            -- Prórroga en empate -> Obligatorio penales
            if v_pen_home is null or v_pen_away is null then
              raise exception 'Un partido knockout con prórroga empatada necesita registrar la tanda de penales para desempatar' using errcode = '22023';
            end if;
          else
            -- Decidido en prórroga -> No debe haber penales
            if v_pen_home is not null or v_pen_away is not null then
              raise exception 'Un partido knockout decidido en prórroga no debe tener tanda de penales' using errcode = '22023';
            end if;
          end if;
        else
          -- Sin prórroga -> Obligatorio penales para desempatar
          if v_pen_home is null or v_pen_away is null then
            raise exception 'Un partido knockout finalizado en empate necesita prórroga o tanda de penales para desempatar' using errcode = '22023';
          end if;
        end if;
      else
        -- Si no hay empate reglamentario, ignoramos prórroga y penales
        v_ext_home := null;
        v_ext_away := null;
        v_pen_home := null;
        v_pen_away := null;
      end if;
    end if;

    v_home := p_home_score;
    v_away := p_away_score;
  else
    -- scheduled / suspended / canceled
    if (p_home_score is not null and p_home_score < 0)
       or (p_away_score is not null and p_away_score < 0) then
      raise exception 'El marcador no puede ser negativo' using errcode = '22023';
    end if;
    v_home := null;
    v_away := null;
    v_pen_home := null;
    v_pen_away := null;
    v_ext_home := null;
    v_ext_away := null;
  end if;

  update public.matches
     set home_score = v_home,
         away_score = v_away,
         status = p_status,
         penalties_home_score = v_pen_home,
         penalties_away_score = v_pen_away,
         extra_time_home_score = v_ext_home,
         extra_time_away_score = v_ext_away,
         updated_at = now()
   where id = p_match_id
  returning * into v_match;

  return v_match;
end;
$$;

comment on function public.fn_admin_set_match_result(uuid, int, int, text, int, int, int, int) is
  'Fija home_score/away_score/status/penalties/extra_time de un partido (admin global). Permite empates en eliminatorias si se provee prórroga o tanda de penales válida.';

grant execute on function public.fn_admin_set_match_result(uuid, int, int, text, int, int, int, int) to authenticated;

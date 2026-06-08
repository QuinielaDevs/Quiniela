-- Migración: league_header_word
-- Añade una "primera palabra" configurable por liga para el encabezado de la app.
-- El encabezado se compone como «{header_word} Quiniela»: la segunda palabra
-- ("Quiniela") es marca fija del producto; la primera la elige el admin al crear
-- la liga (por defecto 'PIJA', que conserva el branding histórico sin migración
-- de datos). Solo se fija al crear: no hay edición posterior (igual que el resto
-- de reglas de la liga).

alter table public.leagues
  add column header_word text not null default 'PIJA'
    check (char_length(trim(header_word)) between 1 and 20);

-- Añadir p_header_word a fn_create_league. Como agregar un parámetro cambia la
-- firma de la función, hay que dropear la firma anterior (6 args) antes de
-- recrearla; create or replace por sí solo crearía una sobrecarga ambigua.
drop function if exists public.fn_create_league(text, text, text, boolean, numeric, text);

create or replace function public.fn_create_league(
  p_name text,
  p_invite_code text,
  p_prediction_mode text,
  p_requires_payment boolean default false,
  p_payment_amount numeric default null,
  p_payment_instructions text default null,
  p_header_word text default 'PIJA'
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

  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'El nombre de la liga es obligatorio.' using errcode = '22023';
  end if;

  if p_prediction_mode is null or p_prediction_mode not in ('dual', 'jornada', 'grupos') then
    raise exception 'Modo de predicción inválido.' using errcode = '22023';
  end if;

  if coalesce(p_payment_amount, 0) < 0 then
    raise exception 'El monto de pago no puede ser negativo.' using errcode = '22023';
  end if;

  if coalesce(p_requires_payment, false) and p_payment_amount is null then
    raise exception 'Una liga con pago requerido necesita un monto.' using errcode = '22023';
  end if;

  insert into public.leagues
    (name, created_by, invite_code, requires_payment, payment_amount, payment_instructions, header_word, rules)
  values
    (trim(p_name), v_uid, p_invite_code, coalesce(p_requires_payment, false),
     p_payment_amount, p_payment_instructions,
     trim(coalesce(nullif(trim(p_header_word), ''), 'PIJA')),
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

grant execute on function public.fn_create_league(text, text, text, boolean, numeric, text, text) to authenticated;

-- Migración: add_create_league_fn
-- Función transaccional de creación de liga (Story 1.3 — AC #3, #4).
--
-- ¿Por qué un RPC y no dos inserts desde el cliente?
--   1) Atomicidad (AC #3): crear la liga + insertar al creador como miembro
--      debe ser todo-o-nada; una función plpgsql corre en una sola transacción.
--   2) RLS (heredado de 1.2): la política `league_members_insert_self` exige
--      `role = 'member'`, por lo que el cliente autenticado NO puede insertarse
--      como 'admin'. SECURITY DEFINER baja al rol propietario (postgres) para
--      escribir `role = 'admin'`, mientras `auth.uid()` ata la liga al llamante
--      real. `set search_path = ''` es obligatorio en funciones SECURITY DEFINER
--      (evita secuestro de search_path); por eso todo va fully-qualified.

-- Los parámetros de pago llevan DEFAULT (al final, como exige Postgres) para que
-- el llamante pueda omitirlos cuando la liga no requiere pago; así los tipos
-- generados los marcan opcionales y la Server Action no necesita pasar null.
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
  -- Sin sesión no hay creador posible. errcode 42501 = insufficient_privilege,
  -- coherente con cómo el resto del esquema señala "no autorizado".
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

  -- El creador nace como 'admin'. payment_status 'pending' espeja FR-5
  -- ("los nuevos entran como Pendiente"); ajustar a 'paid' si producto lo pide.
  insert into public.league_members (league_id, user_id, role, payment_status)
  values (v_league.id, v_uid, 'admin', 'pending');

  return v_league;
end;
$$;

comment on function public.fn_create_league(text, text, text, boolean, numeric, text) is
  'Crea una liga y registra al creador como miembro admin de forma atómica. SECURITY DEFINER para sortear la RLS que impide auto-asignar role=admin.';

-- Solo usuarios autenticados pueden invocarla (anon queda fuera).
grant execute on function public.fn_create_league(text, text, text, boolean, numeric, text) to authenticated;

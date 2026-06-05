-- Migración: hardening_pass
-- Pase de endurecimiento que cierra deuda técnica diferida (deferred-work.md)
-- acumulada en code-reviews de Stories 1.2, 1.3 y 2.4. Forward-only: no muta
-- migraciones ya desplegadas. Todo fully-qualified; funciones DEFINER con
-- search_path = '' consistente con el resto del esquema.

-- ============================================================
-- 1) PII: profiles.email ya NO es legible por el cliente.
--    (Diferido de 1.2: `profiles_select_authenticated using (true)` exponía
--    el email a cualquier autenticado.) RLS gatea FILAS, no COLUMNAS, así que
--    la protección va por privilegios de columna (mismo patrón que predictions
--    y challenge_participants). Supabase concede SELECT a nivel de TABLA a
--    `authenticated`; se revoca y se reconcede SOLO sobre las columnas públicas.
--    `email` queda accesible únicamente para service_role y funciones DEFINER.
--    Verificado: ningún consumidor lee `profiles.email` (el email de sesión se
--    obtiene de auth.users vía supabase.auth, no de esta tabla).
-- ============================================================
revoke select on public.profiles from authenticated;
grant select (id, display_name, avatar_url, created_at)
  on public.profiles to authenticated;

-- ============================================================
-- 2) leagues.payment_amount: integridad a nivel de BD.
--    (Diferido de 1.2/1.3.) No puede ser negativo. La coherencia
--    requires_payment ⇒ payment_amount NOT NULL se valida en fn_create_league
--    (punto 4) para no romper datos existentes con un CHECK de tabla rígido.
-- ============================================================
alter table public.leagues
  add constraint leagues_payment_amount_nonneg
  check (payment_amount is null or payment_amount >= 0);

-- ============================================================
-- 3) predictions: tope superior de marcador (MAX 99).
--    (Diferido de 2.4: el tope MAX_PREDICTION_SCORE=99 vivía solo en cliente/zod;
--    una llamada directa a la RPC podía guardar un marcador enorme.) Refuerza el
--    `>= 0` ya existente con un techo. Enforcement a nivel de tabla (la RPC
--    fn_save_prediction hereda el CHECK; una violación abusiva surge como 23514).
-- ============================================================
alter table public.predictions
  add constraint predictions_score_max
  check (home_score_pred <= 99 and away_score_pred <= 99);

-- ============================================================
-- 4) fn_create_league: validación a nivel de BD.
--    (Diferido de 1.3: cualquier `authenticated` puede invocar el RPC directo
--    por PostgREST y saltarse la validación zod de la Server Action.) Se añaden
--    guardas dentro de la función. Cuerpo idéntico al desplegado + validaciones.
-- ============================================================
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

  -- Validaciones de dominio (espejo de la validación zod de la Server Action,
  -- ahora enforced también para llamadas directas al RPC).
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'El nombre de la liga es obligatorio.' using errcode = '22023';
  end if;

  if p_prediction_mode is null or p_prediction_mode not in ('dual', 'jornada', 'grupos') then
    raise exception 'Modo de predicción inválido.' using errcode = '22023';
  end if;

  if coalesce(p_payment_amount, 0) < 0 then
    raise exception 'El monto de pago no puede ser negativo.' using errcode = '22023';
  end if;

  -- Coherencia: si la liga requiere pago, el monto es obligatorio.
  if coalesce(p_requires_payment, false) and p_payment_amount is null then
    raise exception 'Una liga con pago requerido necesita un monto.' using errcode = '22023';
  end if;

  insert into public.leagues
    (name, created_by, invite_code, requires_payment, payment_amount, payment_instructions, rules)
  values
    (trim(p_name), v_uid, p_invite_code, coalesce(p_requires_payment, false),
     p_payment_amount, p_payment_instructions,
     jsonb_build_object('predictionMode', p_prediction_mode))
  returning * into v_league;

  insert into public.league_members (league_id, user_id, role, payment_status)
  values (v_league.id, v_uid, 'admin', 'pending');

  return v_league;
end;
$$;

comment on function public.fn_create_league(text, text, text, boolean, numeric, text) is
  'Crea una liga y registra al creador como miembro admin de forma atómica. SECURITY DEFINER + validación de dominio (nombre, modo, monto) enforced también para llamadas directas al RPC.';

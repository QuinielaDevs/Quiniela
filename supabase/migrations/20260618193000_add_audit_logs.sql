-- Migración: add_audit_logs
-- Crea la tabla maestra de auditoría (audit_logs), los triggers automáticos para las
-- tablas críticas y la función de purga de espacio para Supabase Free Tier.

-- 1. Crear la tabla de logs
create table if not exists public.audit_logs (
  id          bigserial primary key,
  table_name  text not null,
  action      text not null,
  record_id   text not null,
  old_data    jsonb,
  new_data    jsonb,
  changed_by  uuid, -- UUID del usuario/actor que realizó el cambio (sin FK para resistir borrados e identidades de sistema)
  created_at  timestamptz not null default now()
);

-- 2. Índices de soporte para consultas rápidas de depuración
create index if not exists idx_audit_logs_table_record on public.audit_logs (table_name, record_id);
create index if not exists idx_audit_logs_created_at on public.audit_logs (created_at);

-- 3. Habilitar RLS (Seguridad en la capa de datos)
alter table public.audit_logs enable row level security;

-- Solo lectura para administradores / service_role. 
-- El cliente autenticado común no tiene ninguna política de SELECT, INSERT, UPDATE o DELETE.
-- Esto protege completamente la tabla contra filtraciones.
revoke all on public.audit_logs from authenticated, anon;
grant select on public.audit_logs to service_role;

-- 4. Función trigger genérica
create or replace function public.fn_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  -- Intentamos obtener el UUID de la sesión de Supabase.
  -- Si ocurre un error o no hay sesión activa, se captura y guarda como null.
  begin
    v_user_id := (select auth.uid());
  exception when others then
    v_user_id := null;
  end;

  insert into public.audit_logs (
    table_name,
    action,
    record_id,
    old_data,
    new_data,
    changed_by
  ) values (
    TG_TABLE_NAME,
    TG_OP,
    coalesce(new.id, old.id)::text,
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    v_user_id
  );
  
  return coalesce(new, old);
end;
$$;

-- 5. Vincular triggers a las tablas críticas
-- Nota: Usamos triggers 'AFTER' para auditar solo si la transacción en la tabla principal tuvo éxito.

drop trigger if exists tr_audit_predictions on public.predictions;
create trigger tr_audit_predictions
  after insert or update or delete on public.predictions
  for each row execute function public.fn_audit_trigger();

drop trigger if exists tr_audit_special_predictions on public.special_predictions;
create trigger tr_audit_special_predictions
  after insert or update or delete on public.special_predictions
  for each row execute function public.fn_audit_trigger();

drop trigger if exists tr_audit_challenges on public.challenges;
create trigger tr_audit_challenges
  after insert or update or delete on public.challenges
  for each row execute function public.fn_audit_trigger();

drop trigger if exists tr_audit_point_transactions on public.point_transactions;
create trigger tr_audit_point_transactions
  after insert or update or delete on public.point_transactions
  for each row execute function public.fn_audit_trigger();

-- 6. Función de purga/limpieza automática para ahorrar espacio (Supabase Free Tier)
create or replace function public.fn_purge_old_audit_logs(p_days_to_keep int default 30)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_count int;
begin
  delete from public.audit_logs
  where created_at < now() - (p_days_to_keep || ' days')::interval;
  
  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;

comment on function public.fn_purge_old_audit_logs(int) is
  'Elimina logs de auditoría más antiguos que N días para evitar consumir almacenamiento excesivo en la capa gratuita de Supabase.';

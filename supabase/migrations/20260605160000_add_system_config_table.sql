-- Migración: add_system_config_table
-- Crea la tabla public.system_config para configuraciones del sistema (como ETags de la API de Zafronix).
-- RLS habilitado: cualquier usuario autenticado puede leer, pero la escritura se reserva para el rol de servicio (cron/backend).

create table public.system_config (
    key text primary key,
    value text not null,
    description text,
    updated_at timestamp with time zone default now() not null
);

-- ============================================================
-- 1) Habilitar RLS (denegar todo por defecto)
-- ============================================================
alter table public.system_config enable row level security;

-- ============================================================
-- 2) Políticas de Seguridad
--    * select: cualquier usuario autenticado puede leer las configuraciones.
--    * write (insert/update/delete): denegado para clientes normales. Solo
--      se permite al service_role (que se salta el RLS de forma automática).
-- ============================================================
create policy "system_config_select_authenticated"
  on public.system_config for select
  to authenticated
  using (true);

-- ============================================================
-- 3) Trigger para actualizar el campo updated_at
-- ============================================================
create or replace function public.fn_touch_system_config()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.fn_touch_system_config() is
  'Actualiza automáticamente updated_at a la hora actual del servidor en modificaciones de configuración.';

create trigger tr_touch_system_config
  before update on public.system_config
  for each row execute function public.fn_touch_system_config();

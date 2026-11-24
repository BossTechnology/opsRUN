-- OPR-1 · Salud de la base de opsRUN.
--
-- La página de inicio la usa para mostrar que la app llega a su Supabase y qué
-- migración tiene aplicada. El deploy de staging y producción la usará como
-- prueba de humo.
--
-- Solo la ejecuta el servidor de Next (service_role). anon y authenticated no:
-- la versión del esquema no es asunto del navegador.

create function public.opsrun_health()
returns table (status text, schema_version text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    'ok'::text,
    (select max(m.version) from supabase_migrations.schema_migrations as m)::text;
$$;

comment on function public.opsrun_health() is
  'Salud de la base: status ok y la última migración aplicada. Solo service_role.';

revoke execute on function public.opsrun_health() from public, anon, authenticated;
grant execute on function public.opsrun_health() to service_role;

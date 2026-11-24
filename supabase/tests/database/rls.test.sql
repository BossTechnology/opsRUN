-- Guard: toda tabla de opsRUN a la que llegan anon o authenticated tiene RLS.
--
-- Descubre en vez de enumerar:
-- - Las tablas salen de information_schema.tables.
-- - "De opsRUN" = su dueño es el rol que aplica las migraciones (el mismo que
--   corre este test). Así quedan fuera pg_catalog, information_schema y todo lo
--   que crea Supabase (auth, storage, realtime, supabase_functions…), sin
--   listar esquemas, y entra cualquier esquema nuevo que cree una migración.
-- - "Llegan" = permisos reales de anon y authenticated sobre esquema y tabla.
--
-- El guard se ve fallar en cada corrida: crea una tabla sin RLS en public y
-- comprueba que la detecta, y que deja de verla al activar RLS.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

create function pg_temp.tablas_sin_rls()
returns setof text
language sql
stable
as $$
  select t.table_schema || '.' || t.table_name || ' (' || r.rol || ')'
  from information_schema.tables as t
  join pg_catalog.pg_namespace as n on n.nspname = t.table_schema
  join pg_catalog.pg_class as c on c.relnamespace = n.oid and c.relname = t.table_name
  cross join (values ('anon'), ('authenticated')) as r(rol)
  where t.table_type = 'BASE TABLE'
    and pg_catalog.pg_get_userbyid(c.relowner) = current_user
    and not c.relrowsecurity
    and has_schema_privilege(r.rol, n.oid, 'usage')
    and has_table_privilege(r.rol, c.oid, 'select, insert, update, delete')
$$;

-- 1. La comprobación real, sobre lo que dejaron las migraciones.
select is_empty(
  'select * from pg_temp.tablas_sin_rls()',
  'toda tabla de opsRUN accesible por anon o authenticated tiene RLS activo'
);

-- 2 a 4. El guard se ve fallar con una tabla de prueba sin RLS.
create table public.guard_rls_prueba (id int primary key);
grant select on public.guard_rls_prueba to anon, authenticated;

select ok(
  exists (
    select 1 from pg_temp.tablas_sin_rls() as f(tabla)
    where f.tabla = 'public.guard_rls_prueba (anon)'
  ),
  'el guard detecta una tabla de public sin RLS accesible por anon'
);
select ok(
  exists (
    select 1 from pg_temp.tablas_sin_rls() as f(tabla)
    where f.tabla = 'public.guard_rls_prueba (authenticated)'
  ),
  'el guard detecta una tabla de public sin RLS accesible por authenticated'
);

alter table public.guard_rls_prueba enable row level security;

select is_empty(
  'select * from pg_temp.tablas_sin_rls()',
  'el guard deja de verla al activar RLS'
);

select * from finish();
rollback;

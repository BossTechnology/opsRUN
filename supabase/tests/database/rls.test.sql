-- Guard: toda tabla a la que anon o authenticated pueden llegar tiene RLS activo.
--
-- Descubre las tablas desde information_schema y decide por los permisos
-- reales de cada rol, sin enumerar tablas ni esquemas. Así cubre también las
-- que lleguen después (OPR-20 en adelante) y cualquier esquema que se exponga.
begin;
create extension if not exists pgtap with schema extensions;

select plan(1);

select is_empty(
  $$
    select t.table_schema || '.' || t.table_name || ' (' || r.rol || ')'
    from information_schema.tables as t
    join pg_catalog.pg_namespace as n on n.nspname = t.table_schema
    join pg_catalog.pg_class as c on c.relnamespace = n.oid and c.relname = t.table_name
    cross join (values ('anon'), ('authenticated')) as r(rol)
    where t.table_type = 'BASE TABLE'
      and not c.relrowsecurity
      and has_schema_privilege(r.rol, n.oid, 'usage')
      and has_table_privilege(r.rol, c.oid, 'select, insert, update, delete')
  $$,
  'toda tabla accesible por anon o authenticated tiene RLS activo'
);

select * from finish();
rollback;

-- OPR-20 · Guard G10: bzzzbx_reader solo lee las vistas de writeback.
--
-- Descubre sobre todo el catálogo, no sobre una lista:
-- - relaciones (tablas, vistas, secuencias) de cualquier esquema al que llega
--   (USAGE): fuera de writeback, ningún privilegio; dentro, solo SELECT;
-- - funciones de opsRUN que puede ejecutar en un esquema al que llega;
-- - esquemas donde puede crear objetos;
-- - atributos del rol y pertenencia a otros roles (heredaría sus permisos).
-- pg_catalog e information_schema quedan fuera: son de Postgres y los lee
-- todo rol.
--
-- Se ve fallar en cada corrida: da SELECT sobre public.request y UPDATE sobre
-- una vista de writeback, y comprueba que los detecta.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

create function pg_temp.privilegios_de_mas()
returns setof text
language sql
stable
as $$
  select format('%I.%I (%s)', n.nspname, c.relname, p.priv)
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                     ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p(priv)
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
    and n.nspname not in ('pg_catalog', 'information_schema')
    and has_schema_privilege('bzzzbx_reader', n.oid, 'usage')
    and has_table_privilege('bzzzbx_reader', c.oid, p.priv)
    and not (n.nspname = 'writeback' and p.priv = 'SELECT')
  union all
  select format('%I.%I (%s)', n.nspname, c.relname, p.priv)
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  cross join (values ('USAGE'), ('SELECT'), ('UPDATE')) as p(priv)
  where c.relkind = 'S'
    and n.nspname not in ('pg_catalog', 'information_schema')
    and has_schema_privilege('bzzzbx_reader', n.oid, 'usage')
    and has_sequence_privilege('bzzzbx_reader', c.oid, p.priv)
  union all
  select format('%s (EXECUTE)', p.oid::regprocedure)
  from pg_catalog.pg_proc as p
  where pg_catalog.pg_get_userbyid(p.proowner) = current_user
    and not exists (
      select 1 from pg_catalog.pg_depend as d
      where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    )
    and has_schema_privilege('bzzzbx_reader', p.pronamespace, 'usage')
    and has_function_privilege('bzzzbx_reader', p.oid, 'execute')
  union all
  select format('%I (CREATE)', n.nspname)
  from pg_catalog.pg_namespace as n
  where has_schema_privilege('bzzzbx_reader', n.oid, 'create')
  union all
  select 'atributo ' || a.attr
  from pg_catalog.pg_roles as r
  cross join lateral (values
    ('superuser', r.rolsuper), ('createrole', r.rolcreaterole), ('createdb', r.rolcreatedb),
    ('replication', r.rolreplication), ('bypassrls', r.rolbypassrls)
  ) as a(attr, val)
  where r.rolname = 'bzzzbx_reader' and a.val
  union all
  select 'miembro de ' || m.roleid::regrole::text
  from pg_catalog.pg_auth_members as m
  where m.member = 'bzzzbx_reader'::regrole
$$;

-- 1. La comprobación real.
select is_empty('select * from pg_temp.privilegios_de_mas()',
  'G10: bzzzbx_reader no tiene privilegios fuera de writeback y dentro solo SELECT');

-- 2. Y lee todo lo que hay en writeback.
select is_empty(
  $$
    select c.relname from pg_catalog.pg_class as c
    where c.relnamespace = 'writeback'::regnamespace
      and c.relkind in ('v', 'm', 'r')
      and not has_table_privilege('bzzzbx_reader', c.oid, 'SELECT')
  $$,
  'bzzzbx_reader lee toda vista de writeback'
);
select isnt_empty(
  $$ select 1 from pg_catalog.pg_class where relnamespace = 'writeback'::regnamespace and relkind = 'v' $$,
  'writeback tiene vistas'
);

-- 3. anon y authenticated no llegan a writeback.
select is_empty(
  $$
    select r.rol from (values ('anon'), ('authenticated')) as r(rol)
    where has_schema_privilege(r.rol, 'writeback', 'usage')
  $$,
  'anon y authenticated no tienen USAGE en writeback'
);

-- 4 y 5. El guard se ve fallar.
grant select on public.request to bzzzbx_reader;
grant update on writeback.v1_request to bzzzbx_reader;

select ok(
  exists (select 1 from pg_temp.privilegios_de_mas() as f(p) where f.p = 'public.request (SELECT)'),
  'G10 se ve fallar: detecta SELECT sobre una tabla de public'
);
select ok(
  exists (select 1 from pg_temp.privilegios_de_mas() as f(p) where f.p = 'writeback.v1_request (UPDATE)'),
  'G10 se ve fallar: detecta un privilegio distinto de SELECT dentro de writeback'
);

select * from finish();
rollback;

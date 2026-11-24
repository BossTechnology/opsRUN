-- OPR-20 · Guards G5, G6 y G7: funciones.
--
-- G5: toda función security definer de opsRUN fija search_path.
-- G6: toda función security definer que authenticated puede invocar llama a
--     private.require_operator(). "Puede invocar" = tiene USAGE en el esquema
--     y EXECUTE en la función; así quedan fuera las de solo service_role (como
--     opsrun_health() de OPR-1) y los triggers.
-- G7: anon y authenticated no llegan a private: sin USAGE en el esquema y sin
--     EXECUTE en sus funciones. La única excepción es la que exige Postgres:
--     authenticated ejecuta las funciones que usa una política de RLS (la
--     política corre con los permisos de quien consulta). Se descubren en
--     pg_depend, no se listan.
--
-- Descubre: pg_proc, funciones cuyo dueño es el rol que aplica las
-- migraciones, sin las que pertenecen a una extensión.
--
-- Se ve fallar en cada corrida: crea funciones de prueba que violan cada regla
-- y comprueba que las detecta.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

create function pg_temp.funciones_opsrun()
returns table (fn oid, esquema oid)
language sql
stable
as $$
  select p.oid, p.pronamespace
  from pg_catalog.pg_proc as p
  where pg_catalog.pg_get_userbyid(p.proowner) = current_user
    and not exists (
      select 1 from pg_catalog.pg_depend as d
      where d.classid = 'pg_catalog.pg_proc'::regclass
        and d.objid = p.oid
        and d.deptype = 'e'
    )
$$;

-- G5
create function pg_temp.definer_sin_search_path()
returns setof text
language sql
stable
as $$
  select f.fn::regprocedure::text
  from pg_temp.funciones_opsrun() as f
  join pg_catalog.pg_proc as p on p.oid = f.fn
  where p.prosecdef
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) as cfg
      where cfg like 'search_path=%'
    )
$$;

-- G6
create function pg_temp.definer_sin_require_operator()
returns setof text
language sql
stable
as $$
  select f.fn::regprocedure::text
  from pg_temp.funciones_opsrun() as f
  join pg_catalog.pg_proc as p on p.oid = f.fn
  where p.prosecdef
    and has_schema_privilege('authenticated', f.esquema, 'usage')
    and has_function_privilege('authenticated', f.fn, 'execute')
    and p.prosrc !~ 'private\.require_operator\s*\('
$$;

-- G7
create function pg_temp.private_al_alcance()
returns setof text
language sql
stable
as $$
  select format('private (%s USAGE)', r.rol)
  from (values ('anon'), ('authenticated')) as r(rol)
  where has_schema_privilege(r.rol, 'private', 'usage')
  union all
  select format('%s (%s EXECUTE)', p.oid::regprocedure, r.rol)
  from pg_catalog.pg_proc as p
  cross join (values ('anon'), ('authenticated')) as r(rol)
  where p.pronamespace = 'private'::regnamespace
    and has_function_privilege(r.rol, p.oid, 'execute')
    and not (
      r.rol = 'authenticated'
      and exists (
        select 1 from pg_catalog.pg_depend as d
        where d.classid = 'pg_catalog.pg_policy'::regclass
          and d.refclassid = 'pg_catalog.pg_proc'::regclass
          and d.refobjid = p.oid
      )
    )
$$;

-- 1 a 3. La comprobación real.
select is_empty('select * from pg_temp.definer_sin_search_path()',
  'G5: toda función security definer de opsRUN fija search_path');
select is_empty('select * from pg_temp.definer_sin_require_operator()',
  'G6: toda función security definer que authenticated puede invocar llama a private.require_operator()');
select is_empty('select * from pg_temp.private_al_alcance()',
  'G7: anon y authenticated no llegan a private (salvo lo que usan las políticas de RLS)');

-- 4. La excepción de G7 existe de verdad: la usan las políticas de lectura.
select ok(
  exists (
    select 1 from pg_catalog.pg_depend as d
    where d.classid = 'pg_catalog.pg_policy'::regclass
      and d.refobjid = 'private.current_operator_id()'::regprocedure
  ),
  'las políticas de lectura dependen de private.current_operator_id()'
);

-- 5 a 11. Los guards se ven fallar.
create function public.guard_prueba_sin_search_path()
returns int language sql security definer as $$ select 1 $$;

create function public.guard_prueba_sin_operador()
returns int language sql security definer set search_path = '' as $$ select 1 $$;
grant execute on function public.guard_prueba_sin_operador() to authenticated;

create function public.guard_prueba_con_operador()
returns uuid language sql security definer set search_path = '' as $$ select private.require_operator() $$;
grant execute on function public.guard_prueba_con_operador() to authenticated;

create function private.guard_prueba_privada()
returns int language sql set search_path = '' as $$ select 1 $$;

select ok(
  exists (select 1 from pg_temp.definer_sin_search_path() as f(fn)
          where f.fn = 'guard_prueba_sin_search_path()'),
  'G5 se ve fallar: detecta una función security definer sin search_path'
);
select ok(
  exists (select 1 from pg_temp.definer_sin_require_operator() as f(fn)
          where f.fn = 'guard_prueba_sin_operador()'),
  'G6 se ve fallar: detecta una función que authenticated invoca sin require_operator()'
);
select ok(
  not exists (select 1 from pg_temp.definer_sin_require_operator() as f(fn)
              where f.fn = 'guard_prueba_con_operador()'),
  'G6 no marca una función que llama a require_operator()'
);
select ok(
  exists (select 1 from pg_temp.private_al_alcance() as f(fn)
          where f.fn = 'private.guard_prueba_privada() (anon EXECUTE)'),
  'G7 se ve fallar: detecta una función de private que nace ejecutable por PUBLIC'
);

revoke all on function private.guard_prueba_privada() from public;
grant execute on function private.guard_prueba_privada() to authenticated;
select ok(
  exists (select 1 from pg_temp.private_al_alcance() as f(fn)
          where f.fn = 'private.guard_prueba_privada() (authenticated EXECUTE)'),
  'G7 se ve fallar: detecta EXECUTE de authenticated sobre una función de private que no usa ninguna política'
);

grant usage on schema private to authenticated;
select ok(
  exists (select 1 from pg_temp.private_al_alcance() as f(fn)
          where f.fn = 'private (authenticated USAGE)'),
  'G7 se ve fallar: detecta USAGE de authenticated sobre private'
);
select ok(
  exists (select 1 from pg_temp.definer_sin_require_operator() as f(fn)
          where f.fn = 'private.current_operator_id()'),
  'G6 se ve fallar: con USAGE en private, current_operator_id() queda al alcance sin require_operator()'
);

select * from finish();
rollback;

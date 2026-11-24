-- OPR-20 · Guards G5, G6 y G7: funciones.
--
-- G5: toda función security definer de opsRUN fija search_path.
-- G6: toda función security definer que un rol de opsRUN (salvo el dueño)
--     puede invocar llama a opsrun_private.require_operator() o a
--     opsrun_private.require_system(). "Puede invocar" = tiene USAGE en el
--     esquema y EXECUTE en la función; así quedan fuera los triggers y lo
--     que solo usa el dueño.
-- G7: nadie más que el dueño alcanza opsrun_private: ningún rol (tampoco
--     opsrun_app ni PUBLIC) tiene USAGE en el esquema ni EXECUTE en sus
--     funciones. Sin excepciones: ninguna política llama a un helper (spec §6).
--
-- Descubre: pg_proc en los esquemas `opsrun` y `opsrun_*`, sin las funciones
-- de una extensión; roles en pg_roles. Quedan fuera los superusuarios y los
-- roles predefinidos pg_* como tales.
--
-- Se ve fallar en cada corrida: crea, como el dueño, funciones de prueba que
-- violan cada regla y comprueba que las detecta.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

create function pg_temp.es_de_opsrun(nombre name)
returns boolean
language sql
immutable
as $$ select nombre = 'opsrun' or nombre like 'opsrun\_%' $$;

create function pg_temp.dueno()
returns oid
language sql
stable
as $$ select n.nspowner from pg_catalog.pg_namespace as n where n.nspname = 'opsrun' $$;

create function pg_temp.funciones_opsrun()
returns table (fn oid, esquema oid, nombre text)
language sql
stable
as $$
  select p.oid, p.pronamespace, n.nspname || '.' || p.proname
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where pg_temp.es_de_opsrun(n.nspname)
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
  select f.nombre
  from pg_temp.funciones_opsrun() as f
  join pg_catalog.pg_proc as p on p.oid = f.fn
  where p.prosecdef
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) as cfg
      where cfg like 'search_path=%'
    )
$$;

-- G6
create function pg_temp.definer_sin_actor()
returns setof text
language sql
stable
as $$
  select distinct f.nombre
  from pg_temp.funciones_opsrun() as f
  join pg_catalog.pg_proc as p on p.oid = f.fn
  cross join pg_catalog.pg_roles as r
  where p.prosecdef
    and pg_temp.es_de_opsrun(r.rolname)
    and r.oid <> pg_temp.dueno()
    and has_schema_privilege(r.oid, f.esquema, 'USAGE')
    and has_function_privilege(r.oid, f.fn, 'EXECUTE')
    and p.prosrc !~ 'opsrun_private\.require_(operator|system)\s*\('
$$;

-- G7
create function pg_temp.private_al_alcance()
returns setof text
language sql
stable
as $$
  select format('opsrun_private (%s USAGE)', r.rolname)
  from pg_catalog.pg_roles as r
  where not r.rolsuper
    and r.rolname !~ '^pg_'
    and r.oid <> pg_temp.dueno()
    and has_schema_privilege(r.oid, 'opsrun_private', 'USAGE')
  union all
  select format('%s (%s EXECUTE)', f.nombre, r.rolname)
  from pg_temp.funciones_opsrun() as f
  cross join pg_catalog.pg_roles as r
  where f.esquema = 'opsrun_private'::regnamespace
    and not r.rolsuper
    and r.rolname !~ '^pg_'
    and r.oid <> pg_temp.dueno()
    and has_function_privilege(r.oid, f.fn, 'EXECUTE')
  union all
  select format('%s (PUBLIC EXECUTE)', f.nombre)
  from pg_temp.funciones_opsrun() as f
  join pg_catalog.pg_proc as p on p.oid = f.fn
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as x
  where f.esquema = 'opsrun_private'::regnamespace
    and x.grantee = 0
$$;

-- 1. El guard tiene qué mirar.
select ok(
  (select count(*) from pg_temp.funciones_opsrun() as f
   where f.esquema = 'opsrun_private'::regnamespace) >= 4,
  'G5 a G7 descubren las funciones de opsRUN'
);

-- 2 a 4. La comprobación real.
select is_empty('select * from pg_temp.definer_sin_search_path()',
  'G5: toda función security definer de opsRUN fija search_path');
select is_empty('select * from pg_temp.definer_sin_actor()',
  'G6: toda función security definer que un rol de opsRUN puede invocar valida el actor');
select is_empty('select * from pg_temp.private_al_alcance()',
  'G7: nadie más que el dueño alcanza opsrun_private');

-- 5 a 10. Los guards se ven fallar. Se rompen las reglas como el dueño.
grant opsrun_migrador to current_user with inherit false, set true;
set local role opsrun_migrador;

create function opsrun.guard_prueba_sin_search_path()
returns int language sql security definer as $$ select 1 $$;

create function opsrun.guard_prueba_sin_actor()
returns int language sql security definer set search_path = '' as $$ select 1 $$;
grant execute on function opsrun.guard_prueba_sin_actor() to opsrun_app;

create function opsrun.guard_prueba_con_actor()
returns uuid language sql security definer set search_path = '' as $$ select opsrun_private.require_operator() $$;
grant execute on function opsrun.guard_prueba_con_actor() to opsrun_app;

create function opsrun_private.guard_prueba_privada()
returns int language sql set search_path = '' as $$ select 1 $$;

reset role;

select ok(
  'opsrun.guard_prueba_sin_search_path' in (select * from pg_temp.definer_sin_search_path()),
  'G5 se ve fallar: detecta una función security definer sin search_path'
);
select ok(
  'opsrun.guard_prueba_sin_actor' in (select * from pg_temp.definer_sin_actor()),
  'G6 se ve fallar: detecta una función que opsrun_app invoca sin validar el actor'
);
select ok(
  'opsrun.guard_prueba_con_actor' not in (select * from pg_temp.definer_sin_actor()),
  'G6 no marca una función que llama a require_operator()'
);
select is_empty(
  $$select * from pg_temp.private_al_alcance() as f(t) where f.t like 'opsrun_private.guard_prueba_privada %'$$,
  'una función nueva de opsrun_private nace sin EXECUTE para nadie más que el dueño'
);

set local role opsrun_migrador;
grant execute on function opsrun_private.guard_prueba_privada() to opsrun_app;
grant usage on schema opsrun_private to opsrun_app;
reset role;

select ok(
  'opsrun_private.guard_prueba_privada (opsrun_app EXECUTE)' in (select * from pg_temp.private_al_alcance()),
  'G7 se ve fallar: detecta EXECUTE de opsrun_app sobre una función de opsrun_private'
);
select ok(
  'opsrun_private (opsrun_app USAGE)' in (select * from pg_temp.private_al_alcance()),
  'G7 se ve fallar: detecta USAGE de opsrun_app en opsrun_private'
);

select * from finish();
rollback;

-- OPR-20 · Guard G2: nadie más que el dueño escribe en los objetos de opsRUN.
--
-- Ningún rol, salvo el dueño de los esquemas de opsRUN, tiene INSERT, UPDATE,
-- DELETE ni TRUNCATE sobre tablas o vistas de opsRUN, ni USAGE o UPDATE sobre
-- sus secuencias (nextval y setval). Tampoco opsrun_app: escribe solo por
-- funciones SQL (spec §4).
--
-- Descubre: los objetos de pg_class en los esquemas `opsrun` y `opsrun_*`, y
-- cada rol de pg_roles. Quedan fuera el dueño del objeto y los
-- superusuarios, que se saltan los privilegios: para ellos están los triggers.
-- Los roles predefinidos pg_* (pg_write_all_data, por ejemplo) tampoco se
-- miran como tales: quien los tenga con herencia aparece por sí mismo.
--
-- Se ve fallar en cada corrida: da INSERT sobre opsrun.request a opsrun_app y
-- USAGE sobre la secuencia del R number a un rol ajeno de prueba, y comprueba
-- que los detecta.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

create function pg_temp.es_de_opsrun(nombre name)
returns boolean
language sql
immutable
as $$ select nombre = 'opsrun' or nombre like 'opsrun\_%' $$;

create function pg_temp.escrituras_abiertas()
returns setof text
language sql
stable
as $$
  with objetos as (
    select c.oid, c.relkind, c.relowner, n.nspname, c.relname
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where pg_temp.es_de_opsrun(n.nspname)
  ),
  roles as (
    select r.oid, r.rolname
    from pg_catalog.pg_roles as r
    where not r.rolsuper
      and r.rolname !~ '^pg_'
  )
  select format('%I.%I (%s %s)', o.nspname, o.relname, r.rolname, p.priv)
  from objetos as o
  cross join roles as r
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p(priv)
  where o.relkind in ('r', 'p', 'v', 'm', 'f')
    and r.oid <> o.relowner
    and has_table_privilege(r.oid, o.oid, p.priv)
  union all
  select format('%I.%I (%s %s)', o.nspname, o.relname, r.rolname, p.priv)
  from objetos as o
  cross join roles as r
  cross join (values ('USAGE'), ('UPDATE')) as p(priv)
  where o.relkind = 'S'
    and r.oid <> o.relowner
    and has_sequence_privilege(r.oid, o.oid, p.priv)
$$;

-- 1. El guard tiene qué mirar.
select ok(
  (select count(*) from pg_catalog.pg_class as c
   join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
   where pg_temp.es_de_opsrun(n.nspname) and c.relkind in ('r', 'S')) >= 15,
  'G2 descubre las tablas y secuencias de opsRUN'
);

-- 2. La comprobación real, sobre lo que dejaron las migraciones.
select is_empty(
  'select * from pg_temp.escrituras_abiertas()',
  'G2: ningún rol, salvo el dueño, escribe en tablas, vistas ni secuencias de opsRUN'
);

-- 3 y 4. El guard se ve fallar. Se rompe la regla como el dueño.
create role guard_escrituras_ajeno nologin;
grant opsrun_migrador to current_user with inherit false, set true;
set local role opsrun_migrador;
grant insert on opsrun.request to opsrun_app;
grant usage on sequence opsrun.request_r_number_seq to guard_escrituras_ajeno;
reset role;

select ok(
  'opsrun.request (opsrun_app INSERT)' in (select * from pg_temp.escrituras_abiertas()),
  'G2 se ve fallar: detecta INSERT de opsrun_app sobre opsrun.request'
);
select ok(
  'opsrun.request_r_number_seq (guard_escrituras_ajeno USAGE)' in (select * from pg_temp.escrituras_abiertas()),
  'G2 se ve fallar: detecta USAGE de un rol ajeno sobre la secuencia del R number'
);

select * from finish();
rollback;

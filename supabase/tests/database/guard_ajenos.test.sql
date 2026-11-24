-- OPR-20 · Guard G3: de fuera solo entra el lector del write-back, y solo por
-- opsrun_writeback.
--
-- "Rol ajeno" es todo rol de pg_roles que no se llama `opsrun_*`, más PUBLIC.
-- Quedan fuera los superusuarios (se saltan los privilegios: para ellos están
-- los triggers) y los roles predefinidos pg_* como tales: quien tenga
-- pg_read_all_data con herencia aparece por sí mismo.
--
-- La regla (spec §8):
-- - un rol ajeno con algún privilegio en los esquemas de opsRUN solo puede
--   tener USAGE en opsrun_writeback y SELECT en sus vistas v<n>_*;
-- - PUBLIC no tiene nada;
-- - hay a lo sumo un rol ajeno con algún privilegio. El guard no nombra al
--   lector: lo halla en el catálogo. Si BzzzBX necesitara un segundo lector,
--   este guard falla a propósito y cambiarlo pide una decisión explícita (ADR).
--
-- Se ve fallar en cada corrida, como el dueño y con rollback: un privilegio de
-- más al lector hallado (SELECT en una tabla de opsrun, USAGE en opsrun),
-- USAGE en opsrun_writeback para PUBLIC, y un segundo lector (authenticated).
--
-- La frontera con Supabase que miraba rls.test.sql (anon, authenticated y
-- service_role sin USAGE en los esquemas de opsRUN) queda dentro de esta regla.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

create function pg_temp.es_de_opsrun(nombre name)
returns boolean
language sql
immutable
as $$ select nombre = 'opsrun' or nombre like 'opsrun\_%' $$;

-- Todo privilegio de un rol ajeno (o de PUBLIC) en los esquemas de opsRUN.
create function pg_temp.privilegios_ajenos()
returns table (rol text, objeto text, privilegio text, permitido boolean)
language sql
stable
as $$
  with ajenos as (
    select r.oid, r.rolname::text as nombre
    from pg_catalog.pg_roles as r
    where not pg_temp.es_de_opsrun(r.rolname)
      and not r.rolsuper
      and r.rolname !~ '^pg_'
  ),
  esquemas as (
    select n.oid, n.nspname
    from pg_catalog.pg_namespace as n
    where pg_temp.es_de_opsrun(n.nspname)
  ),
  relaciones as (
    select c.oid, c.relkind, c.relname, c.relacl, c.relowner, e.nspname
    from pg_catalog.pg_class as c
    join esquemas as e on e.oid = c.relnamespace
  ),
  funciones as (
    select p.oid, p.proname, p.proacl, p.proowner, e.nspname
    from pg_catalog.pg_proc as p
    join esquemas as e on e.oid = p.pronamespace
  ),
  de_roles as (
    select a.nombre, 'esquema ' || e.nspname, p.priv,
           e.nspname = 'opsrun_writeback' and p.priv = 'USAGE'
    from ajenos as a
    cross join esquemas as e
    cross join (values ('USAGE'), ('CREATE')) as p(priv)
    where has_schema_privilege(a.oid, e.oid, p.priv)
    union all
    select a.nombre, r.nspname || '.' || r.relname, p.priv,
           r.nspname = 'opsrun_writeback' and r.relkind = 'v'
             and r.relname ~ '^v[0-9]+_' and p.priv = 'SELECT'
    from ajenos as a
    cross join relaciones as r
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                       ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p(priv)
    where r.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_table_privilege(a.oid, r.oid, p.priv)
    union all
    select a.nombre, r.nspname || '.' || r.relname, p.priv, false
    from ajenos as a
    cross join relaciones as r
    cross join (values ('USAGE'), ('SELECT'), ('UPDATE')) as p(priv)
    where r.relkind = 'S'
      and has_sequence_privilege(a.oid, r.oid, p.priv)
    union all
    select a.nombre, f.nspname || '.' || f.proname, 'EXECUTE', false
    from ajenos as a
    cross join funciones as f
    where has_function_privilege(a.oid, f.oid, 'EXECUTE')
  ),
  de_public as (
    select 'PUBLIC', 'esquema ' || e.nspname, x.privilege_type, false
    from esquemas as e
    join pg_catalog.pg_namespace as n on n.oid = e.oid
    cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) as x
    where x.grantee = 0
    union all
    select 'PUBLIC', r.nspname || '.' || r.relname, x.privilege_type, false
    from relaciones as r
    cross join lateral aclexplode(
      coalesce(r.relacl, acldefault(case when r.relkind = 'S' then 's' else 'r' end::"char", r.relowner))
    ) as x
    where x.grantee = 0
    union all
    select 'PUBLIC', f.nspname || '.' || f.proname, x.privilege_type, false
    from funciones as f
    cross join lateral aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) as x
    where x.grantee = 0
  )
  select * from de_roles
  union all
  select * from de_public
$$;

create function pg_temp.de_mas()
returns setof text
language sql
stable
as $$
  select format('%s → %s: %s', rol, objeto, privilegio)
  from pg_temp.privilegios_ajenos()
  where not permitido
$$;

create function pg_temp.lectores()
returns setof text
language sql
stable
as $$ select distinct rol from pg_temp.privilegios_ajenos() $$;

-- 1. El guard ve los esquemas de opsRUN (si no viera ninguno, pasaría sin probar nada).
select ok(
  (select count(*) from pg_catalog.pg_namespace as n where pg_temp.es_de_opsrun(n.nspname)) >= 3,
  'G3 descubre los esquemas de opsRUN'
);

-- 2 a 4. La comprobación real.
select is_empty(
  'select * from pg_temp.de_mas()',
  'G3: ningún rol ajeno ni PUBLIC tiene en opsRUN más que USAGE en opsrun_writeback y SELECT en sus vistas'
);
select cmp_ok(
  (select count(*) from pg_temp.lectores()), '<=', 1::bigint,
  'G3: a lo sumo un rol ajeno tiene algún privilegio en los esquemas de opsRUN'
);
-- La otra cara: el lector hallado lee toda vista del write-back.
select is_empty(
  $$
    select l.rol || ' → ' || c.relname
    from pg_temp.lectores() as l(rol)
    cross join pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'opsrun_writeback'
      and c.relkind = 'v'
      and not has_table_privilege(l.rol, c.oid, 'SELECT')
  $$,
  'el lector del write-back lee toda vista de opsrun_writeback'
);

-- 5 a 10. El guard se ve fallar. Se rompe la regla como el dueño.
grant opsrun_migrador to current_user with inherit false, set true;

-- El lector, hallado en el catálogo: el rol ajeno al que el ACL del esquema
-- opsrun_writeback le concede USAGE de forma directa.
create temporary table lector as
  select x.grantee::regrole::name as rolname
  from pg_catalog.pg_namespace as n
  cross join lateral aclexplode(n.nspacl) as x
  where n.nspname = 'opsrun_writeback'
    and x.privilege_type = 'USAGE'
    and x.grantee <> 0
    and x.grantee <> n.nspowner
    and not pg_temp.es_de_opsrun(x.grantee::regrole::name);

select is(
  (select count(*) from lector), 1::bigint,
  'hay un lector del write-back para romper la regla'
);

-- Un privilegio de más al lector: SELECT en una tabla de opsrun.
-- (El nombre se lee antes de cambiar de rol: la tabla temporal es del rol que
-- corre el test.)
do $$
declare
  v_lector name := (select rolname from lector);
begin
  set local role opsrun_migrador;
  execute format('grant select on opsrun.request to %I', v_lector);
  reset role;
end
$$;
select ok(
  format('%s → opsrun.request: SELECT', (select rolname from lector)) in (select * from pg_temp.de_mas()),
  'G3 se ve fallar: detecta SELECT del lector sobre una tabla de opsrun'
);
do $$
declare
  v_lector name := (select rolname from lector);
begin
  set local role opsrun_migrador;
  execute format('revoke select on opsrun.request from %I', v_lector);
  execute format('grant usage on schema opsrun to %I', v_lector);
  reset role;
end
$$;
select ok(
  format('%s → esquema opsrun: USAGE', (select rolname from lector)) in (select * from pg_temp.de_mas()),
  'G3 se ve fallar: detecta USAGE del lector en el esquema opsrun'
);
do $$
declare
  v_lector name := (select rolname from lector);
begin
  set local role opsrun_migrador;
  execute format('revoke usage on schema opsrun from %I', v_lector);
  reset role;
end
$$;

-- PUBLIC con USAGE en opsrun_writeback.
set local role opsrun_migrador;
grant usage on schema opsrun_writeback to public;
reset role;
select ok(
  'PUBLIC → esquema opsrun_writeback: USAGE' in (select * from pg_temp.de_mas()),
  'G3 se ve fallar: detecta USAGE de PUBLIC en opsrun_writeback'
);
set local role opsrun_migrador;
revoke usage on schema opsrun_writeback from public;
reset role;

-- Un segundo lector, con lo mismo que el primero.
set local role opsrun_migrador;
grant usage on schema opsrun_writeback to authenticated;
grant select on opsrun_writeback.v1_request to authenticated;
reset role;
select is_empty(
  $$select * from pg_temp.de_mas() as f(t) where f.t like 'authenticated %'$$,
  'un segundo lector con solo USAGE y SELECT del write-back no tiene privilegios de más…'
);
select ok(
  'authenticated' in (select * from pg_temp.lectores())
    and (select count(*) from pg_temp.lectores()) > 1,
  'G3 se ve fallar: …pero cuenta como un segundo rol ajeno con privilegios en opsRUN'
);

select * from finish();
rollback;

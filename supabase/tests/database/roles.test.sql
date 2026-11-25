-- Guard: los roles de opsRUN tienen el mínimo privilegio (ADR 0003 y las
-- convenciones de las vecinas de Bzzz).
--
-- "Rol de opsRUN" es todo rol llamado `opsrun_*`, descubierto en pg_roles: en
-- la caja y en el alta local, opsrun_migrador (dueño) y opsrun_app (el
-- servidor de Next). El lector del write-back de la caja no es de opsRUN y
-- aquí no se busca; lo cubre G3 (guard_ajenos.test.sql).
--
-- - Ninguno es superusuario, salta RLS, crea roles o bases, ni replica.
-- - Ninguno es miembro de otro rol: no heredan de authenticated, service_role,
--   postgres ni de nada.
-- - Ninguno tiene CREATE en la base.
-- - Fuera de los esquemas de opsRUN no tienen nada que PUBLIC no tenga ya: ni
--   en public, ni en auth, ni en storage, ni en los esquemas de las demás
--   vecinas. Recorre todo el catálogo (pg_class, pg_namespace, pg_proc) en vez
--   de enumerar esquemas.
-- - opsrun_app entra solo a `opsrun`, sin CREATE.
--
-- Cada regla se ve fallar en cada corrida: el test la rompe a propósito y
-- comprueba que el guard lo detecta. El rol que corre el test hizo el alta
-- local y puede alterar esos roles; el rollback lo deshace.
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

create function pg_temp.es_de_opsrun(nombre name)
returns boolean
language sql
immutable
as $$ select nombre = 'opsrun' or nombre like 'opsrun\_%' $$;

create function pg_temp.roles_opsrun()
returns setof name
language sql
stable
as $$ select r.rolname from pg_catalog.pg_roles as r where r.rolname like 'opsrun\_%' $$;

-- Los esquemas temporales de cada sesión (pg_temp_N, pg_toast_temp_N) no son
-- de nadie: Postgres los da a quien tenga TEMP sobre la base.
create function pg_temp.es_temporal(esquema oid)
returns boolean
language sql
stable
as $$ select esquema = pg_my_temp_schema() or pg_is_other_temp_schema(esquema) $$;

-- ¿PUBLIC tiene ese privilegio sobre el objeto? (acl nula = la de por defecto)
create function pg_temp.publico_tiene(acl aclitem[], tipo "char", dueno oid, privilegio text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from aclexplode(coalesce(acl, acldefault(tipo, dueno))) as a
    where a.grantee = 0 and a.privilege_type = privilegio
  )
$$;

create function pg_temp.atributos_peligrosos()
returns setof text
language sql
stable
as $$
  select r.rolname || ': ' || a.atributo
  from pg_catalog.pg_roles as r
  cross join lateral (
    values ('superuser', r.rolsuper), ('bypassrls', r.rolbypassrls),
           ('createrole', r.rolcreaterole), ('createdb', r.rolcreatedb),
           ('replication', r.rolreplication)
  ) as a(atributo, tiene)
  where r.rolname in (select pg_temp.roles_opsrun()) and a.tiene
$$;

create function pg_temp.membresias()
returns setof text
language sql
stable
as $$
  select r.rolname || ' es miembro de ' || g.rolname
  from pg_catalog.pg_auth_members as m
  join pg_catalog.pg_roles as r on r.oid = m.member
  join pg_catalog.pg_roles as g on g.oid = m.roleid
  where r.rolname in (select pg_temp.roles_opsrun())
$$;

create function pg_temp.crean_en_la_base()
returns setof name
language sql
stable
as $$
  select r.rol from pg_temp.roles_opsrun() as r(rol)
  where has_database_privilege(r.rol, current_database(), 'CREATE')
$$;

-- Todo lo que un rol de opsRUN alcanza fuera de los esquemas de opsRUN y
-- PUBLIC no.
create function pg_temp.alcance_fuera()
returns setof text
language sql
stable
as $$
  -- Esquemas: USAGE o CREATE.
  select r.rol || ' → esquema ' || n.nspname || ': ' || p.priv
  from pg_temp.roles_opsrun() as r(rol)
  cross join pg_catalog.pg_namespace as n
  cross join (values ('USAGE'), ('CREATE')) as p(priv)
  where not pg_temp.es_de_opsrun(n.nspname)
    and not pg_temp.es_temporal(n.oid)
    and has_schema_privilege(r.rol, n.oid, p.priv)
    and not pg_temp.publico_tiene(n.nspacl, 'n', n.nspowner, p.priv)
  union all
  -- Tablas, vistas, vistas materializadas y tablas foráneas.
  select r.rol || ' → relación ' || n.nspname || '.' || c.relname || ': ' || p.priv
  from pg_temp.roles_opsrun() as r(rol)
  cross join pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                     ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p(priv)
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
    and not pg_temp.es_de_opsrun(n.nspname)
    and has_table_privilege(r.rol, c.oid, p.priv)
    and not pg_temp.publico_tiene(c.relacl, 'r', c.relowner, p.priv)
  union all
  -- Secuencias.
  select r.rol || ' → secuencia ' || n.nspname || '.' || c.relname || ': ' || p.priv
  from pg_temp.roles_opsrun() as r(rol)
  cross join pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  cross join (values ('USAGE'), ('SELECT'), ('UPDATE')) as p(priv)
  where c.relkind = 'S'
    and not pg_temp.es_de_opsrun(n.nspname)
    and has_sequence_privilege(r.rol, c.oid, p.priv)
    and not pg_temp.publico_tiene(c.relacl, 's', c.relowner, p.priv)
  union all
  -- Funciones.
  select r.rol || ' → función ' || n.nspname || '.' || f.proname
  from pg_temp.roles_opsrun() as r(rol)
  cross join pg_catalog.pg_proc as f
  join pg_catalog.pg_namespace as n on n.oid = f.pronamespace
  where not pg_temp.es_de_opsrun(n.nspname)
    and has_function_privilege(r.rol, f.oid, 'EXECUTE')
    and not pg_temp.publico_tiene(f.proacl, 'f', f.proowner, 'EXECUTE')
$$;

-- Lo que opsrun_app alcanza en los esquemas de opsRUN, fuera de USAGE en opsrun.
create function pg_temp.app_en_opsrun()
returns setof text
language sql
stable
as $$
  select n.nspname || ': ' || p.priv
  from pg_catalog.pg_namespace as n
  cross join (values ('USAGE'), ('CREATE')) as p(priv)
  where pg_temp.es_de_opsrun(n.nspname)
    and has_schema_privilege('opsrun_app', n.oid, p.priv)
    and not (n.nspname = 'opsrun' and p.priv = 'USAGE')
$$;

-- 1. El guard ve los roles (si no viera ninguno, los demás pasarían sin probar nada).
select ok(
  (select count(*) from pg_temp.roles_opsrun()) >= 2
    and 'opsrun_app' in (select pg_temp.roles_opsrun()),
  'el guard descubre los roles de opsRUN (opsrun_app y el dueño)'
);

-- 2 y 3. Sin atributos peligrosos.
select is_empty(
  'select * from pg_temp.atributos_peligrosos()',
  'ningún rol de opsRUN es superusuario, salta RLS, crea roles o bases, ni replica'
);

alter role opsrun_app createdb;
select ok(
  'opsrun_app: createdb' in (select * from pg_temp.atributos_peligrosos()),
  'el guard detecta un rol de opsRUN que crea bases'
);
alter role opsrun_app nocreatedb;

-- 4 y 5. Sin membresías.
select is_empty(
  'select * from pg_temp.membresias()',
  'ningún rol de opsRUN es miembro de otro rol'
);

grant authenticated to opsrun_app;
select ok(
  'opsrun_app es miembro de authenticated' in (select * from pg_temp.membresias()),
  'el guard detecta opsrun_app como miembro de authenticated'
);
revoke authenticated from opsrun_app;

-- 6 y 7. Sin CREATE en la base (Postgres no se lo da a PUBLIC y el alta tampoco).
select is_empty(
  'select * from pg_temp.crean_en_la_base()',
  'ningún rol de opsRUN puede crear esquemas en la base'
);

do $$
begin
  execute format('grant create on database %I to opsrun_app', current_database());
end
$$;
select ok(
  'opsrun_app' in (select * from pg_temp.crean_en_la_base()),
  'el guard detecta CREATE de opsrun_app en la base'
);
do $$
begin
  execute format('revoke create on database %I from opsrun_app', current_database());
end
$$;

-- 8 a 12. Nada fuera de sus esquemas que PUBLIC no tenga ya.
select is_empty(
  'select * from pg_temp.alcance_fuera()',
  'ningún rol de opsRUN alcanza nada fuera de sus esquemas que PUBLIC no alcance ya'
);

create schema guard_otra_app;
create table guard_otra_app.datos (id int);
create function guard_otra_app.accion() returns int language sql as 'select 1';
revoke execute on function guard_otra_app.accion() from public;

grant usage on schema guard_otra_app to opsrun_app;
select ok(
  'opsrun_app → esquema guard_otra_app: USAGE' in (select * from pg_temp.alcance_fuera()),
  'el guard detecta USAGE en el esquema de otra vecina'
);

grant select on guard_otra_app.datos to opsrun_app;
select ok(
  'opsrun_app → relación guard_otra_app.datos: SELECT' in (select * from pg_temp.alcance_fuera()),
  'el guard detecta SELECT en una tabla de otra vecina'
);

grant execute on function guard_otra_app.accion() to opsrun_app;
select ok(
  'opsrun_app → función guard_otra_app.accion' in (select * from pg_temp.alcance_fuera()),
  'el guard detecta EXECUTE en una función de otra vecina'
);

create table public.guard_tabla_publica (id int);
grant insert on public.guard_tabla_publica to opsrun_app;
select ok(
  'opsrun_app → relación public.guard_tabla_publica: INSERT' in (select * from pg_temp.alcance_fuera()),
  'el guard detecta INSERT en una tabla de public'
);

-- 13 y 14. Lo que ya prohíbe Postgres, visto desde cada rol de opsRUN.
select is_empty(
  $$select r.rol from pg_temp.roles_opsrun() as r(rol)
    where has_schema_privilege(r.rol, 'auth', 'usage')
       or has_schema_privilege(r.rol, 'storage', 'usage')$$,
  'ningún rol de opsRUN llega a auth ni a storage'
);
select is_empty(
  $$select r.rol from pg_temp.roles_opsrun() as r(rol)
    where has_schema_privilege(r.rol, 'public', 'create')$$,
  'ningún rol de opsRUN puede crear nada en public'
);

-- 15 a 18. Dentro de opsRUN, opsrun_app entra a opsrun y a nada más.
select ok(
  has_schema_privilege('opsrun_app', 'opsrun', 'usage'),
  'opsrun_app entra al esquema opsrun'
);
select is_empty(
  'select * from pg_temp.app_en_opsrun()',
  'opsrun_app no entra a opsrun_private ni a opsrun_writeback, ni crea en ningún esquema de opsRUN'
);

do $$
declare
  dueno name := (
    select r.rolname
    from pg_catalog.pg_namespace as n
    join pg_catalog.pg_roles as r on r.oid = n.nspowner
    where n.nspname = 'opsrun'
  );
begin
  execute format('grant %I to current_user with inherit false, set true', dueno);
  execute format('set local role %I', dueno);
  grant usage on schema opsrun_private to opsrun_app;
  grant create on schema opsrun to opsrun_app;
  reset role;
end
$$;

select ok(
  'opsrun_private: USAGE' in (select * from pg_temp.app_en_opsrun()),
  'el guard detecta USAGE de opsrun_app en opsrun_private'
);
select ok(
  'opsrun: CREATE' in (select * from pg_temp.app_en_opsrun()),
  'el guard detecta CREATE de opsrun_app en opsrun'
);

select * from finish();
rollback;

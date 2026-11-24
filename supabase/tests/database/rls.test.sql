-- Guards de los esquemas de opsRUN (G1 y la frontera con Supabase).
--
-- Descubre en vez de enumerar:
-- - Los esquemas de opsRUN son `opsrun` y todo `opsrun_*`: el prefijo es lo
--   que evita choques con la caja y las demás vecinas en la base compartida.
--   Un esquema nuevo con ese prefijo entra solo.
-- - El dueño es el dueño del esquema `opsrun` según el catálogo, se llame como
--   se llame (en la caja y en el alta local, opsrun_migrador).
-- - Las tablas salen de information_schema.tables.
--
-- Cada guard se ve fallar en cada corrida: el test rompe la regla a propósito
-- dentro de la transacción y comprueba que el guard lo detecta. Para romperla
-- como el dueño, el rol que corre el test (el que hizo el alta local) se
-- concede el dueño un momento; el rollback lo deshace.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

create function pg_temp.es_de_opsrun(nombre name)
returns boolean
language sql
immutable
as $$ select nombre = 'opsrun' or nombre like 'opsrun\_%' $$;

create function pg_temp.esquemas_opsrun()
returns setof name
language sql
stable
as $$
  select n.nspname from pg_catalog.pg_namespace as n where pg_temp.es_de_opsrun(n.nspname)
$$;

create function pg_temp.dueno()
returns name
language sql
stable
as $$
  select r.rolname
  from pg_catalog.pg_namespace as n
  join pg_catalog.pg_roles as r on r.oid = n.nspowner
  where n.nspname = 'opsrun'
$$;

-- Esquemas de opsRUN cuyo dueño no es el del esquema opsrun.
create function pg_temp.esquemas_de_otro_dueno()
returns setof name
language sql
stable
as $$
  select n.nspname
  from pg_catalog.pg_namespace as n
  where pg_temp.es_de_opsrun(n.nspname)
    and n.nspowner <> (select o.nspowner from pg_catalog.pg_namespace as o where o.nspname = 'opsrun')
$$;

-- Tablas de opsRUN sin RLS activo.
create function pg_temp.tablas_sin_rls()
returns setof text
language sql
stable
as $$
  select t.table_schema || '.' || t.table_name
  from information_schema.tables as t
  join pg_catalog.pg_namespace as n on n.nspname = t.table_schema
  join pg_catalog.pg_class as c on c.relnamespace = n.oid and c.relname = t.table_name
  where t.table_type = 'BASE TABLE'
    and pg_temp.es_de_opsrun(t.table_schema::name)
    and not c.relrowsecurity
$$;

-- Roles de la API de Supabase que llegan a un esquema de opsRUN.
create function pg_temp.api_en_esquemas_opsrun()
returns setof text
language sql
stable
as $$
  select e.esquema || ' (' || r.rol || ')'
  from pg_temp.esquemas_opsrun() as e(esquema)
  cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rol)
  where has_schema_privilege(r.rol, e.esquema, 'usage')
     or has_schema_privilege(r.rol, e.esquema, 'create')
$$;

-- Lo que un rol de opsRUN tiene fuera de los esquemas de opsRUN: public, los
-- esquemas de Supabase y los de las demás vecinas.
create function pg_temp.opsrun_fuera()
returns setof text
language sql
stable
as $$
  select 'esquema ' || n.nspname
  from pg_catalog.pg_namespace as n
  join pg_catalog.pg_roles as r on r.oid = n.nspowner
  where pg_temp.es_de_opsrun(r.rolname) and not pg_temp.es_de_opsrun(n.nspname)
  union all
  select 'relación ' || n.nspname || '.' || c.relname
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  join pg_catalog.pg_roles as r on r.oid = c.relowner
  where pg_temp.es_de_opsrun(r.rolname) and not pg_temp.es_de_opsrun(n.nspname)
  union all
  select 'función ' || n.nspname || '.' || p.proname
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  join pg_catalog.pg_roles as r on r.oid = p.proowner
  where pg_temp.es_de_opsrun(r.rolname) and not pg_temp.es_de_opsrun(n.nspname)
$$;

-- 1 y 2. El guard ve los esquemas y al dueño (si no viera nada, los demás
-- pasarían sin probar nada).
select ok(
  (select count(*) from pg_temp.esquemas_opsrun()) >= 3,
  'el guard descubre los esquemas de opsRUN (opsrun, opsrun_private y opsrun_writeback)'
);
select ok(
  pg_temp.es_de_opsrun(pg_temp.dueno()),
  'el dueño del esquema opsrun es un rol de opsRUN'
);

-- 3. Un solo dueño para todos los esquemas de opsRUN.
select is_empty(
  'select * from pg_temp.esquemas_de_otro_dueno()',
  'todos los esquemas de opsRUN son del dueño del esquema opsrun'
);

-- Desde aquí, las pruebas que rompen la regla actúan como el dueño.
do $$
begin
  execute format('grant %I to current_user with inherit false, set true', pg_temp.dueno());
end
$$;

-- 4 a 6. G1: RLS en cada tabla de opsRUN.
select is_empty(
  'select * from pg_temp.tablas_sin_rls()',
  'toda tabla de los esquemas de opsRUN tiene RLS activo'
);

do $$
begin
  execute format('set local role %I', pg_temp.dueno());
  create table opsrun.guard_rls_prueba (id int primary key);
  reset role;
end
$$;

select ok(
  'opsrun.guard_rls_prueba' in (select * from pg_temp.tablas_sin_rls()),
  'el guard de RLS detecta una tabla de opsRUN sin RLS'
);

do $$
begin
  execute format('set local role %I', pg_temp.dueno());
  alter table opsrun.guard_rls_prueba enable row level security;
  reset role;
end
$$;

select is_empty(
  'select * from pg_temp.tablas_sin_rls()',
  'el guard de RLS deja de verla al activar RLS'
);

-- 7 y 8. anon, authenticated y service_role no llegan a los esquemas de opsRUN.
select is_empty(
  'select * from pg_temp.api_en_esquemas_opsrun()',
  'anon, authenticated y service_role no llegan a los esquemas de opsRUN'
);

do $$
begin
  execute format('set local role %I', pg_temp.dueno());
  grant usage on schema opsrun to authenticated;
  reset role;
end
$$;

select ok(
  'opsrun (authenticated)' in (select * from pg_temp.api_en_esquemas_opsrun()),
  'el guard detecta un rol de la API con USAGE en un esquema de opsRUN'
);

-- 9 a 11. Nada de opsRUN fuera de sus esquemas: ni en public ni en lo de otros.
select is_empty(
  'select * from pg_temp.opsrun_fuera()',
  'ningún rol de opsRUN es dueño de nada fuera de los esquemas de opsRUN'
);

create schema guard_otra_app;
do $$
begin
  execute format('grant create, usage on schema guard_otra_app to %I', pg_temp.dueno());
  execute format('set local role %I', pg_temp.dueno());
  create function guard_otra_app.de_opsrun() returns int language sql as 'select 1';
  create table guard_otra_app.de_opsrun (id int);
  reset role;
end
$$;

select ok(
  'función guard_otra_app.de_opsrun' in (select * from pg_temp.opsrun_fuera()),
  'el guard detecta una función de opsRUN fuera de sus esquemas'
);
select ok(
  'relación guard_otra_app.de_opsrun' in (select * from pg_temp.opsrun_fuera()),
  'el guard detecta una tabla de opsRUN fuera de sus esquemas'
);

select * from finish();
rollback;

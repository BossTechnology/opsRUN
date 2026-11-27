-- OPR-20 · Guard G9: toda columna declara su dueño.
--
-- Es el guard de "nadie copia datos de otro dueño": una columna nueva no pasa
-- CI hasta que alguien declara de quién es.
--
-- - Toda columna de una tabla de los esquemas de opsRUN (`opsrun` y
--   `opsrun_*`) tiene un COMMENT que empieza
--   con su dueño (opsrun, crosswalk o bzzzbx-snapshot), opcionalmente ":draft" o ":job",
--   y " · " con la descripción.
-- - Toda columna bzzzbx_*_id es text y está marcada crosswalk.
--
-- Descubre: pg_attribute de las tablas de los esquemas de opsRUN, sin
-- importar quién las creó.
--
-- Se ve fallar en cada corrida: agrega columnas sin comentario, con un
-- crosswalk que no es text y con un crosswalk marcado opsrun. Para alterar la
-- tabla, el rol que corre el test se concede opsrun_migrador con herencia; el
-- rollback lo deshace.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

grant opsrun_migrador to current_user with inherit true, set true;

create function pg_temp.columnas()
returns table (tabla regclass, columna name, tipo regtype, comentario text)
language sql
stable
as $$
  select c.oid::regclass, a.attname, a.atttypid::regtype, col_description(c.oid, a.attnum)
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  join pg_catalog.pg_attribute as a on a.attrelid = c.oid
  where (n.nspname = 'opsrun' or n.nspname like 'opsrun\_%')
    and c.relkind in ('r', 'p')
    and a.attnum > 0
    and not a.attisdropped
$$;

create function pg_temp.columnas_sin_dueno()
returns setof text
language sql
stable
as $$
  select format('%s.%I', tabla, columna)
  from pg_temp.columnas()
  where coalesce(comentario, '') !~ '^(opsrun|crosswalk|bzzzbx-snapshot)(:draft|:job)? · .+'
$$;

create function pg_temp.crosswalk_mal_declarado()
returns setof text
language sql
stable
as $$
  select format('%s.%I', tabla, columna)
  from pg_temp.columnas()
  where columna ~ 'bzzzbx_[a-z0-9_]+_id$'
    and (tipo <> 'text'::regtype or coalesce(comentario, '') !~ '^crosswalk[: ]')
$$;

-- 1 a 3. La comprobación real, y que el guard tiene qué mirar.
select ok(
  (select count(distinct tabla) from pg_temp.columnas()) >= 15,
  'G9 descubre las tablas de opsRUN'
);
select is_empty(
  'select * from pg_temp.columnas_sin_dueno()',
  'G9: toda columna de opsRUN declara su dueño en el COMMENT'
);
select is_empty(
  'select * from pg_temp.crosswalk_mal_declarado()',
  'G9: toda columna bzzzbx_*_id es text y está marcada crosswalk'
);

-- 4 a 6. El guard se ve fallar.
alter table opsrun.request add column guard_sin_dueno text;
alter table opsrun.request add column bzzzbx_guard_numero_id integer;
comment on column opsrun.request.bzzzbx_guard_numero_id is 'crosswalk · Prueba con tipo equivocado.';
alter table opsrun.request add column bzzzbx_guard_marca_id text;
comment on column opsrun.request.bzzzbx_guard_marca_id is 'opsrun · Prueba con dueño equivocado.';

select ok(
  exists (
    select 1 from pg_temp.columnas_sin_dueno() as f(c) where f.c = 'opsrun.request.guard_sin_dueno'
  ),
  'G9 se ve fallar: detecta una columna sin comentario de dueño'
);
select ok(
  exists (
    select 1 from pg_temp.crosswalk_mal_declarado() as f(c) where f.c = 'opsrun.request.bzzzbx_guard_numero_id'
  ),
  'G9 se ve fallar: detecta un crosswalk que no es text'
);
select ok(
  exists (
    select 1 from pg_temp.crosswalk_mal_declarado() as f(c) where f.c = 'opsrun.request.bzzzbx_guard_marca_id'
  ),
  'G9 se ve fallar: detecta un crosswalk marcado con otro dueño'
);

select * from finish();
rollback;

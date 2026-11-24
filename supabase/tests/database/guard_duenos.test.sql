-- OPR-20 · Guard G9: toda columna declara su dueño.
--
-- Es el guard de "nadie copia datos de otro dueño": una columna nueva no pasa
-- CI hasta que alguien declara de quién es.
--
-- - Toda columna de una tabla de public de opsRUN tiene un COMMENT que empieza
--   con su dueño (opsrun, crosswalk o bzzzbx-snapshot), opcionalmente ":draft",
--   y " · " con la descripción.
-- - Toda columna bzzzbx_*_id es text y está marcada crosswalk.
--
-- Descubre: pg_attribute de las tablas de public cuyo dueño es el rol que
-- aplica las migraciones.
--
-- Se ve fallar en cada corrida: agrega columnas sin comentario, con un
-- crosswalk que no es text y con un crosswalk marcado opsrun.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

create function pg_temp.columnas()
returns table (tabla regclass, columna name, tipo regtype, comentario text)
language sql
stable
as $$
  select c.oid::regclass, a.attname, a.atttypid::regtype, col_description(c.oid, a.attnum)
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  join pg_catalog.pg_attribute as a on a.attrelid = c.oid
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and pg_catalog.pg_get_userbyid(c.relowner) = current_user
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
  where coalesce(comentario, '') !~ '^(opsrun|crosswalk|bzzzbx-snapshot)(:draft)? · .+'
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

-- 1 y 2. La comprobación real.
select is_empty(
  'select * from pg_temp.columnas_sin_dueno()',
  'G9: toda columna de public declara su dueño en el COMMENT'
);
select is_empty(
  'select * from pg_temp.crosswalk_mal_declarado()',
  'G9: toda columna bzzzbx_*_id es text y está marcada crosswalk'
);

-- 3 a 5. El guard se ve fallar.
alter table public.request add column guard_sin_dueno text;
alter table public.request add column bzzzbx_guard_numero_id integer;
comment on column public.request.bzzzbx_guard_numero_id is 'crosswalk · Prueba con tipo equivocado.';
alter table public.request add column bzzzbx_guard_marca_id text;
comment on column public.request.bzzzbx_guard_marca_id is 'opsrun · Prueba con dueño equivocado.';

select ok(
  exists (
    select 1 from pg_temp.columnas_sin_dueno() as f(c) where f.c = 'request.guard_sin_dueno'
  ),
  'G9 se ve fallar: detecta una columna sin comentario de dueño'
);
select ok(
  exists (
    select 1 from pg_temp.crosswalk_mal_declarado() as f(c) where f.c = 'request.bzzzbx_guard_numero_id'
  ),
  'G9 se ve fallar: detecta un crosswalk que no es text'
);
select ok(
  exists (
    select 1 from pg_temp.crosswalk_mal_declarado() as f(c) where f.c = 'request.bzzzbx_guard_marca_id'
  ),
  'G9 se ve fallar: detecta un crosswalk marcado con otro dueño'
);

select * from finish();
rollback;

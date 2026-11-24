-- OPR-20 · Guard G2: anon y authenticated no escriben en ningún objeto de opsRUN.
--
-- Las escrituras del operador van solo por funciones SQL (spec §4), así que
-- ninguna tabla ni vista les da INSERT, UPDATE, DELETE ni TRUNCATE, y ninguna
-- secuencia les da USAGE ni UPDATE (nextval y setval).
--
-- Descubre: todo objeto de pg_class cuyo dueño es el rol que aplica las
-- migraciones (el que corre este test), en cualquier esquema. Igual que G1.
--
-- Se ve fallar en cada corrida: da INSERT sobre public.request a
-- authenticated y USAGE sobre la secuencia del R number a anon, y comprueba
-- que los detecta.
begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

create function pg_temp.escrituras_abiertas()
returns setof text
language sql
stable
as $$
  select format('%I.%I (%s %s)', n.nspname, c.relname, r.rol, p.priv)
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) as r(rol)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p(priv)
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
    and pg_catalog.pg_get_userbyid(c.relowner) = current_user
    and has_table_privilege(r.rol, c.oid, p.priv)
  union all
  select format('%I.%I (%s %s)', n.nspname, c.relname, r.rol, p.priv)
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) as r(rol)
  cross join (values ('USAGE'), ('UPDATE')) as p(priv)
  where c.relkind = 'S'
    and pg_catalog.pg_get_userbyid(c.relowner) = current_user
    and has_sequence_privilege(r.rol, c.oid, p.priv)
$$;

-- 1. La comprobación real, sobre lo que dejaron las migraciones.
select is_empty(
  'select * from pg_temp.escrituras_abiertas()',
  'G2: ningún objeto de opsRUN da escritura a anon ni a authenticated'
);

-- 2 y 3. El guard se ve fallar.
grant insert on public.request to authenticated;
grant usage on sequence public.request_r_number_seq to anon;

select ok(
  exists (
    select 1 from pg_temp.escrituras_abiertas() as f(objeto)
    where f.objeto = 'public.request (authenticated INSERT)'
  ),
  'G2 se ve fallar: detecta INSERT de authenticated sobre public.request'
);
select ok(
  exists (
    select 1 from pg_temp.escrituras_abiertas() as f(objeto)
    where f.objeto = 'public.request_r_number_seq (anon USAGE)'
  ),
  'G2 se ve fallar: detecta USAGE de anon sobre la secuencia del R number'
);

select * from finish();
rollback;

-- OPR-30, OPR-31 y OPR-32 · Guard G14: los hechos del job (spec docs/spec/opr-30-31-32-etapas.md §10.1, P-15).
--
-- Los hechos de opsRUN después de programar (End manually, OSS, aprobación, PO
-- capturado y validación) son columnas de opsrun.request marcadas ":job" en su
-- COMMENT. G14 exige dos cosas:
--
-- a) Toda función security definer que un rol de opsRUN (salvo el dueño) puede
--    invocar y cuyo prosrc nombra una columna :job llama a
--    opsrun_private.lock_scheduled_request(: el candado con la versión que vio el
--    operador. Una función que escribe un hecho del job sin él puede pisar lo que
--    otro operador acaba de hacer.
-- b) Toda columna :job es nula en una request open: se prueba poniéndole un
--    valor a cada una, descubierta, y esperando 23514 (request_job_facts_need_job
--    y las constraints de pares); y todas juntas, con valores coherentes, chocan
--    con request_job_facts_need_job y con ninguna otra.
--
-- Descubre: las columnas por su COMMENT y las funciones por pg_proc en los
-- esquemas `opsrun` y `opsrun_*`, sin nombrar ninguna. Una columna :job nueva
-- entra sola; si nadie la agrega a la constraint, (b) la encuentra.
--
-- Se ve fallar en cada corrida: crea una función de prueba, ejecutable por
-- opsrun_app y con require_operator(), que hace update opsrun.request set
-- approved_at = now() sin el candado, y una columna :job que la constraint no
-- cubre; comprueba que las detecta. El rollback lo deshace.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

grant opsrun_migrador to current_user with inherit true, set true;

insert into opsrun.operator (id, email, display_name, team)
values ('0a000000-0000-4000-8000-000000000141', 'g14@example.test', 'Operador G14', 'operations');

-- Una request open, sin ningún hecho del job.
insert into opsrun.request (id, received_at)
values ('b0000000-0000-4000-8000-000000000141', now());

create function pg_temp.es_de_opsrun(nombre name)
returns boolean
language sql
immutable
as $$ select nombre = 'opsrun' or nombre like 'opsrun\_%' $$;

create function pg_temp.columnas_job()
returns setof name
language sql
stable
as $$
  select a.attname
  from pg_catalog.pg_attribute as a
  where a.attrelid = 'opsrun.request'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and col_description(a.attrelid, a.attnum) ~ '^[a-z-]+:job '
$$;

-- (a) Funciones que un rol de opsRUN puede invocar, que nombran un hecho del job y no toman el candado.
create function pg_temp.funciones_sin_candado()
returns setof text
language sql
stable
as $$
  select distinct n.nspname || '.' || p.proname
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  cross join pg_catalog.pg_roles as r
  where pg_temp.es_de_opsrun(n.nspname)
    and p.prosecdef
    and not exists (
      select 1 from pg_catalog.pg_depend as d
      where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    )
    and pg_temp.es_de_opsrun(r.rolname)
    and r.oid <> n.nspowner
    and has_schema_privilege(r.oid, p.pronamespace, 'USAGE')
    and has_function_privilege(r.oid, p.oid, 'EXECUTE')
    and exists (
      select 1 from pg_temp.columnas_job() as c
      where p.prosrc ~ ('\m' || c || '\M')
    )
    and p.prosrc !~ 'opsrun_private\.lock_scheduled_request\s*\('
$$;

-- Un valor válido para el tipo de cada columna :job. Un tipo que no está aquí falla en voz alta:
-- quien agregue una columna :job de otro tipo tiene que decidir su valor de prueba.
create function pg_temp.valor_de_prueba(p_columna name)
returns text
language plpgsql
stable
as $$
declare
  v_tipo text := (
    select t.typname::text
    from pg_catalog.pg_attribute as a
    join pg_catalog.pg_type as t on t.oid = a.atttypid
    where a.attrelid = 'opsrun.request'::regclass and a.attname = p_columna
  );
begin
  return case v_tipo
    when 'timestamptz' then 'now()'
    when 'uuid' then quote_literal('0a000000-0000-4000-8000-000000000141')
    when 'text' then quote_literal('x')
    when 'oss_mark' then quote_literal('oss')
    when 'oss_source' then quote_literal('operator')
  end
  || '';
end;
$$;

-- (b) Columnas :job a las que una request open acepta un valor (cada una por separado).
create function pg_temp.hechos_que_aceptan_open()
returns setof text
language plpgsql
as $$
declare
  v_columna name;
  v_valor text;
begin
  for v_columna in select * from pg_temp.columnas_job() loop
    v_valor := pg_temp.valor_de_prueba(v_columna);
    if v_valor is null or v_valor = '' then
      raise exception 'G14: sin valor de prueba para %', v_columna;
    end if;
    begin
      execute format('update opsrun.request set %I = %s where id = %L',
                     v_columna, v_valor, 'b0000000-0000-4000-8000-000000000141');
      return next v_columna::text;
      -- Se deshace lo que pasó: la fila queda sin hechos para la columna que sigue.
      raise exception 'deshacer' using errcode = 'P0001';
    exception
      when check_violation then null;
      when sqlstate 'P0001' then null;
    end;
  end loop;
end;
$$;

-- (b) Todas las columnas :job juntas, en una request open: solo debe fallar request_job_facts_need_job.
create function pg_temp.constraint_que_frena_a_todas()
returns text
language plpgsql
as $$
declare
  v_sets text;
  v_constraint text;
begin
  select string_agg(format('%I = %s', c, pg_temp.valor_de_prueba(c)), ', ' order by c)
    into v_sets
    from pg_temp.columnas_job() as c;
  begin
    execute format('update opsrun.request set %s where id = %L', v_sets, 'b0000000-0000-4000-8000-000000000141');
    raise exception 'deshacer' using errcode = 'P0001';
  exception
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      return v_constraint;
    when sqlstate 'P0001' then
      return 'ninguna: la request open aceptó todos los hechos del job';
  end;
end;
$$;

-- 1. Hay qué mirar: columnas :job y funciones que las nombran.
select ok(
  (select count(*) from pg_temp.columnas_job()) >= 13
  and exists (
    select 1
    from pg_catalog.pg_proc as p
    where p.pronamespace = 'opsrun'::regnamespace and p.prosecdef
      and exists (select 1 from pg_temp.columnas_job() as c where p.prosrc ~ ('\m' || c || '\M'))
  ),
  'G14 tiene qué mirar: las columnas :job de opsrun.request y funciones que las nombran'
);

-- 2 a 4. La comprobación real.
select is_empty(
  'select * from pg_temp.funciones_sin_candado()',
  'G14a: toda función que un rol de opsRUN invoca y que nombra un hecho del job toma lock_scheduled_request'
);
select is_empty(
  'select * from pg_temp.hechos_que_aceptan_open()',
  'G14b: ninguna columna :job acepta un valor en una request open (23514)'
);
select is(
  pg_temp.constraint_que_frena_a_todas(),
  'request_job_facts_need_job',
  'G14b: con todos los hechos a la vez, solo choca request_job_facts_need_job'
);

-- 5 a 7. G14a se ve fallar: una función que escribe un hecho del job sin el candado.
set local role opsrun_migrador;
create function opsrun.guard_prueba_sin_candado()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform opsrun_private.require_operator();
  update opsrun.request set approved_at = now() where id = 'b0000000-0000-4000-8000-000000000141';
end;
$$;
grant execute on function opsrun.guard_prueba_sin_candado() to opsrun_app;

create function opsrun.guard_prueba_con_candado()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request opsrun.request;
begin
  perform opsrun_private.require_operator();
  v_request := opsrun_private.lock_scheduled_request('b0000000-0000-4000-8000-000000000141', 0);
  update opsrun.request set approved_at = now() where id = v_request.id;
end;
$$;
grant execute on function opsrun.guard_prueba_con_candado() to opsrun_app;

-- Una función que nombra el hecho pero no es invocable por ningún rol de opsRUN no cuenta.
create function opsrun.guard_prueba_cerrada()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update opsrun.request set approved_at = now() where id = 'b0000000-0000-4000-8000-000000000141';
end;
$$;
reset role;

select ok(
  'opsrun.guard_prueba_sin_candado' in (select * from pg_temp.funciones_sin_candado()),
  'G14a se ve fallar: detecta una función de opsrun_app que escribe approved_at sin el candado'
);
select ok(
  'opsrun.guard_prueba_con_candado' not in (select * from pg_temp.funciones_sin_candado()),
  'G14a no marca una función que toma el candado'
);
select ok(
  'opsrun.guard_prueba_cerrada' not in (select * from pg_temp.funciones_sin_candado()),
  'G14a no marca una función que ningún rol de opsRUN puede invocar'
);

-- 8 y 9. El candado rechaza lo que no es un job.
select throws_ok(
  $$ select opsrun_private.lock_scheduled_request('b0000000-0000-4000-8000-000000000141', 0) $$,
  'OP019',
  null,
  'el candado rechaza una request que no está programada'
);
select throws_ok(
  $$ select opsrun_private.lock_scheduled_request('b0000000-0000-4000-8000-000000000142', 0) $$,
  'OP006',
  null,
  'el candado rechaza una request que no existe'
);

-- 10 a 12. G14b se ve fallar: una columna :job que la constraint no cubre.
alter table opsrun.request add column hecho_g14 timestamptz;
comment on column opsrun.request.hecho_g14 is 'opsrun:job · prueba de G14';
select ok(
  'hecho_g14' in (select * from pg_temp.hechos_que_aceptan_open()),
  'G14b se ve fallar: detecta una columna :job que una request open acepta'
);

alter table opsrun.request drop column hecho_g14;
alter table opsrun.request add column hecho_g14 jsonb;
comment on column opsrun.request.hecho_g14 is 'opsrun:job · prueba de G14, de un tipo sin valor de prueba';
select throws_ok(
  'select * from pg_temp.hechos_que_aceptan_open()',
  'P0001',
  'G14: sin valor de prueba para hecho_g14',
  'G14b se ve fallar: una columna :job de un tipo sin valor de prueba pide una decisión'
);

alter table opsrun.request drop column hecho_g14;
alter table opsrun.request drop constraint request_job_facts_need_job;
select is(
  pg_temp.constraint_que_frena_a_todas(),
  'ninguna: la request open aceptó todos los hechos del job',
  'G14b se ve fallar: sin request_job_facts_need_job, una request open acepta todos los hechos del job'
);

select * from finish();
rollback;

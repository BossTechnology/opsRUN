-- OPR-29 · Guard G18: el job enlazado de una request solo lo cambia un operador
-- y deja Audit (spec docs/spec/opr-29-scheduled.md §11.1; el spec lo llama G18
-- porque G16 es el guard del ciclo de fondo, ADR 0006, y G17 el de alertas).
--
-- Toda función de los esquemas de opsRUN cuyo código escribe `bzzzbx_job_id` o
-- `job_number` de opsrun.request (un `update opsrun.request set ...` que nombra
-- una de las dos columnas antes del `where`):
--
--   a) llama a opsrun_private.require_operator(): el job enlazado es una
--      decisión de una persona, nunca del sistema ni de una IA;
--   b) escribe un audit_event de `request_scheduled` o de `job_relinked` en la
--      misma función (y por tanto en la misma transacción): el enlace y su
--      Audit se quedan o se deshacen juntos.
--
-- Hoy son link_observed_job y relink_observed_job. Descubre en pg_proc (esquemas
-- `opsrun` y `opsrun_*`, sin las funciones de una extensión), sin lista: una
-- tercera función que cambie el job entra sola y, si no cumple, el guard falla.
--
-- Se ve fallar en cada corrida: dentro de la transacción crea una función de
-- prueba, ejecutable por opsrun_app, que hace `update opsrun.request set
-- job_number = ...` sin operador y sin Audit; otra que sí lo llama pero no deja
-- Audit; una con un Audit de otro tipo; y comprueba que G18 las detecta (y no
-- marca a una completa ni a una que solo filtra por el job). El rollback lo deshace.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

grant opsrun_migrador to current_user with inherit true, set true;

create function pg_temp.es_de_opsrun(nombre name)
returns boolean
language sql
immutable
as $$ select nombre = 'opsrun' or nombre like 'opsrun\_%' $$;

-- Las funciones de opsRUN (no de una extensión) que cambian el job de una request.
create function pg_temp.funciones_que_enlazan()
returns table (nombre text, codigo text)
language sql
stable
as $$
  select n.nspname || '.' || p.proname, p.prosrc
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where pg_temp.es_de_opsrun(n.nspname)
    and not exists (
      select 1 from pg_catalog.pg_depend as d
      where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    )
    -- El SET del update, antes de su WHERE: filtrar por el job no es cambiarlo.
    and p.prosrc ~* 'update\s+opsrun\.request\s+set\s+((?!\mwhere\M)[^;])*\m(bzzzbx_job_id|job_number)\s*='
$$;

-- (a) Sin require_operator() en su propio cuerpo.
create function pg_temp.enlaces_sin_operador()
returns setof text
language sql
stable
as $$
  select f.nombre from pg_temp.funciones_que_enlazan() as f
  where f.codigo !~ 'opsrun_private\.require_operator\s*\('
  order by 1
$$;

-- (b) Sin Audit de request_scheduled o job_relinked en la misma función.
create function pg_temp.enlaces_sin_audit()
returns setof text
language sql
stable
as $$
  select f.nombre from pg_temp.funciones_que_enlazan() as f
  where not (
    f.codigo ~* 'insert\s+into\s+opsrun\.audit_event([^a-z0-9_]|$)'
    and f.codigo ~ '''(request_scheduled|job_relinked)'''
  )
  order by 1
$$;

-- 1. Hay qué mirar.
select is(
  array(select nombre from pg_temp.funciones_que_enlazan() order by 1),
  array['opsrun.link_observed_job', 'opsrun.relink_observed_job'],
  'G18 tiene qué mirar: hoy solo link_observed_job y relink_observed_job cambian el job enlazado'
);

-- 2 y 3. La comprobación real.
select is(array(select * from pg_temp.enlaces_sin_operador()), '{}'::text[],
  'G18 (a): toda función que cambia el job enlazado llama a require_operator()');
select is(array(select * from pg_temp.enlaces_sin_audit()), '{}'::text[],
  'G18 (b): toda función que cambia el job enlazado escribe un audit_event de request_scheduled o job_relinked');

-- 4 a 12. G18 se ve fallar.
set local role opsrun_migrador;
-- Sin operador y sin Audit.
create function opsrun.guard_prueba_enlace_suelto()
returns void language sql security definer set search_path = ''
as $$ update opsrun.request set job_number = 'J-G18' where false $$;
-- Con operador, sin Audit.
create function opsrun.guard_prueba_enlace_sin_audit()
returns void language plpgsql security definer set search_path = ''
as $$ begin
  perform opsrun_private.require_operator();
  update opsrun.request set bzzzbx_job_id = 'bx-job-g18', job_number = 'J-G18' where false;
end $$;
-- Con operador y un Audit de otro tipo.
create function opsrun.guard_prueba_enlace_audit_ajeno()
returns void language plpgsql security definer set search_path = ''
as $$ begin
  perform opsrun_private.require_operator();
  update opsrun.request set bzzzbx_job_id = 'bx-job-g18' where false;
  insert into opsrun.audit_event (event_type, actor_kind, occurred_at) values ('request_assigned', 'operator', now());
end $$;
-- Completa: operador y Audit del enlace.
create function opsrun.guard_prueba_enlace_completo()
returns void language plpgsql security definer set search_path = ''
as $$ begin
  perform opsrun_private.require_operator();
  update opsrun.request set bzzzbx_job_id = 'bx-job-g18', job_number = 'J-G18' where false;
  insert into opsrun.audit_event (event_type, actor_kind, occurred_at) values ('job_relinked', 'operator', now());
end $$;
-- Solo filtra por el job: no lo cambia.
create function opsrun.guard_prueba_filtra_por_job()
returns void language sql security definer set search_path = ''
as $$ update opsrun.request set oss_mark = null where bzzzbx_job_id = 'bx-job-g18' and job_number = 'J-G18' and false $$;
reset role;

select ok(
  'opsrun.guard_prueba_enlace_suelto' in (select nombre from pg_temp.funciones_que_enlazan()),
  'G18 descubre una función nueva que cambia job_number');
select ok(
  'opsrun.guard_prueba_enlace_suelto' in (select * from pg_temp.enlaces_sin_operador()),
  'G18 (a) se ve fallar: detecta una función que cambia job_number sin require_operator()');
select ok(
  'opsrun.guard_prueba_enlace_suelto' in (select * from pg_temp.enlaces_sin_audit()),
  'G18 (b) se ve fallar: detecta una función que cambia job_number sin Audit');
select ok(
  'opsrun.guard_prueba_enlace_sin_audit' in (select * from pg_temp.enlaces_sin_audit())
  and 'opsrun.guard_prueba_enlace_sin_audit' not in (select * from pg_temp.enlaces_sin_operador()),
  'G18 (b) detecta una función con operador que no deja Audit');
select ok(
  'opsrun.guard_prueba_enlace_audit_ajeno' in (select * from pg_temp.enlaces_sin_audit()),
  'G18 (b) detecta una función cuyo Audit es de otro tipo');
select ok(
  'opsrun.guard_prueba_enlace_completo' in (select nombre from pg_temp.funciones_que_enlazan())
  and 'opsrun.guard_prueba_enlace_completo' not in (select * from pg_temp.enlaces_sin_operador())
  and 'opsrun.guard_prueba_enlace_completo' not in (select * from pg_temp.enlaces_sin_audit()),
  'G18 no marca una función con operador y Audit del enlace');
select ok(
  'opsrun.guard_prueba_filtra_por_job' not in (select nombre from pg_temp.funciones_que_enlazan()),
  'G18 no marca una función que solo filtra por el job en el WHERE');
select is(
  (select count(*) from pg_temp.enlaces_sin_operador()), 1::bigint,
  'con las funciones de prueba, (a) marca exactamente la que no llama a require_operator()');
select is(
  (select count(*) from pg_temp.enlaces_sin_audit()), 3::bigint,
  'con las funciones de prueba, (b) marca exactamente las tres sin Audit del enlace');

select * from finish();
rollback;

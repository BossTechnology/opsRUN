-- OPR-34 · Guard G17: las alertas dejan Audit y una resuelta no se toca
-- (spec docs/spec/opr-34-alerts.md §10.1; el spec lo llama G16, pero G16 ya es el
-- guard del único ciclo de fondo, ADR 0006: ver la pregunta abierta del PR).
--
--   1. Toda función de los esquemas de opsRUN cuyo código hace `insert into` o
--      `update` sobre opsrun.alert_occurrence también hace `insert into
--      opsrun.audit_event`. Hoy son clear_alert y upsert_alert_occurrence; una
--      tercera entra sola y, si no deja Audit, el guard falla.
--   2. Toda columna de opsrun.alert_occurrence queda congelada en una ocurrencia
--      resuelta: para cada una, un update sobre una fixture resuelta falla con
--      OP036. Una columna nueva entra sola.
--
-- Descubre: las funciones en pg_proc (esquemas `opsrun` y `opsrun_*`, sin las de
-- una extensión) y las columnas en pg_attribute. Sin listas.
--
-- Se ve fallar en cada corrida: crea una función de prueba que actualiza
-- alert_occurrence sin escribir Audit y comprueba que (1) la detecta; deshabilita
-- el trigger y comprueba que (2) lo detecta en todas las columnas. El rollback lo
-- deshace todo.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

grant opsrun_migrador to current_user with inherit true, set true;

create function pg_temp.es_de_opsrun(nombre name)
returns boolean
language sql
immutable
as $$ select nombre = 'opsrun' or nombre like 'opsrun\_%' $$;

-- (1) Funciones que escriben alert_occurrence, y las que no dejan Audit.
create function pg_temp.funciones_que_escriben_alertas()
returns setof text
language sql
stable
as $$
  select n.nspname || '.' || p.proname
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where pg_temp.es_de_opsrun(n.nspname)
    and p.prosrc ~* '(insert\s+into|update)\s+opsrun\.alert_occurrence([^a-z0-9_]|$)'
    and not exists (
      select 1 from pg_catalog.pg_depend as d
      where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    )
  order by 1
$$;

create function pg_temp.alertas_sin_audit()
returns setof text
language sql
stable
as $$
  select n.nspname || '.' || p.proname
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where pg_temp.es_de_opsrun(n.nspname)
    and p.prosrc ~* '(insert\s+into|update)\s+opsrun\.alert_occurrence([^a-z0-9_]|$)'
    and p.prosrc !~* 'insert\s+into\s+opsrun\.audit_event([^a-z0-9_]|$)'
    and not exists (
      select 1 from pg_catalog.pg_depend as d
      where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    )
  order by 1
$$;

-- (2) Una ocurrencia resuelta, y las columnas que un update puede tocar sin que el trigger lo rechace con OP036.
insert into opsrun.request (id, received_at) values ('b0000000-0000-4000-8000-000000003499', now());
insert into opsrun.alert_occurrence (id, bzzzbx_alert_id, request_id, rule_id, rule_version, level, reason_text, opened_at, resolved_at, resolution)
values ('a1000000-0000-4000-8000-000000003499', 'bx-alert-g17', 'b0000000-0000-4000-8000-000000003499', 'OPS-010', '1', 'red',
        'Not started by 1:00 PM.', now() - interval '2 hours', now() - interval '1 hour', 'auto_cleared');

create function pg_temp.columnas_sin_congelar()
returns setof text
language plpgsql
as $$
declare
  v_col name;
begin
  for v_col in
    select a.attname
    from pg_catalog.pg_attribute as a
    where a.attrelid = 'opsrun.alert_occurrence'::regclass and a.attnum > 0 and not a.attisdropped
    order by a.attnum
  loop
    begin
      execute format('update opsrun.alert_occurrence set %1$I = %1$I where id = %2$L', v_col, 'a1000000-0000-4000-8000-000000003499');
      return next v_col::text;
    exception when sqlstate 'OP036' then
      null;
    end;
  end loop;
end;
$$;

select ok(
  (select count(*) from pg_temp.funciones_que_escriben_alertas()) >= 2
    and (select count(*) from pg_attribute where attrelid = 'opsrun.alert_occurrence'::regclass and attnum > 0 and not attisdropped) >= 17,
  'G17 tiene qué mirar: las funciones que escriben alert_occurrence y sus columnas');
select is(
  array(select * from pg_temp.funciones_que_escriben_alertas()),
  array['opsrun.clear_alert', 'opsrun.upsert_alert_occurrence'],
  'hoy solo clear_alert y upsert_alert_occurrence escriben alert_occurrence');

-- G17 parte 1
select is(array(select * from pg_temp.alertas_sin_audit()), '{}'::text[],
  'G17 (1): toda función que escribe alert_occurrence también inserta en audit_event');

-- G17 parte 2
select is(array(select * from pg_temp.columnas_sin_congelar()), '{}'::text[],
  'G17 (2): toda columna de alert_occurrence queda congelada en una ocurrencia resuelta (OP036)');

-- G17 se ve fallar (1): una función que actualiza alert_occurrence sin Audit.
set local role opsrun_migrador;
create function opsrun.guard_prueba_alerta_sin_audit()
returns void language sql security definer set search_path = ''
as $$ update opsrun.alert_occurrence set level = 'red' where false $$;
create function opsrun.guard_prueba_alerta_con_audit()
returns void language sql security definer set search_path = ''
as $$ update opsrun.alert_occurrence set level = 'red' where false;
      insert into opsrun.audit_event (event_type, actor_kind, occurred_at) values ('alert_level_changed', 'bzzzbx', now()) $$;
reset role;

select ok(
  'opsrun.guard_prueba_alerta_sin_audit' in (select * from pg_temp.alertas_sin_audit()),
  'G17 se ve fallar (1): detecta una función que actualiza alert_occurrence sin escribir Audit');
select ok(
  'opsrun.guard_prueba_alerta_con_audit' not in (select * from pg_temp.alertas_sin_audit()),
  'G17 no marca una función que escribe alert_occurrence y también Audit');

-- G17 se ve fallar (2): sin el trigger, todas las columnas quedan sueltas.
alter table opsrun.alert_occurrence disable trigger alert_occurrence_resolved_frozen;
select ok(
  (select count(*) from pg_temp.columnas_sin_congelar()) >= 17
    and 'resolved_at' in (select * from pg_temp.columnas_sin_congelar())
    and 'level' in (select * from pg_temp.columnas_sin_congelar()),
  'G17 se ve fallar (2): con el trigger deshabilitado detecta todas las columnas sueltas, también las que reabren la alerta');
alter table opsrun.alert_occurrence enable trigger alert_occurrence_resolved_frozen;
select is(array(select * from pg_temp.columnas_sin_congelar()), '{}'::text[],
  'con el trigger activo otra vez, el guard vuelve a quedar en verde');

select * from finish();
rollback;

-- OPR-20 · Guard G4: la RLS de respaldo.
--
-- Los permisos son la frontera (G2, G3). Además, toda tabla de opsrun tiene
-- RLS con una sola política, para opsrun_app. Si a otro rol se le diera
-- SELECT por error, vería 0 filas en toda tabla y vista de opsrun. La otra
-- cara, para que el guard no pase con una política que lo niega todo:
-- opsrun_app lee filas en todas.
--
-- Descubre: las tablas y vistas del esquema opsrun en pg_class. Para que
-- "0 filas" signifique algo, antes de mirar se comprueba que todas tienen
-- filas: una tabla nueva sin fila en la fixture falla aquí.
--
-- El rol ajeno es uno de prueba, creado en el test con USAGE en opsrun y
-- SELECT en todo, que es el error que el guard tiene que aguantar.
--
-- Se ve fallar en cada corrida: una política using (true) para el rol de
-- prueba abre opsrun.request, y el guard la detecta.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

grant opsrun_migrador to current_user with inherit true, set true;
grant opsrun_app to current_user with inherit false, set true;

create role guard_lectura_ajeno nologin;
grant guard_lectura_ajeno to current_user with inherit false, set true;
grant usage on schema opsrun to guard_lectura_ajeno;
grant select on all tables in schema opsrun to guard_lectura_ajeno;

-- Fixture: una fila en cada tabla, con datos inventados.
insert into opsrun.operator (id, auth_user_id, email, display_name, team) values
  ('0a000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001',
   'lectura.uno@example.test', 'Operador Lectura', 'operations');

insert into opsrun.request (id, received_at, owner_operator_id, bzzzbx_property_id)
values ('b0000000-0000-4000-8000-000000000001', now(), '0a000000-0000-4000-8000-000000000001', 'bx-prop-t001');

insert into opsrun.instruction (id, request_id, type, idempotency_key, payload, actor_kind, actor_operator_id)
values ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
        'send_text', 'lectura-1', '{"template": "cleaner_confirmation_request"}',
        'operator', '0a000000-0000-4000-8000-000000000001'),
       ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001',
        'ai_analyze_request', 'lectura-2', '{}', 'system', null);

insert into opsrun.cleaner_confirmation (id, request_id, purpose, bzzzbx_team_id, ask_instruction_id, actor_kind, actor_operator_id)
values ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'initial',
        'bx-team-t001', 'c0000000-0000-4000-8000-000000000001', 'operator', '0a000000-0000-4000-8000-000000000001');

insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
values ('b0000000-0000-4000-8000-000000000001', 'details', 'operator', '{"unit": "4B"}',
        '0a000000-0000-4000-8000-000000000001');

insert into opsrun.request_message (request_id, bzzzbx_message_id, channel, direction, is_original, actor_kind)
values ('b0000000-0000-4000-8000-000000000001', 'bx-msg-t001', 'email', 'inbound', true, 'system');

insert into opsrun.note (request_id, author_operator_id, body)
values ('b0000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', 'Nota de prueba.');

insert into opsrun.alert_occurrence (bzzzbx_alert_id, request_id, rule_id, rule_version, level, reason_text, opened_at)
values ('bx-alert-t001', 'b0000000-0000-4000-8000-000000000001', 'OPS-002', '1', 'amber', 'Abierta hace 2 h.', now());

insert into opsrun.ai_analysis (id, request_id, instruction_id, status, completed_at)
values ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
        'c0000000-0000-4000-8000-000000000002', 'completed', now());

insert into opsrun.ai_suggestion (request_id, ai_analysis_id, field, value)
values ('b0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'unit', '"4B"');

insert into opsrun.message_template (key, version, channel, body, active)
values ('lectura_prueba', 1, 'text', 'Hola {{property}}', true);

insert into opsrun.audit_event (request_id, event_type, actor_kind, occurred_at)
values ('b0000000-0000-4000-8000-000000000001', 'request_received', 'system', now());

-- Tablas y vistas del esquema opsrun.
create function pg_temp.objetos_opsrun()
returns setof regclass
language sql
stable
as $$
  select c.oid::regclass
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'opsrun'
    and c.relkind in ('r', 'p', 'v', 'm')
$$;

-- Filas que ve un rol en cada objeto. Permiso denegado cuenta como 0.
create function pg_temp.filas_visibles(p_rol name)
returns table (objeto text, filas bigint)
language plpgsql
as $$
declare
  v_objetos regclass[];
  v_objeto regclass;
  v_filas bigint;
begin
  select array_agg(o) into v_objetos from pg_temp.objetos_opsrun() as o;
  foreach v_objeto in array v_objetos loop
    begin
      execute format('set local role %I', p_rol);
      execute format('select count(*) from %s', v_objeto) into v_filas;
      reset role;
    exception when insufficient_privilege then
      v_filas := 0;
    end;
    objeto := v_objeto::text;
    filas := v_filas;
    return next;
  end loop;
end;
$$;

-- 1 y 2. Precondiciones: el guard tiene qué mirar, y cada objeto tiene filas
-- (como el dueño, que no está sujeto a RLS).
select ok(
  (select count(*) from pg_temp.objetos_opsrun()) >= 16,
  'G4 descubre las tablas y vistas de opsrun'
);
select is_empty(
  $$ select objeto from pg_temp.filas_visibles('opsrun_migrador') where filas = 0 $$,
  'toda tabla y vista de opsrun tiene filas en la fixture'
);

-- 3. G4
select is_empty(
  $$ select objeto from pg_temp.filas_visibles('guard_lectura_ajeno') where filas > 0 $$,
  'G4: un rol ajeno con SELECT por error lee 0 filas en toda tabla y vista de opsrun'
);

-- 4. La otra cara.
select is_empty(
  $$ select objeto from pg_temp.filas_visibles('opsrun_app') where filas = 0 $$,
  'opsrun_app lee filas en toda tabla y vista de opsrun'
);

-- 5. El guard se ve fallar.
create policy guard_lectura_prueba on opsrun.request for select to guard_lectura_ajeno using (true);

select ok(
  exists (
    select 1 from pg_temp.filas_visibles('guard_lectura_ajeno')
    where objeto = 'opsrun.request' and filas > 0
  ),
  'G4 se ve fallar: detecta una política using (true) para un rol ajeno'
);

select * from finish();
rollback;

-- OPR-28 · Fase A: enlace de una request con el job observado (spec
-- docs/spec/fase-a-enlace.md §5 a §7). Pruebas funcionales de
-- opsrun.link_observed_job y opsrun.reject_job_link.
--
-- Las llamadas van como opsrun_app, el rol del servidor, con el actor de la
-- transacción fijado como lo fija el pool (opsrun.auth_user_id u
-- opsrun.system_actor). Los datos de prueba los pone el dueño de los esquemas:
-- el rol que corre el test se concede opsrun_migrador (y opsrun_app para
-- pasar a él); el rollback lo deshace.
--
-- Que las dos funciones exijan operador lo prueban, además, G5 y G6
-- (guard_funciones.test.sql), que las descubren solas.
begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

grant opsrun_migrador to current_user with inherit true, set true;
-- Para llamar como opsrun_app con SET ROLE, como el pool. Sin herencia: lo
-- que prueba es lo que opsrun_app tiene, no lo que tiene quien corre el test.
grant opsrun_app to current_user with inherit false, set true;

-- Fixture (datos inventados)
insert into opsrun.operator (id, auth_user_id, email, display_name, team) values
  ('0a000000-0000-4000-8000-000000000031', 'aa000000-0000-4000-8000-000000000031',
   'enlace.uno@example.test', 'Operador Enlace', 'operations');

insert into opsrun.request (id, received_at, owner_operator_id, bzzzbx_customer_id, bzzzbx_property_id, service_date) values
  -- gate completo
  ('b0000000-0000-4000-8000-000000000031', now(), '0a000000-0000-4000-8000-000000000031', 'bx-cust-t-01', 'bx-prop-t-01', current_date + 2),
  -- gate incompleto: solo details
  ('b0000000-0000-4000-8000-000000000032', now(), '0a000000-0000-4000-8000-000000000031', 'bx-cust-t-01', 'bx-prop-t-01', current_date + 2),
  -- para rechazos
  ('b0000000-0000-4000-8000-000000000033', now(), null, 'bx-cust-t-01', 'bx-prop-t-01', null),
  -- gate completo, para intentar enlazar un job ya enlazado
  ('b0000000-0000-4000-8000-000000000034', now(), '0a000000-0000-4000-8000-000000000031', 'bx-cust-t-01', 'bx-prop-t-01', current_date + 2);

insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
select r, k, 'operator', '{}', '0a000000-0000-4000-8000-000000000031'
from unnest(array['b0000000-0000-4000-8000-000000000031', 'b0000000-0000-4000-8000-000000000034']::uuid[]) as r
cross join unnest(enum_range(null::opsrun.confirmation_kind)) as k;

insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id) values
  ('b0000000-0000-4000-8000-000000000032', 'details', 'operator', '{}', '0a000000-0000-4000-8000-000000000031');

-- Cada set_config va en un DO para no imprimir filas fuera de TAP.
create function pg_temp.actor(p_auth text, p_system text)
returns void
language plpgsql
as $$
begin
  perform set_config('opsrun.auth_user_id', coalesce(p_auth, ''), true);
  perform set_config('opsrun.system_actor', coalesce(p_system, ''), true);
end;
$$;

-- La llamada bajo prueba corre como opsrun_app, el rol del servidor; pgTAP
-- sigue corriendo como quien corre el test (opsrun_app no ve el esquema de
-- pgTAP). Si la llamada falla, el SET LOCAL se deshace con la subtransacción
-- de throws_ok.
create function pg_temp.como_app(p_sql text)
returns void
language plpgsql
as $$
begin
  set local role opsrun_app;
  execute p_sql;
  reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
select ok(has_function_privilege('opsrun_app', 'opsrun.link_observed_job(uuid, text, text)', 'execute'),
  'opsrun_app ejecuta link_observed_job');
select ok(has_function_privilege('opsrun_app', 'opsrun.reject_job_link(uuid, text, text)', 'execute'),
  'opsrun_app ejecuta reject_job_link');
select ok(not has_function_privilege('authenticated', 'opsrun.link_observed_job(uuid, text, text)', 'execute'),
  'authenticated no ejecuta link_observed_job');
select ok(not has_function_privilege('authenticated', 'opsrun.reject_job_link(uuid, text, text)', 'execute'),
  'authenticated no ejecuta reject_job_link');
select is((select requires_reason from opsrun.audit_event_type where code = 'job_link_rejected'), false,
  'job_link_rejected existe y su motivo es opcional');

-- ---------------------------------------------------------------------------
-- Sin operador no hay enlace ni rechazo
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.actor(null, null); end $$;
select throws_ok($$select pg_temp.como_app($q$select opsrun.link_observed_job('b0000000-0000-4000-8000-000000000031', 'bx-job-t-0001', 'EX-T-0001')$q$)$$,
  '42501', null, 'sin actor, link_observed_job falla');
select throws_ok($$select pg_temp.como_app($q$select opsrun.reject_job_link('b0000000-0000-4000-8000-000000000033', 'bx-job-t-0002', null)$q$)$$,
  '42501', null, 'sin actor, reject_job_link falla');

do $$ begin perform pg_temp.actor(null, 'intake'); end $$;
select throws_ok($$select pg_temp.como_app($q$select opsrun.link_observed_job('b0000000-0000-4000-8000-000000000031', 'bx-job-t-0001', 'EX-T-0001')$q$)$$,
  '42501', null, 'con un actor de sistema, link_observed_job falla');
select throws_ok($$select pg_temp.como_app($q$select opsrun.reject_job_link('b0000000-0000-4000-8000-000000000033', 'bx-job-t-0002', null)$q$)$$,
  '42501', null, 'con un actor de sistema, reject_job_link falla');

-- ---------------------------------------------------------------------------
-- Enlace, como operador
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000031', null); end $$;

select throws_ok($$select pg_temp.como_app($q$select opsrun.link_observed_job('b0000000-0000-4000-8000-000000000032', 'bx-job-t-0001', 'EX-T-0001')$q$)$$,
  'OP005', null, 'sin el gate de Schedule completo no se enlaza');
select throws_ok($$select pg_temp.como_app($q$select opsrun.link_observed_job('b0000000-0000-4000-8000-000000000031', '  ', 'EX-T-0001')$q$)$$,
  '22023', null, 'sin crosswalk ID no se enlaza');
select throws_ok($$select pg_temp.como_app($q$select opsrun.link_observed_job('b0000000-0000-4000-8000-000000000031', 'bx-job-t-0001', null)$q$)$$,
  '22023', null, 'sin job number no se enlaza');
select throws_ok($$select pg_temp.como_app($q$select opsrun.link_observed_job('b0000000-0000-4000-8000-0000000000ff', 'bx-job-t-0001', 'EX-T-0001')$q$)$$,
  'OP006', null, 'una request que no existe no se enlaza');

select lives_ok($$select pg_temp.como_app($q$select opsrun.link_observed_job('b0000000-0000-4000-8000-000000000031', 'bx-job-t-0001', 'EX-T-0001')$q$)$$,
  'con el gate completo, el operador enlaza la request con el job');
select results_eq(
  $$select status::text, bzzzbx_job_id, job_number, scheduled_at is not null
      from opsrun.request where id = 'b0000000-0000-4000-8000-000000000031'$$,
  $$values ('scheduled', 'bx-job-t-0001', 'EX-T-0001', true)$$,
  'la request queda Scheduled con el crosswalk ID y el job number del job'
);
select results_eq(
  $$select event_type, actor_kind::text, actor_operator_id, details
      from opsrun.audit_event where request_id = 'b0000000-0000-4000-8000-000000000031'$$,
  $$values ('request_scheduled', 'operator', '0a000000-0000-4000-8000-000000000031'::uuid,
            '{"mode": "linked", "bzzzbx_job_id": "bx-job-t-0001", "job_number": "EX-T-0001"}'::jsonb)$$,
  'el enlace deja request_scheduled en Audit, con el operador y mode = linked'
);
select is((select count(*)::int from opsrun.instruction where request_id = 'b0000000-0000-4000-8000-000000000031'), 0,
  'el enlace no crea ninguna instrucción: en la Fase A no sale nada a BzzzBX');

select throws_ok($$select pg_temp.como_app($q$select opsrun.link_observed_job('b0000000-0000-4000-8000-000000000031', 'bx-job-t-0009', 'EX-T-0009')$q$)$$,
  'OP007', null, 'una request ya programada no se vuelve a enlazar');
select throws_ok($$select pg_temp.como_app($q$select opsrun.link_observed_job('b0000000-0000-4000-8000-000000000034', 'bx-job-t-0001', 'EX-T-0099')$q$)$$,
  'OP008', null, 'un job ya enlazado no se enlaza a otra request');
select throws_ok($$select pg_temp.como_app($q$select opsrun.link_observed_job('b0000000-0000-4000-8000-000000000034', 'bx-job-t-0098', 'EX-T-0001')$q$)$$,
  'OP008', null, 'un job number ya enlazado no se enlaza a otra request');
select is((select status::text from opsrun.request where id = 'b0000000-0000-4000-8000-000000000034'), 'open',
  'el intento fallido no toca la otra request');

-- ---------------------------------------------------------------------------
-- Rechazo, como operador
-- ---------------------------------------------------------------------------
select lives_ok($$select pg_temp.como_app($q$select opsrun.reject_job_link('b0000000-0000-4000-8000-000000000033', 'bx-job-t-0002', '  ')$q$)$$,
  'el operador rechaza un candidato sin motivo');
select lives_ok($$select pg_temp.como_app($q$select opsrun.reject_job_link('b0000000-0000-4000-8000-000000000033', 'bx-job-t-0003', ' Different date ')$q$)$$,
  'el operador rechaza un candidato con motivo');
select results_eq(
  $$select details ->> 'bzzzbx_job_id', reason, actor_operator_id
      from opsrun.audit_event
     where request_id = 'b0000000-0000-4000-8000-000000000033' and event_type = 'job_link_rejected'
     order by id$$,
  $$values ('bx-job-t-0002', null::text, '0a000000-0000-4000-8000-000000000031'::uuid),
           ('bx-job-t-0003', 'Different date', '0a000000-0000-4000-8000-000000000031'::uuid)$$,
  'cada rechazo queda en Audit con el job, el motivo recortado o nulo, y el operador'
);
select is((select status::text from opsrun.request where id = 'b0000000-0000-4000-8000-000000000033'), 'open',
  'rechazar no toca la request');
select throws_ok($$select pg_temp.como_app($q$select opsrun.reject_job_link('b0000000-0000-4000-8000-000000000031', 'bx-job-t-0004', null)$q$)$$,
  'OP007', null, 'no se rechazan candidatos de una request ya programada');

-- ---------------------------------------------------------------------------
-- Después del enlace manda el job: el borrador queda congelado
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update opsrun.request set service_date = current_date + 9 where id = 'b0000000-0000-4000-8000-000000000031'$$,
  'OP003', null, 'el borrador de una request enlazada queda congelado'
);

select * from finish();
rollback;

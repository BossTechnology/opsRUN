-- OPR-20 · Pruebas funcionales del modelo de datos (no son guards).
--
-- Gate de Schedule, request_ai_marks, transiciones de instruction.status,
-- confirmación vigente única, cursores del write-back, helpers del actor de
-- la transacción y el contrato del write-back.
--
-- Actúa como el dueño de los esquemas de opsRUN: el rol que corre el test (el
-- que hizo el alta local) se concede opsrun_migrador con herencia; el rollback
-- lo deshace.
begin;
create extension if not exists pgtap with schema extensions;

select plan(41);

grant opsrun_migrador to current_user with inherit true, set true;

-- Fixture (datos inventados)
insert into opsrun.operator (id, auth_user_id, email, display_name, team) values
  ('0a000000-0000-4000-8000-000000000021', 'aa000000-0000-4000-8000-000000000021',
   'modelo.uno@example.test', 'Operador Uno', 'operations'),
  ('0a000000-0000-4000-8000-000000000022', null, 'modelo.dos@example.test', 'Operador Dos', 'finance');

insert into opsrun.request (id, received_at, owner_operator_id) values
  ('b0000000-0000-4000-8000-000000000021', now(), null),
  ('b0000000-0000-4000-8000-000000000022', now(), '0a000000-0000-4000-8000-000000000021');

-- ---------------------------------------------------------------------------
-- Write-back: contrato de las vistas
-- ---------------------------------------------------------------------------
select hasnt_column('opsrun_writeback', 'v1_operator', 'email', 'el write-back no saca el correo de los operadores');
select has_column('opsrun_writeback', 'v1_request', 'change_seq', 'el write-back expone el cursor change_seq');
select has_column('opsrun_writeback', 'v1_audit_event', 'id', 'el write-back expone el cursor de Audit');
select hasnt_view('opsrun_writeback', 'v1_note', 'las notas no salen en el write-back v1');

-- ---------------------------------------------------------------------------
-- Actor de la transacción
-- ---------------------------------------------------------------------------
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

do $$ begin perform pg_temp.actor(null, null); end $$;
select is(opsrun_private.current_operator_id(), null::uuid, 'sin actor no hay operador');
select throws_ok('select opsrun_private.require_operator()', '42501', null,
  'require_operator() falla sin actor');
select throws_ok('select opsrun_private.require_system()', '42501', null,
  'require_system() falla sin actor');

do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000021', null); end $$;
select is(opsrun_private.current_operator_id(), '0a000000-0000-4000-8000-000000000021'::uuid,
  'con opsrun.auth_user_id, current_operator_id() da el operador enlazado');
select is(opsrun_private.require_operator(), '0a000000-0000-4000-8000-000000000021'::uuid,
  'con opsrun.auth_user_id, require_operator() da el operador enlazado');
select throws_ok('select opsrun_private.require_system()', '42501', null,
  'require_system() falla si el actor es un operador');

update opsrun.operator set active = false where id = '0a000000-0000-4000-8000-000000000021';
select is(opsrun_private.current_operator_id(), null::uuid, 'un operador desactivado deja de contar');
update opsrun.operator set active = true where id = '0a000000-0000-4000-8000-000000000021';

do $$ begin perform pg_temp.actor('no-es-un-uuid', null); end $$;
select is(opsrun_private.current_operator_id(), null::uuid, 'un auth_user_id mal formado no es un operador');

do $$ begin perform pg_temp.actor(null, 'intake'); end $$;
select is(opsrun_private.require_system(), 'intake', 'con opsrun.system_actor, require_system() da el proceso');
select throws_ok('select opsrun_private.require_operator()', '42501', null,
  'require_operator() falla si el actor es el sistema');

do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000021', 'intake'); end $$;
select throws_ok('select opsrun_private.require_operator()', '42501', null,
  'require_operator() falla si la transacción declara los dos actores');
select throws_ok('select opsrun_private.require_system()', '42501', null,
  'require_system() falla si la transacción declara los dos actores');

do $$ begin perform pg_temp.actor(null, null); end $$;

-- ---------------------------------------------------------------------------
-- Gate de Schedule
-- ---------------------------------------------------------------------------
create function pg_temp.programar(p_request uuid, p_job text)
returns void
language sql
as $$
  update opsrun.request
  set status = 'scheduled', bzzzbx_job_id = p_job, job_number = 'J-' || p_job, scheduled_at = now()
  where id = p_request;
$$;

select throws_ok(
  $$ select pg_temp.programar('b0000000-0000-4000-8000-000000000021', 'bx-job-t021') $$,
  'OP005', null,
  'Schedule exige dueño'
);

insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id) values
  ('b0000000-0000-4000-8000-000000000022', 'details', 'operator', '{}', '0a000000-0000-4000-8000-000000000021'),
  ('b0000000-0000-4000-8000-000000000022', 'sender', 'operator', '{}', '0a000000-0000-4000-8000-000000000021');

select throws_ok(
  $$ select pg_temp.programar('b0000000-0000-4000-8000-000000000022', 'bx-job-t022') $$,
  'OP005', 'opsRUN: Schedule exige confirmación vigente de: cleaner',
  'Schedule exige las tres confirmaciones (falta cleaner)'
);

insert into opsrun.request_confirmation (id, request_id, kind, method, confirmed_value, actor_operator_id, superseded_at)
values ('f0000000-0000-4000-8000-000000000021', 'b0000000-0000-4000-8000-000000000022', 'cleaner', 'phone', '{}',
        '0a000000-0000-4000-8000-000000000021', now());

select throws_ok(
  $$ select pg_temp.programar('b0000000-0000-4000-8000-000000000022', 'bx-job-t022') $$,
  'OP005', null,
  'una confirmación reemplazada no cuenta para Schedule'
);

insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
values ('b0000000-0000-4000-8000-000000000022', 'cleaner', 'phone', '{}', '0a000000-0000-4000-8000-000000000021');

select lives_ok(
  $$ select pg_temp.programar('b0000000-0000-4000-8000-000000000022', 'bx-job-t022') $$,
  'con dueño y las tres confirmaciones vigentes, Schedule pasa'
);
select is(
  (select status from opsrun.request where id = 'b0000000-0000-4000-8000-000000000022'),
  'scheduled'::opsrun.request_status,
  'la request quedó scheduled'
);
select throws_ok(
  $$ insert into opsrun.request (received_at, status, owner_operator_id, bzzzbx_job_id, job_number, scheduled_at)
     values (now(), 'scheduled', '0a000000-0000-4000-8000-000000000021', 'bx-job-t023', 'J-023', now()) $$,
  'OP005', null,
  'una request no puede nacer scheduled sin pasar el gate'
);
select throws_ok(
  $$ update opsrun.request set bzzzbx_job_id = 'bx-job-t021' where id = 'b0000000-0000-4000-8000-000000000021' $$,
  '23514', null,
  'el crosswalk del job, el job number y la hora de programación van juntos'
);

-- ---------------------------------------------------------------------------
-- Confirmación vigente única
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
     values ('b0000000-0000-4000-8000-000000000022', 'details', 'operator', '{}', '0a000000-0000-4000-8000-000000000021') $$,
  '23505', null,
  'no hay dos confirmaciones vigentes del mismo tipo'
);
update opsrun.request_confirmation set superseded_at = now()
where request_id = 'b0000000-0000-4000-8000-000000000022' and kind = 'details' and superseded_at is null;
select lives_ok(
  $$ insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
     values ('b0000000-0000-4000-8000-000000000022', 'details', 'operator', '{}', '0a000000-0000-4000-8000-000000000021') $$,
  'al reemplazar la vigente, entra una nueva'
);
select throws_ok(
  $$ insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_kind, actor_operator_id)
     values ('b0000000-0000-4000-8000-000000000021', 'details', 'operator', '{}', 'ai', '0a000000-0000-4000-8000-000000000021') $$,
  '23514', null,
  'la IA no confirma: una confirmación siempre es de un operador'
);

-- ---------------------------------------------------------------------------
-- request_ai_marks
-- ---------------------------------------------------------------------------
insert into opsrun.instruction (id, request_id, type, idempotency_key, payload, actor_kind)
values ('c0000000-0000-4000-8000-000000000021', 'b0000000-0000-4000-8000-000000000021',
        'ai_analyze_request', 'modelo-ai', '{}', 'system');
insert into opsrun.ai_analysis (id, request_id, instruction_id, status, completed_at)
values ('e0000000-0000-4000-8000-000000000021', 'b0000000-0000-4000-8000-000000000021',
        'c0000000-0000-4000-8000-000000000021', 'completed', now());
insert into opsrun.ai_suggestion (id, request_id, ai_analysis_id, field, rank, value) values
  ('5a000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000021',
   'e0000000-0000-4000-8000-000000000021', 'unit', 1, '"4B"'),
  ('5a000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000021',
   'e0000000-0000-4000-8000-000000000021', 'unit', 2, '"4D"'),
  ('5a000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000021',
   'e0000000-0000-4000-8000-000000000021', 'beds', 1, '2'),
  ('5a000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000021',
   'e0000000-0000-4000-8000-000000000021', 'service_date', 1, '"2027-02-01"');

select results_eq(
  $$ select field, suggestion_id from opsrun.request_ai_marks
     where request_id = 'b0000000-0000-4000-8000-000000000021' order by field $$,
  $$ values ('beds', '5a000000-0000-4000-8000-000000000003'::uuid),
            ('service_date', '5a000000-0000-4000-8000-000000000004'::uuid),
            ('unit', '5a000000-0000-4000-8000-000000000001'::uuid) $$,
  'request_ai_marks muestra un campo por cada sugerencia principal sin decidir'
);

update opsrun.ai_suggestion
set decision = 'accepted', decided_by = '0a000000-0000-4000-8000-000000000021', decided_at = now()
where id = '5a000000-0000-4000-8000-000000000001';
update opsrun.ai_suggestion
set decision = 'corrected', final_value = '3', decided_by = '0a000000-0000-4000-8000-000000000021', decided_at = now()
where id = '5a000000-0000-4000-8000-000000000003';

select results_eq(
  $$ select field from opsrun.request_ai_marks where request_id = 'b0000000-0000-4000-8000-000000000021' $$,
  $$ values ('service_date') $$,
  'aceptar o corregir quita la marca AI del campo'
);
select throws_ok(
  $$ update opsrun.ai_suggestion set decision = 'corrected', decided_by = '0a000000-0000-4000-8000-000000000021', decided_at = now()
     where id = '5a000000-0000-4000-8000-000000000004' $$,
  '23514', null,
  'corregir exige el valor final'
);
select throws_ok(
  $$ update opsrun.ai_suggestion set decision = 'accepted' where id = '5a000000-0000-4000-8000-000000000004' $$,
  '23514', null,
  'aceptar exige quién y cuándo'
);

-- ---------------------------------------------------------------------------
-- instruction.status solo avanza
-- ---------------------------------------------------------------------------
insert into opsrun.instruction (id, request_id, type, idempotency_key, payload, actor_kind, actor_operator_id) values
  ('c0000000-0000-4000-8000-000000000022', 'b0000000-0000-4000-8000-000000000022', 'send_text', 'modelo-1', '{}',
   'operator', '0a000000-0000-4000-8000-000000000021'),
  ('c0000000-0000-4000-8000-000000000023', 'b0000000-0000-4000-8000-000000000022', 'send_email', 'modelo-2', '{}',
   'operator', '0a000000-0000-4000-8000-000000000021');

select lives_ok(
  $$ update opsrun.instruction set status = 'sent', sent_at = now(), attempts = 1
     where id = 'c0000000-0000-4000-8000-000000000022' $$,
  'pending → sent'
);
select throws_ok(
  $$ update opsrun.instruction set status = 'pending' where id = 'c0000000-0000-4000-8000-000000000022' $$,
  'OP004', null,
  'sent → pending no pasa'
);
select lives_ok(
  $$ update opsrun.instruction set status = 'confirmed', resolved_at = now()
     where id = 'c0000000-0000-4000-8000-000000000022' $$,
  'sent → confirmed'
);
select throws_ok(
  $$ update opsrun.instruction set status = 'failed' where id = 'c0000000-0000-4000-8000-000000000022' $$,
  'OP004', null,
  'confirmed es final: confirmed → failed no pasa'
);
select lives_ok(
  $$ update opsrun.instruction set status = 'failed', error_code = 'forced', error_message = 'Forced error', resolved_at = now()
     where id = 'c0000000-0000-4000-8000-000000000023' $$,
  'pending → failed (error forzado antes de enviar)'
);
select throws_ok(
  $$ update opsrun.instruction set status = 'sent' where id = 'c0000000-0000-4000-8000-000000000023' $$,
  'OP004', null,
  'failed es final: failed → sent no pasa'
);
select lives_ok(
  $$ update opsrun.instruction set attempts = 2 where id = 'c0000000-0000-4000-8000-000000000023' $$,
  'una instrucción final acepta cambios que no tocan el status'
);

-- ---------------------------------------------------------------------------
-- Cursores del write-back
-- ---------------------------------------------------------------------------
create temporary table seq_antes as
  select change_seq from opsrun.request where id = 'b0000000-0000-4000-8000-000000000021';
update opsrun.request set unit = '9Z' where id = 'b0000000-0000-4000-8000-000000000021';

select cmp_ok(
  (select change_seq from opsrun.request where id = 'b0000000-0000-4000-8000-000000000021'),
  '>',
  (select change_seq from seq_antes),
  'change_seq avanza en cada UPDATE'
);
select ok(
  (select count(distinct change_seq) = count(*) from (
     select change_seq from opsrun.request
     union all select change_seq from opsrun.instruction
     union all select change_seq from opsrun.operator
   ) as t),
  'change_seq sale de una secuencia global: no se repite entre tablas'
);

-- ---------------------------------------------------------------------------
-- Cleaner confirmation: la IA no decide
-- ---------------------------------------------------------------------------
insert into opsrun.cleaner_confirmation (id, request_id, purpose, bzzzbx_team_id, actor_kind, actor_operator_id)
values ('d0000000-0000-4000-8000-000000000021', 'b0000000-0000-4000-8000-000000000021', 'initial',
        'bx-team-t021', 'operator', '0a000000-0000-4000-8000-000000000021');

select throws_ok(
  $$ update opsrun.cleaner_confirmation set status = 'confirmed' where id = 'd0000000-0000-4000-8000-000000000021' $$,
  '23514', null,
  'una respuesta del cleaner solo queda confirmed con un operador'
);
select throws_ok(
  $$ insert into opsrun.cleaner_confirmation (request_id, purpose, bzzzbx_team_id, actor_kind)
     values ('b0000000-0000-4000-8000-000000000021', 'reschedule', 'bx-team-t021', 'system') $$,
  '23514', null,
  'un Reschedule exige motivo'
);

select * from finish();
rollback;

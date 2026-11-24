-- OPR-20 · Pruebas funcionales del modelo de datos (no son guards).
--
-- Gate de Schedule, request_ai_marks, transiciones de instruction.status,
-- confirmación vigente única, cursores del write-back y helpers de operador.
begin;
create extension if not exists pgtap with schema extensions;

select plan(36);

-- Fixture
insert into auth.users (id, email) values
  ('aa000000-0000-4000-8000-000000000021', 'modelo.uno@example.test');

insert into public.operator (id, auth_user_id, email, display_name, team) values
  ('0a000000-0000-4000-8000-000000000021', 'aa000000-0000-4000-8000-000000000021',
   'modelo.uno@example.test', 'Operador Uno', 'operations'),
  ('0a000000-0000-4000-8000-000000000022', null, 'modelo.dos@example.test', 'Operador Dos', 'finance');

insert into public.request (id, received_at, owner_operator_id) values
  ('b0000000-0000-4000-8000-000000000021', now(), null),
  ('b0000000-0000-4000-8000-000000000022', now(), '0a000000-0000-4000-8000-000000000021');

-- ---------------------------------------------------------------------------
-- Esquemas, rol y vistas
-- ---------------------------------------------------------------------------
select has_schema('private', 'existe el esquema private');
select has_schema('writeback', 'existe el esquema writeback');
select has_role('bzzzbx_reader', 'existe el rol bzzzbx_reader');
select ok(
  not (select rolcanlogin from pg_catalog.pg_roles where rolname = 'bzzzbx_reader'),
  'bzzzbx_reader nace NOLOGIN; el login se da en el servidor'
);
select hasnt_column('writeback', 'v1_operator', 'email', 'el write-back no saca el correo de los operadores');
select has_column('writeback', 'v1_request', 'change_seq', 'el write-back expone el cursor change_seq');

-- ---------------------------------------------------------------------------
-- Helpers de operador
-- ---------------------------------------------------------------------------
select is(private.current_operator_id(), null::uuid, 'sin JWT no hay operador');
select throws_ok('select private.require_operator()', '42501', null,
  'require_operator() falla sin operador activo');

do $$ begin perform set_config('request.jwt.claims', '{"sub": "aa000000-0000-4000-8000-000000000021", "role": "authenticated"}', true); end $$;
select is(private.current_operator_id(), '0a000000-0000-4000-8000-000000000021'::uuid,
  'con JWT, current_operator_id() da el operador enlazado');
select is(private.require_operator(), '0a000000-0000-4000-8000-000000000021'::uuid,
  'con JWT, require_operator() da el operador enlazado');

update public.operator set active = false where id = '0a000000-0000-4000-8000-000000000021';
select is(private.current_operator_id(), null::uuid, 'un operador desactivado deja de contar');
update public.operator set active = true where id = '0a000000-0000-4000-8000-000000000021';
do $$ begin perform set_config('request.jwt.claims', '', true); end $$;

-- ---------------------------------------------------------------------------
-- Gate de Schedule
-- ---------------------------------------------------------------------------
create function pg_temp.programar(p_request uuid, p_job text)
returns void
language sql
as $$
  update public.request
  set status = 'scheduled', bzzzbx_job_id = p_job, job_number = 'J-' || p_job, scheduled_at = now()
  where id = p_request;
$$;

select throws_ok(
  $$ select pg_temp.programar('b0000000-0000-4000-8000-000000000021', 'bx-job-t021') $$,
  'OP005', null,
  'Schedule exige dueño'
);

insert into public.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id) values
  ('b0000000-0000-4000-8000-000000000022', 'details', 'operator', '{}', '0a000000-0000-4000-8000-000000000021'),
  ('b0000000-0000-4000-8000-000000000022', 'sender', 'operator', '{}', '0a000000-0000-4000-8000-000000000021');

select throws_ok(
  $$ select pg_temp.programar('b0000000-0000-4000-8000-000000000022', 'bx-job-t022') $$,
  'OP005', 'opsRUN: Schedule exige confirmación vigente de: cleaner',
  'Schedule exige las tres confirmaciones (falta cleaner)'
);

insert into public.request_confirmation (id, request_id, kind, method, confirmed_value, actor_operator_id, superseded_at)
values ('f0000000-0000-4000-8000-000000000021', 'b0000000-0000-4000-8000-000000000022', 'cleaner', 'phone', '{}',
        '0a000000-0000-4000-8000-000000000021', now());

select throws_ok(
  $$ select pg_temp.programar('b0000000-0000-4000-8000-000000000022', 'bx-job-t022') $$,
  'OP005', null,
  'una confirmación reemplazada no cuenta para Schedule'
);

insert into public.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
values ('b0000000-0000-4000-8000-000000000022', 'cleaner', 'phone', '{}', '0a000000-0000-4000-8000-000000000021');

select lives_ok(
  $$ select pg_temp.programar('b0000000-0000-4000-8000-000000000022', 'bx-job-t022') $$,
  'con dueño y las tres confirmaciones vigentes, Schedule pasa'
);
select is(
  (select status from public.request where id = 'b0000000-0000-4000-8000-000000000022'),
  'scheduled'::public.request_status,
  'la request quedó scheduled'
);
select throws_ok(
  $$ insert into public.request (received_at, status, owner_operator_id, bzzzbx_job_id, job_number, scheduled_at)
     values (now(), 'scheduled', '0a000000-0000-4000-8000-000000000021', 'bx-job-t023', 'J-023', now()) $$,
  'OP005', null,
  'una request no puede nacer scheduled sin pasar el gate'
);
select throws_ok(
  $$ update public.request set bzzzbx_job_id = 'bx-job-t021' where id = 'b0000000-0000-4000-8000-000000000021' $$,
  '23514', null,
  'el crosswalk del job, el job number y la hora de programación van juntos'
);

-- ---------------------------------------------------------------------------
-- Confirmación vigente única
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
     values ('b0000000-0000-4000-8000-000000000022', 'details', 'operator', '{}', '0a000000-0000-4000-8000-000000000021') $$,
  '23505', null,
  'no hay dos confirmaciones vigentes del mismo tipo'
);
update public.request_confirmation set superseded_at = now()
where request_id = 'b0000000-0000-4000-8000-000000000022' and kind = 'details' and superseded_at is null;
select lives_ok(
  $$ insert into public.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
     values ('b0000000-0000-4000-8000-000000000022', 'details', 'operator', '{}', '0a000000-0000-4000-8000-000000000021') $$,
  'al reemplazar la vigente, entra una nueva'
);
select throws_ok(
  $$ insert into public.request_confirmation (request_id, kind, method, confirmed_value, actor_kind, actor_operator_id)
     values ('b0000000-0000-4000-8000-000000000021', 'details', 'operator', '{}', 'ai', '0a000000-0000-4000-8000-000000000021') $$,
  '23514', null,
  'la IA no confirma: una confirmación siempre es de un operador'
);

-- ---------------------------------------------------------------------------
-- request_ai_marks
-- ---------------------------------------------------------------------------
insert into public.instruction (id, request_id, type, idempotency_key, payload, actor_kind)
values ('c0000000-0000-4000-8000-000000000021', 'b0000000-0000-4000-8000-000000000021',
        'ai_analyze_request', 'modelo-ai', '{}', 'system');
insert into public.ai_analysis (id, request_id, instruction_id, status)
values ('e0000000-0000-4000-8000-000000000021', 'b0000000-0000-4000-8000-000000000021',
        'c0000000-0000-4000-8000-000000000021', 'completed');
insert into public.ai_suggestion (id, request_id, ai_analysis_id, field, rank, value) values
  ('5a000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000021',
   'e0000000-0000-4000-8000-000000000021', 'unit', 1, '"4B"'),
  ('5a000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000021',
   'e0000000-0000-4000-8000-000000000021', 'unit', 2, '"4D"'),
  ('5a000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000021',
   'e0000000-0000-4000-8000-000000000021', 'beds', 1, '2'),
  ('5a000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000021',
   'e0000000-0000-4000-8000-000000000021', 'service_date', 1, '"2027-02-01"');

select results_eq(
  $$ select field, suggestion_id from public.request_ai_marks
     where request_id = 'b0000000-0000-4000-8000-000000000021' order by field $$,
  $$ values ('beds', '5a000000-0000-4000-8000-000000000003'::uuid),
            ('service_date', '5a000000-0000-4000-8000-000000000004'::uuid),
            ('unit', '5a000000-0000-4000-8000-000000000001'::uuid) $$,
  'request_ai_marks muestra un campo por cada sugerencia principal sin decidir'
);

update public.ai_suggestion
set decision = 'accepted', decided_by = '0a000000-0000-4000-8000-000000000021', decided_at = now()
where id = '5a000000-0000-4000-8000-000000000001';
update public.ai_suggestion
set decision = 'corrected', final_value = '3', decided_by = '0a000000-0000-4000-8000-000000000021', decided_at = now()
where id = '5a000000-0000-4000-8000-000000000003';

select results_eq(
  $$ select field from public.request_ai_marks where request_id = 'b0000000-0000-4000-8000-000000000021' $$,
  $$ values ('service_date') $$,
  'aceptar o corregir quita la marca AI del campo'
);
select throws_ok(
  $$ update public.ai_suggestion set decision = 'corrected', decided_by = '0a000000-0000-4000-8000-000000000021', decided_at = now()
     where id = '5a000000-0000-4000-8000-000000000004' $$,
  '23514', null,
  'corregir exige el valor final'
);
select throws_ok(
  $$ update public.ai_suggestion set decision = 'accepted' where id = '5a000000-0000-4000-8000-000000000004' $$,
  '23514', null,
  'aceptar exige quién y cuándo'
);

-- ---------------------------------------------------------------------------
-- instruction.status solo avanza
-- ---------------------------------------------------------------------------
insert into public.instruction (id, request_id, type, idempotency_key, payload, actor_kind, actor_operator_id) values
  ('c0000000-0000-4000-8000-000000000022', 'b0000000-0000-4000-8000-000000000022', 'send_text', 'modelo-1', '{}',
   'operator', '0a000000-0000-4000-8000-000000000021'),
  ('c0000000-0000-4000-8000-000000000023', 'b0000000-0000-4000-8000-000000000022', 'send_email', 'modelo-2', '{}',
   'operator', '0a000000-0000-4000-8000-000000000021');

select lives_ok(
  $$ update public.instruction set status = 'sent', sent_at = now(), attempts = 1
     where id = 'c0000000-0000-4000-8000-000000000022' $$,
  'pending → sent'
);
select throws_ok(
  $$ update public.instruction set status = 'pending' where id = 'c0000000-0000-4000-8000-000000000022' $$,
  'OP004', null,
  'sent → pending no pasa'
);
select lives_ok(
  $$ update public.instruction set status = 'confirmed', resolved_at = now()
     where id = 'c0000000-0000-4000-8000-000000000022' $$,
  'sent → confirmed'
);
select throws_ok(
  $$ update public.instruction set status = 'failed' where id = 'c0000000-0000-4000-8000-000000000022' $$,
  'OP004', null,
  'confirmed es final: confirmed → failed no pasa'
);
select lives_ok(
  $$ update public.instruction set status = 'failed', error_code = 'forced', error_message = 'Forced error', resolved_at = now()
     where id = 'c0000000-0000-4000-8000-000000000023' $$,
  'pending → failed (error forzado antes de enviar)'
);
select throws_ok(
  $$ update public.instruction set status = 'sent' where id = 'c0000000-0000-4000-8000-000000000023' $$,
  'OP004', null,
  'failed es final: failed → sent no pasa'
);
select lives_ok(
  $$ update public.instruction set attempts = 2 where id = 'c0000000-0000-4000-8000-000000000023' $$,
  'una instrucción final acepta cambios que no tocan el status'
);

-- ---------------------------------------------------------------------------
-- Cursores del write-back
-- ---------------------------------------------------------------------------
create temporary table seq_antes as
  select change_seq from public.request where id = 'b0000000-0000-4000-8000-000000000021';
update public.request set unit = '9Z' where id = 'b0000000-0000-4000-8000-000000000021';

select cmp_ok(
  (select change_seq from public.request where id = 'b0000000-0000-4000-8000-000000000021'),
  '>',
  (select change_seq from seq_antes),
  'change_seq avanza en cada UPDATE'
);
select ok(
  (select count(distinct change_seq) = count(*) from (
     select change_seq from public.request
     union all select change_seq from public.instruction
     union all select change_seq from public.operator
   ) as t),
  'change_seq sale de una secuencia global: no se repite entre tablas'
);

-- ---------------------------------------------------------------------------
-- Cleaner confirmation: la IA no decide
-- ---------------------------------------------------------------------------
insert into public.cleaner_confirmation (id, request_id, purpose, bzzzbx_team_id, actor_kind, actor_operator_id)
values ('d0000000-0000-4000-8000-000000000021', 'b0000000-0000-4000-8000-000000000021', 'initial',
        'bx-team-t021', 'operator', '0a000000-0000-4000-8000-000000000021');

select throws_ok(
  $$ update public.cleaner_confirmation set status = 'confirmed' where id = 'd0000000-0000-4000-8000-000000000021' $$,
  '23514', null,
  'una respuesta del cleaner solo queda confirmed con un operador'
);
select throws_ok(
  $$ insert into public.cleaner_confirmation (request_id, purpose, bzzzbx_team_id, actor_kind)
     values ('b0000000-0000-4000-8000-000000000021', 'reschedule', 'bx-team-t021', 'system') $$,
  '23514', null,
  'un Reschedule exige motivo'
);

select * from finish();
rollback;

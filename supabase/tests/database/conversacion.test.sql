-- OPR-27 · Conversación (spec docs/spec/opr-27-conversacion.md §8 y §11.2).
-- Pruebas funcionales de las seis funciones de la migración
-- 20261130120000_conversacion.sql: add_note, send_email, send_text,
-- discard_ai_draft, record_instruction_delivery y resolve_instruction.
--
-- Las llamadas van como opsrun_app, el rol del servidor, con el actor de la
-- transacción fijado como lo fija el pool (opsrun.auth_user_id u
-- opsrun.system_actor). Los datos de prueba los pone el dueño de los esquemas;
-- el rollback lo deshace.
--
-- Que cada función exija su actor (operador o sistema) lo prueban, además, G5
-- y G6 (guard_funciones.test.sql), que las descubren solas por pg_proc. Este
-- archivo fija una por una que sin actor, o con el equivocado, fallan.
begin;
create extension if not exists pgtap with schema extensions;

select plan(103);

grant opsrun_migrador to current_user with inherit true, set true;
-- Para llamar como opsrun_app con SET ROLE, como el pool. Sin herencia: lo
-- que prueba es lo que opsrun_app tiene, no lo que tiene quien corre el test.
grant opsrun_app to current_user with inherit false, set true;

-- Fixture (datos inventados)
insert into opsrun.operator (id, auth_user_id, email, display_name, team) values
  ('0a000000-0000-4000-8000-000000000041', 'aa000000-0000-4000-8000-000000000041',
   'conversacion.uno@example.test', 'Operador Conversacion', 'operations');

insert into opsrun.request (id, received_at, owner_operator_id, bzzzbx_customer_id, bzzzbx_property_id) values
  ('b0000000-0000-4000-8000-000000000041', now(), '0a000000-0000-4000-8000-000000000041', 'bx-cust-t-01', 'bx-prop-t-01'),
  ('b0000000-0000-4000-8000-000000000042', now(), '0a000000-0000-4000-8000-000000000041', 'bx-cust-t-01', 'bx-prop-t-01');

-- El original de cada request, cada uno en su hilo.
insert into opsrun.request_message (request_id, bzzzbx_message_id, bzzzbx_thread_id, channel, direction, is_original, actor_kind) values
  ('b0000000-0000-4000-8000-000000000041', 'bx-msg-t-0041', 'bx-thread-t-0041', 'email', 'inbound', true, 'system'),
  ('b0000000-0000-4000-8000-000000000042', 'bx-msg-t-0042', 'bx-thread-t-0042', 'email', 'inbound', true, 'system');

-- Borradores de IA: de la request 41 (correo y texto), de la 42, y uno ya decidido.
insert into opsrun.ai_suggestion (id, request_id, field, rank, value, reason, decision, final_value, decided_by, decided_at) values
  ('5a000000-0000-4000-8000-000000000041', 'b0000000-0000-4000-8000-000000000041', 'draft_customer_reply', 1,
   '{"body": "Hello, your cleaning is scheduled."}', 'Reply to the request.', null, null, null, null),
  ('5a000000-0000-4000-8000-000000000042', 'b0000000-0000-4000-8000-000000000041', 'draft_customer_reply', 1,
   '{"body": "Second draft."}', 'Reply to the request.', null, null, null, null),
  ('5a000000-0000-4000-8000-000000000043', 'b0000000-0000-4000-8000-000000000041', 'draft_cleaner_text', 1,
   '{"body": "Can you take the job?"}', 'Ask the cleaner.', null, null, null, null),
  ('5a000000-0000-4000-8000-000000000044', 'b0000000-0000-4000-8000-000000000042', 'draft_customer_reply', 1,
   '{"body": "Draft of another request."}', 'Reply.', null, null, null, null),
  ('5a000000-0000-4000-8000-000000000045', 'b0000000-0000-4000-8000-000000000041', 'draft_customer_reply', 1,
   '{"body": "Already decided."}', 'Reply.', 'rejected', null, '0a000000-0000-4000-8000-000000000041', now()),
  ('5a000000-0000-4000-8000-000000000046', 'b0000000-0000-4000-8000-000000000041', 'beds', 1,
   '3', 'Not a draft.', null, null, null, null),
  ('5a000000-0000-4000-8000-000000000047', 'b0000000-0000-4000-8000-000000000041', 'draft_customer_reply', 1,
   '{"body": "Draft to discard."}', 'Reply.', null, null, null, null),
  ('5a000000-0000-4000-8000-000000000048', 'b0000000-0000-4000-8000-000000000041', 'draft_cleaner_text', 1,
   '{"body": "Cleaner draft to discard."}', 'Ask.', null, null, null, null);

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

-- La llamada bajo prueba corre como opsrun_app; pgTAP sigue corriendo como
-- quien corre el test. Si la llamada falla, el SET LOCAL se deshace con la
-- subtransacción de throws_ok.
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
select ok(has_function_privilege('opsrun_app', 'opsrun.add_note(uuid, text)', 'execute'), 'opsrun_app ejecuta add_note');
select ok(has_function_privilege('opsrun_app', 'opsrun.send_email(uuid, text, text, text, uuid)', 'execute'), 'opsrun_app ejecuta send_email');
select ok(has_function_privilege('opsrun_app', 'opsrun.send_text(uuid, text, text, text, uuid)', 'execute'), 'opsrun_app ejecuta send_text');
select ok(has_function_privilege('opsrun_app', 'opsrun.discard_ai_draft(uuid)', 'execute'), 'opsrun_app ejecuta discard_ai_draft');
select ok(has_function_privilege('opsrun_app', 'opsrun.record_instruction_delivery(text, text)', 'execute'), 'opsrun_app ejecuta record_instruction_delivery');
select ok(has_function_privilege('opsrun_app', 'opsrun.resolve_instruction(text, opsrun.instruction_status, text, text, text, text)', 'execute'),
  'opsrun_app ejecuta resolve_instruction');
select ok(not has_function_privilege('authenticated', 'opsrun.send_email(uuid, text, text, text, uuid)', 'execute'),
  'authenticated no ejecuta send_email');
select ok(not has_function_privilege('public', 'opsrun.resolve_instruction(text, opsrun.instruction_status, text, text, text, text)', 'execute'),
  'PUBLIC no ejecuta resolve_instruction');

-- ---------------------------------------------------------------------------
-- Las del operador fallan sin actor y con un actor de sistema
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.actor(null, null); end $$;
select throws_ok($$select pg_temp.como_app($q$select opsrun.add_note('b0000000-0000-4000-8000-000000000041', 'x')$q$)$$,
  '42501', null, 'sin actor, add_note falla');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000041', 'bx-thread-t-0041', 'x', 'k-sin-actor-1')$q$)$$,
  '42501', null, 'sin actor, send_email falla');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_text('b0000000-0000-4000-8000-000000000041', 'bx-team-t-01', 'x', 'k-sin-actor-2')$q$)$$,
  '42501', null, 'sin actor, send_text falla');
select throws_ok($$select pg_temp.como_app($q$select opsrun.discard_ai_draft('5a000000-0000-4000-8000-000000000047')$q$)$$,
  '42501', null, 'sin actor, discard_ai_draft falla');

do $$ begin perform pg_temp.actor(null, 'reconciliador'); end $$;
select throws_ok($$select pg_temp.como_app($q$select opsrun.add_note('b0000000-0000-4000-8000-000000000041', 'x')$q$)$$,
  '42501', null, 'con un actor de sistema, add_note falla');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000041', 'bx-thread-t-0041', 'x', 'k-sistema-1')$q$)$$,
  '42501', null, 'con un actor de sistema, send_email falla (nada sale solo)');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_text('b0000000-0000-4000-8000-000000000041', 'bx-team-t-01', 'x', 'k-sistema-2')$q$)$$,
  '42501', null, 'con un actor de sistema, send_text falla (nada sale solo)');
select throws_ok($$select pg_temp.como_app($q$select opsrun.discard_ai_draft('5a000000-0000-4000-8000-000000000047')$q$)$$,
  '42501', null, 'con un actor de sistema, discard_ai_draft falla');
select is((select count(*)::int from opsrun.instruction where request_id = 'b0000000-0000-4000-8000-000000000041'), 0,
  'ningún intento sin operador creó una instrucción');

-- ---------------------------------------------------------------------------
-- add_note
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000041', null); end $$;

select throws_ok($$select pg_temp.como_app($q$select opsrun.add_note('b0000000-0000-4000-8000-000000000041', '')$q$)$$,
  '22023', null, 'una nota vacía no se guarda');
select throws_ok($$select pg_temp.como_app($q$select opsrun.add_note('b0000000-0000-4000-8000-000000000041', E'  \n\t ')$q$)$$,
  '22023', null, 'una nota de solo espacios no se guarda');
select throws_ok($$select pg_temp.como_app($q$select opsrun.add_note('b0000000-0000-4000-8000-000000000041', null)$q$)$$,
  '22023', null, 'una nota nula no se guarda');
select throws_ok($$select pg_temp.como_app(format($q$select opsrun.add_note('b0000000-0000-4000-8000-000000000041', %L)$q$, repeat('x', 4001)))$$,
  '22023', null, 'una nota de más de 4000 caracteres no se guarda');
select throws_ok($$select pg_temp.como_app($q$select opsrun.add_note('b0000000-0000-4000-8000-0000000000ff', 'Hola')$q$)$$,
  'OP006', null, 'una nota de una request que no existe no se guarda');
select is((select count(*)::int from opsrun.note where request_id = 'b0000000-0000-4000-8000-000000000041'), 0,
  'los intentos fallidos no dejaron ninguna nota');

select lives_ok($$select pg_temp.como_app($q$select opsrun.add_note('b0000000-0000-4000-8000-000000000041', '  Requester prefers mornings.  ')$q$)$$,
  'el operador escribe una nota');
select results_eq(
  $$select body, author_operator_id from opsrun.note where request_id = 'b0000000-0000-4000-8000-000000000041'$$,
  $$values ('Requester prefers mornings.', '0a000000-0000-4000-8000-000000000041'::uuid)$$,
  'la nota queda recortada y con su autor'
);
select results_eq(
  $$select a.event_type, a.actor_kind::text, a.actor_operator_id, (a.details ->> 'note_id')::uuid = n.id
      from opsrun.audit_event as a, opsrun.note as n
     where a.request_id = 'b0000000-0000-4000-8000-000000000041' and n.request_id = a.request_id
       and a.event_type = 'note_added'$$,
  $$values ('note_added', 'operator', '0a000000-0000-4000-8000-000000000041'::uuid, true)$$,
  'la nota deja note_added en Audit, con el operador y details.note_id'
);

-- ---------------------------------------------------------------------------
-- send_email
-- ---------------------------------------------------------------------------
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000041', 'bx-thread-t-0041', '   ', 'k-vacio')$q$)$$,
  '22023', null, 'un correo vacío no se guarda');
select throws_ok($$select pg_temp.como_app(format($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000041', 'bx-thread-t-0041', %L, 'k-largo')$q$, repeat('x', 10001)))$$,
  '22023', null, 'un correo de más de 10000 caracteres no se guarda');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000041', 'bx-thread-t-0041', 'Hola', '  ')$q$)$$,
  '22023', null, 'sin clave de idempotencia no se guarda');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000041', 'bx-thread-t-0042', 'Hola', 'k-otro-hilo')$q$)$$,
  'OP009', null, 'un hilo de otra request no se acepta');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000041', 'bx-thread-inexistente', 'Hola', 'k-sin-hilo')$q$)$$,
  'OP009', null, 'un hilo que no existe no se acepta');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-0000000000ff', 'bx-thread-t-0041', 'Hola', 'k-sin-request')$q$)$$,
  'OP006', null, 'una request que no existe no se acepta');
select is((select count(*)::int from opsrun.instruction where request_id = 'b0000000-0000-4000-8000-000000000041'), 0,
  'los intentos fallidos no crearon ninguna instrucción');

select lives_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000041', 'bx-thread-t-0041', '  Hola, ya está. ', 'k-correo-1')$q$)$$,
  'el operador guarda un correo en el hilo de la request');
select results_eq(
  $$select type, status::text, actor_kind::text, actor_operator_id, payload from opsrun.instruction where idempotency_key = 'k-correo-1'$$,
  $$values ('send_email', 'pending', 'operator', '0a000000-0000-4000-8000-000000000041'::uuid,
            '{"bzzzbx_thread_id": "bx-thread-t-0041", "body": "Hola, ya está."}'::jsonb)$$,
  'la instrucción queda pending, del operador, con solo el hilo y el cuerpo en el payload'
);
select is(
  (select array_agg(k order by k) from opsrun.instruction, jsonb_object_keys(payload) as k where idempotency_key = 'k-correo-1'),
  array['body', 'bzzzbx_thread_id'],
  'el payload no trae ni direcciones ni destinatarios'
);
select results_eq(
  $$select a.event_type, a.actor_operator_id, a.instruction_id = i.id
      from opsrun.audit_event as a join opsrun.instruction as i on i.id = a.instruction_id
     where i.idempotency_key = 'k-correo-1'$$,
  $$values ('email_sent', '0a000000-0000-4000-8000-000000000041'::uuid, true)$$,
  'el correo deja email_sent en Audit con su instruction_id'
);
select lives_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000041', 'bx-thread-t-0041', 'Hola, ya está.', 'k-correo-1')$q$)$$,
  'repetir la misma clave no falla');
select is((select count(*)::int from opsrun.instruction where idempotency_key = 'k-correo-1'), 1,
  'repetir la misma clave no duplica la instrucción');
select is((select count(*)::int from opsrun.audit_event where event_type = 'email_sent' and request_id = 'b0000000-0000-4000-8000-000000000041'), 1,
  'repetir la misma clave no duplica el Audit');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000042', 'bx-thread-t-0042', 'Hola', 'k-correo-1')$q$)$$,
  'OP012', null, 'una clave que ya es de otra request no se reutiliza');

-- ---------------------------------------------------------------------------
-- send_text
-- ---------------------------------------------------------------------------
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_text('b0000000-0000-4000-8000-000000000041', 'bx-team-t-01', '', 'k-texto-vacio')$q$)$$,
  '22023', null, 'un texto vacío no se guarda');
select throws_ok($$select pg_temp.como_app(format($q$select opsrun.send_text('b0000000-0000-4000-8000-000000000041', 'bx-team-t-01', %L, 'k-texto-largo')$q$, repeat('x', 1601)))$$,
  '22023', null, 'un texto de más de 1600 caracteres no se guarda');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_text('b0000000-0000-4000-8000-000000000041', ' ', 'Hola', 'k-texto-sin-equipo')$q$)$$,
  '22023', null, 'sin equipo no se guarda el texto');
select lives_ok($$select pg_temp.como_app($q$select opsrun.send_text('b0000000-0000-4000-8000-000000000041', 'bx-team-t-01', 'Can you confirm?', 'k-texto-1')$q$)$$,
  'el operador guarda un texto al cleaner');
select results_eq(
  $$select type, status::text, payload from opsrun.instruction where idempotency_key = 'k-texto-1'$$,
  $$values ('send_text', 'pending', '{"bzzzbx_team_id": "bx-team-t-01", "body": "Can you confirm?"}'::jsonb)$$,
  'el texto queda pending con solo el equipo y el cuerpo en el payload'
);
select results_eq(
  $$select a.event_type, a.instruction_id = i.id from opsrun.audit_event as a join opsrun.instruction as i on i.id = a.instruction_id
     where i.idempotency_key = 'k-texto-1'$$,
  $$values ('text_sent', true)$$,
  'el texto deja text_sent en Audit con su instruction_id'
);

-- ---------------------------------------------------------------------------
-- Borradores de IA
-- ---------------------------------------------------------------------------
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000041', 'bx-thread-t-0041', 'Hola', 'k-borr-otra', '5a000000-0000-4000-8000-000000000044')$q$)$$,
  'OP010', null, 'un borrador de otra request no se acepta');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000041', 'bx-thread-t-0041', 'Hola', 'k-borr-campo', '5a000000-0000-4000-8000-000000000043')$q$)$$,
  'OP010', null, 'un borrador de otro canal no se acepta en un correo');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000041', 'bx-thread-t-0041', 'Hola', 'k-borr-campo-2', '5a000000-0000-4000-8000-000000000046')$q$)$$,
  'OP010', null, 'un campo que no es un borrador no se acepta');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000041', 'bx-thread-t-0041', 'Hola', 'k-borr-decidido', '5a000000-0000-4000-8000-000000000045')$q$)$$,
  'OP010', null, 'un borrador ya decidido no se acepta');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_text('b0000000-0000-4000-8000-000000000041', 'bx-team-t-01', 'Hola', 'k-borr-canal', '5a000000-0000-4000-8000-000000000041')$q$)$$,
  'OP010', null, 'un borrador de correo no se acepta en un texto');
select is((select count(*)::int from opsrun.instruction where idempotency_key like 'k-borr-%'), 0,
  'un borrador inválido no deja ninguna instrucción');
select is((select count(*)::int from opsrun.ai_suggestion where id in
  ('5a000000-0000-4000-8000-000000000041', '5a000000-0000-4000-8000-000000000043', '5a000000-0000-4000-8000-000000000044') and decision is not null), 0,
  'un borrador inválido no decide ningún otro');

select lives_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000041', 'bx-thread-t-0041', '  Hello, your cleaning is scheduled. ', 'k-borr-igual', '5a000000-0000-4000-8000-000000000041')$q$)$$,
  'enviar el borrador tal cual lo acepta');
select results_eq(
  $$select decision::text, final_value, decided_by from opsrun.ai_suggestion where id = '5a000000-0000-4000-8000-000000000041'$$,
  $$values ('accepted', null::jsonb, '0a000000-0000-4000-8000-000000000041'::uuid)$$,
  'un cuerpo igual al propuesto deja el borrador accepted'
);
select results_eq(
  $$select event_type, instruction_id = (select id from opsrun.instruction where idempotency_key = 'k-borr-igual')
      from opsrun.audit_event where ai_suggestion_id = '5a000000-0000-4000-8000-000000000041'$$,
  $$values ('ai_suggestion_accepted', true)$$,
  'aceptar un borrador deja ai_suggestion_accepted en Audit'
);

select lives_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000041', 'bx-thread-t-0041', 'Hello, we scheduled it for Friday.', 'k-borr-distinto', '5a000000-0000-4000-8000-000000000042')$q$)$$,
  'enviar un cuerpo distinto del borrador lo corrige');
select results_eq(
  $$select decision::text, final_value from opsrun.ai_suggestion where id = '5a000000-0000-4000-8000-000000000042'$$,
  $$values ('corrected', '{"body": "Hello, we scheduled it for Friday."}'::jsonb)$$,
  'un cuerpo distinto deja el borrador corrected con su final_value'
);
select is((select count(*)::int from opsrun.audit_event where ai_suggestion_id = '5a000000-0000-4000-8000-000000000042' and event_type = 'ai_suggestion_corrected'), 1,
  'corregir un borrador deja ai_suggestion_corrected en Audit');

select lives_ok($$select pg_temp.como_app($q$select opsrun.send_text('b0000000-0000-4000-8000-000000000041', 'bx-team-t-01', 'Can you take the job on Friday?', 'k-borr-texto', '5a000000-0000-4000-8000-000000000043')$q$)$$,
  'un texto puede decidir su borrador');
select is((select decision::text from opsrun.ai_suggestion where id = '5a000000-0000-4000-8000-000000000043'), 'corrected',
  'el borrador del texto queda corrected');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000041', 'bx-thread-t-0041', 'Hello, your cleaning is scheduled.', 'k-borr-otra-vez', '5a000000-0000-4000-8000-000000000041')$q$)$$,
  'OP010', null, 'un borrador ya decidido no se vuelve a usar');

-- discard_ai_draft
select throws_ok($$select pg_temp.como_app($q$select opsrun.discard_ai_draft('5a000000-0000-4000-8000-000000000046')$q$)$$,
  'OP010', null, 'discard_ai_draft no descarta un campo que no es un borrador');
select throws_ok($$select pg_temp.como_app($q$select opsrun.discard_ai_draft('5a000000-0000-4000-8000-000000000045')$q$)$$,
  'OP010', null, 'discard_ai_draft no descarta un borrador ya decidido');
select throws_ok($$select pg_temp.como_app($q$select opsrun.discard_ai_draft('5a000000-0000-4000-8000-0000000000ff')$q$)$$,
  'OP010', null, 'discard_ai_draft no descarta un borrador que no existe');
select lives_ok($$select pg_temp.como_app($q$select opsrun.discard_ai_draft('5a000000-0000-4000-8000-000000000047')$q$)$$,
  'el operador descarta un borrador');
select results_eq(
  $$select decision::text, decided_by from opsrun.ai_suggestion where id = '5a000000-0000-4000-8000-000000000047'$$,
  $$values ('rejected', '0a000000-0000-4000-8000-000000000041'::uuid)$$,
  'descartar deja el borrador rejected con el operador'
);
select results_eq(
  $$select event_type, request_id from opsrun.audit_event where ai_suggestion_id = '5a000000-0000-4000-8000-000000000047'$$,
  $$values ('ai_suggestion_rejected', 'b0000000-0000-4000-8000-000000000041'::uuid)$$,
  'descartar deja ai_suggestion_rejected en Audit'
);
select is((select count(*)::int from opsrun.instruction where idempotency_key in ('k-borr-descartar')), 0,
  'descartar un borrador no crea ninguna instrucción');

-- ---------------------------------------------------------------------------
-- Las del sistema fallan sin actor y con un operador
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.actor(null, null); end $$;
select throws_ok($$select pg_temp.como_app($q$select opsrun.record_instruction_delivery('k-correo-1', 'bx-ref-t-1')$q$)$$,
  '42501', null, 'sin actor, record_instruction_delivery falla');
select throws_ok($$select pg_temp.como_app($q$select opsrun.resolve_instruction('k-correo-1', 'failed', null, 'e', 'm')$q$)$$,
  '42501', null, 'sin actor, resolve_instruction falla');
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000041', null); end $$;
select throws_ok($$select pg_temp.como_app($q$select opsrun.record_instruction_delivery('k-correo-1', 'bx-ref-t-1')$q$)$$,
  '42501', null, 'con un operador, record_instruction_delivery falla');
select throws_ok($$select pg_temp.como_app($q$select opsrun.resolve_instruction('k-correo-1', 'failed', null, 'e', 'm')$q$)$$,
  '42501', null, 'con un operador, resolve_instruction falla');

-- ---------------------------------------------------------------------------
-- record_instruction_delivery y resolve_instruction, como sistema
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.actor(null, 'despacho'); end $$;

select throws_ok($$select pg_temp.como_app($q$select opsrun.record_instruction_delivery('k-no-existe', 'bx-ref-t-0')$q$)$$,
  'OP011', null, 'record_instruction_delivery no acusa una instrucción que no existe');
select throws_ok($$select pg_temp.como_app($q$select opsrun.record_instruction_delivery('k-correo-1', ' ')$q$)$$,
  '22023', null, 'record_instruction_delivery exige la referencia');
select lives_ok($$select pg_temp.como_app($q$select opsrun.record_instruction_delivery('k-correo-1', 'bx-ref-t-1')$q$)$$,
  'el sistema acusa la instrucción');
select results_eq(
  $$select status::text, bzzzbx_reference, attempts::int, sent_at is not null from opsrun.instruction where idempotency_key = 'k-correo-1'$$,
  $$values ('sent', 'bx-ref-t-1', 1, true)$$,
  'el acuse deja la instrucción sent, con su referencia, un intento y sent_at'
);
select lives_ok($$select pg_temp.como_app($q$select opsrun.record_instruction_delivery('k-correo-1', 'bx-ref-t-OTRA')$q$)$$,
  'repetir el acuse no falla');
select results_eq(
  $$select status::text, bzzzbx_reference, attempts::int from opsrun.instruction where idempotency_key = 'k-correo-1'$$,
  $$values ('sent', 'bx-ref-t-1', 1)$$,
  'repetir el acuse no cambia nada');

do $$ begin perform pg_temp.actor(null, 'reconciliador'); end $$;
select throws_ok($$select pg_temp.como_app($q$select opsrun.resolve_instruction('k-no-existe', 'failed', null, 'e', 'm')$q$)$$,
  'OP011', null, 'resolve_instruction no cierra una instrucción que no existe');
select throws_ok($$select pg_temp.como_app($q$select opsrun.resolve_instruction('k-correo-1', 'pending', null, null, null)$q$)$$,
  '22023', null, 'resolve_instruction no devuelve una instrucción a pending');

select lives_ok($$select pg_temp.como_app($q$select opsrun.resolve_instruction('k-correo-1', 'confirmed', 'bx-ref-t-1', null, null, 'bx-msg-t-9001')$q$)$$,
  'el sistema confirma un correo con el ID de su mensaje');
select results_eq(
  $$select status::text, resolved_at is not null from opsrun.instruction where idempotency_key = 'k-correo-1'$$,
  $$values ('confirmed', true)$$,
  'la instrucción queda confirmed y con resolved_at'
);
select results_eq(
  $$select m.bzzzbx_message_id, m.bzzzbx_thread_id, m.channel::text, m.direction::text, m.is_original, m.actor_kind::text, m.instruction_id = i.id
      from opsrun.request_message as m join opsrun.instruction as i on i.id = m.instruction_id
     where i.idempotency_key = 'k-correo-1'$$,
  $$values ('bx-msg-t-9001', 'bx-thread-t-0041', 'email', 'outbound', false, 'system', true)$$,
  'confirmar crea el request_message saliente, enlazado a la instrucción'
);
select lives_ok($$select pg_temp.como_app($q$select opsrun.resolve_instruction('k-correo-1', 'confirmed', 'bx-ref-t-1', null, null, 'bx-msg-t-9001')$q$)$$,
  'repetir la confirmación no falla');
select is((select count(*)::int from opsrun.request_message where instruction_id = (select id from opsrun.instruction where idempotency_key = 'k-correo-1')), 1,
  'repetir la confirmación no duplica el request_message');
select throws_ok($$select pg_temp.como_app($q$select opsrun.resolve_instruction('k-correo-1', 'sent', null, null, null)$q$)$$,
  'OP004', null, 'una instrucción confirmed no vuelve a sent');
select throws_ok($$select pg_temp.como_app($q$select opsrun.resolve_instruction('k-correo-1', 'failed', null, 'e', 'm')$q$)$$,
  'OP004', null, 'una instrucción confirmed no pasa a failed');

-- Un texto: confirmado sin hilo, y un fallo.
select lives_ok($$select pg_temp.como_app($q$select opsrun.resolve_instruction('k-texto-1', 'sent', 'bx-ref-t-2', null, null)$q$)$$,
  'resolve_instruction también avanza a sent');
select results_eq(
  $$select status::text, bzzzbx_reference, attempts::int, sent_at is not null from opsrun.instruction where idempotency_key = 'k-texto-1'$$,
  $$values ('sent', 'bx-ref-t-2', 1, true)$$,
  'sent por resolve_instruction deja referencia, un intento y sent_at'
);
select lives_ok($$select pg_temp.como_app($q$select opsrun.resolve_instruction('k-texto-1', 'confirmed', null, null, null, 'bx-msg-t-9002')$q$)$$,
  'el sistema confirma un texto');
select results_eq(
  $$select m.bzzzbx_thread_id, m.channel::text, m.direction::text from opsrun.request_message as m where m.bzzzbx_message_id = 'bx-msg-t-9002'$$,
  $$values (null::text, 'text', 'outbound')$$,
  'el mensaje de un texto no lleva hilo');

-- Un fallo: Audit instruction_failed, con el código y sin el mensaje de PINCH.
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000041', null); end $$;
select lives_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000042', 'bx-thread-t-0042', 'Hola 42', 'k-fallo-1')$q$)$$,
  'el operador guarda otro correo');
select lives_ok($$select pg_temp.como_app($q$select opsrun.send_text('b0000000-0000-4000-8000-000000000042', 'bx-team-t-01', 'Hola 42', 'k-timeout-1')$q$)$$,
  'y un texto');
do $$ begin perform pg_temp.actor(null, 'reconciliador'); end $$;
select lives_ok($$select pg_temp.como_app($q$select opsrun.resolve_instruction('k-fallo-1', 'failed', null, 'forced_error', 'Forced error (stand-in).')$q$)$$,
  'el sistema marca un envío como failed');
select results_eq(
  $$select status::text, error_code, error_message, resolved_at is not null from opsrun.instruction where idempotency_key = 'k-fallo-1'$$,
  $$values ('failed', 'forced_error', 'Forced error (stand-in).', true)$$,
  'failed guarda el código y el mensaje del error para el operador'
);
select results_eq(
  $$select a.event_type, a.actor_kind::text, a.actor_operator_id, a.details ->> 'error_code'
      from opsrun.audit_event as a join opsrun.instruction as i on i.id = a.instruction_id
     where i.idempotency_key = 'k-fallo-1' and a.event_type = 'instruction_failed'$$,
  $$values ('instruction_failed', 'system', null::uuid, 'forced_error')$$,
  'failed deja instruction_failed en Audit como sistema'
);
select lives_ok($$select pg_temp.como_app($q$select opsrun.resolve_instruction('k-fallo-1', 'failed', null, 'forced_error', 'Forced error (stand-in).')$q$)$$,
  'repetir el fallo no falla');
select is((select count(*)::int from opsrun.audit_event where event_type = 'instruction_failed' and request_id = 'b0000000-0000-4000-8000-000000000042'), 1,
  'repetir el fallo no duplica el Audit');
select is((select count(*)::int from opsrun.request_message where instruction_id = (select id from opsrun.instruction where idempotency_key = 'k-fallo-1')), 0,
  'un envío fallido no crea request_message');
select lives_ok($$select pg_temp.como_app($q$select opsrun.resolve_instruction('k-timeout-1', 'timed_out', null, null, 'The result was not observed in the source.')$q$)$$,
  'el sistema marca un envío como timed_out');
select results_eq(
  $$select status::text, resolved_at is not null from opsrun.instruction where idempotency_key = 'k-timeout-1'$$,
  $$values ('timed_out', true)$$,
  'timed_out cierra la instrucción');

select * from finish();
rollback;

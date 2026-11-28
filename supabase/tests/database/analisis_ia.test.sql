-- OPR-36 · Análisis de la request por IA (spec docs/spec/opr-36-analisis-ia.md §8 y §15.1).
-- Pruebas funcionales de start_ai_analysis, record_ai_analysis y
-- decide_ai_suggestion, del check y del índice único de ai_analysis, y de los
-- helpers de la migración 20261207120000_analisis_ia.sql.
--
-- Las llamadas van como opsrun_app, el rol del servidor, con el actor de la
-- transacción fijado como lo fija el pool (opsrun.auth_user_id u
-- opsrun.system_actor). Los datos de prueba los pone el dueño de los esquemas;
-- el rollback lo deshace. No depende de la seed. Todo es inventado.
--
-- Que cada función exija su actor lo prueban, además, G5, G6 y G7
-- (guard_funciones.test.sql), que las descubren solas por pg_proc, y G19
-- (guard_ia_no_actua_sola.test.sql). Este archivo fija una por una que sin
-- actor, con el equivocado o con los dos a la vez, fallan sin escribir nada.
begin;
create extension if not exists pgtap with schema extensions;

select plan(118);

grant opsrun_migrador to current_user with inherit true, set true;
-- Para llamar como opsrun_app con SET ROLE, como el pool. Sin herencia: lo que
-- prueba es lo que opsrun_app tiene, no lo que tiene quien corre el test.
grant opsrun_app to current_user with inherit false, set true;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into opsrun.operator (id, auth_user_id, email, display_name, team, active) values
  ('0a000000-0000-4000-8000-000000000361', 'aa000000-0000-4000-8000-000000000361', 'ia.uno@example.test', 'Operador IA Uno', 'operations', true);

-- Una request open con el borrador vacío (o lleno, si se pide). El id termina en el número.
create function pg_temp.rid(p_n int)
returns uuid
language sql
as $$ select ('b0000000-0000-4000-8000-0000000036' || lpad(p_n::text, 2, '0'))::uuid $$;

create function pg_temp.nueva(p_n int, p_lleno boolean default false)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := pg_temp.rid(p_n);
begin
  if p_lleno then
    insert into opsrun.request (id, received_at, bzzzbx_customer_id, bzzzbx_contact_id, bzzzbx_property_id, bzzzbx_space_id,
                                unit, beds, bzzzbx_service_id, service_date, window_start, window_end, access_notes, po_number)
    values (v_id, now(), 'bx-cust-t36', 'bx-cont-t36', 'bx-prop-t36', 'bx-space-t36', '7C', 2, 'bx-svc-t36',
            date '2027-03-10', time '09:00', time '12:00', 'Key at the desk.', 'PO-T-36');
  else
    insert into opsrun.request (id, received_at) values (v_id, now());
  end if;
  return v_id;
end;
$$;

create function pg_temp.actor(p_auth text, p_system text)
returns void
language plpgsql
as $$
begin
  perform set_config('opsrun.auth_user_id', coalesce(p_auth, ''), true);
  perform set_config('opsrun.system_actor', coalesce(p_system, ''), true);
end;
$$;

create function pg_temp.como_sistema()
returns void language sql as $$ select pg_temp.actor(null, 'analisis_ia') $$;
create function pg_temp.como_operador()
returns void language sql as $$ select pg_temp.actor('aa000000-0000-4000-8000-000000000361', null) $$;

-- Las llamadas bajo prueba, como opsrun_app.
create function pg_temp.iniciar(p_req uuid)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  set local role opsrun_app;
  v_id := opsrun.start_ai_analysis(p_req);
  reset role;
  return v_id;
end;
$$;

create function pg_temp.registrar(
  p_analisis uuid, p_status text, p_sugerencias jsonb default '[]', p_error text default null,
  p_modelo text default 'example-model', p_definitivo boolean default false
)
returns text
language plpgsql
as $$
declare
  v_r text;
begin
  set local role opsrun_app;
  v_r := opsrun.record_ai_analysis(p_analisis, p_status::opsrun.ai_analysis_status, p_modelo, p_sugerencias, p_error, p_definitivo);
  reset role;
  return v_r;
end;
$$;

create function pg_temp.decidir(p_sugerencia uuid, p_decision text, p_final jsonb default null, p_version bigint default null, p_motivo text default null)
returns void
language plpgsql
as $$
declare
  v_version bigint := coalesce(p_version,
    (select r.change_seq from opsrun.request as r join opsrun.ai_suggestion as s on s.request_id = r.id where s.id = p_sugerencia));
begin
  set local role opsrun_app;
  perform opsrun.decide_ai_suggestion(p_sugerencia, p_decision::opsrun.ai_decision, v_version, p_final, p_motivo);
  reset role;
end;
$$;

create function pg_temp.sug(p_req uuid, p_campo text, p_rango int default 1)
returns uuid
language sql
as $$
  select s.id from opsrun.ai_suggestion as s where s.request_id = p_req and s.field = p_campo and s.rank = p_rango
$$;

create function pg_temp.estado_sug(p_req uuid, p_campo text, p_rango int default 1)
returns text
language sql
as $$
  select coalesce(s.decision::text, 'abierta') from opsrun.ai_suggestion as s where s.request_id = p_req and s.field = p_campo and s.rank = p_rango
$$;

create function pg_temp.eventos(p_req uuid, p_tipo text)
returns bigint
language sql
as $$ select count(*) from opsrun.audit_event where request_id = p_req and event_type = p_tipo $$;

create function pg_temp.escrituras_prohibidas()
returns bigint
language sql
as $$
  select (select count(*) from opsrun.request_confirmation)
       + (select count(*) from opsrun.instruction)
       + (select count(*) from opsrun.cleaner_confirmation)
$$;

-- Un resultado completo y válido, con alternativas de la propiedad.
create function pg_temp.resultado_completo()
returns jsonb
language sql
as $$
  select jsonb_build_array(
    jsonb_build_object('field', 'property', 'rank', 1, 'value', 'bx-prop-0001', 'reason', 'Address in the email.'),
    jsonb_build_object('field', 'property', 'rank', 2, 'value', 'bx-prop-0002', 'reason', 'Same street.'),
    jsonb_build_object('field', 'service', 'rank', 1, 'value', 'bx-svc-0001', 'reason', null),
    jsonb_build_object('field', 'service_date', 'rank', 1, 'value', '2027-03-12', 'reason', 'Friday.'),
    jsonb_build_object('field', 'time_window', 'rank', 1, 'value', jsonb_build_object('start', '09:00', 'end', '12:00'), 'reason', 'Morning.'),
    jsonb_build_object('field', 'unit', 'rank', 1, 'value', '4B', 'reason', 'Subject line.'),
    jsonb_build_object('field', 'beds', 'rank', 1, 'value', 3, 'reason', 'Three bedrooms.'),
    jsonb_build_object('field', 'sender', 'rank', 1,
      'value', jsonb_build_object('bzzzbx_customer_id', 'bx-cust-0001', 'bzzzbx_contact_id', 'bx-cont-0001'), 'reason', 'The signature.'))
$$;

-- ---------------------------------------------------------------------------
-- Permisos y forma de la migración
-- ---------------------------------------------------------------------------
select ok(
  has_function_privilege('opsrun_app', 'opsrun.start_ai_analysis(uuid)', 'execute')
    and has_function_privilege('opsrun_app', 'opsrun.record_ai_analysis(uuid, opsrun.ai_analysis_status, text, jsonb, text, boolean)', 'execute')
    and has_function_privilege('opsrun_app', 'opsrun.decide_ai_suggestion(uuid, opsrun.ai_decision, bigint, jsonb, text)', 'execute'),
  'opsrun_app ejecuta las tres funciones');
select ok(
  not has_function_privilege('authenticated', 'opsrun.start_ai_analysis(uuid)', 'execute')
    and not has_function_privilege('anon', 'opsrun.record_ai_analysis(uuid, opsrun.ai_analysis_status, text, jsonb, text, boolean)', 'execute')
    and not has_function_privilege('authenticated', 'opsrun.decide_ai_suggestion(uuid, opsrun.ai_decision, bigint, jsonb, text)', 'execute'),
  'ni authenticated ni anon ejecutan ninguna');
select is(
  (select is_nullable from information_schema.columns where table_schema = 'opsrun' and table_name = 'ai_analysis' and column_name = 'instruction_id'),
  'YES', 'ai_analysis.instruction_id admite null (P-1)');

do $$ begin perform pg_temp.nueva(1); end $$;
do $$ begin perform pg_temp.nueva(2); end $$;

-- ---------------------------------------------------------------------------
-- Actor: start y record, sistema; decide, operador
-- ---------------------------------------------------------------------------
insert into opsrun.ai_analysis (id, request_id, status) values ('e0000000-0000-4000-8000-000000003601', pg_temp.rid(2), 'pending');
insert into opsrun.ai_suggestion (id, request_id, ai_analysis_id, field, rank, value)
values ('5a000000-0000-4000-8000-000000003601', pg_temp.rid(2), 'e0000000-0000-4000-8000-000000003601', 'unit', 1, '"4B"');
create temp table antes2 as
select (select count(*) from opsrun.ai_analysis) as analisis, (select count(*) from opsrun.ai_suggestion) as sugerencias,
       (select count(*) from opsrun.audit_event) as auditorias;

do $$ begin perform pg_temp.actor(null, null); end $$;
select throws_ok($$select pg_temp.iniciar(pg_temp.rid(1))$$, '42501', null, 'sin actor, start_ai_analysis falla');
select throws_ok($$select pg_temp.registrar('e0000000-0000-4000-8000-000000003601', 'failed', '[]', 'x')$$, '42501', null, 'sin actor, record_ai_analysis falla');
select throws_ok($$select pg_temp.decidir('5a000000-0000-4000-8000-000000003601', 'rejected')$$, '42501', null, 'sin actor, decide_ai_suggestion falla');

do $$ begin perform pg_temp.como_operador(); end $$;
select throws_ok($$select pg_temp.iniciar(pg_temp.rid(1))$$, '42501', null, 'con un operador, start_ai_analysis falla');
select throws_ok($$select pg_temp.registrar('e0000000-0000-4000-8000-000000003601', 'failed', '[]', 'x')$$, '42501', null, 'con un operador, record_ai_analysis falla');

do $$ begin perform pg_temp.como_sistema(); end $$;
select throws_ok($$select pg_temp.decidir('5a000000-0000-4000-8000-000000003601', 'rejected')$$, '42501', null, 'con el sistema, decide_ai_suggestion falla');

do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000361', 'analisis_ia'); end $$;
select throws_ok($$select pg_temp.iniciar(pg_temp.rid(1))$$, '42501', null, 'con operador y sistema a la vez, start_ai_analysis falla');
select throws_ok($$select pg_temp.registrar('e0000000-0000-4000-8000-000000003601', 'failed', '[]', 'x')$$, '42501', null, 'con operador y sistema a la vez, record_ai_analysis falla');
select throws_ok($$select pg_temp.decidir('5a000000-0000-4000-8000-000000003601', 'rejected')$$, '42501', null, 'con operador y sistema a la vez, decide_ai_suggestion falla');

select ok(
  (select count(*) from opsrun.ai_analysis) = (select analisis from antes2)
    and (select count(*) from opsrun.ai_suggestion) = (select sugerencias from antes2)
    and (select count(*) from opsrun.audit_event) = (select auditorias from antes2)
    and (select status::text from opsrun.ai_analysis where id = 'e0000000-0000-4000-8000-000000003601') = 'pending'
    and (select decision from opsrun.ai_suggestion where id = '5a000000-0000-4000-8000-000000003601') is null,
  'las llamadas con el actor equivocado no escribieron nada');

-- ---------------------------------------------------------------------------
-- start_ai_analysis (§5.2)
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.como_sistema(); end $$;

create temp table ids (clave text primary key, id uuid);

insert into ids select 'a1', pg_temp.iniciar(pg_temp.rid(1));
select isnt((select id from ids where clave = 'a1'), null::uuid, 'start: una request open sin análisis abre uno');
select is(
  (select a.status::text || '/' || coalesce(a.instruction_id::text, 'sin instrucción') || '/' || coalesce(a.completed_at::text, 'sin respuesta')
     from opsrun.ai_analysis as a where a.id = (select id from ids where clave = 'a1')),
  'pending/sin instrucción/sin respuesta', 'start: nace pending, sin instrucción y sin hora de respuesta');
select is(pg_temp.iniciar(pg_temp.rid(1)), null::uuid, 'start: con uno pending, no abre otro');
select throws_ok(
  $$insert into opsrun.ai_analysis (request_id, status) values (pg_temp.rid(1), 'pending')$$, '23505', null,
  'el índice único parcial impide un segundo pending de la misma request');
select throws_ok(
  $$insert into opsrun.ai_analysis (request_id, status) values (pg_temp.rid(2), 'completed')$$, '23514', null,
  'el check impide un análisis terminado sin hora de respuesta');
select throws_ok(
  $$insert into opsrun.ai_analysis (request_id, status, completed_at) values (pg_temp.rid(2), 'pending', now())$$, '23514', null,
  'el check impide un pending con hora de respuesta');

-- Cerrado con failed hace menos de 60 s: todavía no.
select is(pg_temp.registrar((select id from ids where clave = 'a1'), 'timed_out', '[]', 'timeout'), 'recorded', 'el primero termina timed_out');
select is(pg_temp.iniciar(pg_temp.rid(1)), null::uuid, 'start: el primero falló hace menos de 60 s, no hay reintento todavía');
update opsrun.ai_analysis set completed_at = now() - interval '61 seconds' where id = (select id from ids where clave = 'a1');
insert into ids select 'a2', pg_temp.iniciar(pg_temp.rid(1));
select isnt((select id from ids where clave = 'a2'), null::uuid, 'start: pasados 60 s, el reintento abre el segundo');

-- A lo sumo dos.
select is(pg_temp.registrar((select id from ids where clave = 'a2'), 'failed', '[]', 'model_error'), 'recorded', 'el reintento falla también');
update opsrun.ai_analysis set completed_at = now() - interval '5 minutes' where id = (select id from ids where clave = 'a2');
select is(pg_temp.iniciar(pg_temp.rid(1)), null::uuid, 'start: con dos análisis, no hay un tercero');

-- Un rechazo definitivo no se reintenta.
do $$ begin perform pg_temp.nueva(3); end $$;
insert into ids select 'd1', pg_temp.iniciar(pg_temp.rid(3));
do $$ begin perform pg_temp.registrar((select id from ids where clave = 'd1'), 'failed', '[]', 'message_unknown', null, true); end $$;
update opsrun.ai_analysis set completed_at = now() - interval '5 minutes' where id = (select id from ids where clave = 'd1');
select is(pg_temp.iniciar(pg_temp.rid(3)), null::uuid, 'start: un rechazo definitivo de BzzzBX no se reintenta');

-- Request que no toca.
do $$ begin perform pg_temp.nueva(4); end $$;
insert into ids select 'c1', pg_temp.iniciar(pg_temp.rid(4));
do $$ begin perform pg_temp.registrar((select id from ids where clave = 'c1'), 'completed', '[]'); end $$;
select is(pg_temp.iniciar(pg_temp.rid(4)), null::uuid, 'start: con uno completed, null');
select is(pg_temp.iniciar('b0000000-0000-4000-8000-000000009999'), null::uuid, 'start: una request que no existe, null');

-- ---------------------------------------------------------------------------
-- record_ai_analysis completed: lo que llena y lo que no (§5.3)
-- ---------------------------------------------------------------------------
-- Request 5: borrador vacío.
do $$ begin perform pg_temp.nueva(5); end $$;
insert into ids select 'v5', pg_temp.iniciar(pg_temp.rid(5));
create temp table antes5 as select pg_temp.escrituras_prohibidas() as n, (select change_seq from opsrun.request where id = pg_temp.rid(5)) as version;

select is(pg_temp.registrar((select id from ids where clave = 'v5'), 'completed', pg_temp.resultado_completo()), 'recorded',
  'completed: el resultado válido se guarda');
select is(
  (select count(*) from opsrun.ai_suggestion where ai_analysis_id = (select id from ids where clave = 'v5')),
  8::bigint, 'completed: una sugerencia por propuesta, con alternativas');
select ok(
  (select r.bzzzbx_property_id = 'bx-prop-0001' and r.bzzzbx_service_id = 'bx-svc-0001' and r.service_date = date '2027-03-12'
          and r.window_start = time '09:00' and r.window_end = time '12:00' and r.unit = '4B' and r.beds = 3
          and r.bzzzbx_customer_id = 'bx-cust-0001' and r.bzzzbx_contact_id = 'bx-cont-0001'
     from opsrun.request as r where r.id = pg_temp.rid(5)),
  'completed: llena las columnas vacías con la propuesta principal; time_window llena las dos, sender las dos');
select ok(
  (select r.bzzzbx_property_id <> 'bx-prop-0002' from opsrun.request as r where r.id = pg_temp.rid(5)),
  'completed: una alternativa nunca llena el borrador');
select is(pg_temp.estado_sug(pg_temp.rid(5), 'property', 2), 'abierta', 'completed: la alternativa queda sin decidir');
select is(
  (select count(*) from opsrun.request_ai_marks where request_id = pg_temp.rid(5)), 7::bigint,
  'completed: los 7 campos propuestos salen AI-marked (solo rank 1)') ;
select ok(
  (select a.status = 'completed' and a.completed_at is not null and a.model = 'example-model'
     from opsrun.ai_analysis as a where a.id = (select id from ids where clave = 'v5')),
  'completed: el análisis queda completed con modelo y hora');
select ok(
  (select e.actor_kind = 'ai' and e.actor_operator_id is null
          and e.details ->> 'ai_analysis_id' = (select id::text from ids where clave = 'v5')
          and e.details -> 'fields' @> '["property", "sender", "beds"]'::jsonb
          and e.details -> 'filled' @> '["property", "sender", "beds"]'::jsonb
     from opsrun.audit_event as e
    where e.request_id = pg_temp.rid(5) and e.event_type = 'ai_analysis_completed'),
  'completed: Audit ai_analysis_completed del actor ai, con fields y filled');
select is(pg_temp.eventos(pg_temp.rid(5), 'ai_analysis_completed'), 1::bigint, 'completed: un solo evento de Audit');
select is(pg_temp.escrituras_prohibidas(), (select n from antes5),
  'completed: ninguna confirmación, instrucción ni pregunta al cleaner nueva');
select ok(
  (select r.status = 'open' and r.owner_operator_id is null and r.bzzzbx_job_id is null
     from opsrun.request as r where r.id = pg_temp.rid(5)),
  'completed: ni el estado, ni el dueño, ni el job cambian');
select is((select count(*) from opsrun.audit_event where request_id = pg_temp.rid(5) and event_type = 'confirmation_superseded'), 0::bigint,
  'completed: el trigger de OPR-28 no escribe confirmation_superseded');

-- Idempotencia: el segundo resultado del mismo análisis no escribe.
create temp table antes5b as
select (select count(*) from opsrun.ai_suggestion) as s, (select count(*) from opsrun.audit_event) as a;
select is(pg_temp.registrar((select id from ids where clave = 'v5'), 'completed', pg_temp.resultado_completo()), 'duplicate',
  'idempotente: el segundo resultado del mismo análisis es duplicate');
select is(pg_temp.registrar((select id from ids where clave = 'v5'), 'timed_out', '[]', 'timeout'), 'duplicate',
  'idempotente: un timed_out tardío sobre un completed es duplicate');
select ok(
  (select count(*) from opsrun.ai_suggestion) = (select s from antes5b) and (select count(*) from opsrun.audit_event) = (select a from antes5b),
  'idempotente: el duplicado no escribió nada');
select throws_ok($$select pg_temp.registrar('e0000000-0000-4000-8000-0000000fffff', 'completed', '[]')$$, 'OP045', null,
  'un análisis que no existe es OP045');

-- Campo lleno: la sugerencia queda abierta y el borrador intacto.
do $$ begin perform pg_temp.nueva(6, true); end $$;
insert into ids select 'v6', pg_temp.iniciar(pg_temp.rid(6));
do $$ begin perform pg_temp.registrar((select id from ids where clave = 'v6'), 'completed', pg_temp.resultado_completo()); end $$;
select ok(
  (select r.bzzzbx_property_id = 'bx-prop-t36' and r.unit = '7C' and r.beds = 2 and r.service_date = date '2027-03-10'
          and r.bzzzbx_customer_id = 'bx-cust-t36'
     from opsrun.request as r where r.id = pg_temp.rid(6)),
  'campo lleno: el borrador queda intacto');
select is(pg_temp.estado_sug(pg_temp.rid(6), 'property'), 'abierta', 'campo lleno: la sugerencia queda abierta (AI-marked)');
select is(
  (select e.details -> 'filled' from opsrun.audit_event as e where e.request_id = pg_temp.rid(6) and e.event_type = 'ai_analysis_completed'),
  '[]'::jsonb, 'campo lleno: filled queda vacío');

-- Cubierto por una confirmación vigente: la sugerencia queda superseded y no se toca el borrador.
-- La propiedad vacía con solo el cleaner confirmado también (OPR-28 §5.5).
do $$ begin perform pg_temp.nueva(7); end $$;
update opsrun.request set bzzzbx_team_id = 'bx-team-t36', service_date = date '2027-03-10', window_start = time '09:00', window_end = time '12:00'
 where id = pg_temp.rid(7);
insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
values (pg_temp.rid(7), 'cleaner', 'phone', '{}', '0a000000-0000-4000-8000-000000000361');
insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
values (pg_temp.rid(7), 'sender', 'operator', '{}', '0a000000-0000-4000-8000-000000000361');
create temp table antes7 as select (select count(*) from opsrun.request_confirmation where request_id = pg_temp.rid(7)) as n;
insert into ids select 'v7', pg_temp.iniciar(pg_temp.rid(7));
do $$ begin perform pg_temp.registrar((select id from ids where clave = 'v7'), 'completed', pg_temp.resultado_completo()); end $$;
select is(pg_temp.estado_sug(pg_temp.rid(7), 'property'), 'superseded',
  'cubierto: la propiedad, con solo el cleaner confirmado, queda superseded');
select is((select bzzzbx_property_id from opsrun.request where id = pg_temp.rid(7)), null::text,
  'cubierto: la propiedad vacía no se llena (invalidaría la confirmación del cleaner)');
select is(pg_temp.estado_sug(pg_temp.rid(7), 'sender'), 'superseded', 'cubierto: el sender confirmado queda superseded');
select is(pg_temp.estado_sug(pg_temp.rid(7), 'service_date'), 'superseded', 'cubierto: la fecha cubierta por el cleaner queda superseded');
select is(pg_temp.estado_sug(pg_temp.rid(7), 'unit'), 'abierta', 'cubierto: un campo que ninguna confirmación cubre sí queda abierto');
select is((select unit from opsrun.request where id = pg_temp.rid(7)), '4B', 'cubierto: y se llena');
select is(
  (select count(*) from opsrun.request_ai_marks where request_id = pg_temp.rid(7) and field in ('property', 'sender', 'service_date')), 0::bigint,
  'cubierto: lo superseded no sale AI-marked');
select ok(
  (select count(*) from opsrun.request_confirmation where request_id = pg_temp.rid(7) and superseded_at is null) = (select n from antes7),
  'cubierto: las confirmaciones vigentes siguen vigentes');

-- El operador ya rechazó o corrigió ese campo en un análisis anterior: superseded.
do $$ begin perform pg_temp.nueva(8); end $$;
insert into opsrun.ai_analysis (id, request_id, status, completed_at) values
  ('e0000000-0000-4000-8000-000000003608', pg_temp.rid(8), 'failed', now() - interval '10 minutes');
insert into opsrun.ai_suggestion (request_id, ai_analysis_id, field, rank, value, decision, decided_by, decided_at) values
  (pg_temp.rid(8), 'e0000000-0000-4000-8000-000000003608', 'beds', 1, '5', 'rejected', '0a000000-0000-4000-8000-000000000361', now() - interval '9 minutes');
insert into ids select 'v8', pg_temp.iniciar(pg_temp.rid(8));
do $$ begin perform pg_temp.registrar((select id from ids where clave = 'v8'), 'completed', pg_temp.resultado_completo()); end $$;
select is((select count(*) from opsrun.ai_suggestion where request_id = pg_temp.rid(8) and field = 'beds' and ai_analysis_id = (select id from ids where clave = 'v8') and decision = 'superseded'),
  1::bigint, 'rechazado antes: la propuesta de ese campo llega superseded');
select is((select beds from opsrun.request where id = pg_temp.rid(8)), null::smallint, 'rechazado antes: el borrador no se vuelve a llenar');

-- Las abiertas de un análisis anterior pasan a superseded antes de guardar las nuevas.
do $$ begin perform pg_temp.nueva(9); end $$;
insert into opsrun.ai_analysis (id, request_id, status, completed_at) values
  ('e0000000-0000-4000-8000-000000003609', pg_temp.rid(9), 'timed_out', now() - interval '10 minutes');
insert into opsrun.ai_suggestion (id, request_id, ai_analysis_id, field, rank, value) values
  ('5a000000-0000-4000-8000-000000003609', pg_temp.rid(9), 'e0000000-0000-4000-8000-000000003609', 'unit', 1, '"1A"');
insert into ids select 'v9', pg_temp.iniciar(pg_temp.rid(9));
do $$ begin perform pg_temp.registrar((select id from ids where clave = 'v9'), 'completed', pg_temp.resultado_completo()); end $$;
select is((select decision::text from opsrun.ai_suggestion where id = '5a000000-0000-4000-8000-000000003609'), 'superseded',
  'reintento: las abiertas del análisis anterior pasan a superseded');
select is(
  (select coalesce(s.decision::text, 'abierta') from opsrun.ai_suggestion as s where s.ai_analysis_id = (select id from ids where clave = 'v9') and s.field = 'unit'),
  'abierta', 'reintento: la nueva queda abierta');

-- multiple_jobs: un aviso, ninguna columna.
do $$ begin perform pg_temp.nueva(10); end $$;
insert into ids select 'v10', pg_temp.iniciar(pg_temp.rid(10));
create temp table antes10 as select r.change_seq as version from opsrun.request as r where r.id = pg_temp.rid(10);
do $$ begin perform pg_temp.registrar((select id from ids where clave = 'v10'), 'completed',
  '[{"field": "multiple_jobs", "rank": 1, "value": {"count": 2}, "reason": "Two units."}]'); end $$;
select is(pg_temp.estado_sug(pg_temp.rid(10), 'multiple_jobs'), 'abierta', 'multiple_jobs: queda abierta');
select is((select r.change_seq from opsrun.request as r where r.id = pg_temp.rid(10)), (select version from antes10),
  'multiple_jobs: no toca la request');

-- ---------------------------------------------------------------------------
-- Forma (OP046): todo se valida antes de escribir
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.nueva(11); end $$;
insert into ids select 'f11', pg_temp.iniciar(pg_temp.rid(11));
create temp table antes11 as
select (select count(*) from opsrun.ai_suggestion) as s, (select count(*) from opsrun.audit_event) as a;

create function pg_temp.malo(p_sugerencias jsonb)
returns text
language plpgsql
as $$
begin
  perform pg_temp.registrar((select id from ids where clave = 'f11'), 'completed', p_sugerencias);
  return 'sin error';
exception when others then
  return sqlstate;
end;
$$;

select is(pg_temp.malo('[{"field": "cleaner_team", "rank": 1, "value": "bx-team-0001"}]'), 'OP046', 'forma: cleaner_team no se pide aquí (OPR-37)');
select is(pg_temp.malo('[{"field": "draft_customer_reply", "rank": 1, "value": {"body": "x"}}]'), 'OP046', 'forma: un borrador de mensaje tampoco');
select is(pg_temp.malo('[{"field": "no_existe", "rank": 1, "value": "x"}]'), 'OP046', 'forma: un campo inexistente');
select is(pg_temp.malo('[{"field": "unit", "rank": 4, "value": "4B"}]'), 'OP046', 'forma: rango fuera de 1 a 3');
select is(pg_temp.malo('[{"field": "unit", "rank": 1, "value": "4B"}, {"field": "unit", "rank": 1, "value": "5C"}]'), 'OP046', 'forma: dos rank 1 del mismo campo');
select is(pg_temp.malo('[{"field": "unit", "rank": 2, "value": "4B"}]'), 'OP046', 'forma: alternativa sin principal');
select is(pg_temp.malo('[{"field": "sender", "rank": 1, "value": {"bzzzbx_customer_id": "bx-cust-0001", "name": "Ana"}}]'), 'OP046', 'forma: clave extra en sender (un nombre no entra)');
select is(pg_temp.malo('[{"field": "time_window", "rank": 1, "value": {"start": "12:00", "end": "09:00"}}]'), 'OP046', 'forma: ventana invertida');
select is(pg_temp.malo('[{"field": "service_date", "rank": 1, "value": "2027-02-30"}]'), 'OP046', 'forma: fecha inválida');
select is(pg_temp.malo(jsonb_build_array(jsonb_build_object('field', 'unit', 'rank', 1, 'value', repeat('x', 33)))), 'OP046', 'forma: unit de más de 32 caracteres');
select is(pg_temp.malo(jsonb_build_array(jsonb_build_object('field', 'unit', 'rank', 1, 'value', '4B', 'reason', repeat('x', 201)))), 'OP046', 'forma: motivo de más de 200 caracteres');
select is(pg_temp.malo('[{"field": "beds", "rank": 1, "value": 3.5}]'), 'OP046', 'forma: camas con decimales');
select is(pg_temp.malo('[{"field": "property", "rank": 1, "value": "Example Tower"}]'), 'OP046', 'forma: una propiedad con nombre en vez de crosswalk ID');
select is(pg_temp.malo('[{"field": "unit", "rank": 1, "value": "4B", "body": "El correo"}]'), 'OP046', 'forma: clave extra en la sugerencia');
select is(pg_temp.malo('[{"field": "unit", "rank": 1, "value": "4B"}, {"field": "beds", "rank": 1, "value": 99}]'), 'OP046', 'forma: una buena y una mala, se rechaza todo');
select ok(
  (select count(*) from opsrun.ai_suggestion) = (select s from antes11) and (select count(*) from opsrun.audit_event) = (select a from antes11)
    and (select status::text from opsrun.ai_analysis where id = (select id from ids where clave = 'f11')) = 'pending'
    and (select unit from opsrun.request where id = pg_temp.rid(11)) is null,
  'forma: nada se escribió, el análisis sigue pending');
select throws_ok($$select pg_temp.registrar((select id from ids where clave = 'f11'), 'pending', '[]')$$, '22023', null, 'record con status pending es 22023');
select throws_ok($$select pg_temp.registrar((select id from ids where clave = 'f11'), 'failed', '[{"field": "unit", "rank": 1, "value": "4B"}]', 'x')$$, '22023', null,
  'un análisis failed no lleva sugerencias');

-- ---------------------------------------------------------------------------
-- failed y timed_out
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.nueva(12); end $$;
insert into ids select 'x12', pg_temp.iniciar(pg_temp.rid(12));
select is(pg_temp.registrar((select id from ids where clave = 'x12'), 'failed', '[]', 'model_error'), 'recorded', 'failed se registra');
select ok(
  (select a.status = 'failed' and a.completed_at is not null from opsrun.ai_analysis as a where a.id = (select id from ids where clave = 'x12'))
    and (select count(*) from opsrun.ai_suggestion where request_id = pg_temp.rid(12)) = 0,
  'failed: estado, hora y sin sugerencias');
select ok(
  (select e.actor_kind = 'system' and e.details ->> 'status' = 'failed' and e.details ->> 'error_code' = 'model_error'
          and e.details ->> 'ai_analysis_id' = (select id::text from ids where clave = 'x12') and not (e.details ? 'definitive')
     from opsrun.audit_event as e where e.request_id = pg_temp.rid(12) and e.event_type = 'ai_analysis_failed'),
  'failed: Audit ai_analysis_failed del sistema con status y error_code');

do $$ begin perform pg_temp.nueva(13); end $$;
insert into ids select 'x13', pg_temp.iniciar(pg_temp.rid(13));
do $$ begin perform pg_temp.registrar((select id from ids where clave = 'x13'), 'timed_out', '[]', null); end $$;
select ok(
  (select e.actor_kind = 'system' and e.details ->> 'status' = 'timed_out' and not (e.details ? 'error_code')
     from opsrun.audit_event as e where e.request_id = pg_temp.rid(13) and e.event_type = 'ai_analysis_failed'),
  'timed_out: Audit ai_analysis_failed con status timed_out');
select is(pg_temp.registrar((select id from ids where clave = 'x13'), 'completed', pg_temp.resultado_completo()), 'duplicate',
  'timed_out: una respuesta tardía es duplicate y no escribe');
select is((select count(*) from opsrun.ai_suggestion where request_id = pg_temp.rid(13)), 0::bigint, 'timed_out: la respuesta tardía no guardó sugerencias');

-- ---------------------------------------------------------------------------
-- Request que ya no está open
-- ---------------------------------------------------------------------------
-- Una request scheduled con su análisis pending: se cierra completed sin guardar nada.
do $$ begin perform pg_temp.nueva(14); end $$;
insert into ids select 's14', pg_temp.iniciar(pg_temp.rid(14));
update opsrun.request set owner_operator_id = '0a000000-0000-4000-8000-000000000361' where id = pg_temp.rid(14);
insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
select pg_temp.rid(14), k, case when k = 'cleaner' then 'phone'::opsrun.confirmation_method else 'operator' end, '{}', '0a000000-0000-4000-8000-000000000361'
  from unnest(enum_range(null::opsrun.confirmation_kind)) as k;
update opsrun.request set status = 'scheduled', bzzzbx_job_id = 'bx-job-t36', job_number = 'EX-T36', scheduled_at = now() where id = pg_temp.rid(14);
do $$ begin perform pg_temp.registrar((select id from ids where clave = 's14'), 'completed', pg_temp.resultado_completo()); end $$;
select ok(
  (select a.status = 'completed' from opsrun.ai_analysis as a where a.id = (select id from ids where clave = 's14'))
    and (select count(*) from opsrun.ai_suggestion where request_id = pg_temp.rid(14)) = 0
    and (select r.unit is null from opsrun.request as r where r.id = pg_temp.rid(14)),
  'scheduled: el análisis queda completed, sin sugerencias y sin tocar el borrador');
select is(
  (select e.details ->> 'discarded' from opsrun.audit_event as e where e.request_id = pg_temp.rid(14) and e.event_type = 'ai_analysis_completed'),
  'request_not_open', 'scheduled: Audit dice details.discarded = request_not_open');
select is(pg_temp.iniciar(pg_temp.rid(14)), null::uuid, 'start: una request scheduled no abre análisis');

-- ---------------------------------------------------------------------------
-- decide_ai_suggestion
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.como_operador(); end $$;

-- Accept: el borrador igual al valor.
do $$ begin perform pg_temp.decidir(pg_temp.sug(pg_temp.rid(5), 'unit'), 'accepted', null, null, 'Looks right.'); end $$;
select ok(
  (select s.decision = 'accepted' and s.decided_by = '0a000000-0000-4000-8000-000000000361' and s.decided_at is not null and s.final_value is null
     from opsrun.ai_suggestion as s where s.id = pg_temp.sug(pg_temp.rid(5), 'unit')),
  'accepted: queda decidida por el operador, sin valor final');
select ok(
  (select e.actor_kind = 'operator' and e.reason = 'Looks right.' and e.ai_suggestion_id = pg_temp.sug(pg_temp.rid(5), 'unit')
     from opsrun.audit_event as e where e.request_id = pg_temp.rid(5) and e.event_type = 'ai_suggestion_accepted'),
  'accepted: Audit ai_suggestion_accepted del operador, con su motivo');
select is(
  (select count(*) from opsrun.request_ai_marks where request_id = pg_temp.rid(5) and field = 'unit'), 0::bigint,
  'accepted: el campo ya no sale AI-marked');

-- Accept con el borrador distinto: OP048.
update opsrun.request set unit = '9Z' where id = pg_temp.rid(5);
select lives_ok($$select pg_temp.decidir(pg_temp.sug(pg_temp.rid(5), 'beds'), 'accepted')$$, 'accepted con camas iguales al borrador funciona');
select throws_ok($$select pg_temp.decidir(pg_temp.sug(pg_temp.rid(6), 'unit'), 'accepted')$$, 'OP048', null,
  'accepted con el borrador distinto del valor de la IA es OP048');

-- Corrected: escribe el borrador y el valor final.
do $$ begin perform pg_temp.decidir(pg_temp.sug(pg_temp.rid(6), 'beds'), 'corrected', '4'); end $$;
select ok(
  (select s.decision = 'corrected' and s.final_value = '4'::jsonb from opsrun.ai_suggestion as s where s.id = pg_temp.sug(pg_temp.rid(6), 'beds'))
    and (select beds from opsrun.request where id = pg_temp.rid(6)) = 4,
  'corrected: guarda el valor final y escribe el borrador');
select is(pg_temp.eventos(pg_temp.rid(6), 'ai_suggestion_corrected'), 1::bigint, 'corrected: deja ai_suggestion_corrected');

-- Corrected sobre una columna que cubre una confirmación: el trigger de OPR-28 la invalida con el operador de actor.
insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
values (pg_temp.rid(6), 'details', 'operator', '{}', '0a000000-0000-4000-8000-000000000361');
do $$ begin perform pg_temp.decidir(pg_temp.sug(pg_temp.rid(6), 'property'), 'corrected', '"bx-prop-0002"'); end $$;
select ok(
  (select c.superseded_at is not null from opsrun.request_confirmation as c where c.request_id = pg_temp.rid(6) and c.kind = 'details')
    and (select e.actor_kind = 'operator' from opsrun.audit_event as e where e.request_id = pg_temp.rid(6) and e.event_type = 'confirmation_superseded'),
  'corrected: el trigger de OPR-28 invalida la confirmación que cubría la columna, con el operador como actor');

-- Corrected con forma inválida o sin valor final: OP048.
select throws_ok($$select pg_temp.decidir(pg_temp.sug(pg_temp.rid(6), 'service'), 'corrected')$$, 'OP048', null, 'corrected sin valor final es OP048');
select throws_ok($$select pg_temp.decidir(pg_temp.sug(pg_temp.rid(6), 'service'), 'corrected', '"Deep clean"')$$, 'OP048', null, 'corrected con forma inválida es OP048');

-- Rejected: vacía el borrador si todavía tenía el valor de la IA.
do $$ begin perform pg_temp.decidir(pg_temp.sug(pg_temp.rid(5), 'service'), 'rejected'); end $$;
select ok(
  (select s.decision = 'rejected' from opsrun.ai_suggestion as s where s.id = pg_temp.sug(pg_temp.rid(5), 'service'))
    and (select bzzzbx_service_id from opsrun.request where id = pg_temp.rid(5)) is null,
  'rejected: vacía el borrador que tenía el valor de la IA');
-- ... y no si alguien lo cambió.
do $$ begin perform pg_temp.nueva(15); end $$;
do $$ begin perform pg_temp.como_sistema(); end $$;
insert into ids select 'v15', pg_temp.iniciar(pg_temp.rid(15));
do $$ begin perform pg_temp.registrar((select id from ids where clave = 'v15'), 'completed', '[{"field": "unit", "rank": 1, "value": "4B"}]'); end $$;
update opsrun.request set unit = '8H' where id = pg_temp.rid(15);
do $$ begin perform pg_temp.como_operador(); end $$;
do $$ begin perform pg_temp.decidir(pg_temp.sug(pg_temp.rid(15), 'unit'), 'rejected'); end $$;
select is((select unit from opsrun.request where id = pg_temp.rid(15)), '8H', 'rejected: si alguien ya cambió el borrador, se deja');

-- multiple_jobs: acepta y rechaza sin tocar el borrador.
do $$ begin perform pg_temp.decidir(pg_temp.sug(pg_temp.rid(10), 'multiple_jobs'), 'accepted'); end $$;
select is(pg_temp.estado_sug(pg_temp.rid(10), 'multiple_jobs'), 'accepted', 'multiple_jobs: Got it la acepta');
do $$ begin perform pg_temp.nueva(16); end $$;
do $$ begin perform pg_temp.como_sistema(); end $$;
insert into ids select 'v16', pg_temp.iniciar(pg_temp.rid(16));
do $$ begin perform pg_temp.registrar((select id from ids where clave = 'v16'), 'completed', '[{"field": "multiple_jobs", "rank": 1, "value": {"count": 3}}]'); end $$;
do $$ begin perform pg_temp.como_operador(); end $$;
do $$ begin perform pg_temp.decidir(pg_temp.sug(pg_temp.rid(16), 'multiple_jobs'), 'rejected'); end $$;
select is(pg_temp.estado_sug(pg_temp.rid(16), 'multiple_jobs'), 'rejected', 'multiple_jobs: Not multiple la rechaza');
select throws_ok($$select pg_temp.decidir(pg_temp.sug(pg_temp.rid(16), 'multiple_jobs'), 'corrected', '{"count": 2}')$$, 'OP047', null,
  'multiple_jobs: ya decidida, OP047 antes que cualquier otra cosa');

-- Las alternativas se cierran con la decisión del campo.
select is(pg_temp.estado_sug(pg_temp.rid(5), 'property', 2), 'abierta', 'antes de decidir la propiedad, su alternativa está abierta');
do $$ begin perform pg_temp.decidir(pg_temp.sug(pg_temp.rid(5), 'property'), 'corrected', '"bx-prop-0002"'); end $$;
select is(pg_temp.estado_sug(pg_temp.rid(5), 'property', 2), 'superseded', 'al decidir la principal, las alternativas del campo pasan a superseded');

-- Errores de la decisión.
select throws_ok($$select pg_temp.decidir(pg_temp.sug(pg_temp.rid(5), 'unit'), 'accepted')$$, 'OP047', null, 'una sugerencia ya decidida es OP047');
select throws_ok($$select pg_temp.decidir(pg_temp.sug(pg_temp.rid(6), 'service_date'), 'superseded')$$, '22023', null, 'superseded no lo decide un operador (22023)');
select throws_ok($$select pg_temp.decidir(pg_temp.sug(pg_temp.rid(6), 'service_date'), 'accepted', null, 1)$$, 'OP013', null, 'una versión vieja es OP013');
select throws_ok($$select pg_temp.decidir('5a000000-0000-4000-8000-0000000fffff', 'accepted', null, 1)$$, 'OP045', null, 'una sugerencia que no existe es OP045');
select throws_ok($$select pg_temp.decidir(pg_temp.sug(pg_temp.rid(14), 'unit'), 'accepted', null, 1)$$, 'OP045', null, 'si la request scheduled no guardó sugerencias, no hay qué decidir (OP045)');
-- Request no open: una sugerencia que existía antes de programarse.
do $$ begin perform pg_temp.nueva(17); end $$;
do $$ begin perform pg_temp.como_sistema(); end $$;
insert into ids select 'v17', pg_temp.iniciar(pg_temp.rid(17));
do $$ begin perform pg_temp.registrar((select id from ids where clave = 'v17'), 'completed', '[{"field": "unit", "rank": 1, "value": "4B"}]'); end $$;
update opsrun.request set owner_operator_id = '0a000000-0000-4000-8000-000000000361' where id = pg_temp.rid(17);
insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
select pg_temp.rid(17), k, case when k = 'cleaner' then 'phone'::opsrun.confirmation_method else 'operator' end, '{}', '0a000000-0000-4000-8000-000000000361'
  from unnest(enum_range(null::opsrun.confirmation_kind)) as k;
update opsrun.request set status = 'scheduled', bzzzbx_job_id = 'bx-job-t37', job_number = 'EX-T37', scheduled_at = now() where id = pg_temp.rid(17);
do $$ begin perform pg_temp.como_operador(); end $$;
select throws_ok($$select pg_temp.decidir(pg_temp.sug(pg_temp.rid(17), 'unit'), 'rejected', null, 1)$$, 'OP007', null, 'una request que ya no está open es OP007');

-- ---------------------------------------------------------------------------
-- Flujo completo en SQL: ingesta → start → record → Confirm details → sin marcas
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.actor(null, 'entrada_correo'); end $$;
create temp table flujo as
select request_id as id from opsrun.ingest_request_email('bx-msg-t36-flujo', 'bx-thread-t36-flujo', now());
do $$ begin perform pg_temp.como_sistema(); end $$;
insert into ids select 'flujo', pg_temp.iniciar((select id from flujo));
do $$ begin perform pg_temp.registrar((select id from ids where clave = 'flujo'), 'completed', pg_temp.resultado_completo()); end $$;
select is((select count(*) from opsrun.request_ai_marks where request_id = (select id from flujo)), 7::bigint, 'flujo: siete campos AI-marked tras el análisis');
do $$ begin perform pg_temp.como_operador(); end $$;
select is(
  (select opsrun.confirm_details((select id from flujo), (select change_seq from opsrun.request where id = (select id from flujo))) is not null),
  true, 'flujo: Confirm details corre con lo que llenó la IA');
select is(
  (select count(*) from opsrun.request_ai_marks where request_id = (select id from flujo) and field = any (opsrun_private.ai_fields_of('details'))),
  0::bigint, 'flujo: Confirm details cierra las marcas de sus campos');
select is(
  (select count(*) from opsrun.ai_suggestion where request_id = (select id from flujo) and field = 'property' and rank = 1 and decision = 'accepted'),
  1::bigint, 'flujo: la propiedad queda accepted');
select is(
  (select count(*) from opsrun.request_ai_marks where request_id = (select id from flujo) and field = 'sender'), 1::bigint,
  'flujo: el sender sigue AI-marked hasta Confirm sender');

-- ---------------------------------------------------------------------------
-- G13 sigue en verde: ai_fields_of no cambió; los helpers
-- ---------------------------------------------------------------------------
select is(opsrun_private.ai_fields_of('details'),
  array['property', 'space', 'unit', 'beds', 'service', 'service_date', 'time_window', 'access_notes', 'po_number'],
  'ai_fields_of(details) no cambia');
select ok(
  (select bool_and(f in (select code from opsrun.ai_field)) from unnest(opsrun_private.ai_analysis_fields()) as f),
  'todo campo de ai_analysis_fields está en ai_field');
select is(
  (select array_agg(f order by f) from unnest(opsrun_private.ai_analysis_fields()) as f
    where f <> 'multiple_jobs' and not (opsrun_private.ai_draft_columns(f) <> '{}')),
  null::text[], 'todo campo de ai_analysis_fields menos multiple_jobs llena alguna columna del borrador');

select * from finish();
rollback;

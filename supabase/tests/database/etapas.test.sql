-- OPR-30, OPR-31 y OPR-32 · In Progress, Complete y Validation hasta Paid
-- (spec docs/spec/opr-30-31-32-etapas.md §8 y §10.1). Pruebas funcionales de las
-- funciones de la migración 20261203120000_etapas_in_progress_a_paid.sql:
-- clear_alert, mark_oss, approve_job, enter_po, validate_job y
-- record_observed_event, y de sus helpers.
--
-- Las llamadas van como opsrun_app, el rol del servidor, con el actor de la
-- transacción fijado como lo fija el pool (opsrun.auth_user_id u
-- opsrun.system_actor). Los datos de prueba los pone el dueño de los esquemas;
-- el rollback lo deshace. No depende de la seed.
--
-- Que cada función exija un operador (o el sistema) lo prueban, además, G5, G6 y
-- G7 (guard_funciones.test.sql), que las descubren solas por pg_proc, y G14
-- (guard_hechos_del_job.test.sql) para el candado con versión. Este archivo fija
-- una por una que sin actor, con el equivocado o con los dos a la vez, fallan sin
-- escribir nada.
begin;
create extension if not exists pgtap with schema extensions;

select plan(117);

grant opsrun_migrador to current_user with inherit true, set true;
-- Para llamar como opsrun_app con SET ROLE, como el pool. Sin herencia: lo
-- que prueba es lo que opsrun_app tiene, no lo que tiene quien corre el test.
grant opsrun_app to current_user with inherit false, set true;

-- ---------------------------------------------------------------------------
-- Fixture (datos inventados)
-- ---------------------------------------------------------------------------
insert into opsrun.operator (id, auth_user_id, email, display_name, team) values
  ('0a000000-0000-4000-8000-000000000061', 'aa000000-0000-4000-8000-000000000061', 'etapas.uno@example.test', 'Operador Uno', 'operations'),
  ('0a000000-0000-4000-8000-000000000062', 'aa000000-0000-4000-8000-000000000062', 'etapas.dos@example.test', 'Operador Dos', 'finance');

create function pg_temp.rid(p_n int)
returns uuid
language sql
as $$ select ('b0000000-0000-4000-8000-0000000006' || lpad(p_n::text, 2, '0'))::uuid $$;

-- Una request open con el borrador lleno.
create function pg_temp.abierta(p_n int, p_po text default null)
returns uuid
language plpgsql
as $$
begin
  insert into opsrun.request (
    id, received_at, owner_operator_id,
    bzzzbx_customer_id, bzzzbx_contact_id, bzzzbx_property_id, bzzzbx_space_id,
    unit, beds, bzzzbx_service_id, service_date, window_start, window_end,
    access_notes, po_number, bzzzbx_team_id
  ) values (
    pg_temp.rid(p_n), now(), '0a000000-0000-4000-8000-000000000061',
    'bx-cust-t61', 'bx-cont-t61', 'bx-prop-t61', 'bx-space-t61',
    '7C', 2, 'bx-svc-t61', date '2027-03-10', time '09:00', time '12:00',
    'Key at the desk.', p_po, 'bx-team-t61'
  );
  return pg_temp.rid(p_n);
end;
$$;

-- Una request programada (con su job), lista para In Progress a Validation.
create function pg_temp.programada(p_n int, p_po text default null)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := pg_temp.abierta(p_n, p_po);
begin
  insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
  select v_id, k, 'operator', '{}', '0a000000-0000-4000-8000-000000000061'
  from unnest(enum_range(null::opsrun.confirmation_kind)) as k;
  update opsrun.request
     set status = 'scheduled', bzzzbx_job_id = 'bx-job-t61' || lpad(p_n::text, 2, '0'),
         job_number = 'J-T-61' || lpad(p_n::text, 2, '0'), scheduled_at = now()
   where id = v_id;
  return v_id;
end;
$$;

create function pg_temp.ver(p_req uuid)
returns bigint
language sql
as $$ select r.change_seq from opsrun.request as r where r.id = p_req $$;

-- Cada set_config va en una función para no imprimir filas fuera de TAP.
create function pg_temp.actor(p_auth text, p_system text)
returns void
language plpgsql
as $$
begin
  perform set_config('opsrun.auth_user_id', coalesce(p_auth, ''), true);
  perform set_config('opsrun.system_actor', coalesce(p_system, ''), true);
end;
$$;

-- Corre una sentencia como opsrun_app. Devuelve 'ok' o el SQLSTATE: el SET LOCAL
-- se deshace con la subtransacción si falla.
create function pg_temp.estado(p_sql text)
returns text
language plpgsql
as $$
begin
  set local role opsrun_app;
  execute p_sql;
  reset role;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

-- Las llamadas bajo prueba, como opsrun_app. La versión por defecto es el change_seq actual.
create function pg_temp.limpiar(
  p_req uuid,
  p_alert text default 'bx-alert-t61',
  p_rule text default 'MEC-003',
  p_motivo text default 'Large unit, called ahead.',
  p_version bigint default null,
  p_texto text default 'Running 45 min over the window.',
  p_abierta timestamptz default now() - interval '1 hour'
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  set local role opsrun_app;
  v_id := opsrun.clear_alert(p_req, coalesce(p_version, pg_temp.ver(p_req)), p_alert, p_rule, '1',
                             'amber'::opsrun.alert_level, p_texto, p_abierta, p_motivo);
  reset role;
  return v_id;
end;
$$;

create function pg_temp.marcar(p_req uuid, p_marca opsrun.oss_mark, p_motivo text default null, p_version bigint default null)
returns void
language plpgsql
as $$
begin
  set local role opsrun_app;
  perform opsrun.mark_oss(p_req, p_marca, coalesce(p_version, pg_temp.ver(p_req)), p_motivo);
  reset role;
end;
$$;

create function pg_temp.aprobar(p_req uuid, p_version bigint default null)
returns void
language plpgsql
as $$
begin
  set local role opsrun_app;
  perform opsrun.approve_job(p_req, coalesce(p_version, pg_temp.ver(p_req)));
  reset role;
end;
$$;

create function pg_temp.capturar(p_req uuid, p_po text, p_version bigint default null)
returns void
language plpgsql
as $$
begin
  set local role opsrun_app;
  perform opsrun.enter_po(p_req, p_po, coalesce(p_version, pg_temp.ver(p_req)));
  reset role;
end;
$$;

create function pg_temp.validar(p_req uuid, p_requerido boolean, p_po_job text default null, p_version bigint default null)
returns void
language plpgsql
as $$
begin
  set local role opsrun_app;
  perform opsrun.validate_job(p_req, coalesce(p_version, pg_temp.ver(p_req)), p_requerido, p_po_job);
  reset role;
end;
$$;

create function pg_temp.observar(p_job text, p_tipo text, p_evento text, p_cuando timestamptz default now())
returns bigint
language plpgsql
as $$
declare
  v_id bigint;
begin
  set local role opsrun_app;
  v_id := opsrun.record_observed_event(p_job, p_tipo, p_evento, p_cuando);
  reset role;
  return v_id;
end;
$$;

create function pg_temp.eventos(p_req uuid)
returns text
language sql
as $$
  select coalesce(string_agg(e.event_type, ',' order by e.id), '')
  from opsrun.audit_event as e
  where e.request_id = p_req
$$;

create function pg_temp.cuenta_eventos(p_req uuid, p_tipo text)
returns bigint
language sql
as $$ select count(*) from opsrun.audit_event as e where e.request_id = p_req and e.event_type = p_tipo $$;

-- El operador por defecto de las pruebas: Operador Uno.
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000061', null); end $$;

-- ---------------------------------------------------------------------------
-- 1. Sin actor, con el de sistema o con los dos a la vez: 42501 y no escriben nada
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.programada(1); end $$;
do $$ begin perform pg_temp.programada(2); end $$;

-- Las cinco del operador, con el actor que se declare; devuelve los SQLSTATE en orden.
create function pg_temp.estados_del_operador(p_req uuid)
returns text
language sql
as $$
  select concat_ws(',',
    pg_temp.estado(format($q$ select opsrun.clear_alert(%L, %s, 'bx-alert-x', 'MEC-003', '1', 'amber', 'Late.', now() - interval '1 hour', 'Reviewed') $q$, p_req, pg_temp.ver(p_req))),
    pg_temp.estado(format($q$ select opsrun.mark_oss(%L, 'oss', %s) $q$, p_req, pg_temp.ver(p_req))),
    pg_temp.estado(format($q$ select opsrun.approve_job(%L, %s) $q$, p_req, pg_temp.ver(p_req))),
    pg_temp.estado(format($q$ select opsrun.enter_po(%L, 'PO-X', %s) $q$, p_req, pg_temp.ver(p_req))),
    pg_temp.estado(format($q$ select opsrun.validate_job(%L, %s, false) $q$, p_req, pg_temp.ver(p_req)))
  )
$$;

do $$ begin perform pg_temp.actor(null, null); end $$;
select is(pg_temp.estados_del_operador(pg_temp.rid(1)), '42501,42501,42501,42501,42501',
  'sin actor, las cinco funciones del operador fallan con 42501');
do $$ begin perform pg_temp.actor(null, 'observador'); end $$;
select is(pg_temp.estados_del_operador(pg_temp.rid(1)), '42501,42501,42501,42501,42501',
  'con el actor de sistema, las cinco funciones del operador fallan con 42501');
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000061', 'observador'); end $$;
select is(pg_temp.estados_del_operador(pg_temp.rid(1)), '42501,42501,42501,42501,42501',
  'con operador y sistema a la vez, las cinco funciones del operador fallan con 42501');
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-0000000000ff', null); end $$;
select is(pg_temp.estados_del_operador(pg_temp.rid(1)), '42501,42501,42501,42501,42501',
  'con un operador que no existe, las cinco funciones fallan con 42501');

do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000061', null); end $$;
select is(pg_temp.eventos(pg_temp.rid(1)), '', 'sin actor no se escribió ningún Audit');
select is(
  (select count(*) from opsrun.request as r
    where r.id = pg_temp.rid(1)
      and num_nonnulls(r.oss_mark, r.approved_at, r.entered_po_at, r.validated_at) = 0),
  1::bigint,
  'sin actor no se escribió ningún hecho del job'
);
select is((select count(*) from opsrun.alert_occurrence as a where a.request_id = pg_temp.rid(1)), 0::bigint,
  'sin actor no se creó ninguna ocurrencia');

-- record_observed_event: del sistema, no del operador.
do $$ begin perform pg_temp.actor(null, null); end $$;
select is(pg_temp.estado($q$ select opsrun.record_observed_event('bx-job-t6101', 'job_checked_in', 'bx-evt-t1', now()) $q$), '42501',
  'record_observed_event sin actor falla con 42501');
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000061', null); end $$;
select is(pg_temp.estado($q$ select opsrun.record_observed_event('bx-job-t6101', 'job_checked_in', 'bx-evt-t1', now()) $q$), '42501',
  'record_observed_event con un operador falla con 42501');
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000061', 'observador'); end $$;
select is(pg_temp.estado($q$ select opsrun.record_observed_event('bx-job-t6101', 'job_checked_in', 'bx-evt-t1', now()) $q$), '42501',
  'record_observed_event con los dos actores falla con 42501');
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000061', null); end $$;

-- ---------------------------------------------------------------------------
-- 2. Una request open (sin job) y una versión vieja: OP019, OP013 y OP006, sin escribir
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.abierta(3); end $$;

create function pg_temp.estados_con(p_req uuid, p_version bigint)
returns text
language sql
as $$
  select concat_ws(',',
    pg_temp.estado(format($q$ select opsrun.clear_alert(%L, %s, 'bx-alert-x', 'MEC-003', '1', 'amber', 'Late.', now() - interval '1 hour', 'Reviewed') $q$, p_req, p_version)),
    pg_temp.estado(format($q$ select opsrun.mark_oss(%L, 'oss', %s) $q$, p_req, p_version)),
    pg_temp.estado(format($q$ select opsrun.approve_job(%L, %s) $q$, p_req, p_version)),
    pg_temp.estado(format($q$ select opsrun.enter_po(%L, 'PO-X', %s) $q$, p_req, p_version)),
    pg_temp.estado(format($q$ select opsrun.validate_job(%L, %s, false) $q$, p_req, p_version))
  )
$$;

select is(pg_temp.estados_con(pg_temp.rid(3), pg_temp.ver(pg_temp.rid(3))), 'OP019,OP019,OP019,OP019,OP019',
  'una request open (sin job): las cinco funciones fallan con OP019');
select is(pg_temp.estados_con(pg_temp.rid(2), pg_temp.ver(pg_temp.rid(2)) - 1), 'OP013,OP013,OP013,OP013,OP013',
  'con la versión vieja: las cinco funciones fallan con OP013');
select is(pg_temp.estados_con('b0000000-0000-4000-8000-0000000006ff', 1), 'OP006,OP006,OP006,OP006,OP006',
  'una request que no existe: las cinco funciones fallan con OP006');
select is(pg_temp.eventos(pg_temp.rid(2)), '', 'con la versión vieja no se escribió Audit');
select is(pg_temp.eventos(pg_temp.rid(3)), '', 'en una request open no se escribió Audit');
select is((select count(*) from opsrun.alert_occurrence as a where a.request_id in (pg_temp.rid(2), pg_temp.rid(3))), 0::bigint,
  'ni con la versión vieja ni en una request open se creó una ocurrencia');

-- ---------------------------------------------------------------------------
-- 3. clear_alert
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.programada(10); end $$;
do $$ begin perform pg_temp.programada(11); end $$;

-- Una ocurrencia que ya existe (la dejó el write-back, OPR-34), abierta, en R11.
insert into opsrun.alert_occurrence (id, bzzzbx_alert_id, request_id, rule_id, rule_version, level, reason_text, opened_at)
values ('a1000000-0000-4000-8000-000000000061', 'bx-alert-existente', pg_temp.rid(11), 'MEC-003', '1', 'red',
        'Running 90 min over the window.', now() - interval '2 hours');

-- Sin motivo, o con el motivo en blanco: 22023 y no escribe nada.
select is(pg_temp.estado(format($q$ select opsrun.clear_alert(%L, %s, 'bx-alert-t61', 'MEC-003', '1', 'amber', 'Late.', now(), null) $q$, pg_temp.rid(10), pg_temp.ver(pg_temp.rid(10)))),
  '22023', 'clear_alert sin motivo falla con 22023');
select is(pg_temp.estado(format($q$ select opsrun.clear_alert(%L, %s, 'bx-alert-t61', 'MEC-003', '1', 'amber', 'Late.', now(), '   ') $q$, pg_temp.rid(10), pg_temp.ver(pg_temp.rid(10)))),
  '22023', 'clear_alert con el motivo en blanco falla con 22023');
select is(pg_temp.estado(format($q$ select opsrun.clear_alert(%L, %s, '', 'MEC-003', '1', 'amber', 'Late.', now(), 'Reviewed') $q$, pg_temp.rid(10), pg_temp.ver(pg_temp.rid(10)))),
  '22023', 'clear_alert sin el id de la alerta falla con 22023');
select is(pg_temp.estado(format($q$ select opsrun.clear_alert(%L, %s, 'bx-alert-t61', 'MEC-003', '1', 'amber', 'Late.', null, 'Reviewed') $q$, pg_temp.rid(10), pg_temp.ver(pg_temp.rid(10)))),
  '22023', 'clear_alert sin la hora de apertura falla con 22023');

-- Una regla que no se limpia: OP020.
select is(pg_temp.estado(format($q$ select opsrun.clear_alert(%L, %s, 'bx-alert-ops', 'OPS-001', '1', 'amber', 'Unassigned.', now() - interval '1 hour', 'Reviewed') $q$, pg_temp.rid(10), pg_temp.ver(pg_temp.rid(10)))),
  'OP020', 'clear_alert con OPS-001 falla con OP020');
select is(pg_temp.estado(format($q$ select opsrun.clear_alert(%L, %s, 'bx-alert-trn', 'TRN-005', '1', 'amber', 'PO missing.', now() - interval '1 hour', 'Reviewed') $q$, pg_temp.rid(10), pg_temp.ver(pg_temp.rid(10)))),
  'OP020', 'clear_alert con TRN-005 falla con OP020');
select is((select count(*) from opsrun.alert_occurrence as a where a.request_id = pg_temp.rid(10)), 0::bigint,
  'los rechazos no crearon la ocurrencia');
select is(pg_temp.eventos(pg_temp.rid(10)), '', 'los rechazos no dejaron Audit');

-- Una ocurrencia de otra request: OP021. Una ya resuelta: OP022.
select is(pg_temp.estado(format($q$ select opsrun.clear_alert(%L, %s, 'bx-alert-existente', 'MEC-003', '1', 'amber', 'Late.', now() - interval '1 hour', 'Reviewed') $q$, pg_temp.rid(10), pg_temp.ver(pg_temp.rid(10)))),
  'OP021', 'clear_alert con la alerta de otra request falla con OP021');

-- La ocurrencia que ya existía: se reutiliza y se resuelve.
select is(pg_temp.limpiar(pg_temp.rid(11), 'bx-alert-existente', p_motivo => '  Large unit.  '), 'a1000000-0000-4000-8000-000000000061'::uuid,
  'clear_alert reutiliza la ocurrencia que ya existe');
select is((select count(*) from opsrun.alert_occurrence as a where a.request_id = pg_temp.rid(11)), 1::bigint,
  'no se creó una ocurrencia más');
select results_eq(
  $$ select resolution::text, resolved_by, resolution_reason, level::text, reason_text
       from opsrun.alert_occurrence where id = 'a1000000-0000-4000-8000-000000000061' $$,
  $$ values ('cleared_by_operator', '0a000000-0000-4000-8000-000000000061'::uuid, 'Large unit.', 'red', 'Running 90 min over the window.') $$,
  'la ocurrencia queda cleared_by_operator con el operador y el motivo recortado, y su instantánea no cambia'
);
select is(pg_temp.estado(format($q$ select opsrun.clear_alert(%L, %s, 'bx-alert-existente', 'MEC-003', '1', 'amber', 'Late.', now() - interval '1 hour', 'Again') $q$, pg_temp.rid(11), pg_temp.ver(pg_temp.rid(11)))),
  'OP022', 'clear_alert con la alerta ya resuelta falla con OP022');

-- Una ocurrencia que todavía no existe: la crea con la instantánea del servidor y la resuelve.
select isnt(pg_temp.limpiar(pg_temp.rid(10), 'bx-alert-t61', p_motivo => 'Large unit, called ahead.'), null::uuid,
  'clear_alert devuelve el id de la ocurrencia que creó');
select results_eq(
  $$ select rule_id, rule_version, level::text, reason_text, resolution::text, resolved_by, resolution_reason,
            opened_at <= now() - interval '59 minutes' and opened_at >= now() - interval '61 minutes' as abierta_hace_una_hora
       from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-t61' $$,
  $$ values ('MEC-003', '1', 'amber', 'Running 45 min over the window.', 'cleared_by_operator',
             '0a000000-0000-4000-8000-000000000061'::uuid, 'Large unit, called ahead.', true) $$,
  'la ocurrencia nueva guarda la instantánea que pasó el servidor y queda resuelta por el operador'
);
select results_eq(
  $$ select reason, actor_kind::text, actor_operator_id, details ->> 'bzzzbx_alert_id', details ->> 'rule_id',
            alert_occurrence_id = (select id from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-t61')
       from opsrun.audit_event where request_id = '$$ || pg_temp.rid(10) || $$' and event_type = 'alert_cleared' $$,
  $$ values ('Large unit, called ahead.', 'operator', '0a000000-0000-4000-8000-000000000061'::uuid, 'bx-alert-t61', 'MEC-003', true) $$,
  'alert_cleared lleva motivo, operador, la alerta y la regla'
);
select is(pg_temp.eventos(pg_temp.rid(10)), 'alert_cleared',
  'no hay alert_opened antes cuando la ocurrencia la creó clear_alert');
select is(
  (select v.resolution::text from opsrun_writeback.v1_alert_occurrence as v where v.bzzzbx_alert_id = 'bx-alert-t61'),
  'cleared_by_operator',
  'v1_alert_occurrence muestra la resolución para el write-back'
);
select is(pg_temp.estado(format($q$ select opsrun.clear_alert(%L, %s, 'bx-alert-t61', 'MEC-003', '1', 'amber', 'Late.', now() - interval '1 hour', 'Again') $q$, pg_temp.rid(10), pg_temp.ver(pg_temp.rid(10)))),
  'OP022', 'limpiar dos veces la misma alerta falla con OP022 y no crea otra');

-- Clear alert no cambia la request ni mueve la etapa.
select is(
  (select num_nonnulls(r.oss_mark, r.approved_at, r.entered_po_at, r.validated_at)::int from opsrun.request as r where r.id = pg_temp.rid(10)),
  0, 'clear_alert no toca los hechos del job de la request');

-- ---------------------------------------------------------------------------
-- 4. mark_oss
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.programada(20); end $$;
do $$ begin perform pg_temp.programada(21); end $$;
-- R21 terminó a mano sin fotos: OSS automático (como la seed de R5).
update opsrun.request
   set ended_manually_at = now() - interval '1 hour', ended_manually_by = '0a000000-0000-4000-8000-000000000061',
       oss_mark = 'oss', oss_marked_at = now() - interval '1 hour', oss_source = 'auto'
 where id = pg_temp.rid(21);

select is(pg_temp.estado(format($q$ select opsrun.mark_oss(%L, null, %s) $q$, pg_temp.rid(20), pg_temp.ver(pg_temp.rid(20)))),
  '22023', 'mark_oss sin marca falla con 22023');

select lives_ok($$ select pg_temp.marcar(pg_temp.rid(20), 'oss', 'Cleaner took no photos') $$, 'mark_oss pone OSS');
select results_eq(
  $$ select oss_mark::text, oss_source::text, oss_marked_by, oss_marked_at is not null from opsrun.request where id = '$$ || pg_temp.rid(20) || $$' $$,
  $$ values ('oss', 'operator', '0a000000-0000-4000-8000-000000000061'::uuid, true) $$,
  'mark_oss guarda la marca, el operador y la fuente operator'
);
select results_eq(
  $$ select reason, details ->> 'mark', details ->> 'previous_mark', actor_operator_id
       from opsrun.audit_event where request_id = '$$ || pg_temp.rid(20) || $$' and event_type = 'oss_marked' $$,
  $$ values ('Cleaner took no photos', 'oss', null, '0a000000-0000-4000-8000-000000000061'::uuid) $$,
  'oss_marked lleva la marca, la anterior (ninguna) y el motivo'
);
select is(pg_temp.estado(format($q$ select opsrun.mark_oss(%L, 'oss', %s) $q$, pg_temp.rid(20), pg_temp.ver(pg_temp.rid(20)))),
  'OP024', 'mark_oss con la marca que ya tiene falla con OP024');
select lives_ok($$ select pg_temp.marcar(pg_temp.rid(20), 'not_oss') $$, 'mark_oss cambia de OSS a Not OSS');
select results_eq(
  $$ select reason, details ->> 'mark', details ->> 'previous_mark'
       from opsrun.audit_event where request_id = '$$ || pg_temp.rid(20) || $$' and event_type = 'oss_marked' order by id desc limit 1 $$,
  $$ values (null::text, 'not_oss', 'oss') $$,
  'el segundo oss_marked dice cuál era la marca anterior y no lleva motivo'
);

-- Una marca automática (R5) la cambia el operador.
select lives_ok($$ select pg_temp.marcar(pg_temp.rid(21), 'not_oss') $$, 'mark_oss cambia una marca auto a la del operador');
select results_eq(
  $$ select oss_mark::text, oss_source::text, oss_marked_by is not null from opsrun.request where id = '$$ || pg_temp.rid(21) || $$' $$,
  $$ values ('not_oss', 'operator', true) $$,
  'la marca auto pasó a ser del operador'
);
select is(
  (select details ->> 'previous_mark' from opsrun.audit_event where request_id = pg_temp.rid(21) and event_type = 'oss_marked'),
  'oss', 'oss_marked dice que la anterior era OSS (auto)');

-- Aprobado, la marca no cambia (P-12).
do $$ begin perform pg_temp.aprobar(pg_temp.rid(20)); end $$;
select is(pg_temp.estado(format($q$ select opsrun.mark_oss(%L, 'oss', %s) $q$, pg_temp.rid(20), pg_temp.ver(pg_temp.rid(20)))),
  'OP023', 'mark_oss con el job aprobado falla con OP023');

-- ---------------------------------------------------------------------------
-- 5. approve_job
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.programada(30); end $$;

select lives_ok($$ select pg_temp.aprobar(pg_temp.rid(30)) $$, 'approve_job aprueba el job');
select results_eq(
  $$ select approved_by, approved_at is not null from opsrun.request where id = '$$ || pg_temp.rid(30) || $$' $$,
  $$ values ('0a000000-0000-4000-8000-000000000061'::uuid, true) $$,
  'approve_job guarda quién y cuándo'
);
select is(pg_temp.eventos(pg_temp.rid(30)), 'job_approved',
  'approve_job deja job_approved y ningún aviso al requester (S-9)');
select is(pg_temp.estado(format($q$ select opsrun.approve_job(%L, %s) $q$, pg_temp.rid(30), pg_temp.ver(pg_temp.rid(30)))),
  'OP023', 'approve_job dos veces falla con OP023');
select is(pg_temp.cuenta_eventos(pg_temp.rid(30), 'job_approved'), 1::bigint, 'el segundo intento no dejó otro Audit');
select is((select count(*) from opsrun.instruction as i where i.request_id = pg_temp.rid(30)), 0::bigint,
  'Fase A: approve_job no crea ninguna instrucción');
-- Approve no exige la marca OSS (S-8): R30 se aprobó sin marca.
select is((select oss_mark::text from opsrun.request where id = pg_temp.rid(30)), null::text, 'Approve no exige una marca OSS');

-- ---------------------------------------------------------------------------
-- 6. enter_po
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.programada(40); end $$;

select is(pg_temp.estado(format($q$ select opsrun.enter_po(%L, '   ', %s) $q$, pg_temp.rid(40), pg_temp.ver(pg_temp.rid(40)))),
  '22023', 'enter_po con el PO en blanco falla con 22023');
select is(pg_temp.estado(format($q$ select opsrun.enter_po(%L, null, %s) $q$, pg_temp.rid(40), pg_temp.ver(pg_temp.rid(40)))),
  '22023', 'enter_po sin PO falla con 22023');
select is(pg_temp.estado(format($q$ select opsrun.enter_po(%L, %L, %s) $q$, pg_temp.rid(40), repeat('x', 65), pg_temp.ver(pg_temp.rid(40)))),
  '22023', 'enter_po con más de 64 caracteres falla con 22023');
select lives_ok($$ select pg_temp.capturar(pg_temp.rid(40), repeat('y', 64)) $$, 'enter_po acepta 64 caracteres');
select lives_ok($$ select pg_temp.capturar(pg_temp.rid(40), '  PO-EX-4000  ') $$, 'enter_po acepta un PO con espacios y lo recorta');
select results_eq(
  $$ select entered_po_number, entered_po_by, entered_po_at is not null from opsrun.request where id = '$$ || pg_temp.rid(40) || $$' $$,
  $$ values ('PO-EX-4000', '0a000000-0000-4000-8000-000000000061'::uuid, true) $$,
  'enter_po guarda el PO recortado, quién y cuándo'
);
select results_eq(
  $$ select details ->> 'po_number', details ->> 'previous_po_number'
       from opsrun.audit_event where request_id = '$$ || pg_temp.rid(40) || $$' and event_type = 'po_entered' order by id desc limit 1 $$,
  $$ values ('PO-EX-4000', repeat('y', 64)) $$,
  'po_entered lleva el PO y el que había antes'
);
select is(pg_temp.estado(format($q$ select opsrun.enter_po(%L, 'PO-EX-4000', %s) $q$, pg_temp.rid(40), pg_temp.ver(pg_temp.rid(40)))),
  'OP024', 'enter_po con el mismo PO falla con OP024');
select is(pg_temp.cuenta_eventos(pg_temp.rid(40), 'po_entered'), 2::bigint, 'solo los dos cambios reales dejaron Audit');
select is((select count(*) from opsrun.instruction as i where i.request_id = pg_temp.rid(40)), 0::bigint,
  'Fase A: enter_po no crea ninguna instrucción (write_po es de Fase B)');
select is((select po_number from opsrun.request where id = pg_temp.rid(40)), null::text,
  'el PO del borrador no se toca: sigue congelado');

-- ---------------------------------------------------------------------------
-- 7. validate_job
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.programada(50); end $$;
do $$ begin perform pg_temp.programada(51, 'PO-DRAFT-51'); end $$;
do $$ begin perform pg_temp.programada(52); end $$;
do $$ begin perform pg_temp.programada(53); end $$;
do $$ begin perform pg_temp.programada(54); end $$;

-- Sin aprobar: OP026.
select is(pg_temp.estado(format($q$ select opsrun.validate_job(%L, %s, false) $q$, pg_temp.rid(50), pg_temp.ver(pg_temp.rid(50)))),
  'OP026', 'validate_job sin aprobar falla con OP026');
select is(pg_temp.estado(format($q$ select opsrun.validate_job(%L, %s, null) $q$, pg_temp.rid(50), pg_temp.ver(pg_temp.rid(50)))),
  '22023', 'validate_job sin saber si el cliente exige PO falla con 22023');

do $$ begin perform pg_temp.aprobar(pg_temp.rid(50)); end $$;
do $$ begin perform pg_temp.aprobar(pg_temp.rid(51)); end $$;
do $$ begin perform pg_temp.aprobar(pg_temp.rid(52)); end $$;
do $$ begin perform pg_temp.aprobar(pg_temp.rid(53)); end $$;
do $$ begin perform pg_temp.aprobar(pg_temp.rid(54)); end $$;

-- El cliente exige PO y no hay ninguno: OP027, sin escribir.
select is(pg_temp.estado(format($q$ select opsrun.validate_job(%L, %s, true) $q$, pg_temp.rid(50), pg_temp.ver(pg_temp.rid(50)))),
  'OP027', 'validate_job con el PO exigido y sin PO falla con OP027');
select is(pg_temp.estado(format($q$ select opsrun.validate_job(%L, %s, true, '   ') $q$, pg_temp.rid(50), pg_temp.ver(pg_temp.rid(50)))),
  'OP027', 'un PO de PINCH en blanco no cuenta');
select is(
  (select validated_at is null from opsrun.request where id = pg_temp.rid(50)) and pg_temp.cuenta_eventos(pg_temp.rid(50), 'job_validated') = 0,
  true, 'el rechazo no validó ni dejó Audit');

-- Sin PO exigido, valida sin PO.
select lives_ok($$ select pg_temp.validar(pg_temp.rid(50), false) $$, 'validate_job sin PO exigido valida aunque no haya PO');
select results_eq(
  $$ select validated_by, validated_at is not null from opsrun.request where id = '$$ || pg_temp.rid(50) || $$' $$,
  $$ values ('0a000000-0000-4000-8000-000000000061'::uuid, true) $$,
  'validate_job guarda quién y cuándo'
);
select results_eq(
  $$ select (details -> 'po_required')::text, (details -> 'po_source')::text, (details -> 'po_number')::text
       from opsrun.audit_event where request_id = '$$ || pg_temp.rid(50) || $$' and event_type = 'job_validated' $$,
  $$ values ('false', 'null', 'null') $$,
  'job_validated sin PO dice po_required false y sin fuente'
);
select is(pg_temp.estado(format($q$ select opsrun.validate_job(%L, %s, false) $q$, pg_temp.rid(50), pg_temp.ver(pg_temp.rid(50)))),
  'OP025', 'validate_job dos veces falla con OP025');
select is(pg_temp.estado(format($q$ select opsrun.enter_po(%L, 'PO-LATE', %s) $q$, pg_temp.rid(50), pg_temp.ver(pg_temp.rid(50)))),
  'OP025', 'enter_po con el job validado falla con OP025');

-- El PO vigente, por fuente (P-2): opsRUN, PINCH o borrador.
do $$ begin perform pg_temp.capturar(pg_temp.rid(52), 'PO-OPSRUN-52'); end $$;
select lives_ok($$ select pg_temp.validar(pg_temp.rid(52), true, 'PO-PINCH-52') $$, 'validate_job con PO de opsRUN y de PINCH valida');
select results_eq(
  $$ select details ->> 'po_source', details ->> 'po_number'
       from opsrun.audit_event where request_id = '$$ || pg_temp.rid(52) || $$' and event_type = 'job_validated' $$,
  $$ values ('opsrun', 'PO-OPSRUN-52') $$,
  'manda el PO de opsRUN sobre el de PINCH: details.po_source = opsrun'
);

select lives_ok($$ select pg_temp.validar(pg_temp.rid(53), true, ' PO-PINCH-53 ') $$, 'validate_job con PO solo de PINCH valida');
select results_eq(
  $$ select details ->> 'po_source', (details -> 'po_number')::text, (details -> 'po_required')::text
       from opsrun.audit_event where request_id = '$$ || pg_temp.rid(53) || $$' and event_type = 'job_validated' $$,
  $$ values ('pinch', 'null', 'true') $$,
  'con el PO de PINCH, details.po_source = pinch y el PO de PINCH no se copia a Audit'
);

select lives_ok($$ select pg_temp.validar(pg_temp.rid(51), true) $$, 'validate_job con PO solo del borrador valida');
select results_eq(
  $$ select details ->> 'po_source', details ->> 'po_number'
       from opsrun.audit_event where request_id = '$$ || pg_temp.rid(51) || $$' and event_type = 'job_validated' $$,
  $$ values ('draft', 'PO-DRAFT-51') $$,
  'con el PO del borrador, details.po_source = draft'
);

-- El orden de las fuentes, directo en el helper.
select is(
  opsrun_private.current_po((select r from opsrun.request as r where r.id = pg_temp.rid(51)), 'PO-PINCH')::text,
  '{"po_number": "PO-PINCH", "po_source": "pinch"}',
  'current_po: el de PINCH le gana al del borrador'
);
select is(
  opsrun_private.current_po((select r from opsrun.request as r where r.id = pg_temp.rid(54)), null)::text,
  '{"po_number": null, "po_source": null}',
  'current_po: sin ninguna fuente, nada'
);
select is(opsrun_private.clearable_rules(), array['MEC-003']::text[], 'clearable_rules: solo MEC-003');

-- ---------------------------------------------------------------------------
-- 8. Atómico: si falla un paso, no queda ni el dato ni su Audit
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.programada(60); end $$;
do $$ begin perform pg_temp.programada(61); end $$;

create function opsrun_private.prueba_falla_audit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'falla forzada del Audit' using errcode = 'XX999';
end;
$$;
create trigger prueba_falla_audit before insert on opsrun.audit_event
  for each row when (new.event_type in ('job_approved', 'alert_cleared', 'oss_marked', 'po_entered')) execute function opsrun_private.prueba_falla_audit();

select is(pg_temp.estado(format($q$ select opsrun.approve_job(%L, %s) $q$, pg_temp.rid(60), pg_temp.ver(pg_temp.rid(60)))), 'XX999',
  'si el Audit falla, approve_job falla');
select is((select approved_at is null from opsrun.request where id = pg_temp.rid(60)), true,
  'approve_job: sin Audit tampoco queda el dato');
select is(pg_temp.estado(format($q$ select opsrun.mark_oss(%L, 'oss', %s) $q$, pg_temp.rid(60), pg_temp.ver(pg_temp.rid(60)))), 'XX999',
  'si el Audit falla, mark_oss falla');
select is((select oss_mark is null from opsrun.request where id = pg_temp.rid(60)), true,
  'mark_oss: sin Audit tampoco queda la marca');
select is(pg_temp.estado(format($q$ select opsrun.enter_po(%L, 'PO-X', %s) $q$, pg_temp.rid(60), pg_temp.ver(pg_temp.rid(60)))), 'XX999',
  'si el Audit falla, enter_po falla');
select is((select entered_po_number is null from opsrun.request where id = pg_temp.rid(60)), true,
  'enter_po: sin Audit tampoco queda el PO');
select is(pg_temp.estado(format($q$ select opsrun.clear_alert(%L, %s, 'bx-alert-t6061', 'MEC-003', '1', 'amber', 'Late.', now() - interval '1 hour', 'Reviewed') $q$, pg_temp.rid(60), pg_temp.ver(pg_temp.rid(60)))), 'XX999',
  'si el Audit falla, clear_alert falla');
select is((select count(*) from opsrun.alert_occurrence as a where a.bzzzbx_alert_id = 'bx-alert-t6061'), 0::bigint,
  'clear_alert: sin Audit tampoco queda la ocurrencia');

drop trigger prueba_falla_audit on opsrun.audit_event;

-- ---------------------------------------------------------------------------
-- 9. Constraints de las columnas nuevas (como el dueño, sin pasar por las funciones)
-- ---------------------------------------------------------------------------
select throws_ok(
  format($q$ update opsrun.request set entered_po_number = 'PO-X' where id = %L $q$, pg_temp.rid(61)),
  '23514', null, 'el PO capturado va junto con su fecha y su autor (request_entered_po_together)');
select throws_ok(
  format($q$ update opsrun.request set entered_po_number = '  ', entered_po_at = now(), entered_po_by = '0a000000-0000-4000-8000-000000000061' where id = %L $q$, pg_temp.rid(61)),
  '23514', null, 'el PO capturado no puede estar en blanco (request_entered_po_not_blank)');
select throws_ok(
  format($q$ update opsrun.request set validated_at = now() where id = %L $q$, pg_temp.rid(61)),
  '23514', null, 'la validación va con su autor (request_validated_pair)');
select throws_ok(
  format($q$ update opsrun.request set validated_at = now(), validated_by = '0a000000-0000-4000-8000-000000000061' where id = %L $q$, pg_temp.rid(61)),
  '23514', null, 'no se valida un job sin aprobar (request_validated_needs_approval)');
select throws_ok(
  format($q$ update opsrun.request set entered_po_number = 'PO-X', entered_po_at = now(), entered_po_by = '0a000000-0000-4000-8000-000000000061' where id = %L $q$, pg_temp.rid(3)),
  '23514', null, 'una request open no acepta el PO capturado (request_job_facts_need_job)');

-- ---------------------------------------------------------------------------
-- 10. record_observed_event
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.programada(70); end $$;
do $$ begin perform pg_temp.actor(null, 'observador'); end $$;

do $$ begin perform pg_temp.observar('bx-job-t6170', 'job_checked_in', 'bx-evt-t6170-1', now() - interval '3 hours'); end $$;
select results_eq(
  $$ select event_type, actor_kind::text, actor_operator_id, source::text, bzzzbx_event_id, details::text,
            occurred_at <= now() - interval '179 minutes' and occurred_at >= now() - interval '181 minutes'
       from opsrun.audit_event where bzzzbx_event_id = 'bx-evt-t6170-1' $$,
  $$ values ('job_checked_in', 'bzzzbx', null::uuid, 'bzzzbx_observed', 'bx-evt-t6170-1', '{}', true) $$,
  'record_observed_event escribe solo el tipo, la hora de BzzzBX y su id, sin operador ni detalles'
);
select is(pg_temp.observar('bx-job-t6170', 'job_checked_in', 'bx-evt-t6170-1'), null::bigint,
  'un evento repetido (mismo bzzzbx_event_id) no se escribe otra vez');
select is((select count(*) from opsrun.audit_event as e where e.bzzzbx_event_id = 'bx-evt-t6170-1'), 1::bigint,
  'el evento repetido no duplicó la fila');
select is(pg_temp.observar('bx-job-no-existe', 'job_started', 'bx-evt-t6170-2'), null::bigint,
  'un job que no es de ninguna request no escribe nada y devuelve null');
select is((select count(*) from opsrun.audit_event as e where e.bzzzbx_event_id = 'bx-evt-t6170-2'), 0::bigint,
  'el job desconocido no dejó fila');
select isnt(pg_temp.observar('bx-job-t6170', 'job_paid', 'bx-evt-t6170-3'), null::bigint, 'un evento nuevo devuelve su id');
select is(pg_temp.estado($q$ select opsrun.record_observed_event('bx-job-t6170', 'job_approved', 'bx-evt-t6170-4', now()) $q$), '22023',
  'un tipo que no es observado (job_approved es de opsRUN) falla con 22023');
select is(pg_temp.estado($q$ select opsrun.record_observed_event('bx-job-t6170', 'no_existe', 'bx-evt-t6170-5', now()) $q$), '22023',
  'un tipo fuera del catálogo falla con 22023');
select is(pg_temp.estado($q$ select opsrun.record_observed_event('bx-job-t6170', 'job_started', '', now()) $q$), '22023',
  'sin id de evento falla con 22023');
select is(pg_temp.estado($q$ select opsrun.record_observed_event('bx-job-t6170', 'job_started', 'bx-evt-t6170-6', null) $q$), '22023',
  'sin hora falla con 22023');
select is(
  (select r.change_seq from opsrun.request as r where r.id = pg_temp.rid(70)),
  pg_temp.ver(pg_temp.rid(70)),
  'record_observed_event no toca la request ni su change_seq'
);
select is(pg_temp.eventos(pg_temp.rid(70)), 'job_checked_in,job_paid', 'quedaron los dos hechos observados, y nada más');
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000061', null); end $$;

-- ---------------------------------------------------------------------------
-- 11. El flujo en SQL: enlazada → clear_alert → mark_oss → approve → enter_po → validate
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.programada(80); end $$;
do $$ begin perform pg_temp.limpiar(pg_temp.rid(80), 'bx-alert-t6180', p_motivo => 'Reviewed with the cleaner.'); end $$;
do $$ begin perform pg_temp.marcar(pg_temp.rid(80), 'not_oss'); end $$;
do $$ begin perform pg_temp.aprobar(pg_temp.rid(80)); end $$;
do $$ begin perform pg_temp.capturar(pg_temp.rid(80), 'PO-FLOW-80'); end $$;
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000062', null); end $$;
do $$ begin perform pg_temp.validar(pg_temp.rid(80), true); end $$;
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000061', null); end $$;

select is(pg_temp.eventos(pg_temp.rid(80)), 'alert_cleared,oss_marked,job_approved,po_entered,job_validated',
  'el flujo deja los cinco eventos en orden');
select results_eq(
  $$ select event_type, actor_operator_id from opsrun.audit_event where request_id = '$$ || pg_temp.rid(80) || $$' order by id $$,
  $$ values ('alert_cleared', '0a000000-0000-4000-8000-000000000061'::uuid),
            ('oss_marked', '0a000000-0000-4000-8000-000000000061'::uuid),
            ('job_approved', '0a000000-0000-4000-8000-000000000061'::uuid),
            ('po_entered', '0a000000-0000-4000-8000-000000000061'::uuid),
            ('job_validated', '0a000000-0000-4000-8000-000000000062'::uuid) $$,
  'cada evento lleva a su persona: Validate, la de Finance'
);
select results_eq(
  $$ select oss_mark::text, approved_by, entered_po_number, validated_by from opsrun.request where id = '$$ || pg_temp.rid(80) || $$' $$,
  $$ values ('not_oss', '0a000000-0000-4000-8000-000000000061'::uuid, 'PO-FLOW-80', '0a000000-0000-4000-8000-000000000062'::uuid) $$,
  'el flujo deja la request marcada, aprobada, con PO y validada'
);
select is((select count(*) from opsrun.instruction as i where i.request_id = pg_temp.rid(80)), 0::bigint,
  'ninguna función de las etapas manda instrucciones en la Fase A');

-- ---------------------------------------------------------------------------
-- 12. v1_request y el write-back
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(x.attname::text, ',' order by x.attnum) from (
     select a.attname, a.attnum from pg_catalog.pg_attribute as a
      where a.attrelid = 'opsrun_writeback.v1_request'::regclass and a.attnum > 0 and not a.attisdropped
      order by a.attnum desc limit 5) as x),
  'entered_po_number,entered_po_at,entered_po_by,validated_at,validated_by',
  'v1_request termina con las cinco columnas nuevas, al final'
);
select is(
  (select a.attname::text from pg_catalog.pg_attribute as a
    where a.attrelid = 'opsrun_writeback.v1_request'::regclass and a.attnum = 32),
  'change_seq', 'las columnas de antes no se movieron: change_seq sigue en su lugar');
select ok(
  has_column_privilege('bzzz_writeback_opsrun', 'opsrun_writeback.v1_request', 'entered_po_number', 'select')
  and has_column_privilege('bzzz_writeback_opsrun', 'opsrun_writeback.v1_request', 'validated_at', 'select'),
  'bzzz_writeback_opsrun lee las columnas nuevas de v1_request'
);
select results_eq(
  $$ select entered_po_number, validated_by from opsrun_writeback.v1_request where id = '$$ || pg_temp.rid(80) || $$' $$,
  $$ values ('PO-FLOW-80', '0a000000-0000-4000-8000-000000000062'::uuid) $$,
  'el write-back ve el PO capturado y quién validó'
);

select * from finish();
rollback;

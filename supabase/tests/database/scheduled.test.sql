-- OPR-29 · Scheduled (spec docs/spec/opr-29-scheduled.md §10 y §11.1). Pruebas
-- funcionales de la migración 20261206120000_scheduled.sql: relink_observed_job,
-- los dos tipos de Audit nuevos y la cancelación observada.
--
-- Las llamadas van como opsrun_app, el rol del servidor, con el actor de la
-- transacción fijado como lo fija el pool (opsrun.auth_user_id u
-- opsrun.system_actor). Los datos de prueba los pone el dueño de los esquemas;
-- el rollback lo deshace. No depende de la seed.
--
-- Que la función exija un operador lo prueban, además, G5, G6 y G7
-- (guard_funciones.test.sql), G14 (candado con versión) y G18
-- (guard_job_enlazado.test.sql), que la descubren sola. Este archivo fija una
-- por una las reglas de §10.2.
begin;
create extension if not exists pgtap with schema extensions;

select plan(57);

grant opsrun_migrador to current_user with inherit true, set true;
-- Para llamar como opsrun_app con SET ROLE, como el pool. Sin herencia: lo
-- que prueba es lo que opsrun_app tiene, no lo que tiene quien corre el test.
grant opsrun_app to current_user with inherit false, set true;

-- ---------------------------------------------------------------------------
-- Fixture (datos inventados)
-- ---------------------------------------------------------------------------
insert into opsrun.operator (id, auth_user_id, email, display_name, team) values
  ('0a000000-0000-4000-8000-000000000291', 'aa000000-0000-4000-8000-000000000291', 'scheduled.uno@example.test', 'Operador Uno', 'operations');

create function pg_temp.rid(p_n int)
returns uuid
language sql
as $$ select ('b0000000-0000-4000-8000-0000000029' || lpad(p_n::text, 2, '0'))::uuid $$;

-- Una request open con el borrador lleno.
create function pg_temp.abierta(p_n int)
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
    pg_temp.rid(p_n), now(), '0a000000-0000-4000-8000-000000000291',
    'bx-cust-t29', 'bx-cont-t29', 'bx-prop-t29', 'bx-space-t29',
    '7C', 2, 'bx-svc-t29', date '2027-03-10', time '09:00', time '12:00',
    'Key at the desk.', null, 'bx-team-t29'
  );
  return pg_temp.rid(p_n);
end;
$$;

-- Una request programada con el job `bx-job-t29NN` / `J-T-29NN`, con sus tres confirmaciones.
create function pg_temp.programada(p_n int)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := pg_temp.abierta(p_n);
begin
  insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
  select v_id, k, 'operator', '{}', '0a000000-0000-4000-8000-000000000291'
  from unnest(enum_range(null::opsrun.confirmation_kind)) as k;
  update opsrun.request
     set status = 'scheduled', bzzzbx_job_id = 'bx-job-t29' || lpad(p_n::text, 2, '0'),
         job_number = 'J-T-29' || lpad(p_n::text, 2, '0'), scheduled_at = now()
   where id = v_id;
  return v_id;
end;
$$;

create function pg_temp.ver(p_req uuid)
returns bigint
language sql
as $$ select r.change_seq from opsrun.request as r where r.id = p_req $$;

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

-- relink_observed_job como opsrun_app. La versión por defecto es el change_seq actual.
create function pg_temp.relink(
  p_req uuid,
  p_job text,
  p_numero text,
  p_motivo text default 'Wrong job linked.',
  p_version bigint default null
)
returns void
language plpgsql
as $$
begin
  set local role opsrun_app;
  perform opsrun.relink_observed_job(p_req, coalesce(p_version, pg_temp.ver(p_req)), p_job, p_numero, p_motivo);
  reset role;
end;
$$;

create function pg_temp.estado_relink(p_req uuid, p_job text, p_numero text, p_motivo text default 'Wrong job linked.', p_version bigint default null)
returns text
language sql
as $$
  select pg_temp.estado(format('select opsrun.relink_observed_job(%L, %s, %L, %L, %L)',
    p_req, coalesce(p_version, pg_temp.ver(p_req)), p_job, p_numero, p_motivo))
$$;

create function pg_temp.eventos(p_req uuid)
returns text
language sql
as $$
  select coalesce(string_agg(e.event_type, ',' order by e.id), '')
  from opsrun.audit_event as e
  where e.request_id = p_req
$$;

create function pg_temp.instrucciones()
returns bigint
language sql
as $$ select count(*) from opsrun.instruction $$;

do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000291', null); end $$;

-- ---------------------------------------------------------------------------
-- 1. Catálogo, permisos y forma de la función
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select code, label, requires_reason, source::text, sort_order::int from opsrun.audit_event_type
      where code in ('job_relinked', 'job_cancel_observed') order by code $$,
  $$ values ('job_cancel_observed', 'Job cancelled', false, 'bzzzbx_observed', 215),
            ('job_relinked', 'Linked job changed', true, 'opsrun', 87) $$,
  'los dos tipos de Audit están en el catálogo, con su origen y su motivo');

select ok(has_function_privilege('opsrun_app', 'opsrun.relink_observed_job(uuid, bigint, text, text, text)', 'execute'),
  'opsrun_app ejecuta relink_observed_job');
select ok(not has_function_privilege('authenticated', 'opsrun.relink_observed_job(uuid, bigint, text, text, text)', 'execute')
      and not has_function_privilege('anon', 'opsrun.relink_observed_job(uuid, bigint, text, text, text)', 'execute'),
  'ni authenticated ni anon ejecutan relink_observed_job');
select ok(
  exists (
    select 1 from pg_catalog.pg_proc as p
    where p.oid = 'opsrun.relink_observed_job(uuid, bigint, text, text, text)'::regprocedure
      and p.prosecdef
      and p.proconfig @> array['search_path=""']
      and p.prosrc ~ 'opsrun_private\.require_operator\s*\('
      and p.prosrc ~ 'opsrun_private\.lock_scheduled_request\s*\('
  ),
  'relink_observed_job es security definer, fija search_path, valida al operador y toma el candado');
select ok(
  (select p.prosrc !~* 'opsrun\.instruction' from pg_catalog.pg_proc as p
    where p.oid = 'opsrun.relink_observed_job(uuid, bigint, text, text, text)'::regprocedure),
  'Fase A no manda instrucciones: relink_observed_job no escribe en opsrun.instruction');

-- ---------------------------------------------------------------------------
-- 2. Sin actor, con el de sistema o con los dos a la vez: 42501 y no escribe nada
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.programada(1); end $$;
create temp table antes as select pg_temp.ver(pg_temp.rid(1)) as version, (select count(*) from opsrun.audit_event) as auditorias;

do $$ begin perform pg_temp.actor(null, null); end $$;
select is(pg_temp.estado_relink(pg_temp.rid(1), 'bx-job-nuevo-01', 'J-N-01'), '42501', 'sin actor, relink_observed_job falla con 42501');
do $$ begin perform pg_temp.actor(null, 'observador'); end $$;
select is(pg_temp.estado_relink(pg_temp.rid(1), 'bx-job-nuevo-01', 'J-N-01'), '42501', 'con el actor de sistema, falla con 42501');
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000291', 'observador'); end $$;
select is(pg_temp.estado_relink(pg_temp.rid(1), 'bx-job-nuevo-01', 'J-N-01'), '42501', 'con operador y sistema a la vez, falla con 42501');
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-0000000000ff', null); end $$;
select is(pg_temp.estado_relink(pg_temp.rid(1), 'bx-job-nuevo-01', 'J-N-01'), '42501', 'con un operador que no existe, falla con 42501');
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000291', null); end $$;

select ok(
  (select r.bzzzbx_job_id = 'bx-job-t2901' and r.change_seq = (select version from antes) from opsrun.request as r where r.id = pg_temp.rid(1))
    and (select count(*) from opsrun.audit_event) = (select auditorias from antes),
  'sin actor de operador no cambió el job ni se escribió Audit');

-- ---------------------------------------------------------------------------
-- 3. Errores: cada uno sin escribir nada
-- ---------------------------------------------------------------------------
select is(pg_temp.estado_relink(pg_temp.rid(99), 'bx-job-nuevo-01', 'J-N-01', p_version => 1), 'OP006', 'una request que no existe falla con OP006');

do $$ begin perform pg_temp.abierta(2); end $$;
select is(pg_temp.estado_relink(pg_temp.rid(2), 'bx-job-nuevo-01', 'J-N-01'), 'OP019', 'una request open (sin job) falla con OP019');

select is(pg_temp.estado_relink(pg_temp.rid(1), 'bx-job-nuevo-01', 'J-N-01', p_version => pg_temp.ver(pg_temp.rid(1)) - 1), 'OP013',
  'una versión vieja falla con OP013');
select is((select r.bzzzbx_job_id from opsrun.request as r where r.id = pg_temp.rid(1)), 'bx-job-t2901', 'la versión vieja no cambió el job');

select is(pg_temp.estado_relink(pg_temp.rid(1), 'bx-job-nuevo-01', 'J-N-01', p_motivo => null), '22023', 'sin motivo falla con 22023');
select is(pg_temp.estado_relink(pg_temp.rid(1), 'bx-job-nuevo-01', 'J-N-01', p_motivo => '   '), '22023', 'con el motivo en blanco falla con 22023');
select is(pg_temp.estado_relink(pg_temp.rid(1), '  ', 'J-N-01'), '22023', 'sin job falla con 22023');
select is(pg_temp.estado_relink(pg_temp.rid(1), 'bx-job-nuevo-01', ''), '22023', 'sin job number falla con 22023');

select is(pg_temp.estado_relink(pg_temp.rid(1), 'bx-job-t2901', 'J-T-2901'), 'OP041', 'el mismo job falla con OP041');
select is(pg_temp.estado_relink(pg_temp.rid(1), 'bx-job-t2901', 'J-N-01'), 'OP041', 'el mismo crosswalk ID con otro número también falla con OP041');
select is(pg_temp.estado_relink(pg_temp.rid(1), 'bx-job-nuevo-01', 'J-T-2901'), 'OP041', 'el mismo job number con otro crosswalk ID también falla con OP041');

do $$ begin perform pg_temp.programada(3); end $$;
select is(pg_temp.estado_relink(pg_temp.rid(1), 'bx-job-t2903', 'J-N-02'), 'OP008', 'el job de otra request falla con OP008');
select is(pg_temp.estado_relink(pg_temp.rid(1), 'bx-job-nuevo-01', 'J-T-2903'), 'OP008', 'el job number de otra request falla con OP008');

-- Hechos del job en opsRUN: ninguno deja cambiar el job (OP040). Cada uno en su request.
do $$ begin perform pg_temp.programada(4); end $$;
do $$ begin perform pg_temp.programada(5); end $$;
do $$ begin perform pg_temp.programada(6); end $$;
do $$ begin perform pg_temp.programada(7); end $$;
do $$ begin perform pg_temp.programada(8); end $$;
update opsrun.request set approved_at = now(), approved_by = '0a000000-0000-4000-8000-000000000291' where id = pg_temp.rid(4);
update opsrun.request set ended_manually_at = now(), ended_manually_by = '0a000000-0000-4000-8000-000000000291' where id = pg_temp.rid(5);
update opsrun.request set oss_mark = 'oss', oss_marked_at = now(), oss_marked_by = '0a000000-0000-4000-8000-000000000291', oss_source = 'operator' where id = pg_temp.rid(6);
update opsrun.request set approved_at = now(), approved_by = '0a000000-0000-4000-8000-000000000291',
       entered_po_number = 'PO-1', entered_po_at = now(), entered_po_by = '0a000000-0000-4000-8000-000000000291' where id = pg_temp.rid(7);
update opsrun.request set approved_at = now(), approved_by = '0a000000-0000-4000-8000-000000000291',
       validated_at = now(), validated_by = '0a000000-0000-4000-8000-000000000291' where id = pg_temp.rid(8);
select is(pg_temp.estado_relink(pg_temp.rid(4), 'bx-job-nuevo-04', 'J-N-04'), 'OP040', 'con approved_at falla con OP040');
select is(pg_temp.estado_relink(pg_temp.rid(5), 'bx-job-nuevo-05', 'J-N-05'), 'OP040', 'con End manually falla con OP040');
select is(pg_temp.estado_relink(pg_temp.rid(6), 'bx-job-nuevo-06', 'J-N-06'), 'OP040', 'con la marca OSS falla con OP040');
select is(pg_temp.estado_relink(pg_temp.rid(7), 'bx-job-nuevo-07', 'J-N-07'), 'OP040', 'con el PO capturado falla con OP040');
select is(pg_temp.estado_relink(pg_temp.rid(8), 'bx-job-nuevo-08', 'J-N-08'), 'OP040', 'con la validación falla con OP040');
select is(
  (select count(*) from opsrun.request as r where r.id = any (array[pg_temp.rid(4), pg_temp.rid(5), pg_temp.rid(6), pg_temp.rid(7), pg_temp.rid(8)])
     and r.bzzzbx_job_id like 'bx-job-t29%'),
  5::bigint,
  'ningún OP040 cambió el job');

select is((select count(*) from opsrun.audit_event as e where e.event_type = 'job_relinked'), 0::bigint, 'ningún error dejó un job_relinked');

-- ---------------------------------------------------------------------------
-- 4. El caso bueno
-- ---------------------------------------------------------------------------
create temp table antes_bueno as
  select r.status::text as status, r.scheduled_at, r.service_date, r.window_start, r.window_end, r.bzzzbx_team_id, r.owner_operator_id,
         (select count(*) from opsrun.request_confirmation as c where c.request_id = r.id) as confirmaciones,
         (select count(*) from opsrun.request_confirmation as c where c.request_id = r.id and c.superseded_at is null) as vigentes,
         (select count(*) from opsrun.audit_event as e where e.request_id = r.id and e.event_type = 'request_scheduled') as enlaces
    from opsrun.request as r where r.id = pg_temp.rid(1);
create temp table cuenta_instrucciones as select pg_temp.instrucciones() as n;

do $$ begin perform pg_temp.relink(pg_temp.rid(1), 'bx-job-nuevo-01', 'J-N-01', '  Wrong job linked.  '); end $$;

select results_eq(
  $$ select bzzzbx_job_id, job_number from opsrun.request where id = pg_temp.rid(1) $$,
  $$ values ('bx-job-nuevo-01', 'J-N-01') $$,
  'cambian el crosswalk ID y el job number');
select results_eq(
  $$ select r.status::text, r.scheduled_at, r.service_date, r.window_start, r.window_end, r.bzzzbx_team_id, r.owner_operator_id from opsrun.request as r where r.id = pg_temp.rid(1) $$,
  $$ select status, scheduled_at, service_date, window_start, window_end, bzzzbx_team_id, owner_operator_id from antes_bueno $$,
  'el estado, scheduled_at, el borrador y el dueño no cambian');
select results_eq(
  $$ select count(*), count(*) filter (where c.superseded_at is null) from opsrun.request_confirmation as c where c.request_id = pg_temp.rid(1) $$,
  $$ select confirmaciones, vigentes from antes_bueno $$,
  'las confirmaciones siguen vigentes (son sobre el borrador, no sobre el job)');
select results_eq(
  $$ select event_type, actor_kind::text, actor_operator_id, reason, source::text,
            details ->> 'from_bzzzbx_job_id', details ->> 'from_job_number', details ->> 'to_bzzzbx_job_id', details ->> 'to_job_number'
       from opsrun.audit_event where request_id = pg_temp.rid(1) and event_type = 'job_relinked' $$,
  $$ values ('job_relinked', 'operator', '0a000000-0000-4000-8000-000000000291'::uuid, 'Wrong job linked.', 'opsrun',
             'bx-job-t2901', 'J-T-2901', 'bx-job-nuevo-01', 'J-N-01') $$,
  'queda un job_relinked del operador, con el motivo y los cuatro valores de details');
select is(
  (select count(*) from opsrun.audit_event as e where e.request_id = pg_temp.rid(1) and e.event_type = 'request_scheduled'),
  (select enlaces from antes_bueno),
  'el enlace original sigue en Audit: Audit no se edita');
select is(pg_temp.instrucciones(), (select n from cuenta_instrucciones), 'relink_observed_job no creó ninguna instrucción');
select is(
  (select count(*) from opsrun_writeback.v1_audit_event as v where v.event_type = 'job_relinked' and v.request_id = pg_temp.rid(1)),
  1::bigint,
  'v1_audit_event muestra el job_relinked');

-- El job anterior queda libre: se puede enlazar a otra request.
do $$ begin perform pg_temp.programada(9); end $$;
select is(pg_temp.estado_relink(pg_temp.rid(9), 'bx-job-t2901', 'J-T-2901'), 'ok', 'el job anterior queda libre para otra request');

-- Y la request puede volver a cambiar.
select is(pg_temp.estado_relink(pg_temp.rid(1), 'bx-job-nuevo-03', 'J-N-03', p_motivo => 'Replaced in PINCH.'), 'ok', 'el job enlazado se puede cambiar otra vez');
select results_eq(
  $$ select details ->> 'from_bzzzbx_job_id', details ->> 'to_bzzzbx_job_id' from opsrun.audit_event
      where request_id = pg_temp.rid(1) and event_type = 'job_relinked' order by id desc limit 1 $$,
  $$ values ('bx-job-nuevo-01', 'bx-job-nuevo-03') $$,
  'el segundo cambio parte del job que dejó el primero');

-- ---------------------------------------------------------------------------
-- 5. Todo o nada: un fallo después del update no deja ni el cambio ni su Audit
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.programada(10); end $$;
set local role opsrun_migrador;
create function opsrun_private.prueba_falla_el_audit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'fallo forzado' using errcode = 'P0001';
end;
$$;
create trigger prueba_falla_el_audit before insert on opsrun.audit_event
  for each row when (new.event_type = 'job_relinked')
  execute function opsrun_private.prueba_falla_el_audit();
reset role;

select is(pg_temp.estado_relink(pg_temp.rid(10), 'bx-job-nuevo-10', 'J-N-10'), 'P0001', 'el fallo forzado del Audit llega al llamador');
select is((select r.bzzzbx_job_id from opsrun.request as r where r.id = pg_temp.rid(10)), 'bx-job-t2910', 'el fallo no dejó el cambio de job');
select is((select count(*) from opsrun.audit_event as e where e.request_id = pg_temp.rid(10) and e.event_type = 'job_relinked'), 0::bigint,
  'el fallo no dejó el job_relinked');
drop trigger prueba_falla_el_audit on opsrun.audit_event;

-- ---------------------------------------------------------------------------
-- 6. El motivo de job_relinked lo exige también el trigger de Audit (G12)
-- ---------------------------------------------------------------------------
select throws_ok(
  format($q$ insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at)
             values (%L, 'job_relinked', 'operator', '0a000000-0000-4000-8000-000000000291', now()) $q$, pg_temp.rid(10)),
  'OP002', null, 'un job_relinked sin motivo lo rechaza el trigger de Audit');

-- ---------------------------------------------------------------------------
-- 7. La cancelación observada: record_observed_event con job_cancel_observed
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.programada(20); end $$;
do $$ begin perform pg_temp.actor(null, 'observador'); end $$;

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

create temp table antes_cancel as select pg_temp.ver(pg_temp.rid(20)) as version;
do $$ begin perform pg_temp.observar('bx-job-t2920', 'job_cancel_observed', 'bx-job-t2920:cancelled', now() - interval '2 minutes'); end $$;
select results_eq(
  $$ select event_type, actor_kind::text, actor_operator_id, source::text, bzzzbx_event_id, details::text, reason
       from opsrun.audit_event where bzzzbx_event_id = 'bx-job-t2920:cancelled' $$,
  $$ values ('job_cancel_observed', 'bzzzbx', null::uuid, 'bzzzbx_observed', 'bx-job-t2920:cancelled', '{}', null::text) $$,
  'la cancelación observada se escribe como hecho observado de BzzzBX, sin operador, motivo ni detalles');
select is(pg_temp.observar('bx-job-t2920', 'job_cancel_observed', 'bx-job-t2920:cancelled'), null::bigint,
  'la segunda vez con el mismo id no escribe');
select is((select count(*) from opsrun.audit_event as e where e.bzzzbx_event_id = 'bx-job-t2920:cancelled'), 1::bigint,
  'la cancelación repetida no duplicó la fila');
select is(pg_temp.ver(pg_temp.rid(20)), (select version from antes_cancel), 'la cancelación observada no toca la request ni su change_seq');
select is((select r.status::text from opsrun.request as r where r.id = pg_temp.rid(20)), 'scheduled',
  'la request sigue Scheduled aunque su job esté cancelado en PINCH');
select is(
  (select count(*) from opsrun_writeback.v1_audit_event as v where v.event_type = 'job_cancel_observed' and v.request_id = pg_temp.rid(20)),
  1::bigint,
  'v1_audit_event muestra la cancelación observada');
select is(pg_temp.instrucciones(), (select n from cuenta_instrucciones), 'la cancelación observada no creó ninguna instrucción');

-- Un operador no escribe un hecho observado.
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000291', null); end $$;
select is(pg_temp.estado($q$ select opsrun.record_observed_event('bx-job-t2920', 'job_cancel_observed', 'bx-job-t2920:otra', now()) $q$), '42501',
  'un operador no puede escribir la cancelación observada');

-- ---------------------------------------------------------------------------
-- 8. Sin texto automático: abrir y cerrar Delayed (OPS-010) no crea instrucciones (§5.4)
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.actor(null, 'registrador_alertas'); end $$;
create function pg_temp.upsert(p_alert text, p_req uuid, p_opened timestamptz, p_cleared timestamptz default null)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  set local role opsrun_app;
  v_id := opsrun.upsert_alert_occurrence(p_alert, p_req, 'OPS-010', '1', 'red'::opsrun.alert_level, 'Not started by 1:00 PM.', null, p_opened, p_cleared);
  reset role;
  return v_id;
end;
$$;
do $$ begin perform pg_temp.upsert('bx-alert-t29-01', pg_temp.rid(20), now() - interval '1 hour'); end $$;
select is(
  (select count(*) from opsrun.alert_occurrence as a where a.bzzzbx_alert_id = 'bx-alert-t29-01' and a.resolved_at is null),
  1::bigint,
  'OPS-010 se abre como ocurrencia');
do $$ begin perform pg_temp.upsert('bx-alert-t29-01', pg_temp.rid(20), now() - interval '1 hour', now()); end $$;
select results_eq(
  $$ select resolution::text from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-t29-01' $$,
  $$ values ('auto_cleared') $$,
  'OPS-010 se cierra sola con el check-in (auto_cleared)');
select is(pg_temp.instrucciones(), (select n from cuenta_instrucciones), 'abrir y cerrar Delayed no creó ninguna instrucción');
select is(
  (select count(*) from opsrun.audit_event as e where e.request_id = pg_temp.rid(20) and e.event_type in ('alert_opened', 'alert_resolved')),
  2::bigint,
  'abrir y cerrar Delayed dejó solo sus dos líneas de Audit');
select is(
  (select count(*) from opsrun.request_message as m where m.request_id = pg_temp.rid(20)),
  0::bigint,
  'abrir y cerrar Delayed no dejó ningún mensaje');

select * from finish();
rollback;

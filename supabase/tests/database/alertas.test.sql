-- OPR-34 · Alertas (spec docs/spec/opr-34-alerts.md §10.1). Pruebas funcionales de
-- opsrun.upsert_alert_occurrence, de los helpers y del trigger de la migración
-- 20261205120000_alertas.sql.
--
-- Las llamadas van como opsrun_app, el rol del servidor, con el actor de la
-- transacción fijado como lo fija el pool (opsrun.auth_user_id u
-- opsrun.system_actor). Los datos de prueba los pone el dueño de los esquemas;
-- el rollback lo deshace. No depende de la seed. Todo es inventado.
--
-- Que la función exija un actor de sistema lo prueban, además, G5, G6 y G7
-- (guard_funciones.test.sql), que la descubren sola por pg_proc, y el guard G17
-- (guard_alertas.test.sql) para el Audit y el trigger. Este archivo fija que sin
-- actor, con un operador o con los dos a la vez, falla sin escribir nada.
begin;
create extension if not exists pgtap with schema extensions;

select plan(78);

grant opsrun_migrador to current_user with inherit true, set true;
-- Para llamar como opsrun_app con SET ROLE, como el pool. Sin herencia: lo que
-- prueba es lo que opsrun_app tiene, no lo que tiene quien corre el test.
grant opsrun_app to current_user with inherit false, set true;

-- ---------------------------------------------------------------------------
-- Fixture (datos inventados)
-- ---------------------------------------------------------------------------
insert into opsrun.operator (id, auth_user_id, email, display_name, team) values
  ('0a000000-0000-4000-8000-000000000341', 'aa000000-0000-4000-8000-000000000341', 'alertas.uno@example.test', 'Operador Uno', 'operations'),
  ('0a000000-0000-4000-8000-000000000342', 'aa000000-0000-4000-8000-000000000342', 'alertas.dos@example.test', 'Operador Dos', 'operations');

create function pg_temp.rid(p_n int)
returns uuid
language sql
as $$ select ('b0000000-0000-4000-8000-0000000034' || lpad(p_n::text, 2, '0'))::uuid $$;

create function pg_temp.rq(p_n int)
returns uuid
language plpgsql
as $$
begin
  insert into opsrun.request (id, received_at) values (pg_temp.rid(p_n), now());
  return pg_temp.rid(p_n);
end;
$$;

-- El instante de referencia: abre a las 10:00 y cierra a las 11:00 de un día fijo.
create function pg_temp.t(p_minutos int)
returns timestamptz
language sql
as $$ select timestamptz '2026-03-01 10:00:00+00' + make_interval(mins => p_minutos) $$;

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

-- La llamada bajo prueba, como opsrun_app. Si falla, el SET LOCAL se deshace
-- con la subtransacción de throws_ok o de estado().
create function pg_temp.upsert(
  p_alert text, p_req uuid, p_rule text, p_level text, p_opened timestamptz, p_cleared timestamptz default null,
  p_reason text default 'Reason from BzzzBX.', p_mensaje text default null, p_version text default '1'
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  set local role opsrun_app;
  v_id := opsrun.upsert_alert_occurrence(p_alert, p_req, p_rule, p_version, p_level::opsrun.alert_level, p_reason, p_mensaje, p_opened, p_cleared);
  reset role;
  return v_id;
end;
$$;

-- El SQLSTATE de lo que pasa al correr una sentencia ('ok' si no falla).
create function pg_temp.estado(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

-- Un evento de Audit de un operador (o de otro actor) en una request, a una hora dada.
create function pg_temp.evento(
  p_req uuid, p_tipo text, p_operador uuid, p_hora timestamptz, p_instruccion uuid default null, p_actor text default 'operator'
)
returns void
language plpgsql
as $$
begin
  insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at, instruction_id)
  values (p_req, p_tipo, p_actor::opsrun.actor_kind, p_operador, p_hora, p_instruccion);
end;
$$;

-- Los tipos de Audit de las alertas de una request, en orden de registro.
create function pg_temp.alertas_de(p_req uuid)
returns text
language sql
as $$
  select coalesce(string_agg(event_type, ',' order by id), '')
  from opsrun.audit_event
  where request_id = p_req and event_type like 'alert\_%'
$$;

create function pg_temp.ocurrencia(p_alert text)
returns opsrun.alert_occurrence
language sql
as $$ select a from opsrun.alert_occurrence as a where a.bzzzbx_alert_id = p_alert $$;

create function pg_temp.auditorias()
returns bigint
language sql
as $$ select count(*) from opsrun.audit_event $$;

create function pg_temp.ocurrencias()
returns bigint
language sql
as $$ select count(*) from opsrun.alert_occurrence $$;

-- La resolución como la ve el write-back (la vista v1_alert_occurrence).
create function pg_temp.resolucion_en_writeback(p_alert text)
returns text
language sql
as $$ select v.resolution::text from opsrun_writeback.v1_alert_occurrence as v where v.bzzzbx_alert_id = p_alert $$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
select ok(has_function_privilege('opsrun_app', 'opsrun.upsert_alert_occurrence(text, uuid, text, text, opsrun.alert_level, text, text, timestamptz, timestamptz)', 'execute'),
  'opsrun_app ejecuta upsert_alert_occurrence');
select ok(not has_function_privilege('authenticated', 'opsrun.upsert_alert_occurrence(text, uuid, text, text, opsrun.alert_level, text, text, timestamptz, timestamptz)', 'execute')
      and not has_function_privilege('anon', 'opsrun.upsert_alert_occurrence(text, uuid, text, text, opsrun.alert_level, text, text, timestamptz, timestamptz)', 'execute'),
  'ni authenticated ni anon ejecutan upsert_alert_occurrence');
select ok(not has_function_privilege('opsrun_app', 'opsrun_private.alert_fixing_events()', 'execute')
      and not has_function_privilege('opsrun_app', 'opsrun_private.alert_fix_for(uuid, text, timestamptz, timestamptz)', 'execute')
      and not has_function_privilege('opsrun_app', 'opsrun_private.alert_occurrence_resolved_frozen()', 'execute'),
  'opsrun_app no alcanza los helpers ni el trigger (G7)');
select ok(
  exists (
    select 1 from pg_catalog.pg_proc as p
    where p.oid = 'opsrun.upsert_alert_occurrence(text, uuid, text, text, opsrun.alert_level, text, text, timestamptz, timestamptz)'::regprocedure
      and p.prosecdef
      and p.proconfig @> array['search_path=""']
      and p.prosrc ~ 'opsrun_private\.require_system\s*\('
  ),
  'upsert_alert_occurrence es security definer, fija search_path y llama a require_system()');

-- ---------------------------------------------------------------------------
-- Sin actor de sistema no hay nada: sin actor, con operador y con los dos
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.rq(1); end $$;
create temp table antes as select pg_temp.ocurrencias() as ocurrencias, pg_temp.auditorias() as auditorias;

do $$ begin perform pg_temp.actor(null, null); end $$;
select throws_ok($$select pg_temp.upsert('bx-alert-t34-sa', pg_temp.rid(1), 'OPS-001', 'amber', pg_temp.t(0))$$, '42501', null,
  'sin actor, upsert_alert_occurrence falla');

do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000341', null); end $$;
select throws_ok($$select pg_temp.upsert('bx-alert-t34-op', pg_temp.rid(1), 'OPS-001', 'amber', pg_temp.t(0))$$, '42501', null,
  'con un operador, upsert_alert_occurrence falla');

do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000341', 'registrador_alertas'); end $$;
select throws_ok($$select pg_temp.upsert('bx-alert-t34-ambos', pg_temp.rid(1), 'OPS-001', 'amber', pg_temp.t(0))$$, '42501', null,
  'con operador y sistema a la vez, upsert_alert_occurrence falla');

select ok(
  pg_temp.ocurrencias() = (select ocurrencias from antes) and pg_temp.auditorias() = (select auditorias from antes),
  'las tres llamadas sin actor de sistema no escribieron nada');

do $$ begin perform pg_temp.actor(null, 'registrador_alertas'); end $$;

-- ---------------------------------------------------------------------------
-- Alta: inserta la ocurrencia y un alert_opened con la hora de BzzzBX
-- ---------------------------------------------------------------------------
select isnt(pg_temp.upsert('bx-alert-t34-01', pg_temp.rid(1), 'OPS-001', 'amber', pg_temp.t(0), null, 'Unassigned for 15 min.'), null::uuid,
  'una alerta nueva devuelve el id de su ocurrencia');
select results_eq(
  $$ select request_id, rule_id, rule_version, level::text, reason_text, bzzzbx_message_id, opened_at, resolved_at, resolution::text,
            first_seen_at >= now() - interval '1 minute' as vista_ahora
       from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-t34-01' $$,
  $$ values (pg_temp.rid(1), 'OPS-001', '1', 'amber', 'Unassigned for 15 min.', null::text, pg_temp.t(0), null::timestamptz, null::text, true) $$,
  'la ocurrencia guarda la instantánea de la apertura y first_seen_at es ahora');
select results_eq(
  $$ select event_type, actor_kind::text, actor_operator_id, occurred_at, details ->> 'bzzzbx_alert_id', details ->> 'rule_id', details ->> 'level',
            alert_occurrence_id = (select id from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-t34-01')
       from opsrun.audit_event where request_id = pg_temp.rid(1) and event_type like 'alert\_%' $$,
  $$ values ('alert_opened', 'bzzzbx', null::uuid, pg_temp.t(0), 'bx-alert-t34-01', 'OPS-001', 'amber', true) $$,
  'el alta deja un alert_opened de BzzzBX con occurred_at = la hora de apertura y su detalle');

-- La segunda llamada igual no escribe nada: ni Audit ni change_seq.
create temp table antes_igual as
select (pg_temp.ocurrencia('bx-alert-t34-01')).change_seq as seq, pg_temp.auditorias() as auditorias, pg_temp.ocurrencias() as ocurrencias;
select is(pg_temp.upsert('bx-alert-t34-01', pg_temp.rid(1), 'OPS-001', 'amber', pg_temp.t(0), null, 'Unassigned for 15 min.'),
  (pg_temp.ocurrencia('bx-alert-t34-01')).id,
  'la segunda llamada igual devuelve la misma ocurrencia');
select ok(
  (pg_temp.ocurrencia('bx-alert-t34-01')).change_seq = (select seq from antes_igual)
    and pg_temp.auditorias() = (select auditorias from antes_igual)
    and pg_temp.ocurrencias() = (select ocurrencias from antes_igual),
  'la segunda llamada igual no escribe nada (change_seq y Audit iguales)');
select is(
  (select count(*) from (select pg_temp.upsert('bx-alert-t34-01', pg_temp.rid(1), 'OPS-001', 'amber', pg_temp.t(0), null, 'Texto distinto.', null, '2')) as x)::int,
  1, 'llamarla con otro texto y otra versión de la regla tampoco falla');
select results_eq(
  $$ select reason_text, rule_version, opened_at from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-t34-01' $$,
  $$ values ('Unassigned for 15 min.', '1', pg_temp.t(0)) $$,
  'el texto, la versión y la hora de apertura son la instantánea y no cambian (S-11)');

-- Con la regla y la request que no cambian, se guarda el id del mensaje de una alerta de mensaje.
select isnt(pg_temp.upsert('bx-alert-t34-msg', pg_temp.rid(1), 'MSG-001', 'red', pg_temp.t(5), null, 'Message not delivered.', 'bx-msg-t34-01'), null::uuid,
  'una alerta de mensaje se registra');
select is((pg_temp.ocurrencia('bx-alert-t34-msg')).bzzzbx_message_id, 'bx-msg-t34-01', 'guarda el crosswalk ID del mensaje');

-- ---------------------------------------------------------------------------
-- Nivel: ámbar a rojo deja alert_level_changed con from y to
-- ---------------------------------------------------------------------------
select is(pg_temp.alertas_de(pg_temp.rid(1)), 'alert_opened,alert_opened', 'hasta aquí, dos alertas abiertas en R1');
select lives_ok($$select pg_temp.upsert('bx-alert-t34-01', pg_temp.rid(1), 'OPS-001', 'red', pg_temp.t(0), null, 'Unassigned for 15 min.')$$,
  'una llamada con otro nivel no falla');
select is((pg_temp.ocurrencia('bx-alert-t34-01')).level::text, 'red', 'el nivel de la ocurrencia abierta se actualiza');
select results_eq(
  $$ select actor_kind::text, details ->> 'from', details ->> 'to' from opsrun.audit_event
      where request_id = pg_temp.rid(1) and event_type = 'alert_level_changed' $$,
  $$ values ('bzzzbx', 'amber', 'red') $$,
  'queda un alert_level_changed con from y to');
select lives_ok($$select pg_temp.upsert('bx-alert-t34-01', pg_temp.rid(1), 'OPS-001', 'red', pg_temp.t(0))$$, 'repetir el nivel no falla');
select is((select count(*) from opsrun.audit_event where request_id = pg_temp.rid(1) and event_type = 'alert_level_changed')::int, 1,
  'repetir el mismo nivel no deja otro alert_level_changed');

-- ---------------------------------------------------------------------------
-- Resolución: llega ya cerrada, y la abierta que después se cierra
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.rq(10); end $$;
select isnt(pg_temp.upsert('bx-alert-t34-10', pg_temp.rid(10), 'OPS-010', 'red', pg_temp.t(0), pg_temp.t(60), 'Not started by 1:00 PM.'), null::uuid,
  'una alerta que llega ya cerrada se registra');
select results_eq(
  $$ select resolved_at, resolution::text, resolved_by, resolving_instruction_id from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-t34-10' $$,
  $$ values (pg_temp.t(60), 'auto_cleared', null::uuid, null::uuid) $$,
  'llega ya cerrada: queda resuelta, auto_cleared, con la hora de cierre de BzzzBX');
select is(pg_temp.alertas_de(pg_temp.rid(10)), 'alert_opened,alert_resolved', 'alert_opened y alert_resolved en la misma llamada');
select results_eq(
  $$ select actor_kind::text, actor_operator_id, occurred_at, details ->> 'resolution', details -> 'fixing_audit_event_id', details -> 'fixing_event_type'
       from opsrun.audit_event where request_id = pg_temp.rid(10) and event_type = 'alert_resolved' $$,
  $$ values ('bzzzbx', null::uuid, pg_temp.t(60), 'auto_cleared', 'null'::jsonb, 'null'::jsonb) $$,
  'auto_cleared: alert_resolved de BzzzBX con occurred_at = el cierre y sin evento que la arreglara');
select is(pg_temp.resolucion_en_writeback('bx-alert-t34-10'), 'auto_cleared', 'v1_alert_occurrence muestra la resolución');
select ok(has_column_privilege('bzzz_writeback_opsrun', 'opsrun_writeback.v1_alert_occurrence', 'resolution', 'select')
      and has_column_privilege('bzzz_writeback_opsrun', 'opsrun_writeback.v1_alert_occurrence', 'resolved_by', 'select'),
  'bzzz_writeback_opsrun lee la resolución en v1_alert_occurrence');

-- Cada caso de quién la arregló, en su request. La ventana va de t(0) a t(60).
do $$
begin
  perform pg_temp.rq(n) from generate_series(11, 19) as n;
  -- R11: un request_assigned de un operador dentro de la ventana.
  perform pg_temp.evento(pg_temp.rid(11), 'request_assigned', '0a000000-0000-4000-8000-000000000341', pg_temp.t(30));
  -- R12: el evento justo antes de abrir.
  perform pg_temp.evento(pg_temp.rid(12), 'request_assigned', '0a000000-0000-4000-8000-000000000341', pg_temp.t(-10));
  -- R13: el evento después de cerrar.
  perform pg_temp.evento(pg_temp.rid(13), 'request_assigned', '0a000000-0000-4000-8000-000000000341', pg_temp.t(120));
  -- R14: un evento de otro tipo.
  perform pg_temp.evento(pg_temp.rid(14), 'details_confirmed', '0a000000-0000-4000-8000-000000000341', pg_temp.t(30));
  -- R15: Delayed no tiene eventos que la arreglen.
  perform pg_temp.evento(pg_temp.rid(15), 'request_assigned', '0a000000-0000-4000-8000-000000000341', pg_temp.t(30));
  -- R16: dos eventos válidos; manda el último.
  perform pg_temp.evento(pg_temp.rid(16), 'request_assigned', '0a000000-0000-4000-8000-000000000341', pg_temp.t(10));
  perform pg_temp.evento(pg_temp.rid(16), 'request_reassigned', '0a000000-0000-4000-8000-000000000342', pg_temp.t(40));
  -- R17: el evento trae su instrucción.
  insert into opsrun.instruction (id, request_id, type, idempotency_key, payload, actor_kind, actor_operator_id, status, sent_at, resolved_at, attempts)
  values ('c0000000-0000-4000-8000-000000003417', pg_temp.rid(17), 'write_po', 'seed-t34-17', '{"po_number": "PO-T34"}', 'operator',
          '0a000000-0000-4000-8000-000000000341', 'confirmed', pg_temp.t(30), pg_temp.t(30), 1);
  perform pg_temp.evento(pg_temp.rid(17), 'po_entered', '0a000000-0000-4000-8000-000000000341', pg_temp.t(30), 'c0000000-0000-4000-8000-000000003417');
  -- R18: lo hizo el sistema, no un operador (el OSS automático).
  perform pg_temp.evento(pg_temp.rid(18), 'oss_marked', null, pg_temp.t(30), null, 'system');
  -- R19: en el borde de la ventana, a la hora de apertura y a la de cierre.
  perform pg_temp.evento(pg_temp.rid(19), 'oss_marked', '0a000000-0000-4000-8000-000000000341', pg_temp.t(0));
end;
$$;

-- R11: se abre y después se cierra (la abierta que se cierra).
select lives_ok($$select pg_temp.upsert('bx-alert-t34-11', pg_temp.rid(11), 'OPS-001', 'amber', pg_temp.t(0))$$, 'R11: se abre');
select lives_ok($$select pg_temp.upsert('bx-alert-t34-11', pg_temp.rid(11), 'OPS-001', 'amber', pg_temp.t(0), pg_temp.t(60))$$, 'R11: se cierra');
select results_eq(
  $$ select resolution::text, resolved_by, resolved_at from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-t34-11' $$,
  $$ values ('fixed_by_action', '0a000000-0000-4000-8000-000000000341'::uuid, pg_temp.t(60)) $$,
  'con un request_assigned de un operador dentro de la ventana: fixed_by_action con ese operador');
select results_eq(
  $$ select actor_kind::text, actor_operator_id, occurred_at, details ->> 'resolution', details ->> 'fixing_event_type',
            (details ->> 'fixing_audit_event_id')::bigint = (select id from opsrun.audit_event where request_id = pg_temp.rid(11) and event_type = 'request_assigned')
       from opsrun.audit_event where request_id = pg_temp.rid(11) and event_type = 'alert_resolved' $$,
  $$ values ('operator', '0a000000-0000-4000-8000-000000000341'::uuid, pg_temp.t(60), 'fixed_by_action', 'request_assigned', true) $$,
  'alert_resolved lleva como actor al operador que la arregló (P-11) y el evento que la arregló');
select is(pg_temp.alertas_de(pg_temp.rid(11)), 'alert_opened,alert_resolved', 'R11: un alert_opened y un alert_resolved');

select lives_ok($$select pg_temp.upsert('bx-alert-t34-12', pg_temp.rid(12), 'OPS-001', 'amber', pg_temp.t(0), pg_temp.t(60))$$, 'R12: llega cerrada');
select is((pg_temp.ocurrencia('bx-alert-t34-12')).resolution::text, 'auto_cleared', 'el evento antes de opened_at no cuenta: auto_cleared');
select lives_ok($$select pg_temp.upsert('bx-alert-t34-13', pg_temp.rid(13), 'OPS-001', 'amber', pg_temp.t(0), pg_temp.t(60))$$, 'R13: llega cerrada');
select is((pg_temp.ocurrencia('bx-alert-t34-13')).resolution::text, 'auto_cleared', 'el evento después de cleared_at no cuenta: auto_cleared');
select lives_ok($$select pg_temp.upsert('bx-alert-t34-14', pg_temp.rid(14), 'OPS-001', 'amber', pg_temp.t(0), pg_temp.t(60))$$, 'R14: llega cerrada');
select is((pg_temp.ocurrencia('bx-alert-t34-14')).resolution::text, 'auto_cleared', 'un evento de otro tipo no la arregla: auto_cleared');
select lives_ok($$select pg_temp.upsert('bx-alert-t34-15', pg_temp.rid(15), 'OPS-010', 'red', pg_temp.t(0), pg_temp.t(60))$$, 'R15: llega cerrada');
select is((pg_temp.ocurrencia('bx-alert-t34-15')).resolution::text, 'auto_cleared', 'OPS-010 siempre es auto_cleared');
select lives_ok($$select pg_temp.upsert('bx-alert-t34-16', pg_temp.rid(16), 'OPS-001', 'amber', pg_temp.t(0), pg_temp.t(60))$$, 'R16: llega cerrada');
select results_eq(
  $$ select resolution::text, resolved_by from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-t34-16' $$,
  $$ values ('fixed_by_action', '0a000000-0000-4000-8000-000000000342'::uuid) $$,
  'con dos eventos válidos, manda el último');
select lives_ok($$select pg_temp.upsert('bx-alert-t34-17', pg_temp.rid(17), 'TRN-005', 'amber', pg_temp.t(0), pg_temp.t(60))$$, 'R17: llega cerrada');
select results_eq(
  $$ select resolution::text, resolving_instruction_id from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-t34-17' $$,
  $$ values ('fixed_by_action', 'c0000000-0000-4000-8000-000000003417'::uuid) $$,
  'con una instruction_id en el evento, resolving_instruction_id');
select is((select instruction_id from opsrun.audit_event where request_id = pg_temp.rid(17) and event_type = 'alert_resolved'),
  'c0000000-0000-4000-8000-000000003417'::uuid, 'alert_resolved apunta a la instrucción que la arregló');
select lives_ok($$select pg_temp.upsert('bx-alert-t34-18', pg_temp.rid(18), 'ORG-002', 'amber', pg_temp.t(0), pg_temp.t(60))$$, 'R18: llega cerrada');
select is((pg_temp.ocurrencia('bx-alert-t34-18')).resolution::text, 'auto_cleared', 'un evento del sistema (el OSS automático) no cuenta como acción de un operador');
select lives_ok($$select pg_temp.upsert('bx-alert-t34-19', pg_temp.rid(19), 'ORG-003', 'amber', pg_temp.t(0), pg_temp.t(60))$$, 'R19: llega cerrada');
select is((pg_temp.ocurrencia('bx-alert-t34-19')).resolution::text, 'fixed_by_action', 'un evento a la hora exacta de apertura cuenta (los extremos son inclusivos)');

-- Cada tipo de evento de alert_fixing_events() existe en el catálogo de Audit.
select is(
  (select count(*) from opsrun_private.alert_fixing_events() as f
    where not exists (select 1 from opsrun.audit_event_type as t where t.code = f.event_type)),
  0::bigint,
  'todo event_type de alert_fixing_events() existe en audit_event_type');
select ok((select count(*) from opsrun_private.alert_fixing_events()) >= 8, 'alert_fixing_events() trae el reparto de §4.1');

-- ---------------------------------------------------------------------------
-- Lo resuelto por Clear alert no se toca
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.rq(20); end $$;
insert into opsrun.alert_occurrence (id, bzzzbx_alert_id, request_id, rule_id, rule_version, level, reason_text, opened_at,
                                     resolved_at, resolution, resolved_by, resolution_reason)
values ('a1000000-0000-4000-8000-000000003420', 'bx-alert-t34-20', pg_temp.rid(20), 'MEC-003', '1', 'amber', 'Running 45 min over the window.',
        pg_temp.t(0), pg_temp.t(30), 'cleared_by_operator', '0a000000-0000-4000-8000-000000000341', 'Large unit, called ahead.');
create temp table antes_clear as
select (pg_temp.ocurrencia('bx-alert-t34-20')).change_seq as seq, pg_temp.auditorias() as auditorias;
select is(pg_temp.upsert('bx-alert-t34-20', pg_temp.rid(20), 'MEC-003', 'red', pg_temp.t(0), pg_temp.t(60), 'Otro texto.'),
  'a1000000-0000-4000-8000-000000003420'::uuid, 'una ocurrencia que resolvió clear_alert devuelve su id');
select ok(
  (pg_temp.ocurrencia('bx-alert-t34-20')).change_seq = (select seq from antes_clear) and pg_temp.auditorias() = (select auditorias from antes_clear),
  'una ocurrencia resuelta por clear_alert no cambia con upsert_alert_occurrence: ni change_seq ni eventos');
select results_eq(
  $$ select level::text, resolution::text, resolved_at, resolution_reason from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-t34-20' $$,
  $$ values ('amber', 'cleared_by_operator', pg_temp.t(30), 'Large unit, called ahead.') $$,
  'ni el nivel ni la resolución cambian: cleared_by_operator es solo de clear_alert (§4.1)');

-- ---------------------------------------------------------------------------
-- Errores: OP035, OP006 y 22023, sin escribir nada
-- ---------------------------------------------------------------------------
create temp table antes_errores as select pg_temp.ocurrencias() as ocurrencias, pg_temp.auditorias() as auditorias;
select is(pg_temp.estado($$select pg_temp.upsert('bx-alert-t34-01', pg_temp.rid(2), 'OPS-001', 'amber', pg_temp.t(0))$$), 'OP006',
  'con una request que no existe, OP006');
do $$ begin perform pg_temp.rq(2); end $$;
select is(pg_temp.estado($$select pg_temp.upsert('bx-alert-t34-01', pg_temp.rid(2), 'OPS-001', 'amber', pg_temp.t(0))$$), 'OP035',
  'la misma alerta con otra request: OP035');
select is(pg_temp.estado($$select pg_temp.upsert('bx-alert-t34-01', pg_temp.rid(1), 'OPS-002', 'amber', pg_temp.t(0))$$), 'OP035',
  'la misma alerta con otra regla: OP035');
select is(pg_temp.estado($$select pg_temp.upsert('bx-alert-t34-11', pg_temp.rid(2), 'OPS-001', 'amber', pg_temp.t(0))$$), 'OP035',
  'OP035 también con la ocurrencia ya resuelta');
select is(pg_temp.estado($$select pg_temp.upsert('bx-alert-t34-22', pg_temp.rid(2), 'OPS-001', 'amber', pg_temp.t(60), pg_temp.t(0))$$), '22023',
  'cleared_at antes de opened_at: 22023');
select is(pg_temp.estado($$select pg_temp.upsert('', pg_temp.rid(2), 'OPS-001', 'amber', pg_temp.t(0))$$), '22023', 'sin id de alerta: 22023');
select is(pg_temp.estado($$select pg_temp.upsert('bx-alert-t34-23', pg_temp.rid(2), '  ', 'amber', pg_temp.t(0))$$), '22023', 'sin regla: 22023');
select is(pg_temp.estado($$select pg_temp.upsert('bx-alert-t34-24', pg_temp.rid(2), 'OPS-001', 'amber', pg_temp.t(0), null, '')$$), '22023', 'sin texto: 22023');
select is(pg_temp.estado($$select pg_temp.upsert('bx-alert-t34-25', pg_temp.rid(2), 'OPS-001', 'amber', null)$$), '22023', 'sin hora de apertura: 22023');
select is(pg_temp.estado($$select pg_temp.upsert('bx-alert-t34-26', pg_temp.rid(2), 'OPS-001', 'amber', pg_temp.t(0), null, 'Reason from BzzzBX.', null, '')$$), '22023', 'sin versión de la regla: 22023');
select is(pg_temp.estado($$select pg_temp.upsert('bx-alert-t34-27', null, 'OPS-001', 'amber', pg_temp.t(0))$$), '22023', 'sin request: 22023');
select ok(
  pg_temp.ocurrencias() = (select ocurrencias from antes_errores) and pg_temp.auditorias() = (select auditorias from antes_errores),
  'ningún error escribió nada');

-- ---------------------------------------------------------------------------
-- OP036: el trigger rechaza un update a una ocurrencia resuelta, también como el dueño
-- ---------------------------------------------------------------------------
select is(pg_temp.estado($$update opsrun.alert_occurrence set level = 'red' where bzzzbx_alert_id = 'bx-alert-t34-11'$$), 'OP036',
  'un update a una ocurrencia resuelta falla con OP036');
select is(pg_temp.estado($$update opsrun.alert_occurrence set resolved_at = null, resolution = null, resolved_by = null where bzzzbx_alert_id = 'bx-alert-t34-11'$$), 'OP036',
  'reabrir una ocurrencia resuelta falla con OP036');
select is(pg_temp.estado($$update opsrun.alert_occurrence set reason_text = reason_text where bzzzbx_alert_id = 'bx-alert-t34-20'$$), 'OP036',
  'ni siquiera un update que no cambia nada pasa en una resuelta (clear_alert incluida)');
select is(pg_temp.estado($$set local role opsrun_migrador; update opsrun.alert_occurrence set level = 'red' where bzzzbx_alert_id = 'bx-alert-t34-11'$$), 'OP036',
  'el dueño tampoco puede cambiar una ocurrencia resuelta');
select is(pg_temp.estado($$update opsrun.alert_occurrence set level = 'amber' where bzzzbx_alert_id = 'bx-alert-t34-msg'$$), 'ok',
  'una ocurrencia abierta sí se puede actualizar');
select is((pg_temp.ocurrencia('bx-alert-t34-11')).level::text, 'amber', 'los rechazos no cambiaron la ocurrencia');
select ok(
  exists (select 1 from pg_catalog.pg_trigger as g where g.tgrelid = 'opsrun.alert_occurrence'::regclass
             and g.tgname = 'alert_occurrence_resolved_frozen' and g.tgenabled = 'O' and g.tgname < 'touch_row'),
  'el trigger existe, está activo y corre antes de touch_row');

-- ---------------------------------------------------------------------------
-- Atomicidad: un fallo después del insert no deja ni la ocurrencia ni su Audit
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.rq(30); end $$;
set local role opsrun_migrador;
create function opsrun.guard_prueba_falla_al_resolver()
returns trigger
language plpgsql
as $$
begin
  if new.event_type = 'alert_resolved' and new.request_id = 'b0000000-0000-4000-8000-000000003430' then
    raise exception 'fallo forzado después del insert' using errcode = 'XX999';
  end if;
  return new;
end;
$$;
create trigger guard_prueba_falla_al_resolver before insert on opsrun.audit_event
  for each row execute function opsrun.guard_prueba_falla_al_resolver();
reset role;

select is(pg_temp.estado($$select pg_temp.upsert('bx-alert-t34-30', pg_temp.rid(30), 'OPS-010', 'red', pg_temp.t(0), pg_temp.t(60))$$), 'XX999',
  'un fallo forzado en el último paso (el alert_resolved) falla la llamada');
select is((select count(*) from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-t34-30')::int, 0,
  'el fallo no dejó la ocurrencia');
select is(pg_temp.alertas_de(pg_temp.rid(30)), '', 'ni su alert_opened: no queda ninguno de los dos');

select * from finish();
rollback;

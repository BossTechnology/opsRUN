-- OPR-28 · Requests: Assign / Reassign y Confirm details, sender y cleaner
-- (spec docs/spec/opr-28-assign-confirm.md §5, §8 y §9.1). Pruebas funcionales
-- de las cuatro funciones de la migración 20261201120000_requests_assign_confirm.sql
-- y del trigger request_confirmation_supersede.
--
-- Las llamadas van como opsrun_app, el rol del servidor, con el actor de la
-- transacción fijado como lo fija el pool (opsrun.auth_user_id u
-- opsrun.system_actor). Los datos de prueba los pone el dueño de los esquemas;
-- el rollback lo deshace. No depende de la seed.
--
-- Que cada función exija un operador lo prueban, además, G5 y G6
-- (guard_funciones.test.sql), que las descubren solas por pg_proc. Este
-- archivo fija una por una que sin actor, con el de sistema o con los dos a la
-- vez, fallan sin escribir nada.
begin;
create extension if not exists pgtap with schema extensions;

select plan(107);

grant opsrun_migrador to current_user with inherit true, set true;
-- Para llamar como opsrun_app con SET ROLE, como el pool. Sin herencia: lo
-- que prueba es lo que opsrun_app tiene, no lo que tiene quien corre el test.
grant opsrun_app to current_user with inherit false, set true;

-- ---------------------------------------------------------------------------
-- Fixture (datos inventados)
-- ---------------------------------------------------------------------------
insert into opsrun.operator (id, auth_user_id, email, display_name, team, active) values
  ('0a000000-0000-4000-8000-000000000051', 'aa000000-0000-4000-8000-000000000051', 'assign.uno@example.test', 'Operador Uno', 'operations', true),
  ('0a000000-0000-4000-8000-000000000052', 'aa000000-0000-4000-8000-000000000052', 'assign.dos@example.test', 'Operador Dos', 'operations', true),
  ('0a000000-0000-4000-8000-000000000053', 'aa000000-0000-4000-8000-000000000053', 'assign.tres@example.test', 'Operador Inactivo', 'finance', false);

-- Una request con todo el borrador lleno y sin dueño. El id termina en el número.
create function pg_temp.nueva(p_n int, p_owner uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := ('b0000000-0000-4000-8000-0000000005' || lpad(p_n::text, 2, '0'))::uuid;
begin
  insert into opsrun.request (
    id, received_at, owner_operator_id,
    bzzzbx_customer_id, bzzzbx_contact_id, bzzzbx_property_id, bzzzbx_space_id,
    unit, beds, bzzzbx_service_id, service_date, window_start, window_end,
    access_notes, po_number, bzzzbx_team_id
  ) values (
    v_id, now(), p_owner,
    'bx-cust-t51', 'bx-cont-t51', 'bx-prop-t51', 'bx-space-t51',
    '7C', 2, 'bx-svc-t51', date '2027-03-10', time '09:00', time '12:00',
    'Key at the desk.', 'PO-T-51', 'bx-team-t51'
  );
  return v_id;
end;
$$;

create function pg_temp.rid(p_n int)
returns uuid
language sql
as $$ select ('b0000000-0000-4000-8000-0000000005' || lpad(p_n::text, 2, '0'))::uuid $$;

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

-- Las cuatro llamadas bajo prueba corren como opsrun_app, el rol del servidor;
-- pgTAP sigue corriendo como quien corre el test. La versión por defecto es el
-- change_seq actual de la request. Si la llamada falla, el SET LOCAL se deshace
-- con la subtransacción de throws_ok.
create function pg_temp.asignar(p_req uuid, p_op uuid, p_motivo text default null, p_version bigint default null)
returns void
language plpgsql
as $$
declare
  v_version bigint := coalesce(p_version, (select r.change_seq from opsrun.request as r where r.id = p_req));
begin
  set local role opsrun_app;
  perform opsrun.assign_request(p_req, p_op, v_version, p_motivo);
  reset role;
end;
$$;

create function pg_temp.confirmar_detalles(p_req uuid, p_version bigint default null)
returns uuid
language plpgsql
as $$
declare
  v_version bigint := coalesce(p_version, (select r.change_seq from opsrun.request as r where r.id = p_req));
  v_id uuid;
begin
  set local role opsrun_app;
  v_id := opsrun.confirm_details(p_req, v_version);
  reset role;
  return v_id;
end;
$$;

create function pg_temp.confirmar_sender(p_req uuid, p_version bigint default null)
returns uuid
language plpgsql
as $$
declare
  v_version bigint := coalesce(p_version, (select r.change_seq from opsrun.request as r where r.id = p_req));
  v_id uuid;
begin
  set local role opsrun_app;
  v_id := opsrun.confirm_sender(p_req, v_version);
  reset role;
  return v_id;
end;
$$;

create function pg_temp.confirmar_cleaner(
  p_req uuid, p_metodo text, p_cc uuid default null, p_motivo text default null, p_version bigint default null
)
returns uuid
language plpgsql
as $$
declare
  v_version bigint := coalesce(p_version, (select r.change_seq from opsrun.request as r where r.id = p_req));
  v_id uuid;
begin
  set local role opsrun_app;
  v_id := opsrun.confirm_cleaner(p_req, p_metodo::opsrun.confirmation_method, v_version, p_cc, p_motivo);
  reset role;
  return v_id;
end;
$$;

-- Una pregunta al cleaner de la request.
create function pg_temp.pregunta(p_id text, p_req uuid, p_team text, p_status text, p_purpose text default 'initial')
returns uuid
language plpgsql
as $$
begin
  insert into opsrun.cleaner_confirmation (
    id, request_id, purpose, bzzzbx_team_id, status, reply_bzzzbx_message_id, actor_kind, actor_operator_id, reason
  ) values (
    p_id::uuid, p_req, p_purpose::opsrun.cleaner_confirmation_purpose, p_team, p_status::opsrun.cleaner_confirmation_status,
    case when p_status = 'replied' then 'bx-msg-t51-reply' end, 'operator', '0a000000-0000-4000-8000-000000000051',
    case when p_purpose = 'reschedule' then 'Moved by the owner' end
  );
  return p_id::uuid;
end;
$$;

create function pg_temp.eventos(p_req uuid, p_tipo text)
returns bigint
language sql
as $$ select count(*) from opsrun.audit_event where request_id = p_req and event_type = p_tipo $$;


-- Ids que devuelven las funciones, para comprobarlos después sin imprimir filas fuera de TAP.
create temp table ids (k text primary key, id uuid not null);
create function pg_temp.g(p_k text, p_id uuid)
returns void
language sql
as $$ insert into pg_temp.ids values (p_k, p_id) $$;
create function pg_temp.i(p_k text)
returns uuid
language sql
as $$ select id from pg_temp.ids where k = p_k $$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
select ok(has_function_privilege('opsrun_app', 'opsrun.assign_request(uuid, uuid, bigint, text)', 'execute')
      and not has_function_privilege('authenticated', 'opsrun.assign_request(uuid, uuid, bigint, text)', 'execute'),
  'solo opsrun_app ejecuta assign_request');
select ok(has_function_privilege('opsrun_app', 'opsrun.confirm_details(uuid, bigint)', 'execute')
      and not has_function_privilege('authenticated', 'opsrun.confirm_details(uuid, bigint)', 'execute'),
  'solo opsrun_app ejecuta confirm_details');
select ok(has_function_privilege('opsrun_app', 'opsrun.confirm_sender(uuid, bigint)', 'execute')
      and not has_function_privilege('authenticated', 'opsrun.confirm_sender(uuid, bigint)', 'execute'),
  'solo opsrun_app ejecuta confirm_sender');
select ok(has_function_privilege('opsrun_app', 'opsrun.confirm_cleaner(uuid, opsrun.confirmation_method, bigint, uuid, text)', 'execute')
      and not has_function_privilege('authenticated', 'opsrun.confirm_cleaner(uuid, opsrun.confirmation_method, bigint, uuid, text)', 'execute'),
  'solo opsrun_app ejecuta confirm_cleaner');

-- ---------------------------------------------------------------------------
-- Sin operador no hay nada: sin actor, con uno de sistema y con los dos
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.nueva(1); end $$;
do $$ begin perform pg_temp.pregunta('5c000000-0000-4000-8000-000000000501', pg_temp.rid(1), 'bx-team-t51', 'replied'); end $$;

do $$ begin perform pg_temp.actor(null, null); end $$;
select throws_ok($$select pg_temp.asignar(pg_temp.rid(1), '0a000000-0000-4000-8000-000000000051')$$, '42501', null, 'sin actor, assign_request falla');
select throws_ok($$select pg_temp.confirmar_detalles(pg_temp.rid(1))$$, '42501', null, 'sin actor, confirm_details falla');
select throws_ok($$select pg_temp.confirmar_sender(pg_temp.rid(1))$$, '42501', null, 'sin actor, confirm_sender falla');
select throws_ok($$select pg_temp.confirmar_cleaner(pg_temp.rid(1), 'phone')$$, '42501', null, 'sin actor, confirm_cleaner falla');

do $$ begin perform pg_temp.actor(null, 'intake'); end $$;
select throws_ok($$select pg_temp.asignar(pg_temp.rid(1), '0a000000-0000-4000-8000-000000000051')$$, '42501', null, 'con un actor de sistema, assign_request falla');
select throws_ok($$select pg_temp.confirmar_detalles(pg_temp.rid(1))$$, '42501', null, 'con un actor de sistema, confirm_details falla');
select throws_ok($$select pg_temp.confirmar_sender(pg_temp.rid(1))$$, '42501', null, 'con un actor de sistema, confirm_sender falla');
select throws_ok($$select pg_temp.confirmar_cleaner(pg_temp.rid(1), 'phone')$$, '42501', null, 'con un actor de sistema, confirm_cleaner falla');

do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000051', 'intake'); end $$;
select throws_ok($$select pg_temp.asignar(pg_temp.rid(1), '0a000000-0000-4000-8000-000000000051')$$, '42501', null, 'con operador y sistema a la vez, assign_request falla');
select throws_ok($$select pg_temp.confirmar_detalles(pg_temp.rid(1))$$, '42501', null, 'con operador y sistema a la vez, confirm_details falla');
select throws_ok($$select pg_temp.confirmar_sender(pg_temp.rid(1))$$, '42501', null, 'con operador y sistema a la vez, confirm_sender falla');
select throws_ok($$select pg_temp.confirmar_cleaner(pg_temp.rid(1), 'phone')$$, '42501', null, 'con operador y sistema a la vez, confirm_cleaner falla');

select is(
  (select count(*) from opsrun.audit_event where request_id = pg_temp.rid(1))
    + (select count(*) from opsrun.request_confirmation where request_id = pg_temp.rid(1))
    + (select count(*) from opsrun.request where id = pg_temp.rid(1) and owner_operator_id is not null)
    + (select count(*) from opsrun.cleaner_confirmation where request_id = pg_temp.rid(1) and status <> 'replied'),
  0::bigint,
  'los doce intentos sin operador no escribieron nada'
);

-- ---------------------------------------------------------------------------
-- assign_request
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.nueva(2); end $$;
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000051', null); end $$;

select throws_ok($$select pg_temp.asignar(pg_temp.rid(2), null)$$, '22023', null, 'quitar el dueño no existe: sin operador destino, 22023');
select throws_ok($$select pg_temp.asignar('b0000000-0000-4000-8000-0000000005ff', '0a000000-0000-4000-8000-000000000051', null, 1)$$,
  'OP006', null, 'una request que no existe, OP006');
select throws_ok($$select pg_temp.asignar(pg_temp.rid(2), '0a000000-0000-4000-8000-000000000053')$$, 'OP014', null, 'un operador inactivo no recibe la request, OP014');
select throws_ok($$select pg_temp.asignar(pg_temp.rid(2), '0a000000-0000-4000-8000-0000000005ee')$$, 'OP014', null, 'un operador que no existe no recibe la request, OP014');
select throws_ok($$select pg_temp.asignar(pg_temp.rid(2), '0a000000-0000-4000-8000-000000000051', null, -1)$$, 'OP013', null, 'con una versión vieja, OP013');

select lives_ok($$select pg_temp.asignar(pg_temp.rid(2), '0a000000-0000-4000-8000-000000000051')$$, 'asignar una request sin dueño');
select is((select owner_operator_id from opsrun.request where id = pg_temp.rid(2)), '0a000000-0000-4000-8000-000000000051'::uuid,
  'la request queda con su dueño');
select results_eq(
  $$select event_type, actor_kind::text, actor_operator_id, reason, details
      from opsrun.audit_event where request_id = pg_temp.rid(2)$$,
  $$values ('request_assigned', 'operator', '0a000000-0000-4000-8000-000000000051'::uuid, null::text,
            '{"to_operator_id": "0a000000-0000-4000-8000-000000000051"}'::jsonb)$$,
  'el primero escribe request_assigned con to_operator_id, con el operador que actuó'
);

select throws_ok($$select pg_temp.asignar(pg_temp.rid(2), '0a000000-0000-4000-8000-000000000051')$$, 'OP015', null, 'asignar al mismo dueño, OP015');

-- Con confirmaciones vigentes: reasignar no invalida ninguna.
do $$ begin perform pg_temp.confirmar_detalles(pg_temp.rid(2)); end $$;
select lives_ok($$select pg_temp.asignar(pg_temp.rid(2), '0a000000-0000-4000-8000-000000000052', '  Covering the weekend  ')$$,
  'reasignar una request con dueño');
select results_eq(
  $$select event_type, reason, details from opsrun.audit_event
     where request_id = pg_temp.rid(2) and event_type = 'request_reassigned'$$,
  $$values ('request_reassigned', 'Covering the weekend',
            '{"from_operator_id": "0a000000-0000-4000-8000-000000000051", "to_operator_id": "0a000000-0000-4000-8000-000000000052"}'::jsonb)$$,
  'el segundo escribe request_reassigned con from y to, y el motivo recortado'
);
select is((select count(*)::int from opsrun.request_confirmation where request_id = pg_temp.rid(2) and superseded_at is null), 1,
  'reasignar no invalida ninguna confirmación');
select is(pg_temp.eventos(pg_temp.rid(2), 'confirmation_superseded'), 0::bigint, 'reasignar no escribe confirmation_superseded');
select is(pg_temp.eventos(pg_temp.rid(2), 'request_assigned'), 1::bigint, 'el primero de la request es la única asignación');

-- Cambia change_seq (S-7): una versión de antes de la reasignación se rechaza.
select throws_ok($$select pg_temp.asignar(pg_temp.rid(2), '0a000000-0000-4000-8000-000000000051', null,
    (select r.change_seq - 1 from opsrun.request as r where r.id = pg_temp.rid(2)))$$,
  'OP013', null, 'asignar con la versión de antes de la reasignación, OP013');

-- Una request programada ya no se asigna.
do $$ begin perform pg_temp.nueva(3, '0a000000-0000-4000-8000-000000000051'); end $$;
insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
select pg_temp.rid(3), k, 'operator', '{}', '0a000000-0000-4000-8000-000000000051'
from unnest(enum_range(null::opsrun.confirmation_kind)) as k;
update opsrun.request set status = 'scheduled', bzzzbx_job_id = 'bx-job-t51', job_number = 'EX-T-51', scheduled_at = now()
 where id = pg_temp.rid(3);
select throws_ok($$select pg_temp.asignar(pg_temp.rid(3), '0a000000-0000-4000-8000-000000000052')$$, 'OP007', null,
  'una request scheduled no se reasigna, OP007');
select throws_ok($$select pg_temp.confirmar_detalles(pg_temp.rid(3))$$, 'OP007', null, 'una request scheduled no confirma details, OP007');
select throws_ok($$select pg_temp.confirmar_sender(pg_temp.rid(3))$$, 'OP007', null, 'una request scheduled no confirma sender, OP007');
select throws_ok($$select pg_temp.confirmar_cleaner(pg_temp.rid(3), 'phone')$$, 'OP007', null, 'una request scheduled no confirma cleaner, OP007');

-- ---------------------------------------------------------------------------
-- confirm_details y confirm_sender
-- ---------------------------------------------------------------------------
-- Sin los datos obligatorios: cada campo que falta por separado.
do $$ begin perform pg_temp.nueva(4); end $$;
update opsrun.request set bzzzbx_property_id = null where id = pg_temp.rid(4);
select throws_ok($$select pg_temp.confirmar_detalles(pg_temp.rid(4))$$, 'OP016', null, 'sin propiedad, confirm_details responde OP016');
update opsrun.request set bzzzbx_property_id = 'bx-prop-t51', bzzzbx_service_id = null where id = pg_temp.rid(4);
select throws_ok($$select pg_temp.confirmar_detalles(pg_temp.rid(4))$$, 'OP016', null, 'sin servicio, OP016');
update opsrun.request set bzzzbx_service_id = 'bx-svc-t51', service_date = null where id = pg_temp.rid(4);
select throws_ok($$select pg_temp.confirmar_detalles(pg_temp.rid(4))$$, 'OP016', null, 'sin fecha, OP016');
update opsrun.request set service_date = date '2027-03-10', window_start = null, window_end = null where id = pg_temp.rid(4);
select throws_ok($$select pg_temp.confirmar_detalles(pg_temp.rid(4))$$, 'OP016', null, 'sin ventana, OP016');
update opsrun.request set window_start = time '09:00', window_end = time '12:00',
       bzzzbx_space_id = null, unit = null, beds = null, access_notes = null, po_number = null
 where id = pg_temp.rid(4);
select lives_ok($$select pg_temp.confirmar_detalles(pg_temp.rid(4))$$,
  'espacio, unidad, camas, notas y PO son opcionales');
select is(
  (select confirmed_value from opsrun.request_confirmation where request_id = pg_temp.rid(4) and kind = 'details'),
  '{"unit": null, "beds": null, "po_number": null, "window_end": "12:00:00", "access_notes": null, "service_date": "2027-03-10",
    "window_start": "09:00:00", "bzzzbx_space_id": null, "bzzzbx_property_id": "bx-prop-t51", "bzzzbx_service_id": "bx-svc-t51"}'::jsonb,
  'confirmed_value incluye también las columnas nulas (un null confirmado es un dato)'
);

do $$ begin perform pg_temp.nueva(5); end $$;
update opsrun.request set bzzzbx_customer_id = null where id = pg_temp.rid(5);
select throws_ok($$select pg_temp.confirmar_sender(pg_temp.rid(5))$$, 'OP016', null, 'sin cliente, confirm_sender responde OP016');
update opsrun.request set bzzzbx_customer_id = 'bx-cust-t51', bzzzbx_contact_id = null where id = pg_temp.rid(5);
select lives_ok($$select pg_temp.confirmar_sender(pg_temp.rid(5))$$, 'el representante es opcional');
select is(
  (select confirmed_value from opsrun.request_confirmation where request_id = pg_temp.rid(5) and kind = 'sender'),
  '{"bzzzbx_customer_id": "bx-cust-t51", "bzzzbx_contact_id": null}'::jsonb,
  'confirmed_value del sender: cliente y representante, sin nombres'
);

-- El camino feliz y su Audit.
do $$ begin perform pg_temp.nueva(6, '0a000000-0000-4000-8000-000000000051'); end $$;
do $$ begin perform pg_temp.g('d', pg_temp.confirmar_detalles(pg_temp.rid(6))); end $$;
select is(
  (select count(*)::int from opsrun.request_confirmation
    where id = pg_temp.i('d') and request_id = pg_temp.rid(6) and kind = 'details' and method = 'operator'
      and superseded_at is null and actor_kind = 'operator'
      and actor_operator_id = '0a000000-0000-4000-8000-000000000051'
      and cleaner_confirmation_id is null),
  1,
  'confirm_details devuelve el id de una confirmación vigente del operador'
);
select is(
  (select confirmed_value from opsrun.request_confirmation where id = pg_temp.i('d')),
  '{"unit": "7C", "beds": 2, "po_number": "PO-T-51", "window_end": "12:00:00", "access_notes": "Key at the desk.", "service_date": "2027-03-10",
    "window_start": "09:00:00", "bzzzbx_space_id": "bx-space-t51", "bzzzbx_property_id": "bx-prop-t51", "bzzzbx_service_id": "bx-svc-t51"}'::jsonb,
  'confirmed_value de details: las columnas de draft_fields(details) con sus valores'
);
select results_eq(
  format($q$select event_type, actor_kind::text, actor_operator_id, reason, details
              from opsrun.audit_event where request_id = pg_temp.rid(6) and event_type = 'details_confirmed'$q$),
  format($q$values ('details_confirmed', 'operator', '0a000000-0000-4000-8000-000000000051'::uuid, null::text,
              '{"method": "operator", "confirmation_id": "%s"}'::jsonb)$q$, pg_temp.i('d')),
  'details_confirmed lleva method y confirmation_id'
);
select throws_ok($$select pg_temp.confirmar_detalles(pg_temp.rid(6))$$, 'OP017', null, 'confirmar details dos veces, OP017');
select is((select count(*)::int from opsrun.request_confirmation where request_id = pg_temp.rid(6)), 1, 'la segunda no dejó otra fila');
select is(pg_temp.eventos(pg_temp.rid(6), 'details_confirmed'), 1::bigint, 'ni otro evento');

do $$ begin perform pg_temp.g('s', pg_temp.confirmar_sender(pg_temp.rid(6))); end $$;
select is(
  (select count(*)::int from opsrun.audit_event
    where request_id = pg_temp.rid(6) and event_type = 'sender_confirmed'
      and details = format('{"method": "operator", "confirmation_id": "%s"}', pg_temp.i('s'))::jsonb),
  1,
  'sender_confirmed lleva method y confirmation_id'
);
select throws_ok($$select pg_temp.confirmar_sender(pg_temp.rid(6))$$, 'OP017', null, 'confirmar sender dos veces, OP017');

select throws_ok($$select pg_temp.confirmar_detalles(pg_temp.rid(6), -1)$$, 'OP013', null, 'confirmar con una versión vieja, OP013 (sobre una fila bloqueada)');
select throws_ok($$select pg_temp.confirmar_detalles('b0000000-0000-4000-8000-0000000005ff', 1)$$, 'OP006', null, 'confirmar una request que no existe, OP006');

-- Lo que confirman las funciones solo tiene columnas :draft.
select is_empty(
  $$
    select c.id, k
      from opsrun.request_confirmation as c
      cross join lateral jsonb_object_keys(c.confirmed_value) as k
     where c.confirmed_value <> '{}'
       and k not in (
         select a.attname
           from pg_catalog.pg_attribute as a
          where a.attrelid = 'opsrun.request'::regclass and a.attnum > 0 and not a.attisdropped
            and col_description(a.attrelid, a.attnum) ~ '^[a-z-]+:draft '
       )
  $$,
  'confirmed_value de toda confirmación solo tiene claves que son columnas :draft de opsrun.request'
);

-- ---------------------------------------------------------------------------
-- Sugerencias de IA al confirmar (§5.4)
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.nueva(7, '0a000000-0000-4000-8000-000000000051'); end $$;
insert into opsrun.ai_suggestion (id, request_id, field, rank, value, reason) values
  ('5a000000-0000-4000-8000-000000000571', pg_temp.rid(7), 'property', 1, '"bx-prop-t51"', 'Address matches.'),
  ('5a000000-0000-4000-8000-000000000572', pg_temp.rid(7), 'service', 1, '"bx-svc-otro"', 'Says deep clean.'),
  ('5a000000-0000-4000-8000-000000000573', pg_temp.rid(7), 'service', 2, '"bx-svc-t51"', 'Alternative.'),
  ('5a000000-0000-4000-8000-000000000574', pg_temp.rid(7), 'time_window', 1, '{"start": "09:00", "end": "12:00"}', 'Morning.'),
  ('5a000000-0000-4000-8000-000000000575', pg_temp.rid(7), 'beds', 1, '3', 'Three bedrooms.'),
  ('5a000000-0000-4000-8000-000000000576', pg_temp.rid(7), 'sender', 1,
   '{"bzzzbx_customer_id": "bx-cust-t51", "bzzzbx_contact_id": "bx-cont-t51"}', 'Known sender.'),
  ('5a000000-0000-4000-8000-000000000577', pg_temp.rid(7), 'cleaner_team', 1, '"bx-team-t51"', 'Default team.'),
  ('5a000000-0000-4000-8000-000000000578', pg_temp.rid(7), 'draft_customer_reply', 1, '{"body": "Hello"}', 'Reply.');
insert into opsrun.ai_suggestion (id, request_id, field, rank, value, reason, decision, decided_by, decided_at) values
  ('5a000000-0000-4000-8000-000000000579', pg_temp.rid(7), 'unit', 1, '"1A"', 'Already decided.', 'rejected',
   '0a000000-0000-4000-8000-000000000052', now() - interval '1 hour');

do $$ begin perform pg_temp.confirmar_detalles(pg_temp.rid(7)); end $$;

select results_eq(
  $$select field, rank::int, decision::text, final_value, decided_by
      from opsrun.ai_suggestion
     where request_id = pg_temp.rid(7) and field in ('property', 'service', 'time_window', 'beds')
     order by field, rank$$,
  $$values ('beds', 1, 'corrected', '2'::jsonb, '0a000000-0000-4000-8000-000000000051'::uuid),
           ('property', 1, 'accepted', null::jsonb, '0a000000-0000-4000-8000-000000000051'::uuid),
           ('service', 1, 'corrected', '"bx-svc-t51"'::jsonb, '0a000000-0000-4000-8000-000000000051'::uuid),
           ('service', 2, null, null::jsonb, null::uuid),
           ('time_window', 1, 'accepted', null::jsonb, '0a000000-0000-4000-8000-000000000051'::uuid)$$,
  'details cierra rank 1 de sus campos: igual al borrador, accepted; distinta, corrected con final_value; la alternativa queda abierta'
);
select is(
  (select count(*)::int from opsrun.ai_suggestion
    where request_id = pg_temp.rid(7) and field in ('sender', 'cleaner_team', 'draft_customer_reply') and decision is null),
  3,
  'confirmar details no cierra las sugerencias de sender, cleaner ni los borradores de mensaje'
);
select is(
  (select decision::text from opsrun.ai_suggestion where id = '5a000000-0000-4000-8000-000000000579'),
  'rejected',
  'una sugerencia ya decidida no se toca'
);
select results_eq(
  $$select event_type, count(*)::int from opsrun.audit_event
     where request_id = pg_temp.rid(7) and ai_suggestion_id is not null group by event_type order by event_type$$,
  $$values ('ai_suggestion_accepted', 2), ('ai_suggestion_corrected', 2)$$,
  'cada cierre deja su evento con ai_suggestion_id'
);
select is(
  (select count(*)::int from opsrun.audit_event as e
    join opsrun.ai_suggestion as s on s.id = e.ai_suggestion_id
   where e.request_id = pg_temp.rid(7) and e.actor_kind = 'operator'
     and e.actor_operator_id = '0a000000-0000-4000-8000-000000000051'
     and e.event_type = case s.decision when 'accepted' then 'ai_suggestion_accepted' else 'ai_suggestion_corrected' end),
  4,
  'cada evento de IA coincide con la decisión y lleva al operador'
);

do $$ begin perform pg_temp.confirmar_sender(pg_temp.rid(7)); end $$;
select is((select decision::text from opsrun.ai_suggestion where id = '5a000000-0000-4000-8000-000000000576'), 'accepted',
  'confirmar sender acepta la sugerencia sender igual al borrador');

do $$ begin perform pg_temp.confirmar_cleaner(pg_temp.rid(7), 'phone'); end $$;
select is((select decision::text from opsrun.ai_suggestion where id = '5a000000-0000-4000-8000-000000000577'), 'accepted',
  'confirmar cleaner por teléfono acepta la sugerencia cleaner_team');
select is((select decision::text from opsrun.ai_suggestion where id = '5a000000-0000-4000-8000-000000000578'), null::text,
  'un borrador de mensaje de la IA no es de ninguna confirmación');

-- ---------------------------------------------------------------------------
-- confirm_cleaner
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.nueva(8, '0a000000-0000-4000-8000-000000000051'); end $$;
select throws_ok($$select pg_temp.confirmar_cleaner(pg_temp.rid(8), 'operator')$$, '22023', null,
  'el método operator no se acepta para el cleaner, 22023');
select throws_ok($$select pg_temp.confirmar_cleaner(pg_temp.rid(8), 'cleaner_text')$$, '22023', null,
  'cleaner_text sin respuesta, 22023');
update opsrun.request set bzzzbx_team_id = null where id = pg_temp.rid(8);
select throws_ok($$select pg_temp.confirmar_cleaner(pg_temp.rid(8), 'phone')$$, 'OP016', null, 'sin equipo en el borrador, OP016');
update opsrun.request set bzzzbx_team_id = 'bx-team-t51' where id = pg_temp.rid(8);

-- Por teléfono, sin pregunta abierta.
select lives_ok($$select pg_temp.confirmar_cleaner(pg_temp.rid(8), 'phone', null, 'Called and confirmed')$$,
  'confirmar el cleaner por teléfono, sin pregunta abierta');
select results_eq(
  $$select method::text, cleaner_confirmation_id, confirmed_value, superseded_at is null
      from opsrun.request_confirmation where request_id = pg_temp.rid(8) and kind = 'cleaner'$$,
  $$values ('phone', null::uuid,
            '{"bzzzbx_team_id": "bx-team-t51", "service_date": "2027-03-10", "window_start": "09:00:00", "window_end": "12:00:00"}'::jsonb,
            true)$$,
  'la confirmación por teléfono guarda el equipo, la fecha y la ventana, sin teléfono ni texto'
);
select results_eq(
  $$select event_type, reason, cleaner_confirmation_id, details ->> 'method'
      from opsrun.audit_event where request_id = pg_temp.rid(8) and event_type = 'cleaner_confirmed'$$,
  $$values ('cleaner_confirmed', 'Called and confirmed', null::uuid, 'phone')$$,
  'cleaner_confirmed lleva method phone y el motivo opcional'
);
select throws_ok($$select pg_temp.confirmar_cleaner(pg_temp.rid(8), 'phone')$$, 'OP017', null, 'confirmar el cleaner dos veces, OP017');

-- Por teléfono con una pregunta abierta al mismo equipo y otra a otro equipo (P-9).
do $$ begin perform pg_temp.nueva(9, '0a000000-0000-4000-8000-000000000051'); end $$;
do $$ begin perform pg_temp.pregunta('5c000000-0000-4000-8000-000000000591', pg_temp.rid(9), 'bx-team-t51', 'asked'); end $$;
do $$ begin perform pg_temp.pregunta('5c000000-0000-4000-8000-000000000592', pg_temp.rid(9), 'bx-team-otro', 'replied'); end $$;
do $$ begin perform pg_temp.g('p', pg_temp.confirmar_cleaner(pg_temp.rid(9), 'phone')); end $$;
select results_eq(
  $$select id::text, status::text, decided_by is not null and decided_at is not null
      from opsrun.cleaner_confirmation where request_id = pg_temp.rid(9) order by id$$,
  $$values ('5c000000-0000-4000-8000-000000000591', 'confirmed', true),
           ('5c000000-0000-4000-8000-000000000592', 'withdrawn', true)$$,
  'por teléfono: la pregunta al mismo equipo queda confirmed y la de otro equipo, withdrawn'
);
select is(
  (select cleaner_confirmation_id from opsrun.request_confirmation where id = pg_temp.i('p')),
  '5c000000-0000-4000-8000-000000000591'::uuid,
  'la confirmación enlaza la pregunta que contestó el teléfono'
);
select is(
  (select cleaner_confirmation_id from opsrun.audit_event where request_id = pg_temp.rid(9) and event_type = 'cleaner_confirmed'),
  '5c000000-0000-4000-8000-000000000591'::uuid,
  'y el evento de Audit la lleva en su columna'
);

-- Aceptando la respuesta por texto (cleaner_text).
do $$ begin perform pg_temp.nueva(10, '0a000000-0000-4000-8000-000000000051'); end $$;
do $$ begin perform pg_temp.nueva(11, '0a000000-0000-4000-8000-000000000051'); end $$;
do $$ begin perform pg_temp.pregunta('5c000000-0000-4000-8000-0000000005a1', pg_temp.rid(10), 'bx-team-t51', 'replied'); end $$;
do $$ begin perform pg_temp.pregunta('5c000000-0000-4000-8000-0000000005a2', pg_temp.rid(10), 'bx-team-otro', 'replied'); end $$;
do $$ begin perform pg_temp.pregunta('5c000000-0000-4000-8000-0000000005a3', pg_temp.rid(10), 'bx-team-t51', 'asked'); end $$;
do $$ begin perform pg_temp.pregunta('5c000000-0000-4000-8000-0000000005a4', pg_temp.rid(11), 'bx-team-t51', 'replied'); end $$;
do $$ begin perform pg_temp.pregunta('5c000000-0000-4000-8000-0000000005a5', pg_temp.rid(10), 'bx-team-t51', 'replied', 'reschedule'); end $$;
insert into opsrun.ai_suggestion (id, request_id, cleaner_confirmation_id, field, rank, value, reason) values
  ('5a000000-0000-4000-8000-0000000005a1', pg_temp.rid(10), '5c000000-0000-4000-8000-0000000005a1', 'cleaner_reply', 1,
   '{"answer": "yes"}', 'The cleaner said yes.');

select throws_ok($$select pg_temp.confirmar_cleaner(pg_temp.rid(10), 'cleaner_text', '5c000000-0000-4000-8000-0000000005a2')$$,
  'OP018', null, 'cleaner_text con la respuesta de otro equipo, OP018');
select throws_ok($$select pg_temp.confirmar_cleaner(pg_temp.rid(10), 'cleaner_text', '5c000000-0000-4000-8000-0000000005a3')$$,
  'OP018', null, 'cleaner_text con una pregunta que sigue en asked, OP018');
select throws_ok($$select pg_temp.confirmar_cleaner(pg_temp.rid(10), 'cleaner_text', '5c000000-0000-4000-8000-0000000005a4')$$,
  'OP018', null, 'cleaner_text con la respuesta de otra request, OP018');
select throws_ok($$select pg_temp.confirmar_cleaner(pg_temp.rid(10), 'cleaner_text', '5c000000-0000-4000-8000-0000000005a5')$$,
  'OP018', null, 'cleaner_text con una respuesta de Reschedule, OP018');
select throws_ok($$select pg_temp.confirmar_cleaner(pg_temp.rid(10), 'cleaner_text', '5c000000-0000-4000-8000-0000000005ff')$$,
  'OP018', null, 'cleaner_text con una respuesta que no existe, OP018');
select is((select count(*)::int from opsrun.request_confirmation where request_id = pg_temp.rid(10)), 0,
  'ningún intento inválido dejó una confirmación');

do $$ begin perform pg_temp.g('t', pg_temp.confirmar_cleaner(pg_temp.rid(10), 'cleaner_text', '5c000000-0000-4000-8000-0000000005a1')); end $$;
select results_eq(
  $$select method::text, cleaner_confirmation_id from opsrun.request_confirmation where id = pg_temp.i('t')$$,
  $$values ('cleaner_text', '5c000000-0000-4000-8000-0000000005a1'::uuid)$$,
  'cleaner_text enlaza la respuesta en la confirmación'
);
select results_eq(
  $$select status::text, decided_by, decided_at is not null from opsrun.cleaner_confirmation
     where id = '5c000000-0000-4000-8000-0000000005a1'$$,
  $$values ('confirmed', '0a000000-0000-4000-8000-000000000051'::uuid, true)$$,
  'la respuesta pasa a confirmed con quién y cuándo'
);
select results_eq(
  $$select e.cleaner_confirmation_id, e.details ->> 'method', e.details ->> 'confirmation_id'
      from opsrun.audit_event as e where e.request_id = pg_temp.rid(10) and e.event_type = 'cleaner_confirmed'$$,
  format($q$values ('5c000000-0000-4000-8000-0000000005a1'::uuid, 'cleaner_text', %L)$q$, pg_temp.i('t')),
  'cleaner_confirmed lleva method cleaner_text, confirmation_id y cleaner_confirmation_id en su columna'
);
select is((select decision::text from opsrun.ai_suggestion where id = '5a000000-0000-4000-8000-0000000005a1'), 'accepted',
  'la lectura de la IA (cleaner_reply) se cierra accepted');
select is(
  (select status::text from opsrun.cleaner_confirmation where id = '5c000000-0000-4000-8000-0000000005a3'),
  'asked',
  'cleaner_text no toca las otras preguntas'
);

-- ---------------------------------------------------------------------------
-- Trigger request_confirmation_supersede
-- ---------------------------------------------------------------------------
create function pg_temp.todas(p_req uuid)
returns void
language plpgsql
as $$
begin
  perform pg_temp.confirmar_detalles(p_req);
  perform pg_temp.confirmar_sender(p_req);
  perform pg_temp.confirmar_cleaner(p_req, 'phone');
end;
$$;

create function pg_temp.vigentes(p_req uuid)
returns text
language sql
as $$
  select coalesce(string_agg(c.kind::text, ',' order by c.kind::text), '')
    from opsrun.request_confirmation as c where c.request_id = p_req and c.superseded_at is null
$$;

do $$ begin perform pg_temp.nueva(12, '0a000000-0000-4000-8000-000000000051'); end $$;
do $$ begin perform pg_temp.todas(pg_temp.rid(12)); end $$;
select is(pg_temp.vigentes(pg_temp.rid(12)), 'cleaner,details,sender', 'preparado: las tres confirmaciones vigentes');

-- Cambiar la fecha invalida details y cleaner, pero no sender.
update opsrun.request set service_date = date '2027-03-11' where id = pg_temp.rid(12);
select is(pg_temp.vigentes(pg_temp.rid(12)), 'sender', 'cambiar service_date invalida details y cleaner, no sender');
select results_eq(
  $$select e.details ->> 'kind', e.details -> 'fields', e.actor_kind::text, e.actor_operator_id,
           e.details ->> 'confirmation_id' = c.id::text
      from opsrun.audit_event as e
      join opsrun.request_confirmation as c on c.id = (e.details ->> 'confirmation_id')::uuid
     where e.request_id = pg_temp.rid(12) and e.event_type = 'confirmation_superseded'
     order by 1$$,
  $$values ('cleaner', '["service_date"]'::jsonb, 'operator', '0a000000-0000-4000-8000-000000000051'::uuid, true),
           ('details', '["service_date"]'::jsonb, 'operator', '0a000000-0000-4000-8000-000000000051'::uuid, true)$$,
  'un confirmation_superseded por tipo, con su lista de columnas y el operador de la transacción'
);
select is((select count(*)::int from opsrun.request_confirmation where request_id = pg_temp.rid(12)), 3,
  'las confirmaciones invalidadas se quedan en la tabla');
select ok((select bool_and(superseded_at is not null) from opsrun.request_confirmation
            where request_id = pg_temp.rid(12) and kind in ('details', 'cleaner')), 'con superseded_at puesto');

-- Después de invalidar, el gate no se cumple.
select throws_ok($$select opsrun.link_observed_job(pg_temp.rid(12), 'bx-job-t51-12', 'EX-T-5112')$$, 'OP005', null,
  'con una confirmación invalidada, link_observed_job responde OP005');

-- Reasignar, notas y mensajes no invalidan; cambiar solo el equipo invalida solo cleaner.
do $$ begin perform pg_temp.nueva(13, '0a000000-0000-4000-8000-000000000051'); end $$;
do $$ begin perform pg_temp.todas(pg_temp.rid(13)); end $$;
update opsrun.request set owner_operator_id = '0a000000-0000-4000-8000-000000000052' where id = pg_temp.rid(13);
select is(pg_temp.vigentes(pg_temp.rid(13)), 'cleaner,details,sender', 'cambiar el dueño no invalida nada');
update opsrun.request set bzzzbx_team_id = 'bx-team-otro' where id = pg_temp.rid(13);
select is(pg_temp.vigentes(pg_temp.rid(13)), 'details,sender', 'cambiar solo el equipo invalida solo cleaner');
update opsrun.request set unit = '8D' where id = pg_temp.rid(13);
select is(pg_temp.vigentes(pg_temp.rid(13)), 'sender', 'cambiar la unidad invalida details');
update opsrun.request set bzzzbx_contact_id = 'bx-cont-otro' where id = pg_temp.rid(13);
select is(pg_temp.vigentes(pg_temp.rid(13)), '', 'cambiar el representante invalida sender');
select results_eq(
  $$select details ->> 'kind', details -> 'fields' from opsrun.audit_event
     where request_id = pg_temp.rid(13) and event_type = 'confirmation_superseded' order by id$$,
  $$values ('cleaner', '["bzzzbx_team_id"]'::jsonb), ('details', '["unit"]'::jsonb), ('sender', '["bzzzbx_contact_id"]'::jsonb)$$,
  'cada evento lista solo las columnas que cambiaron'
);

-- Un cambio de propiedad invalida details y cleaner (otro trabajo), aunque la propiedad no viaje en el valor del cleaner.
do $$ begin perform pg_temp.nueva(14, '0a000000-0000-4000-8000-000000000051'); end $$;
do $$ begin perform pg_temp.todas(pg_temp.rid(14)); end $$;
update opsrun.request set bzzzbx_property_id = 'bx-prop-otro' where id = pg_temp.rid(14);
select is(pg_temp.vigentes(pg_temp.rid(14)), 'sender', 'cambiar la propiedad invalida details y cleaner');

-- Quien cambia el borrador puede ser el sistema (la intake, la IA)...
do $$ begin perform pg_temp.actor(null, 'intake'); end $$;
do $$ begin perform pg_temp.nueva(15, '0a000000-0000-4000-8000-000000000051'); end $$;
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000051', null); end $$;
do $$ begin perform pg_temp.confirmar_detalles(pg_temp.rid(15)); end $$;
do $$ begin perform pg_temp.actor(null, 'intake'); end $$;
update opsrun.request set access_notes = 'New notes' where id = pg_temp.rid(15);
select results_eq(
  $$select actor_kind::text, actor_operator_id, details ->> 'kind' from opsrun.audit_event
     where request_id = pg_temp.rid(15) and event_type = 'confirmation_superseded'$$,
  $$values ('system', null::uuid, 'details')$$,
  'si el cambio lo hace un proceso del sistema, el actor del evento es system'
);

-- ...pero sin actor no hay invalidación con un actor inventado: 42501.
do $$ begin perform pg_temp.nueva(16, '0a000000-0000-4000-8000-000000000051'); end $$;
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000051', null); end $$;
do $$ begin perform pg_temp.confirmar_sender(pg_temp.rid(16)); end $$;
do $$ begin perform pg_temp.actor(null, null); end $$;
select throws_ok($$update opsrun.request set bzzzbx_contact_id = 'bx-cont-otro' where id = pg_temp.rid(16)$$, '42501', null,
  'cambiar el borrador sin actor, con una confirmación que invalidar, 42501');
select is(pg_temp.vigentes(pg_temp.rid(16)), 'sender', 'y la confirmación sigue vigente (nada a medias)');
-- Solo lo lanza cuando hay algo que invalidar.
select lives_ok($$update opsrun.request set owner_operator_id = owner_operator_id where id = pg_temp.rid(16)$$,
  'un UPDATE que no toca esas columnas, sin actor, no hace nada');
select lives_ok($$update opsrun.request set unit = '9Z' where id = pg_temp.rid(16)$$,
  'cambiar una columna que no invalida esa confirmación, sin actor, no hace nada');
do $$ begin perform pg_temp.nueva(17); end $$;
select lives_ok($$update opsrun.request set unit = '9Z' where id = pg_temp.rid(17)$$,
  'sin confirmaciones vigentes, cambiar el borrador sin actor no hace nada');

-- ---------------------------------------------------------------------------
-- El flujo completo en SQL: request nueva -> asignar -> tres confirmaciones -> enlazar
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.nueva(18); end $$;
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000051', null); end $$;
do $$ begin perform pg_temp.asignar(pg_temp.rid(18), '0a000000-0000-4000-8000-000000000051'); end $$;
do $$ begin perform pg_temp.todas(pg_temp.rid(18)); end $$;
select lives_ok($$select opsrun.link_observed_job(pg_temp.rid(18), 'bx-job-t51-18', 'EX-T-5118')$$,
  'con dueño y las tres confirmaciones vigentes, link_observed_job la deja Scheduled');
select is((select status::text from opsrun.request where id = pg_temp.rid(18)), 'scheduled', 'la request queda scheduled');
select results_eq(
  $$select event_type from opsrun.audit_event where request_id = pg_temp.rid(18) order by id$$,
  $$values ('request_assigned'), ('details_confirmed'), ('sender_confirmed'), ('cleaner_confirmed'), ('request_scheduled')$$,
  'Audit cuenta la historia en orden'
);
select is((select count(*)::int from opsrun.instruction where request_id = pg_temp.rid(18)), 0,
  'ninguna de las cuatro acciones crea instrucciones: no sale nada a BzzzBX');

select * from finish();
rollback;

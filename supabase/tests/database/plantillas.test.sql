-- OPR-18 · Plantillas de mensajes y avisos (spec docs/spec/opr-18-plantillas.md §6 y §10.1).
-- Pruebas de la migración 20261209120000_plantillas.sql:
--   * las seis plantillas v1 existen como catálogo (la seed ya no las pone);
--   * guards que descubren: todo {{x}} es uno de los cuatro placeholders, y toda plantilla de texto
--     activa cabe en un SMS GSM-7 con 90 caracteres de valores. Se ven fallar en cada corrida;
--   * send_email y send_text con plantilla: OP055, OP056, el Audit con template_key y template_version,
--     y el payload de la instrucción idéntico al de un envío sin plantilla;
--   * ningún camino crea una instrucción a partir de una plantilla fuera de send_email y send_text.
--
-- Las llamadas van como opsrun_app con el actor de la transacción fijado como lo fija el pool.
-- Que las dos funciones exijan un operador lo prueban, además, G5 y G6 (guard_funciones.test.sql),
-- que las descubren por pg_proc. Aquí se fija una por una. Los datos de prueba los pone el dueño de
-- los esquemas; el rollback lo deshace.
begin;
create extension if not exists pgtap with schema extensions;

select plan(50);

grant opsrun_migrador to current_user with inherit true, set true;
grant opsrun_app to current_user with inherit false, set true;

-- ---------------------------------------------------------------------------
-- El catálogo, antes de que esta prueba meta nada propio
-- ---------------------------------------------------------------------------
select results_eq(
  $$select key, version, channel::text, active, subject is not null from opsrun.message_template order by key, version$$,
  $$values
    ('cancellation_cleaner'::text,   1, 'text',  true, false),
    ('cancellation_requester',       1, 'email', true, true),
    ('cleaner_confirmation_request', 1, 'text',  true, false),
    ('requester_done',               1, 'email', true, true),
    ('requester_scheduled',          1, 'email', true, true),
    ('reschedule_request',           1, 'text',  true, false)$$,
  'las seis plantillas v1 de la tarjeta existen, activas, con su canal y el asunto solo en las de correo'
);
select is(
  (select count(*)::int from (select key from opsrun.message_template where active group by key having count(*) > 1) as x),
  0,
  'una sola versión activa por clave'
);
select results_eq(
  $$select body from opsrun.message_template where key = 'cleaner_confirmation_request' and version = 1$$,
  $$values ('New job: {{property}} {{space}} on {{date}}, {{window}}. Can you confirm?'::text)$$,
  'el texto de la v1 es el neutro del spec (§4.1)'
);

-- ---------------------------------------------------------------------------
-- Guards que descubren (se ven fallar en cada corrida)
-- ---------------------------------------------------------------------------
-- Los placeholders: todo {{x}} de cualquier asunto o cuerpo es uno de los cuatro.
create function pg_temp.placeholders_desconocidos()
returns setof text
language sql
stable
as $$
  select format('%s v%s: {{%s}}', t.key, t.version, m[1])
  from opsrun.message_template as t
  cross join lateral regexp_matches(coalesce(t.subject, '') || ' ' || t.body, '\{\{([^}]*)\}\}', 'g') as m
  where m[1] not in ('property', 'space', 'date', 'window')
$$;

-- Un SMS: GSM-7 sin nada fuera del alfabeto, y la parte fija más 90 de valores (property 40, space 20,
-- date 12, window 18) no pasa de 160. Los caracteres de extensión valen dos.
create function pg_temp.sms_fuera_de_medida()
returns setof text
language sql
stable
as $$
  select format('%s v%s: %s', t.key, t.version,
                case when fija !~ '^[A-Za-z0-9 \n\r@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&''()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà{}\[\]~^\\|€]*$'
                     then 'fuera de GSM-7' else 'pasa de 160' end)
  from opsrun.message_template as t
  cross join lateral (select regexp_replace(t.body, '\{\{[a-z_]+\}\}', '', 'g') as fija) as f
  where t.active
    and t.channel = 'text'
    and (
      fija !~ '^[A-Za-z0-9 \n\r@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&''()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà{}\[\]~^\\|€]*$'
      or length(fija) + length(regexp_replace(fija, '[^{}\[\]~^\\|€]', '', 'g')) + 90 > 160
    )
$$;

-- Toda función que mezcla message_template con opsrun.instruction (ver las dos tablas en su cuerpo) y
-- no es send_email ni send_text: sería un camino para crear un envío a partir de una plantilla.
create function pg_temp.envios_desde_plantilla()
returns setof text
language sql
stable
as $$
  select n.nspname || '.' || p.proname
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where (n.nspname = 'opsrun' or n.nspname like 'opsrun\_%')
    and p.prosrc ~* 'message_template'
    and p.prosrc ~* 'opsrun\.instruction'
    and not (n.nspname = 'opsrun' and p.proname in ('send_email', 'send_text'))
$$;

select is_empty('select * from pg_temp.placeholders_desconocidos()',
  'los placeholders de todo asunto y cuerpo son property, space, date o window');
select is_empty('select * from pg_temp.sms_fuera_de_medida()',
  'toda plantilla de texto activa es GSM-7 y cabe en 160 con 90 caracteres de valores');
select results_eq(
  'select (p.proname::text collate "default") from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid = p.pronamespace '
    || $$where n.nspname = 'opsrun' and p.prosrc ~* 'message_template' and p.prosrc ~* 'opsrun\.instruction' order by 1$$,
  $$values ('send_email'::text), ('send_text')$$,
  'solo send_email y send_text combinan message_template con opsrun.instruction'
);
select is_empty('select * from pg_temp.envios_desde_plantilla()',
  'ningún camino crea una instrucción a partir de una plantilla fuera de send_email y send_text');

-- Se ven fallar: se rompe cada regla como el dueño, dentro de la transacción.
set local role opsrun_migrador;
insert into opsrun.message_template (key, version, channel, subject, body, active) values
  ('guard_placeholder', 1, 'email', 'Hola {{cleaner}}', 'Hello {{property}} and {{price}}.', true),
  ('guard_gsm', 1, 'text', null, 'Caf’é {{property}} — ñ', true),
  ('guard_larga', 1, 'text', null, repeat('x', 71) || ' {{property}}', true),
  ('guard_justa', 1, 'text', null, repeat('x', 66) || ' {{property}} {{space}} {{date}} {{window}}', true),
  ('guard_extension', 1, 'text', null, repeat('|', 36) || ' {{property}}', true);
create function opsrun.guard_prueba_envio_desde_plantilla(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into opsrun.instruction (request_id, type, idempotency_key, payload, actor_kind, status)
  select p_request, 'send_text', 'guard-' || t.key, jsonb_build_object('body', t.body), 'system', 'pending'
  from opsrun.message_template as t where t.active;
end;
$$;
reset role;

select results_eq(
  $$select * from pg_temp.placeholders_desconocidos() order by 1$$,
  $$values ('guard_placeholder v1: {{cleaner}}'::text), ('guard_placeholder v1: {{price}}')$$,
  'el guard de placeholders se ve fallar: marca {{cleaner}} y {{price}}'
);
select results_eq(
  $$select * from pg_temp.sms_fuera_de_medida() order by 1$$,
  $$values ('guard_extension v1: pasa de 160'::text), ('guard_gsm v1: fuera de GSM-7'), ('guard_larga v1: pasa de 160')$$,
  'el guard de SMS se ve fallar: marca el carácter fuera de GSM-7, la plantilla larga y la de caracteres de extensión; no la que cabe justo'
);
select ok(
  'opsrun.guard_prueba_envio_desde_plantilla' in (select * from pg_temp.envios_desde_plantilla()),
  'el guard de envíos desde plantilla se ve fallar: marca una función que mezcla message_template con opsrun.instruction'
);

-- Se quita lo del guard antes de seguir (las claves activas extra no deben mezclarse con el catálogo).
set local role opsrun_migrador;
delete from opsrun.message_template where key like 'guard\_%';
drop function opsrun.guard_prueba_envio_desde_plantilla(uuid);
reset role;
select is((select count(*)::int from opsrun.message_template), 6, 'el catálogo vuelve a ser de seis filas');

-- ---------------------------------------------------------------------------
-- Fixture (datos inventados)
-- ---------------------------------------------------------------------------
insert into opsrun.operator (id, auth_user_id, email, display_name, team) values
  ('0a000000-0000-4000-8000-000000000051', 'aa000000-0000-4000-8000-000000000051',
   'plantillas.uno@example.test', 'Operador Plantillas', 'operations');

insert into opsrun.request (id, received_at, owner_operator_id, bzzzbx_customer_id, bzzzbx_property_id) values
  ('b0000000-0000-4000-8000-000000000051', now(), '0a000000-0000-4000-8000-000000000051', 'bx-cust-t-01', 'bx-prop-t-01');
insert into opsrun.request_message (request_id, bzzzbx_message_id, bzzzbx_thread_id, channel, direction, is_original, actor_kind) values
  ('b0000000-0000-4000-8000-000000000051', 'bx-msg-t-0051', 'bx-thread-t-0051', 'email', 'inbound', true, 'system');

create function pg_temp.actor(p_auth text, p_system text)
returns void
language plpgsql
as $$
begin
  perform set_config('opsrun.auth_user_id', coalesce(p_auth, ''), true);
  perform set_config('opsrun.system_actor', coalesce(p_system, ''), true);
end;
$$;

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
-- Permisos y firmas
-- ---------------------------------------------------------------------------
select ok(to_regprocedure('opsrun.send_email(uuid, text, text, text, uuid)') is null
          and to_regprocedure('opsrun.send_text(uuid, text, text, text, uuid)') is null,
  'las firmas de cinco parámetros ya no existen: la migración las reemplazó');
select ok(has_function_privilege('opsrun_app', 'opsrun.send_email(uuid, text, text, text, uuid, text, integer)', 'execute'),
  'opsrun_app ejecuta send_email con plantilla');
select ok(has_function_privilege('opsrun_app', 'opsrun.send_text(uuid, text, text, text, uuid, text, integer)', 'execute'),
  'opsrun_app ejecuta send_text con plantilla');
select ok(not has_function_privilege('public', 'opsrun.send_email(uuid, text, text, text, uuid, text, integer)', 'execute')
          and not has_function_privilege('public', 'opsrun.send_text(uuid, text, text, text, uuid, text, integer)', 'execute')
          and not has_function_privilege('authenticated', 'opsrun.send_text(uuid, text, text, text, uuid, text, integer)', 'execute'),
  'PUBLIC y authenticated no ejecutan las funciones nuevas');
select is(
  (select count(*)::int
     from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'opsrun' and p.proname in ('send_email', 'send_text')
      and p.prosecdef
      and 'search_path=""' = any (p.proconfig)
      and p.proowner = 'opsrun_migrador'::regrole
      and p.prosrc ~ 'opsrun_private\.require_operator\s*\('),
  2,
  'send_email y send_text siguen security definer, con search_path vacío, del dueño y con require_operator() en su cuerpo'
);

-- ---------------------------------------------------------------------------
-- Sin actor y con un actor de sistema: error, con plantilla también
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.actor(null, null); end $$;
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_text('b0000000-0000-4000-8000-000000000051', 'bx-team-t-01', 'Hola', 'k-pl-sin-actor-1', null, 'cleaner_confirmation_request', 1)$q$)$$,
  '42501', null, 'sin actor, send_text con plantilla falla');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000051', 'bx-thread-t-0051', 'Hola', 'k-pl-sin-actor-2', null, 'requester_scheduled', 1)$q$)$$,
  '42501', null, 'sin actor, send_email con plantilla falla');
do $$ begin perform pg_temp.actor(null, 'reconciliador'); end $$;
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_text('b0000000-0000-4000-8000-000000000051', 'bx-team-t-01', 'Hola', 'k-pl-sistema-1', null, 'cleaner_confirmation_request', 1)$q$)$$,
  '42501', null, 'con un actor de sistema, send_text con plantilla falla (nada sale solo)');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000051', 'bx-thread-t-0051', 'Hola', 'k-pl-sistema-2', null, 'requester_scheduled', 1)$q$)$$,
  '42501', null, 'con un actor de sistema, send_email con plantilla falla (nada sale solo)');

-- ---------------------------------------------------------------------------
-- Con plantilla: lo que se rechaza no deja nada
-- ---------------------------------------------------------------------------
do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000051', null); end $$;

select throws_ok($$select pg_temp.como_app($q$select opsrun.send_text('b0000000-0000-4000-8000-000000000051', 'bx-team-t-01', 'Hola', 'k-pl-1', null, 'no_existe', 1)$q$)$$,
  'OP055', null, 'send_text: una clave que no existe es OP055');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_text('b0000000-0000-4000-8000-000000000051', 'bx-team-t-01', 'Hola', 'k-pl-2', null, 'cleaner_confirmation_request', 9)$q$)$$,
  'OP055', null, 'send_text: una versión que no existe es OP055');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_text('b0000000-0000-4000-8000-000000000051', 'bx-team-t-01', 'Hola', 'k-pl-3', null, 'requester_scheduled', 1)$q$)$$,
  'OP055', null, 'send_text: una plantilla de correo es OP055');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000051', 'bx-thread-t-0051', 'Hola', 'k-pl-4', null, 'cleaner_confirmation_request', 1)$q$)$$,
  'OP055', null, 'send_email: una plantilla de texto es OP055');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000051', 'bx-thread-t-0051', 'Hola', 'k-pl-5', null, 'no_existe', 1)$q$)$$,
  'OP055', null, 'send_email: una clave que no existe es OP055');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_text('b0000000-0000-4000-8000-000000000051', 'bx-team-t-01', 'Can we move it to {{date}}, 9 AM?', 'k-pl-6', null, 'cleaner_confirmation_request', 1)$q$)$$,
  'OP056', null, 'send_text: un cuerpo con {{date}} sin llenar es OP056');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000051', 'bx-thread-t-0051', E'Hola\n{{property}}', 'k-pl-7', null, 'requester_scheduled', 1)$q$)$$,
  'OP056', null, 'send_email: un cuerpo con {{property}} sin llenar es OP056');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_text('b0000000-0000-4000-8000-000000000051', 'bx-team-t-01', 'Hola', 'k-pl-8', null, 'cleaner_confirmation_request', null)$q$)$$,
  '22023', null, 'send_text: la clave sin la versión es un argumento inválido');
select throws_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000051', 'bx-thread-t-0051', 'Hola', 'k-pl-9', null, null, 1)$q$)$$,
  '22023', null, 'send_email: la versión sin la clave es un argumento inválido');
select is((select count(*)::int from opsrun.instruction where request_id = 'b0000000-0000-4000-8000-000000000051'), 0,
  'ningún intento rechazado creó una instrucción');
select is((select count(*)::int from opsrun.audit_event where request_id = 'b0000000-0000-4000-8000-000000000051'
                                                          and event_type in ('email_sent', 'text_sent')), 0,
  'ningún intento rechazado dejó Audit de envío');

-- Un {{…}} sin llenar solo bloquea con plantilla: sin ella, las funciones se comportan como siempre.
select lives_ok($$select pg_temp.como_app($q$select opsrun.send_text('b0000000-0000-4000-8000-000000000051', 'bx-team-t-01', 'Escribí {{esto}} a mano', 'k-sin-pl-1')$q$)$$,
  'sin plantilla, un cuerpo con llaves se envía igual que antes (OP056 es solo con plantilla)');

-- ---------------------------------------------------------------------------
-- Con plantilla: el caso bueno
-- ---------------------------------------------------------------------------
select lives_ok($$select pg_temp.como_app($q$select opsrun.send_text('b0000000-0000-4000-8000-000000000051', 'bx-team-t-01',
    'New job: Sample Court Unit 12 on Wed, Nov 25, 9:00 AM–12:00 PM. Can you confirm? Thanks.', 'k-pl-texto-1', null, 'cleaner_confirmation_request', 1)$q$)$$,
  'el operador guarda un texto con plantilla');
select lives_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000051', 'bx-thread-t-0051',
    'Your cleaning at Sample Court Unit 12 is scheduled for Wed, Nov 25, 9:00 AM–12:00 PM.', 'k-pl-correo-1', null, 'requester_scheduled', 1)$q$)$$,
  'el operador guarda un correo con plantilla');
select lives_ok($$select pg_temp.como_app($q$select opsrun.send_email('b0000000-0000-4000-8000-000000000051', 'bx-thread-t-0051',
    'Your cleaning at Sample Court Unit 12 is scheduled for Wed, Nov 25, 9:00 AM–12:00 PM.', 'k-sin-pl-2')$q$)$$,
  'y un correo con el mismo cuerpo, sin plantilla');
select results_eq(
  $$select type, status::text, actor_kind::text, actor_operator_id from opsrun.instruction
     where idempotency_key in ('k-pl-texto-1', 'k-pl-correo-1') order by type$$,
  $$values ('send_email', 'pending', 'operator', '0a000000-0000-4000-8000-000000000051'::uuid),
           ('send_text',  'pending', 'operator', '0a000000-0000-4000-8000-000000000051'::uuid)$$,
  'las instrucciones quedan pending y del operador'
);
select is(
  (select array_agg(k order by k) from opsrun.instruction, jsonb_object_keys(payload) as k where idempotency_key = 'k-pl-texto-1'),
  array['body', 'bzzzbx_team_id'],
  'el payload del texto con plantilla es solo el crosswalk ID del equipo y el cuerpo: la plantilla no viaja a BzzzBX'
);
select is(
  (select array_agg(k order by k) from opsrun.instruction, jsonb_object_keys(payload) as k where idempotency_key = 'k-pl-correo-1'),
  (select array_agg(k order by k) from opsrun.instruction, jsonb_object_keys(payload) as k where idempotency_key = 'k-sin-pl-2'),
  'el payload del correo con plantilla tiene las mismas llaves que el de uno sin plantilla'
);
select is(
  (select payload from opsrun.instruction where idempotency_key = 'k-pl-correo-1'),
  (select payload from opsrun.instruction where idempotency_key = 'k-sin-pl-2'),
  'y es idéntico: mismo hilo y mismo cuerpo'
);
select results_eq(
  $$select a.event_type, a.details ->> 'template_key', (a.details ->> 'template_version')::int, a.details ->> 'bzzzbx_team_id'
      from opsrun.audit_event as a join opsrun.instruction as i on i.id = a.instruction_id
     where i.idempotency_key = 'k-pl-texto-1'$$,
  $$values ('text_sent', 'cleaner_confirmation_request', 1, 'bx-team-t-01')$$,
  'el texto deja text_sent en Audit con template_key, template_version y el equipo'
);
select results_eq(
  $$select a.event_type, a.details ->> 'template_key', (a.details ->> 'template_version')::int, a.details ->> 'bzzzbx_thread_id'
      from opsrun.audit_event as a join opsrun.instruction as i on i.id = a.instruction_id
     where i.idempotency_key = 'k-pl-correo-1'$$,
  $$values ('email_sent', 'requester_scheduled', 1, 'bx-thread-t-0051')$$,
  'el correo deja email_sent en Audit con template_key, template_version y el hilo'
);
select is(
  (select a.details from opsrun.audit_event as a join opsrun.instruction as i on i.id = a.instruction_id where i.idempotency_key = 'k-sin-pl-2'),
  '{"bzzzbx_thread_id": "bx-thread-t-0051"}'::jsonb,
  'sin plantilla, el Audit es el de siempre: sin template_key ni template_version'
);
select lives_ok($$select pg_temp.como_app($q$select opsrun.send_text('b0000000-0000-4000-8000-000000000051', 'bx-team-t-01',
    'New job: Sample Court Unit 12 on Wed, Nov 25, 9:00 AM–12:00 PM. Can you confirm? Thanks.', 'k-pl-texto-1', null, 'cleaner_confirmation_request', 1)$q$)$$,
  'repetir la misma clave con plantilla no falla');
select is((select count(*)::int from opsrun.instruction where idempotency_key = 'k-pl-texto-1'), 1,
  'repetir la misma clave no duplica la instrucción');
select is((select count(*)::int from opsrun.audit_event as a join opsrun.instruction as i on i.id = a.instruction_id where i.idempotency_key = 'k-pl-texto-1'), 1,
  'repetir la misma clave no duplica el Audit');

-- ---------------------------------------------------------------------------
-- Una versión que ya no es la activa se acepta (S-10)
-- ---------------------------------------------------------------------------
set local role opsrun_migrador;
update opsrun.message_template set active = false where key = 'cleaner_confirmation_request' and version = 1;
insert into opsrun.message_template (key, version, channel, body, active)
values ('cleaner_confirmation_request', 2, 'text', 'New job at {{property}} on {{date}}. Confirm?', true);
reset role;
select lives_ok($$select pg_temp.como_app($q$select opsrun.send_text('b0000000-0000-4000-8000-000000000051', 'bx-team-t-01',
    'New job: Sample Court on Wed, Nov 25. Can you confirm?', 'k-pl-texto-2', null, 'cleaner_confirmation_request', 1)$q$)$$,
  'la v1, que ya no es la activa, se acepta: el operador pudo abrir el picker antes del cambio');
select lives_ok($$select pg_temp.como_app($q$select opsrun.send_text('b0000000-0000-4000-8000-000000000051', 'bx-team-t-01',
    'New job at Sample Court on Wed, Nov 25. Confirm?', 'k-pl-texto-3', null, 'cleaner_confirmation_request', 2)$q$)$$,
  'y la v2 también');
select is((select (details ->> 'template_version')::int from opsrun.audit_event as a join opsrun.instruction as i on i.id = a.instruction_id
            where i.idempotency_key = 'k-pl-texto-2'), 1,
  'el Audit apunta a la versión usada, no a la activa');

-- ---------------------------------------------------------------------------
-- Las funciones no dejan a opsrun_app tocar el catálogo
-- ---------------------------------------------------------------------------
select throws_ok($$select pg_temp.como_app($q$update opsrun.message_template set body = 'x' where key = 'requester_done'$q$)$$,
  '42501', null, 'opsrun_app no puede escribir message_template');
select throws_ok($$select pg_temp.como_app($q$insert into opsrun.message_template (key, version, channel, body, active) values ('mia', 1, 'text', 'hola', true)$q$)$$,
  '42501', null, 'ni insertar plantillas');

select * from finish();
rollback;

-- OPR-15 · Entrada de correo (spec docs/spec/opr-15-entrada-correo.md §9.1).
-- Pruebas funcionales de opsrun.ingest_request_email y de los dos índices de
-- request_message de la migración 20261204120000_entrada_correo.sql.
--
-- Las llamadas van como opsrun_app, el rol del servidor, con el actor de la
-- transacción fijado como lo fija el pool (opsrun.system_actor u
-- opsrun.auth_user_id). Los datos de prueba los pone el dueño de los esquemas;
-- el rollback lo deshace. No depende de la seed. Todo lo que parece de un
-- cliente es inventado.
--
-- Que la función exija un actor de sistema lo prueban, además, G5, G6 y G7
-- (guard_funciones.test.sql), que la descubren sola por pg_proc, y G15
-- (guard_escrituras.test.sql): este archivo fija que sin actor, con un
-- operador o con los dos a la vez, falla sin escribir nada.
begin;
create extension if not exists pgtap with schema extensions;

select plan(55);

grant opsrun_migrador to current_user with inherit true, set true;
-- Para llamar como opsrun_app con SET ROLE, como el pool. Sin herencia: lo que
-- prueba es lo que opsrun_app tiene, no lo que tiene quien corre el test.
grant opsrun_app to current_user with inherit false, set true;

-- ---------------------------------------------------------------------------
-- Ayudas
-- ---------------------------------------------------------------------------
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
-- con la subtransacción de throws_ok.
create function pg_temp.ingerir(p_mensaje text, p_hilo text, p_recibida timestamptz)
returns table (request_id uuid, outcome text)
language plpgsql
as $$
begin
  set local role opsrun_app;
  return query select * from opsrun.ingest_request_email(p_mensaje, p_hilo, p_recibida);
  reset role;
end;
$$;

create function pg_temp.resultado(p_mensaje text, p_hilo text, p_recibida timestamptz default now())
returns text
language sql
as $$ select outcome from pg_temp.ingerir(p_mensaje, p_hilo, p_recibida) $$;

create function pg_temp.request_de(p_mensaje text)
returns uuid
language sql
as $$ select request_id from opsrun.request_message where bzzzbx_message_id = p_mensaje $$;

create function pg_temp.eventos(p_req uuid, p_tipo text)
returns bigint
language sql
as $$ select count(*) from opsrun.audit_event where request_id = p_req and event_type = p_tipo $$;

create function pg_temp.requests()
returns bigint
language sql
as $$ select count(*) from opsrun.request $$;

create function pg_temp.vinculos()
returns bigint
language sql
as $$ select count(*) from opsrun.request_message $$;

create function pg_temp.auditorias()
returns bigint
language sql
as $$ select count(*) from opsrun.audit_event $$;

-- Las columnas :draft de la request con algo escrito, descubiertas por su
-- COMMENT (como G11): si alguien agrega una al borrador, esta prueba la mira.
create function pg_temp.borrador_lleno(p_request uuid)
returns text[]
language sql
stable
as $$
  select coalesce(array_agg(a.attname::text order by a.attname), '{}')
  from pg_catalog.pg_attribute as a
  where a.attrelid = 'opsrun.request'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and col_description(a.attrelid, a.attnum) ~ '^[a-z-]+:draft '
    and (select to_jsonb(r) -> a.attname::text from opsrun.request as r where r.id = p_request) <> 'null'::jsonb
$$;

create function pg_temp.columnas_borrador()
returns bigint
language sql
stable
as $$
  select count(*)
  from pg_catalog.pg_attribute as a
  where a.attrelid = 'opsrun.request'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and col_description(a.attrelid, a.attnum) ~ '^[a-z-]+:draft '
$$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
select ok(has_function_privilege('opsrun_app', 'opsrun.ingest_request_email(text, text, timestamptz)', 'execute'),
  'opsrun_app ejecuta ingest_request_email');
select ok(not has_function_privilege('authenticated', 'opsrun.ingest_request_email(text, text, timestamptz)', 'execute')
      and not has_function_privilege('anon', 'opsrun.ingest_request_email(text, text, timestamptz)', 'execute'),
  'ni authenticated ni anon ejecutan ingest_request_email');

-- ---------------------------------------------------------------------------
-- Sin actor de sistema no hay nada: sin actor, con operador y con los dos
-- ---------------------------------------------------------------------------
create temp table antes as
select pg_temp.requests() as requests, pg_temp.vinculos() as vinculos, pg_temp.auditorias() as auditorias;

do $$ begin perform pg_temp.actor(null, null); end $$;
select throws_ok($$select pg_temp.resultado('bx-msg-t15-sin-actor', 'bx-thread-t15-sin-actor')$$, '42501', null,
  'sin actor, ingest_request_email falla');

do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000151', null); end $$;
select throws_ok($$select pg_temp.resultado('bx-msg-t15-operador', 'bx-thread-t15-operador')$$, '42501', null,
  'con un operador, ingest_request_email falla');

do $$ begin perform pg_temp.actor('aa000000-0000-4000-8000-000000000151', 'entrada_correo'); end $$;
select throws_ok($$select pg_temp.resultado('bx-msg-t15-ambos', 'bx-thread-t15-ambos')$$, '42501', null,
  'con operador y sistema a la vez, ingest_request_email falla');

select ok(
  pg_temp.requests() = (select requests from antes)
    and pg_temp.vinculos() = (select vinculos from antes)
    and pg_temp.auditorias() = (select auditorias from antes),
  'las tres llamadas sin actor de sistema no escribieron nada');

do $$ begin perform pg_temp.actor(null, 'entrada_correo'); end $$;

-- ---------------------------------------------------------------------------
-- created: un correo en un hilo nuevo
-- ---------------------------------------------------------------------------
select is(pg_temp.resultado('bx-msg-t15-0001', 'bx-thread-t15-0001', timestamptz '2026-03-01 15:00:00+00'), 'created',
  'un correo en un hilo nuevo da created');

select is(
  (select count(*) from opsrun.request where id = pg_temp.request_de('bx-msg-t15-0001')),
  1::bigint, 'created: hay una request');
select is(
  (select status::text from opsrun.request where id = pg_temp.request_de('bx-msg-t15-0001')),
  'open', 'created: la request nace abierta');
select is(
  (select owner_operator_id from opsrun.request where id = pg_temp.request_de('bx-msg-t15-0001')),
  null::uuid, 'created: sin dueño');
select is(
  (select received_at from opsrun.request where id = pg_temp.request_de('bx-msg-t15-0001')),
  timestamptz '2026-03-01 15:00:00+00', 'created: received_at es la hora pedida');

select cmp_ok(pg_temp.columnas_borrador(), '>=', 13::bigint, 'el guard del borrador descubre las columnas :draft');
select is(pg_temp.borrador_lleno(pg_temp.request_de('bx-msg-t15-0001')), '{}'::text[],
  'created: todas las columnas :draft están en null');
select is(
  (select num_nulls(bzzzbx_job_id, job_number, scheduled_at) from opsrun.request where id = pg_temp.request_de('bx-msg-t15-0001')),
  3, 'created: sin job');

select is(
  (select count(*) from opsrun.request_message where request_id = pg_temp.request_de('bx-msg-t15-0001')),
  1::bigint, 'created: un solo vínculo');
select ok(
  (select m.is_original and m.channel = 'email' and m.direction = 'inbound' and m.actor_kind = 'system'
          and m.actor_operator_id is null and m.bzzzbx_thread_id = 'bx-thread-t15-0001'
          and m.instruction_id is null
     from opsrun.request_message as m where m.bzzzbx_message_id = 'bx-msg-t15-0001'),
  'created: el vínculo es el original, email, inbound, del sistema y con su hilo');

select is(pg_temp.eventos(pg_temp.request_de('bx-msg-t15-0001'), 'request_received'), 1::bigint,
  'created: un request_received');
select ok(
  (select e.actor_kind = 'system' and e.actor_operator_id is null
          and e.occurred_at = timestamptz '2026-03-01 15:00:00+00'
          and e.details = jsonb_build_object('bzzzbx_message_id', 'bx-msg-t15-0001', 'bzzzbx_thread_id', 'bx-thread-t15-0001')
     from opsrun.audit_event as e
    where e.request_id = pg_temp.request_de('bx-msg-t15-0001') and e.event_type = 'request_received'),
  'created: request_received del sistema, con occurred_at = received_at y solo los dos crosswalk IDs');
select is(
  (select count(*) from opsrun.audit_event where request_id = pg_temp.request_de('bx-msg-t15-0001')),
  1::bigint, 'created: ningún otro evento de Audit');

-- ---------------------------------------------------------------------------
-- duplicate: el mismo mensaje otra vez
-- ---------------------------------------------------------------------------
select is(pg_temp.resultado('bx-msg-t15-0001', 'bx-thread-t15-0001', timestamptz '2026-03-01 15:00:00+00'), 'duplicate',
  'el mismo mensaje da duplicate');
select is(pg_temp.resultado('bx-msg-t15-0001', 'bx-thread-t15-0001', timestamptz '2026-03-01 16:30:00+00'), 'duplicate',
  'el mismo mensaje con otra hora también da duplicate');
select is(
  (select request_id from pg_temp.ingerir('bx-msg-t15-0001', 'bx-thread-t15-0001', timestamptz '2026-03-01 15:00:00+00')),
  pg_temp.request_de('bx-msg-t15-0001'), 'duplicate devuelve la request del mensaje');
select ok(
  (select count(*) from opsrun.request_message where bzzzbx_message_id = 'bx-msg-t15-0001') = 1
    and pg_temp.eventos(pg_temp.request_de('bx-msg-t15-0001'), 'request_received') = 1
    and (select count(*) from opsrun.request where received_at = timestamptz '2026-03-01 15:00:00+00') = 1,
  'duplicate: una request, un vínculo y un request_received');

-- ---------------------------------------------------------------------------
-- linked: una respuesta en el hilo de una request
-- ---------------------------------------------------------------------------
select is(pg_temp.resultado('bx-msg-t15-0002', 'bx-thread-t15-0001', timestamptz '2026-03-01 15:20:00+00'), 'linked',
  'un segundo mensaje del mismo hilo da linked');
select is(pg_temp.request_de('bx-msg-t15-0002'), pg_temp.request_de('bx-msg-t15-0001'),
  'linked: va a la misma request');
select ok(
  (select not m.is_original and m.channel = 'email' and m.direction = 'inbound' and m.actor_kind = 'system'
     from opsrun.request_message as m where m.bzzzbx_message_id = 'bx-msg-t15-0002'),
  'linked: el vínculo no es original, es email, inbound y del sistema');
select ok(
  (select e.actor_kind = 'system' and e.occurred_at = timestamptz '2026-03-01 15:20:00+00'
          and e.details = jsonb_build_object('bzzzbx_message_id', 'bx-msg-t15-0002', 'bzzzbx_thread_id', 'bx-thread-t15-0001')
     from opsrun.audit_event as e
    where e.request_id = pg_temp.request_de('bx-msg-t15-0001') and e.event_type = 'email_received'),
  'linked: email_received del sistema con los dos crosswalk IDs');
select is(pg_temp.eventos(pg_temp.request_de('bx-msg-t15-0001'), 'request_received'), 1::bigint,
  'linked: no hay otro request_received');
select is((select count(*) from opsrun.request where received_at = timestamptz '2026-03-01 15:00:00+00'), 1::bigint,
  'linked: no hay otra request');

select is(pg_temp.resultado('bx-msg-t15-0002', 'bx-thread-t15-0001', timestamptz '2026-03-01 15:20:00+00'), 'duplicate',
  'la respuesta repetida da duplicate');
select is(pg_temp.eventos(pg_temp.request_de('bx-msg-t15-0001'), 'email_received'), 1::bigint,
  'la respuesta repetida no deja otro email_received');

-- También si la request ya está scheduled (el hilo es de una request para siempre, §5.2).
insert into opsrun.operator (id, email, display_name, team)
values ('0a000000-0000-4000-8000-000000000152', 'entrada.uno@example.test', 'Operador Entrada', 'operations');
select is(pg_temp.resultado('bx-msg-t15-0010', 'bx-thread-t15-0010', timestamptz '2026-03-02 10:00:00+00'), 'created',
  'otra request, para programarla');
insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
select pg_temp.request_de('bx-msg-t15-0010'), k, 'operator', '{}', '0a000000-0000-4000-8000-000000000152'
from unnest(enum_range(null::opsrun.confirmation_kind)) as k;
update opsrun.request
   set owner_operator_id = '0a000000-0000-4000-8000-000000000152',
       status = 'scheduled', bzzzbx_job_id = 'bx-job-t15', job_number = 'J-T-15', scheduled_at = now()
 where id = pg_temp.request_de('bx-msg-t15-0010');
select is(pg_temp.resultado('bx-msg-t15-0011', 'bx-thread-t15-0010', timestamptz '2026-03-02 11:00:00+00'), 'linked',
  'una respuesta a una request scheduled también se vincula');
select is(
  (select r.status::text from opsrun.request as r where r.id = pg_temp.request_de('bx-msg-t15-0010')),
  'scheduled', 'vincular no cambia la etapa de la request');

-- ---------------------------------------------------------------------------
-- Sin hilo: cada correo es su propia request (S-5)
-- ---------------------------------------------------------------------------
select is(pg_temp.resultado('bx-msg-t15-0020', null, timestamptz '2026-03-03 09:00:00+00'), 'created',
  'un correo sin hilo da created');
select is(pg_temp.resultado('bx-msg-t15-0021', null, timestamptz '2026-03-03 09:05:00+00'), 'created',
  'otro correo sin hilo da otra request');
select isnt(pg_temp.request_de('bx-msg-t15-0020'), pg_temp.request_de('bx-msg-t15-0021'),
  'dos correos sin hilo son dos requests');
select is(pg_temp.resultado('bx-msg-t15-0020', null, timestamptz '2026-03-03 09:00:00+00'), 'duplicate',
  'un correo sin hilo repetido da duplicate');

-- ---------------------------------------------------------------------------
-- Argumentos inválidos: 22023, sin escribir
-- ---------------------------------------------------------------------------
create temp table antes_invalidos as
select pg_temp.requests() as requests, pg_temp.vinculos() as vinculos, pg_temp.auditorias() as auditorias;

select throws_ok($$select pg_temp.resultado('', 'bx-thread-t15-x')$$, '22023', null, 'un ID de mensaje vacío da 22023');
select throws_ok($$select pg_temp.resultado(null, 'bx-thread-t15-x')$$, '22023', null, 'un ID de mensaje nulo da 22023');
select throws_ok($$select pg_temp.resultado('bx-msg-t15-x', 'bx-thread-t15-x', null)$$, '22023', null, 'una hora nula da 22023');
select ok(
  pg_temp.requests() = (select requests from antes_invalidos)
    and pg_temp.vinculos() = (select vinculos from antes_invalidos)
    and pg_temp.auditorias() = (select auditorias from antes_invalidos),
  'los argumentos inválidos no escribieron nada');

-- ---------------------------------------------------------------------------
-- La hora del futuro: se guarda now() y se marca (S-10)
-- ---------------------------------------------------------------------------
select is(pg_temp.resultado('bx-msg-t15-0030', 'bx-thread-t15-0030', now() + interval '3 hours'), 'created',
  'un correo con hora de 3 horas en el futuro se crea');
select ok(
  (select r.received_at <= now() from opsrun.request as r where r.id = pg_temp.request_de('bx-msg-t15-0030')),
  'la hora del futuro se guardó como now()');
select ok(
  (select (e.details -> 'clock_skew') = 'true'::jsonb
     from opsrun.audit_event as e
    where e.request_id = pg_temp.request_de('bx-msg-t15-0030') and e.event_type = 'request_received'),
  'el Audit lleva details.clock_skew = true');
select is(pg_temp.resultado('bx-msg-t15-0031', 'bx-thread-t15-0031', now() + interval '30 minutes'), 'created',
  'una hora a 30 minutos en el futuro se acepta');
select ok(
  (select r.received_at > now() and not (e.details ? 'clock_skew')
     from opsrun.request as r
     join opsrun.audit_event as e on e.request_id = r.id and e.event_type = 'request_received'
    where r.id = pg_temp.request_de('bx-msg-t15-0031')),
  'dentro de la hora de tolerancia se guarda tal cual y sin marca');

-- ---------------------------------------------------------------------------
-- OP030: un hilo con mensajes en dos requests distintas
-- ---------------------------------------------------------------------------
-- Una fixture escrita como el dueño, como si alguien moviera mensajes a mano.
select pg_temp.resultado('bx-msg-t15-0040', 'bx-thread-t15-0040', timestamptz '2026-03-04 09:00:00+00');
select pg_temp.resultado('bx-msg-t15-0041', null, timestamptz '2026-03-04 09:01:00+00');
insert into opsrun.request_message (request_id, bzzzbx_message_id, bzzzbx_thread_id, channel, direction, is_original, actor_kind)
values (pg_temp.request_de('bx-msg-t15-0041'), 'bx-msg-t15-0042', 'bx-thread-t15-0040', 'email', 'inbound', false, 'system');

create temp table antes_op030 as
select pg_temp.requests() as requests, pg_temp.vinculos() as vinculos, pg_temp.auditorias() as auditorias;
select throws_ok($$select pg_temp.resultado('bx-msg-t15-0043', 'bx-thread-t15-0040')$$, 'OP030', null,
  'un hilo con mensajes en dos requests da OP030');
select ok(
  pg_temp.requests() = (select requests from antes_op030)
    and pg_temp.vinculos() = (select vinculos from antes_op030)
    and pg_temp.auditorias() = (select auditorias from antes_op030),
  'OP030 no escribió nada');
select is(pg_temp.resultado('bx-msg-t15-0042', 'bx-thread-t15-0040'), 'duplicate',
  'un mensaje ya vinculado de un hilo ambiguo sigue dando duplicate');

-- ---------------------------------------------------------------------------
-- El índice nuevo: un original por hilo
-- ---------------------------------------------------------------------------
select ok(
  exists (select 1 from pg_indexes where schemaname = 'opsrun' and tablename = 'request_message'
            and indexname = 'request_message_original_thread_key' and indexdef ilike '%unique%'),
  'existe request_message_original_thread_key, único');
select ok(
  exists (select 1 from pg_indexes where schemaname = 'opsrun' and tablename = 'request_message'
            and indexname = 'request_message_thread_idx'),
  'existe request_message_thread_idx');

-- Para que choque solo el índice del hilo y no el de "un original por request",
-- la request de prueba deja de tener original antes del segundo intento.
update opsrun.request_message set is_original = false where bzzzbx_message_id = 'bx-msg-t15-0041';
select throws_ok(
  $$insert into opsrun.request_message (request_id, bzzzbx_message_id, bzzzbx_thread_id, channel, direction, is_original, actor_kind)
    values (pg_temp.request_de('bx-msg-t15-0041'), 'bx-msg-t15-0044', 'bx-thread-t15-0001', 'email', 'inbound', true, 'system')$$,
  '23505', null, 'un segundo original en el mismo hilo falla con 23505');
select lives_ok(
  $$insert into opsrun.request_message (request_id, bzzzbx_message_id, bzzzbx_thread_id, channel, direction, is_original, actor_kind)
    values (pg_temp.request_de('bx-msg-t15-0021'), 'bx-msg-t15-0045', null, 'email', 'inbound', false, 'system')$$,
  'un vínculo sin hilo no choca con el índice');

-- ---------------------------------------------------------------------------
-- El catálogo de Audit
-- ---------------------------------------------------------------------------
select ok(
  exists (select 1 from opsrun.audit_event_type
           where code = 'email_received' and label = 'Email received' and not requires_reason
             and source = 'opsrun' and sort_order = 225),
  'el catálogo trae email_received con su label, antes de email_sent');

select * from finish();
rollback;

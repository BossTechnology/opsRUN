-- OPR-19 · Estado de entrega y alerta "Message not delivered" (spec
-- docs/spec/opr-19-estado-de-entrega.md §10.1). Sin migración (P-0): lo que la
-- alerta necesita de la base ya lo hace `upsert_alert_occurrence` de OPR-34; aquí
-- se fija, para la regla Message not delivered (MSG-001), lo que el spec pide:
--
--   * el id del mensaje queda en la ocurrencia y en su `alert_opened`;
--   * con un `text_sent` o un `email_sent` de un operador entre la apertura y el
--     cierre, la alerta se resuelve `fixed_by_action` con ese operador (S-10);
--   * sin él, `auto_cleared`; con un evento de otro tipo o de antes de abrir, también;
--   * el reenvío de un texto (`text_sent`) no necesita nada nuevo: el reparto de
--     `alert_fixing_events()` ya lo cuenta.
--
-- Las llamadas van como opsrun_app con el actor de sistema, como el pool. Los
-- datos los pone el dueño de los esquemas y el rollback los deshace. No depende de
-- la seed. Todo es inventado.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

grant opsrun_migrador to current_user with inherit true, set true;
grant opsrun_app to current_user with inherit false, set true;

insert into opsrun.operator (id, auth_user_id, email, display_name, team) values
  ('0a000000-0000-4000-8000-000000000191', 'aa000000-0000-4000-8000-000000000191', 'entrega.uno@example.test', 'Operador Uno', 'operations');

create function pg_temp.rid(p_n int)
returns uuid
language sql
as $$ select ('b0000000-0000-4000-8000-0000000019' || lpad(p_n::text, 2, '0'))::uuid $$;

create function pg_temp.rq(p_n int)
returns void
language plpgsql
as $$ begin insert into opsrun.request (id, received_at) values (pg_temp.rid(p_n), now()); end; $$;

create function pg_temp.t(p_minutos int)
returns timestamptz
language sql
as $$ select timestamptz '2026-03-01 10:00:00+00' + make_interval(mins => p_minutos) $$;

create function pg_temp.actor_de_sistema()
returns void
language plpgsql
as $$
begin
  perform set_config('opsrun.auth_user_id', '', true);
  perform set_config('opsrun.system_actor', 'registrador_alertas', true);
end;
$$;

create function pg_temp.upsert(p_alert text, p_req uuid, p_mensaje text, p_opened timestamptz, p_cleared timestamptz default null)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  set local role opsrun_app;
  v_id := opsrun.upsert_alert_occurrence(p_alert, p_req, 'MSG-001', '1', 'red'::opsrun.alert_level, 'Message not delivered.', p_mensaje, p_opened, p_cleared);
  reset role;
  return v_id;
end;
$$;

create function pg_temp.evento(p_req uuid, p_tipo text, p_hora timestamptz)
returns void
language plpgsql
as $$
begin
  insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at)
  values (p_req, p_tipo, 'operator'::opsrun.actor_kind, '0a000000-0000-4000-8000-000000000191', p_hora);
end;
$$;

do $$
begin
  perform pg_temp.rq(n) from generate_series(1, 6) as n;
  perform pg_temp.actor_de_sistema();
  -- R2: el operador reenvió un texto dentro de la ventana (10:00 a 11:00).
  perform pg_temp.evento(pg_temp.rid(2), 'text_sent', pg_temp.t(30));
  -- R3: reenvió un correo.
  perform pg_temp.evento(pg_temp.rid(3), 'email_sent', pg_temp.t(30));
  -- R4: no reenvió nada; hizo otra cosa.
  perform pg_temp.evento(pg_temp.rid(4), 'details_confirmed', pg_temp.t(30));
  -- R5: reenvió, pero antes de que la alerta abriera.
  perform pg_temp.evento(pg_temp.rid(5), 'text_sent', pg_temp.t(-10));
end;
$$;

-- El reparto de la regla Message not delivered cuenta los dos reenvíos.
select results_eq(
  $$ select event_type from opsrun_private.alert_fixing_events() where rule_id = 'MSG-001' order by event_type $$,
  $$ values ('email_sent'), ('text_sent') $$,
  'MSG-001 se arregla con un email_sent o un text_sent');

-- R1: la alerta abre y guarda el crosswalk ID del mensaje, también en Audit.
select isnt(pg_temp.upsert('bx-alert-t19-01', pg_temp.rid(1), 'bx-msg-t19-01', pg_temp.t(0)), null::uuid, 'la alerta de un mensaje se registra');
select is(
  (select bzzzbx_message_id from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-t19-01'),
  'bx-msg-t19-01', 'la ocurrencia guarda el bzzzbx_message_id');
select results_eq(
  $$ select event_type, actor_kind::text, details ->> 'rule_id' from opsrun.audit_event where request_id = pg_temp.rid(1) and event_type like 'alert\_%' $$,
  $$ values ('alert_opened', 'bzzzbx', 'MSG-001') $$,
  'la apertura deja un alert_opened de BzzzBX con la regla Message not delivered');

-- R2: con un text_sent de un operador dentro de la ventana, fixed_by_action con ese operador.
select lives_ok($$select pg_temp.upsert('bx-alert-t19-02', pg_temp.rid(2), 'bx-msg-t19-02', pg_temp.t(0))$$, 'R2: se abre');
select lives_ok($$select pg_temp.upsert('bx-alert-t19-02', pg_temp.rid(2), 'bx-msg-t19-02', pg_temp.t(0), pg_temp.t(60))$$, 'R2: se cierra');
select results_eq(
  $$ select resolution::text, resolved_by, resolved_at from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-t19-02' $$,
  $$ values ('fixed_by_action', '0a000000-0000-4000-8000-000000000191'::uuid, pg_temp.t(60)) $$,
  'con un text_sent de un operador entre la apertura y el cierre: fixed_by_action con ese operador');
select results_eq(
  $$ select actor_kind::text, details ->> 'fixing_event_type', details ->> 'resolution' from opsrun.audit_event
      where request_id = pg_temp.rid(2) and event_type = 'alert_resolved' $$,
  $$ values ('operator', 'text_sent', 'fixed_by_action') $$,
  'alert_resolved dice que lo arregló un text_sent');

-- R3: un email_sent también.
select lives_ok($$select pg_temp.upsert('bx-alert-t19-03', pg_temp.rid(3), 'bx-msg-t19-03', pg_temp.t(0), pg_temp.t(60))$$, 'R3: llega cerrada');
select results_eq(
  $$ select resolution::text, resolved_by from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-t19-03' $$,
  $$ values ('fixed_by_action', '0a000000-0000-4000-8000-000000000191'::uuid) $$,
  'con un email_sent de un operador: fixed_by_action');

-- R4: sin reenvío, auto_cleared (el caso de la Fase A: el reenvío se hizo en las herramientas de PINCH, S-5).
select lives_ok($$select pg_temp.upsert('bx-alert-t19-04', pg_temp.rid(4), 'bx-msg-t19-04', pg_temp.t(0), pg_temp.t(60))$$, 'R4: llega cerrada');
select results_eq(
  $$ select resolution::text, resolved_by from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-t19-04' $$,
  $$ values ('auto_cleared', null::uuid) $$,
  'sin un text_sent ni un email_sent (otro evento de otro tipo): auto_cleared');

-- R5: un reenvío anterior a la apertura no cuenta.
select lives_ok($$select pg_temp.upsert('bx-alert-t19-05', pg_temp.rid(5), 'bx-msg-t19-05', pg_temp.t(0), pg_temp.t(60))$$, 'R5: llega cerrada');
select is(
  (select resolution::text from opsrun.alert_occurrence where bzzzbx_alert_id = 'bx-alert-t19-05'),
  'auto_cleared', 'un text_sent anterior a la apertura no cuenta: auto_cleared');

-- R6: sin evento alguno, también auto_cleared, y la repetición de la misma llamada no escribe más.
select lives_ok($$select pg_temp.upsert('bx-alert-t19-06', pg_temp.rid(6), 'bx-msg-t19-06', pg_temp.t(0), pg_temp.t(60))$$, 'R6: llega cerrada');
select is(
  (select count(*) from (select pg_temp.upsert('bx-alert-t19-06', pg_temp.rid(6), 'bx-msg-t19-06', pg_temp.t(0), pg_temp.t(60))) as x
    where (select count(*) from opsrun.audit_event where request_id = pg_temp.rid(6) and event_type like 'alert\_%') = 2)::int,
  1, 'repetir la llamada no deja otro alert_opened ni otro alert_resolved');

select * from finish();
rollback;

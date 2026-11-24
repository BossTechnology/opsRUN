-- OPR-20 · Guards G8 y G12: Audit inmutable y motivo obligatorio.
--
-- G8: opsrun.audit_event rechaza UPDATE, DELETE y TRUNCATE para todos, también
-- opsrun_app y el dueño (opsrun_migrador). Dos capas: ningún rol tiene el
-- privilegio (descubre los roles en pg_roles; los superusuarios se saltan los
-- privilegios, por eso existe la segunda capa) y, aunque alguien lo otorgue,
-- el trigger lo frena. Se ve fallar: sin el trigger, el cambio pasa.
--
-- G12: todo tipo de catálogo que pide motivo rechaza filas sin motivo o con el
-- motivo en blanco. Recorre audit_event_type e instruction_type. Se ve
-- fallar: sin el trigger, el evento sin motivo entra.
--
-- El rol que corre el test se concede opsrun_migrador con herencia (para
-- escribir la fixture y quitar triggers) y opsrun_app sin herencia (para
-- actuar como él). El rollback lo deshace.
begin;
create extension if not exists pgtap with schema extensions;

select plan(21);

grant opsrun_migrador to current_user with inherit true, set true;
grant opsrun_app to current_user with inherit false, set true;

-- Ejecuta una sentencia como un rol. Devuelve 'ok:<filas afectadas>' o el
-- SQLSTATE del error (pgTAP no se puede llamar como otro rol: sus tablas de
-- resultados son del rol que corre el test).
create function pg_temp.como(p_rol name, p_sql text)
returns text
language plpgsql
as $$
declare
  v_filas bigint;
begin
  execute format('set local role %I', p_rol);
  execute p_sql;
  get diagnostics v_filas = row_count;
  reset role;
  return 'ok:' || v_filas;
exception when others then
  return sqlstate;
end;
$$;

insert into opsrun.audit_event (event_type, actor_kind, occurred_at)
values ('operator_added', 'system', now());

-- ---------------------------------------------------------------------------
-- G8
-- ---------------------------------------------------------------------------

-- 1. Nadie tiene el privilegio, tampoco el dueño.
select is_empty(
  $$
    select r.rolname || ' ' || p.priv
    from pg_catalog.pg_roles as r
    cross join (values ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p(priv)
    where not r.rolsuper
      and r.rolname !~ '^pg_'
      and has_table_privilege(r.oid, 'opsrun.audit_event'::regclass, p.priv)
  $$,
  'G8: ningún rol (salvo superusuarios) tiene UPDATE, DELETE ni TRUNCATE sobre audit_event'
);

-- 2 a 7. opsrun_app y el dueño chocan con los privilegios.
select is(pg_temp.como('opsrun_app', 'update opsrun.audit_event set reason = $$x$$'), '42501',
  'G8: opsrun_app no puede actualizar audit_event');
select is(pg_temp.como('opsrun_app', 'delete from opsrun.audit_event'), '42501',
  'G8: opsrun_app no puede borrar de audit_event');
select is(pg_temp.como('opsrun_app', 'truncate opsrun.audit_event'), '42501',
  'G8: opsrun_app no puede vaciar audit_event');
select is(pg_temp.como('opsrun_migrador', 'update opsrun.audit_event set reason = $$x$$'), '42501',
  'G8: el dueño no puede actualizar audit_event');
select is(pg_temp.como('opsrun_migrador', 'delete from opsrun.audit_event'), '42501',
  'G8: el dueño no puede borrar de audit_event');
select is(pg_temp.como('opsrun_migrador', 'truncate opsrun.audit_event'), '42501',
  'G8: el dueño no puede vaciar audit_event');

-- 8 a 13. Aunque alguien otorgue el privilegio, no cambia nada. Para
-- opsrun_app, UPDATE y DELETE no llegan a ninguna fila: la RLS de respaldo no
-- le da política de escritura. TRUNCATE no pasa por RLS, y ahí frena el
-- trigger. Al dueño, que no está sujeto a RLS, lo frena el trigger.
grant update, delete, truncate on opsrun.audit_event to opsrun_app, opsrun_migrador;

select is(pg_temp.como('opsrun_app', 'update opsrun.audit_event set reason = $$x$$'), 'ok:0',
  'G8: con el privilegio otorgado, el UPDATE de opsrun_app no llega a ninguna fila');
select is(pg_temp.como('opsrun_app', 'delete from opsrun.audit_event'), 'ok:0',
  'G8: con el privilegio otorgado, el DELETE de opsrun_app no llega a ninguna fila');
select is(pg_temp.como('opsrun_app', 'truncate opsrun.audit_event'), 'OP001',
  'G8: el trigger frena TRUNCATE de opsrun_app');
select is(pg_temp.como('opsrun_migrador', 'update opsrun.audit_event set reason = $$x$$'), 'OP001',
  'G8: el trigger frena UPDATE del dueño');
select is(pg_temp.como('opsrun_migrador', 'delete from opsrun.audit_event'), 'OP001',
  'G8: el trigger frena DELETE del dueño');
select is(pg_temp.como('opsrun_migrador', 'truncate opsrun.audit_event'), 'OP001',
  'G8: el trigger frena TRUNCATE del dueño');

-- ---------------------------------------------------------------------------
-- G12
-- ---------------------------------------------------------------------------

-- Tipos que piden motivo y aceptaron una fila sin él (o con el motivo en blanco).
create function pg_temp.motivo_no_exigido()
returns setof text
language plpgsql
as $$
declare
  v_code text;
  v_reason text;
begin
  for v_code in select code from opsrun.audit_event_type where requires_reason order by code loop
    foreach v_reason in array array[null, '', '   '] loop
      begin
        insert into opsrun.audit_event (event_type, actor_kind, occurred_at, reason)
        values (v_code, 'system', now(), v_reason);
        return next format('audit_event_type %s (motivo %L)', v_code, v_reason);
      exception when sqlstate 'OP002' then
        null;
      end;
    end loop;
  end loop;

  for v_code in select code from opsrun.instruction_type where requires_reason order by code loop
    foreach v_reason in array array[null, '', '   '] loop
      begin
        insert into opsrun.instruction (type, idempotency_key, payload, actor_kind, reason)
        values (v_code, gen_random_uuid()::text, '{}', 'system', v_reason);
        return next format('instruction_type %s (motivo %L)', v_code, v_reason);
      exception when sqlstate 'OP002' then
        null;
      end;
    end loop;
  end loop;
end;
$$;

-- 14 y 15. El guard tiene qué recorrer.
select ok(
  exists (select 1 from opsrun.audit_event_type where requires_reason),
  'hay tipos de evento de Audit que piden motivo'
);
select ok(
  exists (select 1 from opsrun.instruction_type where requires_reason),
  'hay tipos de instrucción que piden motivo'
);

-- 16. La comprobación real.
select is_empty(
  'select * from pg_temp.motivo_no_exigido()',
  'G12: todo tipo que pide motivo rechaza filas sin motivo o con el motivo en blanco'
);

-- 17. Con motivo entra.
select lives_ok(
  $$ insert into opsrun.audit_event (event_type, actor_kind, occurred_at, reason)
     values ('alert_cleared', 'system', now(), 'Revisado con el cleaner.') $$,
  'un evento que pide motivo entra con motivo'
);

-- 18. Un cambio de tipo en una instrucción también pasa por el chequeo.
insert into opsrun.instruction (id, type, idempotency_key, payload, actor_kind)
values ('c0000000-0000-4000-8000-00000000a0d1', 'send_text', 'audit-tipo', '{}', 'system');
select throws_ok(
  $$ update opsrun.instruction set type = 'cancel_job' where id = 'c0000000-0000-4000-8000-00000000a0d1' $$,
  'OP002', null,
  'cambiar una instrucción a un tipo que pide motivo exige motivo'
);

-- 19 a 21. Los guards se ven fallar al quitar los triggers.
drop trigger audit_event_require_reason on opsrun.audit_event;
drop trigger instruction_require_reason on opsrun.instruction;

select ok(
  exists (select 1 from pg_temp.motivo_no_exigido() as f(t) where f.t like 'audit_event_type %'),
  'G12 se ve fallar: sin el trigger, un evento de Audit entra sin motivo'
);
select ok(
  exists (select 1 from pg_temp.motivo_no_exigido() as f(t) where f.t like 'instruction_type %'),
  'G12 se ve fallar: sin el trigger, una instrucción entra sin motivo'
);

drop trigger audit_event_immutable_row on opsrun.audit_event;
drop trigger audit_event_immutable_truncate on opsrun.audit_event;

select matches(pg_temp.como('opsrun_migrador', 'update opsrun.audit_event set reason = $$x$$'), '^ok:[1-9]',
  'G8 se ve fallar: sin el trigger y con el privilegio otorgado, el dueño actualiza audit_event');

select * from finish();
rollback;

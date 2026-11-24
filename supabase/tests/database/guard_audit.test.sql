-- OPR-20 · Guards G8 y G12: Audit inmutable y motivo obligatorio.
--
-- G8: audit_event rechaza UPDATE, DELETE y TRUNCATE para todos, también
-- service_role y postgres. Dos capas: ningún rol tiene el privilegio
-- (descubre los roles en pg_roles; los superusuarios se saltan los
-- privilegios, por eso existe la segunda capa) y, aunque alguien lo otorgue,
-- el trigger lo frena. Se ve fallar: sin el trigger, el cambio pasa.
--
-- G12: todo tipo de catálogo que pide motivo rechaza filas sin motivo o con el
-- motivo en blanco. Recorre audit_event_type e instruction_type. Se ve
-- fallar: sin el trigger, el evento sin motivo entra.
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

insert into public.audit_event (event_type, actor_kind, occurred_at)
values ('operator_added', 'system', now());

-- ---------------------------------------------------------------------------
-- G8
-- ---------------------------------------------------------------------------

-- 1. Nadie tiene el privilegio.
select is_empty(
  $$
    select r.rolname || ' ' || p.priv
    from pg_catalog.pg_roles as r
    cross join (values ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p(priv)
    where not r.rolsuper
      and has_table_privilege(r.oid, 'public.audit_event', p.priv)
  $$,
  'G8: ningún rol (salvo superusuarios) tiene UPDATE, DELETE ni TRUNCATE sobre audit_event'
);

-- 2 a 4. service_role choca con los privilegios.
set local role service_role;
select throws_ok('update public.audit_event set reason = $$x$$', '42501', null,
  'G8: service_role no puede actualizar audit_event');
select throws_ok('delete from public.audit_event', '42501', null,
  'G8: service_role no puede borrar de audit_event');
select throws_ok('truncate public.audit_event', '42501', null,
  'G8: service_role no puede vaciar audit_event');
reset role;

-- 5 a 10. Aunque alguien otorgue el privilegio, el trigger lo frena.
grant update, delete, truncate on public.audit_event to service_role, postgres;

set local role service_role;
select throws_ok('update public.audit_event set reason = $$x$$', 'OP001', null,
  'G8: el trigger frena UPDATE de service_role');
select throws_ok('delete from public.audit_event', 'OP001', null,
  'G8: el trigger frena DELETE de service_role');
select throws_ok('truncate public.audit_event', 'OP001', null,
  'G8: el trigger frena TRUNCATE de service_role');
reset role;

select throws_ok('update public.audit_event set reason = $$x$$', 'OP001', null,
  'G8: el trigger frena UPDATE de postgres');
select throws_ok('delete from public.audit_event', 'OP001', null,
  'G8: el trigger frena DELETE de postgres');
select throws_ok('truncate public.audit_event', 'OP001', null,
  'G8: el trigger frena TRUNCATE de postgres');

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
  for v_code in select code from public.audit_event_type where requires_reason order by code loop
    foreach v_reason in array array[null, '', '   '] loop
      begin
        insert into public.audit_event (event_type, actor_kind, occurred_at, reason)
        values (v_code, 'system', now(), v_reason);
        return next format('audit_event_type %s (motivo %L)', v_code, v_reason);
      exception when sqlstate 'OP002' then
        null;
      end;
    end loop;
  end loop;

  for v_code in select code from public.instruction_type where requires_reason order by code loop
    foreach v_reason in array array[null, '', '   '] loop
      begin
        insert into public.instruction (type, idempotency_key, payload, actor_kind, reason)
        values (v_code, gen_random_uuid()::text, '{}', 'system', v_reason);
        return next format('instruction_type %s (motivo %L)', v_code, v_reason);
      exception when sqlstate 'OP002' then
        null;
      end;
    end loop;
  end loop;
end;
$$;

-- 11 y 12. El guard tiene qué recorrer.
select ok(
  exists (select 1 from public.audit_event_type where requires_reason),
  'hay tipos de evento de Audit que piden motivo'
);
select ok(
  exists (select 1 from public.instruction_type where requires_reason),
  'hay tipos de instrucción que piden motivo'
);

-- 13. La comprobación real.
select is_empty(
  'select * from pg_temp.motivo_no_exigido()',
  'G12: todo tipo que pide motivo rechaza filas sin motivo o con el motivo en blanco'
);

-- 14 y 15. Con motivo entra; un tipo que no lo pide entra sin él.
select lives_ok(
  $$ insert into public.audit_event (event_type, actor_kind, occurred_at, reason)
     values ('alert_cleared', 'system', now(), 'Revisado con el cleaner.') $$,
  'un evento que pide motivo entra con motivo'
);
select lives_ok(
  $$ insert into public.audit_event (event_type, actor_kind, occurred_at)
     values ('note_added', 'system', now()) $$,
  'un evento que no pide motivo entra sin él'
);

-- 16. Un cambio de tipo en una instrucción también pasa por el chequeo.
insert into public.instruction (id, type, idempotency_key, payload, actor_kind)
values ('c0000000-0000-4000-8000-0000000000a1', 'send_text', 'audit-tipo', '{}', 'system');
select throws_ok(
  $$ update public.instruction set type = 'cancel_job' where id = 'c0000000-0000-4000-8000-0000000000a1' $$,
  'OP002', null,
  'cambiar una instrucción a un tipo que pide motivo exige motivo'
);

-- 17 a 20. Los guards se ven fallar al quitar los triggers.
drop trigger audit_event_require_reason on public.audit_event;
drop trigger instruction_require_reason on public.instruction;

select ok(
  exists (select 1 from pg_temp.motivo_no_exigido() as f(t) where f.t like 'audit_event_type %'),
  'G12 se ve fallar: sin el trigger, un evento de Audit entra sin motivo'
);
select ok(
  exists (select 1 from pg_temp.motivo_no_exigido() as f(t) where f.t like 'instruction_type %'),
  'G12 se ve fallar: sin el trigger, una instrucción entra sin motivo'
);

drop trigger audit_event_immutable_row on public.audit_event;
drop trigger audit_event_immutable_truncate on public.audit_event;

select lives_ok('update public.audit_event set reason = $$x$$',
  'G8 se ve fallar: sin el trigger, postgres actualiza audit_event');
select lives_ok('truncate public.audit_event',
  'G8 se ve fallar: sin el trigger, postgres vacía audit_event');

select * from finish();
rollback;

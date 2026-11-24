-- OPR-20 · Guards G3 y G4: quién lee qué en public.
--
-- G3: anon lee 0 filas (o recibe permiso denegado) en toda tabla y vista.
-- G4: un authenticated sin operador activo lee 0 filas en toda tabla y vista.
-- La otra cara, para que G4 no pase con una política que lo niega todo: un
-- operador activo lee filas en todas.
--
-- Descubre: las tablas y vistas de public cuyo dueño es el rol que aplica las
-- migraciones. Para que "0 filas" signifique algo, antes de mirar se comprueba
-- que todas tienen filas: una tabla nueva sin fila en la fixture falla aquí.
--
-- Se ve fallar en cada corrida: una política using (true) abre public.request
-- a anon y a authenticated, y los guards la detectan.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

-- Fixture: una fila en cada tabla, con datos inventados.
insert into auth.users (id, email) values
  ('aa000000-0000-4000-8000-000000000001', 'lectura.activo@example.test'),
  ('aa000000-0000-4000-8000-000000000002', 'lectura.inactivo@example.test'),
  ('aa000000-0000-4000-8000-000000000009', 'lectura.sin-operador@example.test');

insert into public.operator (id, auth_user_id, email, display_name, team, active) values
  ('0a000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001',
   'lectura.activo@example.test', 'Operador Activo', 'operations', true),
  ('0a000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-000000000002',
   'lectura.inactivo@example.test', 'Operador Inactivo', 'finance', false);

insert into public.request (id, received_at, owner_operator_id, bzzzbx_property_id)
values ('b0000000-0000-4000-8000-000000000001', now(), '0a000000-0000-4000-8000-000000000001', 'bx-prop-t001');

insert into public.instruction (id, request_id, type, idempotency_key, payload, actor_kind, actor_operator_id)
values ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
        'send_text', 'lectura-1', '{"template": "cleaner_confirmation_request"}',
        'operator', '0a000000-0000-4000-8000-000000000001'),
       ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001',
        'ai_analyze_request', 'lectura-2', '{}', 'system', null);

insert into public.cleaner_confirmation (id, request_id, purpose, bzzzbx_team_id, ask_instruction_id, actor_kind, actor_operator_id)
values ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'initial',
        'bx-team-t001', 'c0000000-0000-4000-8000-000000000001', 'operator', '0a000000-0000-4000-8000-000000000001');

insert into public.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
values ('b0000000-0000-4000-8000-000000000001', 'details', 'operator', '{"unit": "4B"}',
        '0a000000-0000-4000-8000-000000000001');

insert into public.request_message (request_id, bzzzbx_message_id, channel, direction, is_original, actor_kind)
values ('b0000000-0000-4000-8000-000000000001', 'bx-msg-t001', 'email', 'inbound', true, 'system');

insert into public.note (request_id, author_operator_id, body)
values ('b0000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', 'Nota de prueba.');

insert into public.alert_occurrence (bzzzbx_alert_id, request_id, rule_id, rule_version, level, reason_text, opened_at)
values ('bx-alert-t001', 'b0000000-0000-4000-8000-000000000001', 'OPS-002', '1', 'amber', 'Abierta hace 2 h.', now());

insert into public.ai_analysis (id, request_id, instruction_id, status)
values ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
        'c0000000-0000-4000-8000-000000000002', 'completed');

insert into public.ai_suggestion (request_id, ai_analysis_id, field, value)
values ('b0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'unit', '"4B"');

insert into public.message_template (key, version, channel, body, active)
values ('lectura_prueba', 1, 'text', 'Hola {{property}}', true);

insert into public.audit_event (request_id, event_type, actor_kind, occurred_at)
values ('b0000000-0000-4000-8000-000000000001', 'request_received', 'system', now());

-- Objetos de public de opsRUN.
create function pg_temp.objetos_public()
returns setof regclass
language sql
stable
as $$
  select c.oid::regclass
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v', 'm')
    and pg_catalog.pg_get_userbyid(c.relowner) = current_user
$$;

-- Filas que ve un rol en cada objeto. Permiso denegado cuenta como 0.
create function pg_temp.filas_visibles(p_rol text, p_sub uuid)
returns table (objeto text, filas bigint)
language plpgsql
as $$
declare
  v_objetos regclass[];
  v_objeto regclass;
  v_filas bigint;
begin
  select array_agg(o) into v_objetos from pg_temp.objetos_public() as o;
  foreach v_objeto in array v_objetos loop
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', p_rol)::text, true);
      execute format('set local role %I', p_rol);
      execute format('select count(*) from %s', v_objeto) into v_filas;
      reset role;
    exception when insufficient_privilege then
      v_filas := 0;
    end;
    objeto := v_objeto::text;
    filas := v_filas;
    return next;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- 1. Precondición: cada objeto tiene filas (como dueño, sin RLS).
select is_empty(
  $$ select objeto from pg_temp.filas_visibles(current_user, null) where filas = 0 $$,
  'toda tabla y vista de public tiene filas en la fixture'
);

-- 2. G3
select is_empty(
  $$ select objeto from pg_temp.filas_visibles('anon', null) where filas > 0 $$,
  'G3: anon no lee filas en ninguna tabla ni vista de public'
);

-- 3 y 4. G4
select is_empty(
  $$ select objeto from pg_temp.filas_visibles('authenticated', 'aa000000-0000-4000-8000-000000000009') where filas > 0 $$,
  'G4: un usuario sin operador no lee filas en ninguna tabla ni vista de public'
);
select is_empty(
  $$ select objeto from pg_temp.filas_visibles('authenticated', 'aa000000-0000-4000-8000-000000000002') where filas > 0 $$,
  'G4: un operador inactivo no lee filas en ninguna tabla ni vista de public'
);

-- 5. La otra cara.
select is_empty(
  $$ select objeto from pg_temp.filas_visibles('authenticated', 'aa000000-0000-4000-8000-000000000001') where filas = 0 $$,
  'un operador activo lee filas en toda tabla y vista de public'
);

-- 6 y 7. Los guards se ven fallar.
grant select on public.request to anon;
create policy guard_lectura_prueba_anon on public.request for select to anon using (true);
create policy guard_lectura_prueba_auth on public.request for select to authenticated using (true);

select ok(
  exists (
    select 1 from pg_temp.filas_visibles('anon', null)
    where objeto = 'public.request'::regclass::text and filas > 0
  ),
  'G3 se ve fallar: detecta una política using (true) para anon'
);
select ok(
  exists (
    select 1 from pg_temp.filas_visibles('authenticated', 'aa000000-0000-4000-8000-000000000009')
    where objeto = 'public.request'::regclass::text and filas > 0
  ),
  'G4 se ve fallar: detecta una política using (true) para authenticated'
);

select * from finish();
rollback;

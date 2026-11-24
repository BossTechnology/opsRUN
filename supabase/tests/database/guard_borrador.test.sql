-- OPR-20 · Guard G11: el borrador de una request scheduled no cambia.
--
-- Al programar, manda el job en PINCH y el borrador queda como registro de lo
-- que se confirmó.
--
-- Descubre: las columnas del borrador son las de public.request cuyo COMMENT
-- dice ":draft" (G9 obliga a que toda columna tenga COMMENT). Si alguien
-- agrega una columna al borrador y no al trigger, este guard la encuentra.
--
-- Se ve fallar en cada corrida: sin el trigger, el borrador cambia.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

-- Fixture: una request con todo el borrador lleno, confirmada y programada.
insert into public.operator (id, email, display_name, team)
values ('0a000000-0000-4000-8000-000000000011', 'borrador@example.test', 'Operador Borrador', 'operations');

insert into public.request (
  id, received_at, owner_operator_id,
  bzzzbx_customer_id, bzzzbx_contact_id, bzzzbx_property_id, bzzzbx_space_id,
  unit, beds, bzzzbx_service_id, service_date, window_start, window_end,
  access_notes, po_number, bzzzbx_team_id
) values
  ('b0000000-0000-4000-8000-000000000011', now(), '0a000000-0000-4000-8000-000000000011',
   'bx-cust-t011', 'bx-cont-t011', 'bx-prop-t011', 'bx-space-t011',
   '7C', 2, 'bx-svc-t011', date '2027-01-15', time '09:00', time '12:00',
   'Código en recepción.', 'PO-T-011', 'bx-team-t011'),
  ('b0000000-0000-4000-8000-000000000012', now(), null,
   'bx-cust-t012', null, null, null, null, null, null, null, null, null, null, null, null);

insert into public.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
select 'b0000000-0000-4000-8000-000000000011', k, 'operator', '{}', '0a000000-0000-4000-8000-000000000011'
from unnest(enum_range(null::public.confirmation_kind)) as k;

update public.request
set status = 'scheduled', bzzzbx_job_id = 'bx-job-t011', job_number = 'J-T-011', scheduled_at = now()
where id = 'b0000000-0000-4000-8000-000000000011';

create function pg_temp.columnas_borrador()
returns setof name
language sql
stable
as $$
  select a.attname
  from pg_catalog.pg_attribute as a
  where a.attrelid = 'public.request'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and col_description(a.attrelid, a.attnum) ~ '^[a-z-]+:draft '
$$;

-- Columnas del borrador que se dejaron cambiar en la request programada.
create function pg_temp.borrador_que_cambia()
returns setof text
language plpgsql
as $$
declare
  v_columna name;
begin
  for v_columna in select * from pg_temp.columnas_borrador() loop
    begin
      execute format('update public.request set %I = null where id = %L',
                     v_columna, 'b0000000-0000-4000-8000-000000000011');
      return next v_columna::text;
    exception when sqlstate 'OP003' then
      null;
    end;
  end loop;
end;
$$;

-- 1 y 2. Precondiciones: hay borrador, y la fixture lo llena entero (poner
-- null es un cambio real en cada columna).
select isnt_empty('select * from pg_temp.columnas_borrador()', 'request tiene columnas marcadas :draft');
select is_empty(
  $$
    select c from pg_temp.columnas_borrador() as c
    where (select to_jsonb(r) ->> c from public.request as r
           where r.id = 'b0000000-0000-4000-8000-000000000011') is null
  $$,
  'la request programada de la fixture tiene todo el borrador lleno'
);

-- 3. La comprobación real.
select is_empty(
  'select * from pg_temp.borrador_que_cambia()',
  'G11: ninguna columna del borrador cambia en una request scheduled'
);

-- 4. Lo que no es borrador sí cambia (reasignar, por ejemplo).
select lives_ok(
  $$ update public.request set owner_operator_id = null where id = 'b0000000-0000-4000-8000-000000000011' $$,
  'en una request scheduled se puede cambiar lo que no es borrador'
);

-- 5. Mientras está open, el borrador cambia.
select lives_ok(
  $$ update public.request set unit = '1A', beds = 1 where id = 'b0000000-0000-4000-8000-000000000012' $$,
  'en una request open el borrador cambia'
);

-- 6. Programada no vuelve a open.
select throws_ok(
  $$ update public.request set status = 'open', bzzzbx_job_id = null, job_number = null, scheduled_at = null
     where id = 'b0000000-0000-4000-8000-000000000011' $$,
  'OP003', null,
  'una request scheduled no vuelve a open'
);

-- 7. Lo que se confirmó sigue ahí.
select is(
  (select unit from public.request where id = 'b0000000-0000-4000-8000-000000000011'),
  '7C',
  'el borrador confirmado queda como registro'
);

-- 8 y 9. El guard se ve fallar al quitar el trigger.
drop trigger request_draft_frozen on public.request;

select isnt_empty(
  'select * from pg_temp.borrador_que_cambia()',
  'G11 se ve fallar: sin el trigger, el borrador cambia'
);
select is(
  (select unit from public.request where id = 'b0000000-0000-4000-8000-000000000011'),
  null::text,
  'G11 se ve fallar: el borrador quedó borrado'
);

select * from finish();
rollback;

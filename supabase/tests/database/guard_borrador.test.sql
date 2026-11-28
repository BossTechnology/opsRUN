-- OPR-20 · Guard G11: el borrador de una request scheduled no cambia.
-- OPR-28 · Guard G13: el reparto del borrador entre las tres confirmaciones.
--
-- Al programar, manda el job en PINCH y el borrador queda como registro de lo
-- que se confirmó.
--
-- Descubre: las columnas del borrador son las de opsrun.request cuyo COMMENT
-- dice ":draft" (G9 obliga a que toda columna tenga COMMENT). Si alguien
-- agrega una columna al borrador y no al trigger, este guard la encuentra.
--
-- Se ve fallar en cada corrida: sin el trigger, el borrador cambia.
--
-- G13 (al final del archivo): toda columna :draft de opsrun.request está en
-- opsrun_private.draft_fields de algún tipo de confirmación; ninguna columna de
-- draft_fields ni de draft_invalidating_fields deja de ser :draft; todo
-- opsrun.ai_field de borrador está en opsrun_private.ai_fields_of de algún
-- tipo (todos menos multiple_jobs, cleaner_reply y los draft_*, que no son
-- campos del borrador). Si alguien agrega una columna o un campo y se olvida
-- del reparto, este guard lo encuentra. Se ve fallar en cada corrida: agrega
-- una columna :draft de prueba, un campo de IA de prueba y funciones que
-- nombran lo que no es, y comprueba que las detecta. El rollback lo deshace.
--
-- Actúa como el dueño: el rol que corre el test se concede opsrun_migrador con
-- herencia; el rollback lo deshace.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

grant opsrun_migrador to current_user with inherit true, set true;

-- Fixture: una request con todo el borrador lleno, confirmada y programada.
insert into opsrun.operator (id, email, display_name, team)
values ('0a000000-0000-4000-8000-000000000011', 'borrador@example.test', 'Operador Borrador', 'operations');

insert into opsrun.request (
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

insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
select 'b0000000-0000-4000-8000-000000000011', k, 'operator', '{}', '0a000000-0000-4000-8000-000000000011'
from unnest(enum_range(null::opsrun.confirmation_kind)) as k;

update opsrun.request
set status = 'scheduled', bzzzbx_job_id = 'bx-job-t011', job_number = 'J-T-011', scheduled_at = now()
where id = 'b0000000-0000-4000-8000-000000000011';

create function pg_temp.columnas_borrador()
returns setof name
language sql
stable
as $$
  select a.attname
  from pg_catalog.pg_attribute as a
  where a.attrelid = 'opsrun.request'::regclass
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
      execute format('update opsrun.request set %I = null where id = %L',
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
    where (select to_jsonb(r) ->> c from opsrun.request as r
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
  $$ update opsrun.request set owner_operator_id = null where id = 'b0000000-0000-4000-8000-000000000011' $$,
  'en una request scheduled se puede cambiar lo que no es borrador'
);

-- 5. Mientras está open, el borrador cambia.
select lives_ok(
  $$ update opsrun.request set unit = '1A', beds = 1 where id = 'b0000000-0000-4000-8000-000000000012' $$,
  'en una request open el borrador cambia'
);

-- 6. Programada no vuelve a open.
select throws_ok(
  $$ update opsrun.request set status = 'open', bzzzbx_job_id = null, job_number = null, scheduled_at = null
     where id = 'b0000000-0000-4000-8000-000000000011' $$,
  'OP003', null,
  'una request scheduled no vuelve a open'
);

-- 7. Lo que se confirmó sigue ahí.
select is(
  (select unit from opsrun.request where id = 'b0000000-0000-4000-8000-000000000011'),
  '7C',
  'el borrador confirmado queda como registro'
);

-- 8 y 9. El guard se ve fallar al quitar el trigger.
drop trigger request_draft_frozen on opsrun.request;

select isnt_empty(
  'select * from pg_temp.borrador_que_cambia()',
  'G11 se ve fallar: sin el trigger, el borrador cambia'
);
select is(
  (select unit from opsrun.request where id = 'b0000000-0000-4000-8000-000000000011'),
  null::text,
  'G11 se ve fallar: el borrador quedó borrado'
);

-- ---------------------------------------------------------------------------
-- G13: el reparto del borrador entre las confirmaciones (OPR-28, spec §5.1 y §9.1)
-- ---------------------------------------------------------------------------
create function pg_temp.draft_sin_tipo()
returns setof name
language sql
stable
as $$
  select c from pg_temp.columnas_borrador() as c
  where not exists (
    select 1 from unnest(enum_range(null::opsrun.confirmation_kind)) as k
    where c::text = any (opsrun_private.draft_fields(k))
  )
$$;

create function pg_temp.campos_que_no_son_draft()
returns setof text
language sql
stable
as $$
  select distinct f
  from unnest(enum_range(null::opsrun.confirmation_kind)) as k
  cross join lateral unnest(opsrun_private.draft_fields(k) || opsrun_private.draft_invalidating_fields(k)) as f
  where f::name not in (select pg_temp.columnas_borrador())
$$;

-- Lo que se confirma tiene que invalidar la confirmación al cambiar.
create function pg_temp.confirmado_que_no_invalida()
returns setof text
language sql
stable
as $$
  select k::text || '.' || f
  from unnest(enum_range(null::opsrun.confirmation_kind)) as k
  cross join lateral unnest(opsrun_private.draft_fields(k)) as f
  where f <> all (opsrun_private.draft_invalidating_fields(k))
$$;

-- OPR-36: lo que llena el análisis de IA. Toda columna de ai_draft_columns es :draft y
-- todo campo de ai_analysis_fields es un opsrun.ai_field.
create function pg_temp.ia_columnas_que_no_son_draft()
returns setof text
language sql
stable
as $$
  select f || '.' || c
  from unnest(opsrun_private.ai_analysis_fields()) as f
  cross join lateral unnest(opsrun_private.ai_draft_columns(f)) as c
  where c::name not in (select pg_temp.columnas_borrador())
$$;

create function pg_temp.ia_campos_sin_ai_field()
returns setof text
language sql
stable
as $$
  select f from unnest(opsrun_private.ai_analysis_fields()) as f
  where f not in (select code from opsrun.ai_field)
$$;

create function pg_temp.ia_sin_tipo()
returns setof text
language sql
stable
as $$
  select a.code
  from opsrun.ai_field as a
  where a.code not in ('multiple_jobs', 'cleaner_reply')
    and a.code not like 'draft\_%'
    and not exists (
      select 1 from unnest(enum_range(null::opsrun.confirmation_kind)) as k
      where a.code = any (opsrun_private.ai_fields_of(k))
    )
$$;

select ok(
  (select count(*) from pg_temp.columnas_borrador()) >= 13
  and (select count(*) from unnest(enum_range(null::opsrun.confirmation_kind)) as k
        where cardinality(opsrun_private.draft_fields(k)) > 0) = 3,
  'G13 tiene qué mirar: las columnas :draft y los tres tipos con sus campos'
);
select is_empty('select * from pg_temp.draft_sin_tipo()',
  'G13: toda columna :draft de opsrun.request está en draft_fields de algún tipo');
select is_empty('select * from pg_temp.campos_que_no_son_draft()',
  'G13: ninguna columna de draft_fields ni de draft_invalidating_fields deja de ser :draft');
select is_empty('select * from pg_temp.confirmado_que_no_invalida()',
  'G13: todo lo que se confirma invalida la confirmación al cambiar');
select is_empty('select * from pg_temp.ia_sin_tipo()',
  'G13: todo ai_field de borrador está en ai_fields_of de algún tipo');

-- G13 se ve fallar: una columna :draft nueva que nadie repartió.
alter table opsrun.request add column prueba_g13 text;
comment on column opsrun.request.prueba_g13 is 'opsrun:draft · prueba';
select ok('prueba_g13' in (select * from pg_temp.draft_sin_tipo()),
  'G13 se ve fallar: detecta una columna :draft que ningún tipo de confirmación reparte');

-- Un campo de IA nuevo que nadie repartió.
insert into opsrun.ai_field (code, label) values ('campo_prueba_g13', 'Prueba');
select ok('campo_prueba_g13' in (select * from pg_temp.ia_sin_tipo()),
  'G13 se ve fallar: detecta un ai_field de borrador que ningún tipo reparte');

-- Un tipo que nombra una columna que no es del borrador.
create or replace function opsrun_private.draft_fields(p_kind opsrun.confirmation_kind)
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['owner_operator_id', 'no_existe'] $$;
select ok('owner_operator_id' in (select * from pg_temp.campos_que_no_son_draft())
      and 'no_existe' in (select * from pg_temp.campos_que_no_son_draft()),
  'G13 se ve fallar: detecta una columna de draft_fields que no es :draft');

-- Algo que se confirma y no invalida.
create or replace function opsrun_private.draft_invalidating_fields(p_kind opsrun.confirmation_kind)
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['unit'] $$;
select ok('details.owner_operator_id' in (select * from pg_temp.confirmado_que_no_invalida()),
  'G13 se ve fallar: detecta lo que se confirma pero no invalida');

-- OPR-36: el análisis de IA solo llena columnas del borrador y campos que existen.
select is_empty('select * from pg_temp.ia_columnas_que_no_son_draft()',
  'G13 (OPR-36): toda columna de ai_draft_columns es :draft');
select is_empty('select * from pg_temp.ia_campos_sin_ai_field()',
  'G13 (OPR-36): todo campo de ai_analysis_fields está en ai_field');

-- G13 (OPR-36) se ve fallar: el análisis llena una columna que no es del borrador y pide un campo que no existe.
create or replace function opsrun_private.ai_draft_columns(p_field text)
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['owner_operator_id'] $$;
select ok('property.owner_operator_id' in (select * from pg_temp.ia_columnas_que_no_son_draft()),
  'G13 (OPR-36) se ve fallar: detecta una columna de ai_draft_columns que no es :draft');

create or replace function opsrun_private.ai_analysis_fields()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['property', 'campo_que_no_existe'] $$;
select ok('campo_que_no_existe' in (select * from pg_temp.ia_campos_sin_ai_field()),
  'G13 (OPR-36) se ve fallar: detecta un campo de ai_analysis_fields que no está en ai_field');

select * from finish();
rollback;

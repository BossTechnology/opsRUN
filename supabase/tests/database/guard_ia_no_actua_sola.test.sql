-- OPR-36 · Guard G19: la IA no actúa sola (spec docs/spec/opr-36-analisis-ia.md §14.1).
-- G16 es el ciclo de fondo (ADR 0006), G17 las alertas (OPR-34) y G18 el job
-- enlazado (OPR-29): este es el siguiente número libre.
--
-- "Las IAs proponen, las personas firman." Ninguna función del sistema que
-- escribe el análisis de IA (opsrun.ai_analysis u opsrun.ai_suggestion) puede:
--   - insertar en request_confirmation, instruction ni cleaner_confirmation;
--   - cambiar request.status, owner_operator_id, bzzzbx_job_id ni job_number;
--   - escribir alert_occurrence;
--   - poner en ai_suggestion.decision otro valor que 'superseded'.
--
-- Descubre: las funciones de los esquemas `opsrun` y `opsrun_*` (sin las de una
-- extensión) cuyo código llama a opsrun_private.require_system() y escribe en
-- ai_analysis o ai_suggestion; y, de esas, todo helper de opsrun_private que
-- llamen (a cualquier profundidad). Mira su `prosrc` sin comentarios. Una
-- función nueva del análisis, o un helper nuevo que ella llame, entra sola.
--
-- Es una comprobación por texto: protege contra el descuido, no contra quien la
-- esquiva a propósito. Lo que no hace el análisis lo cierran también los roles
-- (opsrun_app no escribe tablas, G2) y los CHECK de ai_suggestion
-- (`ai_suggestion_operator_decision`: solo un operador decide).
--
-- Se ve fallar en cada corrida: crea, como el dueño, funciones de prueba del
-- sistema que insertan una confirmación, una instrucción, una pregunta al
-- cleaner, cambian el estado, el dueño o el job de la request, escriben una
-- alerta y deciden una sugerencia, y un helper privado que hace una de ellas;
-- comprueba que el guard las detecta, y que no marca a una función limpia. El
-- rollback las deshace.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

create function pg_temp.es_de_opsrun(nombre name)
returns boolean
language sql
immutable
as $$ select nombre = 'opsrun' or nombre like 'opsrun\_%' $$;

-- El código sin comentarios de línea (`-- …`) ni de bloque.
create function pg_temp.codigo(p_src text)
returns text
language sql
immutable
as $$ select regexp_replace(regexp_replace(p_src, '/\*.*?\*/', '', 'gs'), '--[^\n]*', '', 'g') $$;

-- Las funciones del sistema que escriben el análisis de IA, y los helpers de opsrun_private que llaman.
create function pg_temp.alcance()
returns table (nombre text, codigo text)
language sql
stable
as $$
  with recursive todas as (
    select p.oid, n.nspname, p.proname, pg_temp.codigo(p.prosrc) as codigo
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where pg_temp.es_de_opsrun(n.nspname)
      and p.prokind = 'f'
      and not exists (
        select 1 from pg_catalog.pg_depend as d
        where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  ),
  raiz as (
    select t.* from todas as t
    where t.codigo ~* 'opsrun_private\.require_system\s*\('
      and t.codigo ~* '(insert\s+into|update)\s+opsrun\.ai_(analysis|suggestion)\M'
  ),
  cierre as (
    select r.oid, r.nspname, r.proname, r.codigo from raiz as r
    union
    select t.oid, t.nspname, t.proname, t.codigo
    from cierre as c
    join todas as t on t.nspname = 'opsrun_private'
                   and c.codigo ~* ('opsrun_private\.' || t.proname || '\s*\(')
  )
  select distinct c.nspname || '.' || c.proname, c.codigo from cierre as c
$$;

-- Lo que ninguna de ellas puede hacer: 'función (motivo)'.
create function pg_temp.violaciones()
returns setof text
language sql
stable
as $$
  select a.nombre || ' (' || m.motivo || ')'
  from pg_temp.alcance() as a
  cross join lateral (values
    ('inserta una confirmación o una instrucción o una pregunta al cleaner',
      a.codigo ~* 'insert\s+into\s+opsrun\.(request_confirmation|instruction|cleaner_confirmation)\M'),
    ('cambia el estado, el dueño o el job de la request',
      a.codigo ~* 'update\s+opsrun\.request\s+set\s[^;]*?\m(status|owner_operator_id|bzzzbx_job_id|job_number)\M\s*='),
    ('escribe una alerta',
      a.codigo ~* '(insert\s+into|update)\s+opsrun\.alert_occurrence\M'),
    ('decide una sugerencia',
      a.codigo ~* 'decision\s*=\s*''(?!superseded'')'
      or a.codigo ~* '''(accepted|corrected|rejected)''\s*::\s*opsrun\.ai_decision'
      or a.codigo ~* 'then\s+''(accepted|corrected|rejected)''')
  ) as m(motivo, viola)
  where m.viola
  order by 1
$$;

-- 1. El guard tiene qué mirar: las funciones del análisis y sus helpers.
select ok(
  (select count(*) from pg_temp.alcance() where nombre in
    ('opsrun.start_ai_analysis', 'opsrun.record_ai_analysis', 'opsrun_private.ai_apply_to_draft')) = 3,
  'G19 tiene qué mirar: start_ai_analysis, record_ai_analysis y el helper que escribe el borrador');
select ok(
  (select count(*) from pg_temp.alcance() where nombre in ('opsrun.decide_ai_suggestion', 'opsrun.confirm_details', 'opsrun.ingest_request_email')) = 0,
  'G19 no mira lo del operador ni las demás funciones del sistema');

-- 2. La comprobación real.
select is_empty('select * from pg_temp.violaciones()',
  'G19: ninguna función del sistema del análisis de IA firma por una persona');

-- 3 a 10. G19 se ve fallar. Se rompe la regla como el dueño.
grant opsrun_migrador to current_user with inherit false, set true;
set local role opsrun_migrador;

create function opsrun.guard_prueba_ia_confirma()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform opsrun_private.require_system();
  insert into opsrun.ai_suggestion (request_id, field, value) select id, 'unit', '"x"' from opsrun.request limit 1;
  insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id)
  select id, 'details', 'operator', '{}', null from opsrun.request limit 1;
end $$;

create function opsrun.guard_prueba_ia_instruye()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform opsrun_private.require_system();
  update opsrun.ai_analysis set model = 'x' where false;
  insert into opsrun.instruction (request_id, type, idempotency_key, payload, actor_kind)
  select id, 'send_text', 'x', '{}', 'system' from opsrun.request limit 1;
end $$;

create function opsrun.guard_prueba_ia_pregunta()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform opsrun_private.require_system();
  update opsrun.ai_analysis set model = 'x' where false;
  insert into opsrun.cleaner_confirmation (request_id, purpose, bzzzbx_team_id, actor_kind)
  select id, 'initial', 'bx-team-x', 'system' from opsrun.request limit 1;
end $$;

create function opsrun.guard_prueba_ia_cambia_estado()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform opsrun_private.require_system();
  update opsrun.ai_analysis set model = 'x' where false;
  update opsrun.request
     set unit = '1', status = 'scheduled'
   where false;
end $$;

create function opsrun.guard_prueba_ia_cambia_dueno()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform opsrun_private.require_system();
  update opsrun.ai_analysis set model = 'x' where false;
  update opsrun.request set owner_operator_id = null where false;
end $$;

create function opsrun.guard_prueba_ia_alerta()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform opsrun_private.require_system();
  update opsrun.ai_suggestion set reason = 'x' where false;
  update opsrun.alert_occurrence set resolution_reason = 'x' where false;
end $$;

create function opsrun.guard_prueba_ia_decide()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform opsrun_private.require_system();
  update opsrun.ai_suggestion set decision = 'accepted' where false;
end $$;

-- Un helper privado que hace trampa, llamado desde una función del sistema que en sí es limpia.
create function opsrun_private.guard_prueba_ia_ayudante()
returns void language plpgsql set search_path = '' as $$
begin
  update opsrun.request set bzzzbx_job_id = 'bx-job-x' where false;
end $$;
create function opsrun.guard_prueba_ia_con_ayudante()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform opsrun_private.require_system();
  update opsrun.ai_analysis set model = 'x' where false;
  perform opsrun_private.guard_prueba_ia_ayudante();
end $$;

-- Una función del sistema limpia: escribe una sugerencia superseded y llena el borrador. Y un comentario que nombra lo prohibido.
create function opsrun.guard_prueba_ia_limpia()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform opsrun_private.require_system();
  -- insert into opsrun.request_confirmation y update opsrun.request set status solo en un comentario
  insert into opsrun.ai_suggestion (request_id, field, value, decision)
  select id, 'unit', '"x"', 'superseded' from opsrun.request limit 1;
  update opsrun.ai_suggestion set decision = 'superseded' where false;
  update opsrun.request set unit = '1', beds = 2 where false;
end $$;

reset role;

select ok('opsrun.guard_prueba_ia_confirma (inserta una confirmación o una instrucción o una pregunta al cleaner)' in (select * from pg_temp.violaciones()),
  'G19 se ve fallar: detecta una función del sistema del análisis que inserta una confirmación');
select ok('opsrun.guard_prueba_ia_instruye (inserta una confirmación o una instrucción o una pregunta al cleaner)' in (select * from pg_temp.violaciones()),
  'G19 se ve fallar: detecta una que inserta una instrucción');
select ok('opsrun.guard_prueba_ia_pregunta (inserta una confirmación o una instrucción o una pregunta al cleaner)' in (select * from pg_temp.violaciones()),
  'G19 se ve fallar: detecta una que le pregunta al cleaner');
select ok('opsrun.guard_prueba_ia_cambia_estado (cambia el estado, el dueño o el job de la request)' in (select * from pg_temp.violaciones())
      and 'opsrun.guard_prueba_ia_cambia_dueno (cambia el estado, el dueño o el job de la request)' in (select * from pg_temp.violaciones()),
  'G19 se ve fallar: detecta una que cambia el estado o el dueño de la request');
select ok('opsrun.guard_prueba_ia_alerta (escribe una alerta)' in (select * from pg_temp.violaciones()),
  'G19 se ve fallar: detecta una que escribe una alerta');
select ok('opsrun.guard_prueba_ia_decide (decide una sugerencia)' in (select * from pg_temp.violaciones()),
  'G19 se ve fallar: detecta una que pone una decisión que no es superseded');
select ok('opsrun_private.guard_prueba_ia_ayudante (cambia el estado, el dueño o el job de la request)' in (select * from pg_temp.violaciones()),
  'G19 se ve fallar: detecta un helper privado que cambia el job, llamado desde el sistema');
select is_empty(
  $$select * from pg_temp.violaciones() as v(t) where v.t like 'opsrun.guard_prueba_ia_limpia %'$$,
  'G19 no marca una función del sistema que solo escribe sugerencias superseded y el borrador (ni un comentario)');

select * from finish();
rollback;

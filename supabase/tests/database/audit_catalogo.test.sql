-- OPR-35 · Catálogo de tipos de Audit: lo que la pestaña muestra.
--
-- La pestaña Audit descubre los tipos desde opsrun.audit_event_type y muestra
-- su `label` tal cual (spec docs/spec/opr-35-audit.md §2.3 y §9). Dos reglas:
--
--   1. Todo tipo tiene `label` y no está en blanco: una fila sin nombre se
--      vería como un renglón vacío.
--   2. Ni el `code` ni el `label` de ningún tipo mencionan Zendesk (la tarjeta
--      pide "No Zendesk references anywhere"). Recorre el catálogo entero, no
--      una lista: un tipo nuevo cae bajo la regla sin tocar este archivo.
--
-- Sin migración no hay funciones ni grants nuevos que cubrir; G2, G4 y G8
-- (guard_escrituras, guard_lectura, guard_audit) ya cubren las tablas que se
-- leen. Cada regla se ve fallar en cada corrida: dentro de la transacción se
-- inserta un tipo malo, se comprueba que la regla lo detecta, y el rollback lo
-- deshace.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

grant opsrun_migrador to current_user with inherit true, set true;

-- Las reglas como consultas, para correrlas sobre el catálogo real y sobre el de prueba.
create function pg_temp.sin_nombre()
returns bigint
language sql
as $$
  select count(*) from opsrun.audit_event_type where nullif(btrim(label), '') is null
$$;

create function pg_temp.con_zendesk()
returns bigint
language sql
as $$
  select count(*) from opsrun.audit_event_type where code ilike '%zendesk%' or label ilike '%zendesk%'
$$;

-- ---------------------------------------------------------------------------
-- 1. El catálogo real
-- ---------------------------------------------------------------------------
select cmp_ok((select count(*) from opsrun.audit_event_type), '>', 0::bigint, 'el catálogo de tipos de Audit no está vacío');
select is(pg_temp.sin_nombre(), 0::bigint, 'todo audit_event_type tiene label y no está en blanco');
select is(pg_temp.con_zendesk(), 0::bigint, 'ningún audit_event_type menciona Zendesk en su code ni en su label');

-- ---------------------------------------------------------------------------
-- 2. Se ven fallar: tipos malos dentro de la transacción
-- ---------------------------------------------------------------------------
set local role opsrun_migrador;
insert into opsrun.audit_event_type (code, label, requires_reason, source, sort_order)
values ('prueba_zendesk_label', 'Zendesk ticket', false, 'opsrun', 32001),
       ('prueba_sin_nombre', '   ', false, 'opsrun', 32002),
       ('prueba_zendesk_code_zendesk', 'Ticket created', false, 'opsrun', 32003);
reset role;

select is(pg_temp.con_zendesk(), 2::bigint, 'la regla de Zendesk se ve fallar: detecta un label y un code con Zendesk');
select is(pg_temp.sin_nombre(), 1::bigint, 'la regla del label se ve fallar: detecta un tipo con el label en blanco');
select is(
  (select count(*) from opsrun.audit_event_type where code ilike '%zendesk%' and label not ilike '%zendesk%'),
  1::bigint,
  'la regla de Zendesk detecta también un code con el label limpio'
);

select * from finish();
rollback;

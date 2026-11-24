-- opsrun.opsrun_health(): vive en opsrun, responde, y solo la ejecuta opsrun_app.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

select has_function('opsrun', 'opsrun_health', '{}'::name[], 'existe opsrun.opsrun_health()');
select hasnt_function('public', 'opsrun_health', '{}'::name[], 'no hay opsrun_health en public');

select ok(
  not has_function_privilege('anon', 'opsrun.opsrun_health()', 'execute'),
  'anon no puede ejecutar opsrun_health'
);
select ok(
  not has_function_privilege('authenticated', 'opsrun.opsrun_health()', 'execute'),
  'authenticated no puede ejecutar opsrun_health'
);
select ok(
  not has_function_privilege('service_role', 'opsrun.opsrun_health()', 'execute'),
  'service_role no puede ejecutar opsrun_health'
);
select ok(
  has_function_privilege('opsrun_app', 'opsrun.opsrun_health()', 'execute'),
  'opsrun_app puede ejecutar opsrun_health'
);

-- Como opsrun_app de verdad. El rol que corre el test lo creó en el alta local
-- y puede concedérselo; el rollback lo deshace. opsrun_app no llega a pgTAP
-- (vive en extensions), así que el resultado se guarda y se comprueba al volver.
create temporary table resultado (status text, schema_version text, ultima text);
grant insert on resultado to opsrun_app;
grant opsrun_app to current_user with inherit false, set true;

set local role opsrun_app;
insert into resultado
select h.status, h.schema_version, (select max(m.version) from opsrun.schema_migration as m)
from opsrun.opsrun_health() as h;
reset role;

select is((select status from resultado), 'ok', 'como opsrun_app, status es ok');
select isnt((select schema_version from resultado), null, 'como opsrun_app, schema_version no es null');
select is(
  (select schema_version from resultado),
  (select ultima from resultado),
  'schema_version es la última migración de opsrun.schema_migration'
);

select * from finish();
rollback;

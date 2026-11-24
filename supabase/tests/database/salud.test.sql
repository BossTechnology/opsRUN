-- OPR-1 · public.opsrun_health(): responde y solo la ejecuta service_role.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

select has_function('public', 'opsrun_health', '{}'::name[], 'existe public.opsrun_health()');

select ok(
  not has_function_privilege('anon', 'public.opsrun_health()', 'execute'),
  'anon no puede ejecutar opsrun_health'
);
select ok(
  not has_function_privilege('authenticated', 'public.opsrun_health()', 'execute'),
  'authenticated no puede ejecutar opsrun_health'
);
select ok(
  has_function_privilege('service_role', 'public.opsrun_health()', 'execute'),
  'service_role puede ejecutar opsrun_health'
);

set local role service_role;

select is((select status from public.opsrun_health()), 'ok', 'status es ok');
select isnt(
  (select schema_version from public.opsrun_health()),
  null,
  'schema_version trae la última migración aplicada'
);

reset role;

select * from finish();
rollback;

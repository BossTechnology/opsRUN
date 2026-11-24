-- OPR-1 · Lo primero de opsRUN en el Supabase de la caja (ADR 0003).
--
-- Corre como opsrun_migrador, dueño de los esquemas de opsRUN. Siguiendo las
-- convenciones de las vecinas de Bzzz:
-- - los esquemas (opsrun, opsrun_private, opsrun_writeback) y los roles
--   (opsrun_migrador, opsrun_app, bzzz_writeback_opsrun) ya existen: los crea
--   el alta de opsRUN en Bzzz. Las migraciones no ejecutan create schema ni
--   create role. En local y en CI los crea supabase/alta-local.sql;
-- - las migraciones solo crean objetos dentro de esos esquemas y conceden
--   sobre ellos. Nada en public, que es de Supabase.
--
-- El servidor de Next se conecta directo a Postgres como opsrun_app, que solo
-- entra a `opsrun`: ni a opsrun_private ni a opsrun_writeback.
--
-- Los guards de supabase/tests/database/ prueban lo que esto promete.

-- ── Permisos de base ────────────────────────────────────────────────────────
-- Nadie más que el dueño entra a los esquemas, salvo opsrun_app a `opsrun`.
revoke all on schema opsrun, opsrun_private, opsrun_writeback from public;
grant usage on schema opsrun to opsrun_app;

-- Postgres da EXECUTE a PUBLIC en cada función nueva. Para las que cree
-- opsrun_migrador, no: cada una se concede a mano. (Un ALTER DEFAULT
-- PRIVILEGES ... IN SCHEMA no puede quitar lo que da el default global; por
-- eso va sin IN SCHEMA, para el rol.)
alter default privileges for role opsrun_migrador revoke execute on functions from public;

-- ── Migraciones aplicadas ───────────────────────────────────────────────────
-- Las aplica scripts/migrar.mjs como opsrun_migrador, que no tiene acceso a
-- supabase_migrations (es de Supabase): opsRUN lleva su propia cuenta.
-- El script inserta la fila de cada migración en la misma transacción que la
-- aplica; esta tabla nace en esta migración, así que también la registra.
create table opsrun.schema_migration (
  version text primary key,
  name text not null,
  applied_at timestamptz not null default now()
);

comment on table opsrun.schema_migration is
  'Migraciones de opsRUN aplicadas, una fila por archivo de supabase/migrations. La escribe scripts/migrar.mjs.';
comment on column opsrun.schema_migration.version is
  'opsrun: versión de la migración, el prefijo numérico del archivo.';
comment on column opsrun.schema_migration.name is
  'opsrun: nombre del archivo, sin la versión ni la extensión.';
comment on column opsrun.schema_migration.applied_at is
  'opsrun: cuándo se aplicó.';

alter table opsrun.schema_migration enable row level security;

grant select on opsrun.schema_migration to opsrun_app;

create policy "schema_migration: opsrun_app lee"
  on opsrun.schema_migration for select to opsrun_app
  using (true);

-- ── Salud de la base ────────────────────────────────────────────────────────
-- La página de inicio la usa para mostrar que la app llega a la base y qué
-- migración tiene aplicada; el deploy la usará como prueba de humo. Corre con
-- los permisos de quien la llama (opsrun_app): no necesita más.
create function opsrun.opsrun_health()
returns table (status text, schema_version text)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'ok'::text, max(m.version) from opsrun.schema_migration as m;
$$;

comment on function opsrun.opsrun_health() is
  'Salud de la base: status ok y la última migración de opsRUN aplicada. Solo opsrun_app.';

revoke execute on function opsrun.opsrun_health() from public;
grant execute on function opsrun.opsrun_health() to opsrun_app;

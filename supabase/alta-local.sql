-- SOLO LOCAL Y CI. Imita el alta de opsRUN en Bzzz.
--
-- En la caja, los esquemas y los roles de opsRUN los crea el guion de Bzzz a
-- partir del alta de la vecina (convenciones de vecinas de Bzzz, ADR 0003), no
-- este archivo ni las migraciones de opsRUN. Aquí no hay alta de Bzzz, así que
-- esto la imita antes de las migraciones, para que las migraciones y los
-- guards vean la misma base que en la caja.
--
-- Lo corre scripts/base-local.mjs con el rol administrador del Supabase local
-- (postgres), en `pnpm local`, `pnpm db:start`, `pnpm db:reset`,
-- `pnpm test:db`, el E2E y el CI. Es idempotente.
--
-- Las claves son solo locales y públicas a propósito: el Supabase local no
-- sale de la máquina. En la caja las claves las da el alta y no pasan por el
-- repo.

-- ── Roles ───────────────────────────────────────────────────────────────────
-- Atributos del alta: LOGIN, NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
-- NOREPLICATION y sin pertenecer a ningún rol. Si el rol ya existe (los roles
-- son de todo el clúster y sobreviven a un reset), se le vuelven a fijar los
-- que se pueden fijar sin ser superusuario; SUPERUSER, BYPASSRLS y
-- REPLICATION no se pueden ni nombrar en un ALTER, y los guards de
-- supabase/tests/database/ fallan si alguno aparece.
do $$
begin
  -- Dueño de los esquemas de opsRUN; aplica las migraciones. Una conexión a la
  -- vez, como en la caja.
  if not exists (select from pg_catalog.pg_roles where rolname = 'opsrun_migrador') then
    create role opsrun_migrador
      login nosuperuser nobypassrls nocreatedb nocreaterole noreplication
      connection limit 1
      password 'opsrun_migrador_local';
  else
    alter role opsrun_migrador
      login nocreatedb nocreaterole connection limit 1 password 'opsrun_migrador_local';
  end if;

  -- El servidor de Next. En la caja su límite de conexiones lo mide el alta;
  -- aquí no se limita.
  if not exists (select from pg_catalog.pg_roles where rolname = 'opsrun_app') then
    create role opsrun_app
      login nosuperuser nobypassrls nocreatedb nocreaterole noreplication
      password 'opsrun_app_local';
  else
    alter role opsrun_app
      login nocreatedb nocreaterole connection limit -1 password 'opsrun_app_local';
  end if;

  -- La caja leyendo el write-back de opsRUN. En la caja solo entra desde su red
  -- interna; aquí no se imita esa restricción y no tiene clave, así que no
  -- entra. Lo que puede leer lo concede la migración de OPR-20.
  if not exists (select from pg_catalog.pg_roles where rolname = 'bzzz_writeback_opsrun') then
    create role bzzz_writeback_opsrun
      login nosuperuser nobypassrls nocreatedb nocreaterole noreplication;
  else
    alter role bzzz_writeback_opsrun login nocreatedb nocreaterole password null;
  end if;
end
$$;

-- ── Esquemas ────────────────────────────────────────────────────────────────
-- Con dueño opsrun_migrador. Para crearlos a su nombre, postgres necesita
-- poder hacer SET ROLE a opsrun_migrador: se lo da un momento y se lo quita.
grant opsrun_migrador to current_user with inherit false, set true;

create schema if not exists opsrun authorization opsrun_migrador;
create schema if not exists opsrun_private authorization opsrun_migrador;
create schema if not exists opsrun_writeback authorization opsrun_migrador;

revoke opsrun_migrador from current_user;

-- Si ya existían, el alta igual exige que sean de opsrun_migrador.
do $$
declare
  esquema name;
begin
  for esquema in
    select n.nspname
    from pg_catalog.pg_namespace as n
    where n.nspname in ('opsrun', 'opsrun_private', 'opsrun_writeback')
      and n.nspowner <> 'opsrun_migrador'::regrole
  loop
    raise exception 'el esquema % ya existe y no es de opsrun_migrador', esquema;
  end loop;
end
$$;

-- Ninguno tiene CREATE en la base: no se les concede (PUBLIC tampoco lo tiene)
-- y el guard de roles lo comprueba.

# ESTADO.md

> Actualizar al cerrar cada sesión. Es lo primero que lee la siguiente.

## Tarea actual
- OPR-1, conexión directa (rama `opr-1-conexion-directa`): opsRUN en el Supabase de la caja, en sus esquemas y con sus roles, según la ADR 0003 y las convenciones de las vecinas de Bzzz. PR contra `main`, sin fusionar.

## Hecho
- 2026-11-24: base de documentos creada a partir de las 43 tarjetas del proyecto OPR en Relevo. Commit `e029ca1` en `main`.
- 2026-11-24: OPR-1 local. Next.js 16 (App Router, TypeScript estricto) con pnpm y Node 22; Supabase local con la CLI como dependencia (puertos 58320–58329); migración `public.opsrun_health()`; página de inicio que muestra la salud de la base; pgTAP (salud y guard de RLS que descubre las tablas), Vitest y un E2E de Playwright; `pnpm local` levanta todo en un comando; CI en GitHub Actions. Stack de tests confirmado en `PLAN.md` §2.
- En local pasan `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db` (10 tests) y `pnpm test:e2e`, y `pnpm local` sirve la página conectada a su base.
- CI del PR en verde (run 45426026175): lint + typecheck + Vitest, pgTAP (2 archivos, 10 tests) y Playwright (1 E2E).
- El guard de RLS se acota a las tablas cuyo dueño es el rol de las migraciones (en la primera corrida del CI marcaba tablas de pg_catalog y de Supabase) y se ve fallar en cada corrida: crea una tabla de prueba sin RLS en `public` y comprueba que la detecta. También se vio en rojo en local con una tabla real sin RLS (y en verde al quitarla).

- 2026-11-24: PR #1 (OPR-1 local) y PR #2 (spec y ADR 0001 de OPR-20) fusionados en `main` por orden de Henry, con la CI en verde.
- 2026-11-24: ADR 0003 (PR #4, fusionado). opsRUN usa el Supabase de la caja.
- 2026-11-24: OPR-1 conexión directa:
  - El servidor de Next se conecta directo a Postgres como `opsrun_app` con `pg`, sin supabase-js, PostgREST ni service role. Solo lectura por defecto, `statement_timeout` de 5 s y rechazo de un login superusuario o BYPASSRLS. Cada transacción puede declarar su actor (`opsrun.auth_user_id` u `opsrun.system_actor`) para OPR-20; el login sigue en OPR-2.
  - Con `OPSRUN_SERVIDOR=1`, el servidor valida sus variables y la URL del GoTrue de la caja, lee la clave de un archivo de secretos montado y no arranca si falta algo o sobra una variable prohibida.
  - Los esquemas (`opsrun`, `opsrun_private`, `opsrun_writeback`) y los roles (`opsrun_migrador`, `opsrun_app`, `bzzz_writeback_opsrun`) los crea el alta de Bzzz. En local y en CI los imita `supabase/alta-local.sql`.
  - Las migraciones corren como `opsrun_migrador` con `scripts/migrar.mjs` y llevan su cuenta en `opsrun.schema_migration`; la CLI de Supabase ya no las aplica. Se quitó la migración `public.opsrun_health()`, que nunca salió de local y CI; la salud vive en `opsrun.opsrun_health()`.
  - Guards pgTAP por descubrimiento: G1 acotado a `opsrun*`, un solo dueño, nada de opsRUN fuera de sus esquemas, y roles `opsrun_*` sin atributos peligrosos, sin membresías y sin alcance fuera de lo suyo. `opsrun_app` entra solo a `opsrun`. Cada guard se ve fallar en cada corrida.
- 2026-11-24: ADR 0002. opsRUN corre en el mismo servidor que BzzzBX, al lado de la caja y no dentro, con repo, Supabase, deploy y vuelta atrás propios. Confirma lo que ya decía OPR-1; el spec de OPR-20 (tablas en `public` de su propio Supabase) no cambia.

## Pendiente
- `.env.example`: lo crea Henry. Los permisos del agente bloquean cualquier archivo `.env*`. Los nombres están en `PLAN.md` §3 (los `SUPABASE_*` ya no se usan).
- Con el equipo de BzzzBX: cómo se aplican las migraciones en la caja (`scripts/migrar.mjs` como `opsrun_migrador` u otro mecanismo), cómo llega la clave de `opsrun_app` al archivo de secretos y el límite de conexiones de `opsrun_app` (el pool abre hasta 4).
- Protección de la rama `main`.
- OPR-1 en el servidor de PINCH: staging y producción sobre el Supabase de la caja, comando único de deploy y vuelta atrás, secretos en el servidor, migraciones aplicadas desde el repo y `opsrun_health()` como prueba de humo tras cada deploy.
- Leer el Release Definition, el User Guide y el prototipo R23 cuando estén en Relevo.
- Confirmar con Federico las dependencias de `PLAN.md` §5.

## Bloqueado
- OPR-6 (contrato de BzzzBX): bloquea casi todo P1, incluido el despliegue de OPR-1.
- OPR-2 (método de login): bloquea OPR-21 y, por ella, OPR-23.

## Siguiente paso
- Revisar y fusionar el PR de la conexión directa. Después, la migración de OPR-20 sobre esa base: va con versión posterior a `20261124120000`, corre como `opsrun_migrador` y no crea esquemas ni roles.

# ESTADO.md

> Actualizar al cerrar cada sesión. Es lo primero que lee la siguiente.

## Tarea actual
- OPR-1, imagen y deploy (rama `opr-1-imagen-y-deploy`): PR contra `main`, sin fusionar. Todo lo que se puede hacer sin el servidor de PINCH; el despliegue real espera la red de OPR-6.

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

- 2026-11-24: OPR-20 ajustado a la ADR 0003. Esquemas `opsrun`, `opsrun_private` y `opsrun_writeback`; roles `opsrun_app` (lee y ejecuta funciones) y `opsrun_writeback_reader`. El servidor fija el actor de cada transacción (`opsrun.auth_user_id` o `opsrun.system_actor`). RLS de respaldo con una sola política para `opsrun_app`. Los guards G2 a G12 quedan acotados a los esquemas y roles `opsrun*`. Henry eligió las cuatro opciones recomendadas.
- 2026-11-24: OPR-20 alineado con D77 §2.8 (PR #5). El lector del write-back es `bzzz_writeback_opsrun`, rol de la caja, que reemplaza a `opsrun_writeback_reader`. El dueño de esquemas y migraciones es `opsrun_migrador`. Esquemas y roles los crea el alta de opsRUN en Bzzz; las migraciones solo crean objetos y conceden dentro de `opsrun*`. En local y en CI los imita un script de prueba que construye OPR-1. G3 no busca al lector por nombre: todo rol ajeno con privilegios en `opsrun*` solo puede tener USAGE en `opsrun_writeback` y SELECT en sus vistas `v1_*`.
- 2026-11-24: G3 exige además a lo sumo un rol ajeno con privilegios en `opsrun*` (aprobado por Henry), para que un SELECT de más a `authenticated` no pase. Un segundo lector de BzzzBX hace fallar G3 a propósito y pide una decisión explícita.
- 2026-11-24: PR #6 (OPR-1, conexión directa) fusionado en `main`.
- 2026-11-24: OPR-20, migración `20261124130000_modelo_de_datos.sql` sobre la de OPR-1. Corre como `opsrun_migrador`, sin crear esquemas ni roles: catálogos, las 15 tablas en `opsrun`, helpers de actor en `opsrun_private` (`current_operator_id`, `require_operator`, `require_system`), triggers (Audit inmutable, motivo obligatorio, borrador congelado, gate de Schedule, estado de instrucciones hacia adelante), RLS con una política de lectura para `opsrun_app` y vistas `v1_*` en `opsrun_writeback` para `bzzz_writeback_opsrun`.
  - Guards pgTAP G2 a G12 por descubrimiento, cada uno visto fallar en cada corrida. G3 absorbe la frontera con los roles de la API que miraba `rls.test.sql`. El guard del lector del write-back del modelo anterior (`guard_writeback.test.sql`) queda dentro de G3 y se quita; el G10 del spec actual lo cubren `roles.test.sql` y `rls.test.sql` de OPR-1.
  - `scripts/migrar.mjs` ya no confunde el `end;` de un cuerpo plpgsql con un fin de transacción (con test de Vitest).
  - La seed pasa al esquema `opsrun` y carga como `opsrun_migrador`, con datos inventados.
  - G3 y G7 con la lectura del clúster (ADR 0004, aprobada por Henry el 2026-11-24 para G3 y G7; riesgo aceptado: esos miembros tienen BYPASSRLS y leen todo opsRUN, y cerrarlo es de la caja): lo que un rol tiene solo por heredar `pg_read_all_data` no cuenta; se halla por membresía, sin nombrar roles. La regla está en el spec §8.
  - Validado en local con psql contra el Postgres del Supabase local, con la seed cargada (el Docker local está saturado y `supabase test db` no arranca): los 11 archivos pgTAP en verde. `pnpm lint`, `pnpm typecheck` y `pnpm test` en verde. `test:db` completo, en la CI del PR.

- 2026-11-24: PR #7 (OPR-20, migración del modelo de datos) fusionado en `main`.
- 2026-11-24: OPR-1 imagen y deploy:
  - `Dockerfile`: Next en modo standalone sobre `node:22.23.5-alpine3.24`, usuario `opsrun` (uid 10001), sin secretos en el entorno ni en las capas (`.dockerignore` deja fuera `.env*`, llaves y `.git`). Trae `scripts/migrar.mjs` y las migraciones, para que el deploy aplique las de esa misma imagen. HEALTHCHECK con `scripts/humo.mjs`.
  - `GET /api/salud` llama a `opsrun.opsrun_health()` como `opsrun_app`; da 503 sin el texto del error.
  - `scripts/servidor/opsrun.sh` (`construir`, `deploy`, `vuelta-atras`, `estado`): imagen `opsrun:<sha>`, revisión del entorno dentro de la imagen con las reglas de `entorno.ts` (`scripts/verificar-entorno.mjs`), migraciones como `opsrun_migrador` en un contenedor aparte que es el único que ve su secreto, cambio de contenedor, prueba de humo y vuelta sola a la anterior si falla. Bitácora `deploys.log` por entorno. Contenedor de solo lectura, sin capacidades y con techo de memoria.
  - `scripts/migrar.mjs` lee la conexión del migrador de un archivo (`OPSRUN_MIGRADOR_SECRETS_FILE`) si no está en el entorno.
  - `pnpm test:deploy` (`scripts/servidor/prueba-ciclo.sh`) prueba el ciclo contra el Supabase local: deploy, versión B, deploy roto que vuelve solo, entorno con una variable prohibida y vuelta atrás. Job nuevo en CI.
  - Runbook en `docs/runbook-servidor.md`.
  - En local pasan `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db` (11 archivos, 148 tests) y `pnpm test:deploy` con la imagen construida en local.

## Pendiente
- `.env.example`: lo crea Henry. Los permisos del agente bloquean cualquier archivo `.env*`. Los nombres están en `PLAN.md` §3 (los `SUPABASE_*` ya no se usan).
- Con el equipo de BzzzBX: cómo se aplican las migraciones en la caja (`scripts/migrar.mjs` como `opsrun_migrador` u otro mecanismo), cómo llega la clave de `opsrun_app` al archivo de secretos y el límite de conexiones de `opsrun_app` (el pool abre hasta 4).
- Protección de la rama `main`.
- OPR-1 en el servidor de PINCH: preparar las carpetas de staging y producción y correr el primer deploy (lo hace Henry, `docs/runbook-servidor.md`). Antes, con el equipo de BzzzBX: la red del contenedor hasta Postgres y GoTrue, las claves de `opsrun_app` y `opsrun_migrador`, y si staging usa otra base.
- La entrada desde fuera (TLS y proxy delante del puerto local de cada entorno): es de opsRUN y no está hecha.
- Leer el Release Definition, el User Guide y el prototipo R23 cuando estén en Relevo.
- Confirmar con Federico las dependencias de `PLAN.md` §5.

## Bloqueado
- OPR-6 (contrato de BzzzBX): bloquea casi todo P1, incluido el despliegue de OPR-1.
- OPR-2 (método de login): bloquea OPR-21 y, por ella, OPR-23.

## Siguiente paso
- Con la CI en verde, Henry revisa el PR de OPR-1 (imagen y deploy) y decide si se fusiona. Después, cuando llegue la red de OPR-6, el primer deploy a staging con el runbook.

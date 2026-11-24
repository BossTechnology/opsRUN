# ESTADO.md

> Actualizar al cerrar cada sesión. Es lo primero que lee la siguiente.

## Tarea actual
- OPR-20: spec y ADR 0001 ajustados a la ADR 0003 (Supabase de la caja) y a las convenciones de las vecinas de Bzzz (D77 §2.8). La migración espera el PR de OPR-1 con la conexión directa y el script que imita el alta de Bzzz en local y en CI. La parte de servidor de OPR-1 (staging y producción) espera la red de OPR-6.

## Hecho
- 2026-11-24: base de documentos creada a partir de las 43 tarjetas del proyecto OPR en Relevo. Commit `e029ca1` en `main`.
- 2026-11-24: OPR-1 local. Next.js 16 (App Router, TypeScript estricto) con pnpm y Node 22; Supabase local con la CLI como dependencia (puertos 58320–58329); migración `public.opsrun_health()`; página de inicio que muestra la salud de la base; pgTAP (salud y guard de RLS que descubre las tablas), Vitest y un E2E de Playwright; `pnpm local` levanta todo en un comando; CI en GitHub Actions. Stack de tests confirmado en `PLAN.md` §2.
- En local pasan `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db` (10 tests) y `pnpm test:e2e`, y `pnpm local` sirve la página conectada a su base.
- CI del PR en verde (run 45426026175): lint + typecheck + Vitest, pgTAP (2 archivos, 10 tests) y Playwright (1 E2E).
- El guard de RLS se acota a las tablas cuyo dueño es el rol de las migraciones (en la primera corrida del CI marcaba tablas de pg_catalog y de Supabase) y se ve fallar en cada corrida: crea una tabla de prueba sin RLS en `public` y comprueba que la detecta. También se vio en rojo en local con una tabla real sin RLS (y en verde al quitarla).

- 2026-11-24: PR #1 (OPR-1 local) y PR #2 (spec y ADR 0001 de OPR-20) fusionados en `main` por orden de Henry, con la CI en verde.
- 2026-11-24: ADR 0002. opsRUN corre en el mismo servidor que BzzzBX, al lado de la caja y no dentro, con repo, Supabase, deploy y vuelta atrás propios. Confirma lo que ya decía OPR-1; el spec de OPR-20 (tablas en `public` de su propio Supabase) no cambia.

- 2026-11-24: OPR-20 ajustado a la ADR 0003. Esquemas `opsrun`, `opsrun_private` y `opsrun_writeback`; roles `opsrun_app` (lee y ejecuta funciones) y `opsrun_writeback_reader`. El servidor fija el actor de cada transacción (`opsrun.auth_user_id` o `opsrun.system_actor`). RLS de respaldo con una sola política para `opsrun_app`. Los guards G2 a G12 quedan acotados a los esquemas y roles `opsrun*`. Henry eligió las cuatro opciones recomendadas.
- 2026-11-24: OPR-20 alineado con D77 §2.8 (PR #5). El lector del write-back es `bzzz_writeback_opsrun`, rol de la caja, que reemplaza a `opsrun_writeback_reader`. El dueño de esquemas y migraciones es `opsrun_migrador`. Esquemas y roles los crea el alta de opsRUN en Bzzz; las migraciones solo crean objetos y conceden dentro de `opsrun*`. En local y en CI los imita un script de prueba que construye OPR-1. G3 no busca al lector por nombre: todo rol ajeno con privilegios en `opsrun*` solo puede tener USAGE en `opsrun_writeback` y SELECT en sus vistas `v1_*`.
- 2026-11-24: G3 exige además a lo sumo un rol ajeno con privilegios en `opsrun*` (aprobado por Henry), para que un SELECT de más a `authenticated` no pase. Un segundo lector de BzzzBX hace fallar G3 a propósito y pide una decisión explícita.
- La migración de OPR-20 (con el modelo anterior, en `public`) está escrita y sin correr en la rama local `opr-20-migracion-modelo-de-datos`; se adapta al nuevo modelo cuando entre lo de OPR-1.

## Pendiente
- `.env.example`: lo crea Henry. Los permisos del agente bloquean cualquier archivo `.env*`. Los nombres están en `PLAN.md` §3, ahora con `SUPABASE_URL` (servidor, en tiempo de ejecución).
- Protección de la rama `main`.
- OPR-1 en el servidor de PINCH: Supabase autohospedado, staging y producción, comando único de deploy y vuelta atrás, secretos en el servidor, migraciones aplicadas desde el repo y `opsrun_health()` como prueba de humo tras cada deploy.
- Leer el Release Definition, el User Guide y el prototipo R23 cuando estén en Relevo.
- Confirmar con Federico las dependencias de `PLAN.md` §5.

## Bloqueado
- OPR-6 (contrato de BzzzBX): bloquea casi todo P1, incluido el despliegue de OPR-1.
- OPR-2 (método de login): bloquea OPR-21 y, por ella, OPR-23.

## Siguiente paso
- Cuando se fusione OPR-1 (`opr-1-conexion-directa`): rebasar `opr-20-migracion-modelo-de-datos` sobre `main`, adaptar la migración y los guards al spec ajustado, correrlos y abrir el PR de la migración.

# ESTADO.md

> Actualizar al cerrar cada sesión. Es lo primero que lee la siguiente.

## Tarea actual
- OPR-1, parte local (rama `opr-1-repo-y-servidor`, PR en borrador contra `main`). La parte de servidor (staging y producción) espera la red de OPR-6.

## Hecho
- 2026-11-24: base de documentos creada a partir de las 43 tarjetas del proyecto OPR en Relevo. Commit `e029ca1` en `main`.
- 2026-11-24: OPR-1 local. Next.js 16 (App Router, TypeScript estricto) con pnpm y Node 22; Supabase local con la CLI como dependencia (puertos 58320–58329); migración `public.opsrun_health()`; página de inicio que muestra la salud de la base; pgTAP (salud y guard de RLS que descubre las tablas), Vitest y un E2E de Playwright; `pnpm local` levanta todo en un comando; CI en GitHub Actions. Stack de tests confirmado en `PLAN.md` §2.
- En local pasan `pnpm lint`, `pnpm typecheck` y `pnpm test`.

## Pendiente
- Correr en local `supabase test db` y `pnpm test:e2e`: la VM de Docker se quedó sin espacio al bajar la imagen de Postgres. Liberar espacio lo decide Henry. Mientras, el CI del PR los corre.
- Ver fallar una vez el guard de RLS (`supabase/tests/database/rls.test.sql`) creando una tabla sin RLS, como pide el principio 8.
- `.env.example`: lo crea Henry. Los permisos del agente bloquean cualquier archivo `.env*`. Los nombres están en `PLAN.md` §3, ahora con `SUPABASE_URL` (servidor, en tiempo de ejecución).
- Protección de la rama `main`.
- OPR-1 en el servidor de PINCH: Supabase autohospedado, staging y producción, comando único de deploy y vuelta atrás, secretos en el servidor, migraciones aplicadas desde el repo y `opsrun_health()` como prueba de humo tras cada deploy.
- Leer el Release Definition, el User Guide y el prototipo R23 cuando estén en Relevo.
- Confirmar con Federico las dependencias de `PLAN.md` §5.

## Bloqueado
- OPR-6 (contrato de BzzzBX): bloquea casi todo P1, incluido el despliegue de OPR-1.
- OPR-2 (método de login): bloquea OPR-21 y, por ella, OPR-23.

## Siguiente paso
- Con Docker con espacio: `pnpm db:start`, `pnpm test:db`, `pnpm test:e2e`, ver fallar el guard de RLS y pasar el PR de OPR-1 a listo.
- OPR-20 (modelo de datos) en local, encima de esta base.

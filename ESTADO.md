# ESTADO.md

> Actualizar al cerrar cada sesión. Es lo primero que lee la siguiente.

## Tarea actual
- OPR-26, Job window: spec `docs/spec/opr-26-job-window.md` aprobado por Henry el 2026-11-27 (P-1 a P-6, con P-2 endurecida). Implementada en la rama `opr-26-job-window-impl` (PR contra `main`, sin fusionar: lo fusiona Henry). El PR #13 (solo el spec) sigue sin fusionar.
- OPR-27, conversación: spec `docs/spec/opr-27-conversacion.md` aprobado por Henry el 2026-11-27 (P-0 a P-7). Implementada en la rama `opr-27-conversacion` (PR contra `main`, sin fusionar).
- OPR-25, tablero y tarjetas (PR #11): fusionado en `main`. El prototipo R23 no se pudo abrir: el aspecto sigue supuestos.
- OPR-28, Fase A: enlace request ↔ job observado (PR #12): fusionado en `main`, sin pantalla todavía.
- OPR-22, stand-ins de BzzzBX (PR #9): fusionado en `main`.
- OPR-1, imagen y deploy (PR #8): fusionado en `main`. El primer deploy en el servidor de PINCH espera la red de OPR-6.

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
- 2026-11-24: OPR-22, stand-ins de BzzzBX. Spec `docs/spec/opr-22-stand-ins.md` y ADR 0005, provisionales hasta OPR-6 y escritos contra el Runbook 1.1 (en Relevo).
  - Puertos en `src/lib/bzzzbx/`. Lectura: 13 proyecciones con crosswalk ID y versión, `buscarJobs` para la Fase A y cambios por cursor (sondeo; el realtime solo lo despierta). Instrucciones: `entregar` idempotente, los pasos del Runbook §7.1 y cierre confirmada, fallida o sin confirmar.
  - Falso en memoria con datos inventados y los mismos crosswalk IDs que la seed. Deja forzar errores (también con `__forzar_error` en el payload), simular cambios en el origen, pedir aprobación y reconstruir.
  - `BZZZBX_MODO`: `falso` por defecto fuera del servidor y `real` en el servidor, donde `falso` no deja arrancar. El real no existe todavía.
  - Pruebas de contrato que reciben la implementación: corren contra el falso y, con `BZZZBX_CONTRATO_REAL=1`, contra el real (hoy fallan a propósito).
  - La seed ya no arma `bx-job-`, `bx-msg-`, `bx-thread-` ni el job number con el R number, que en una base usada no empieza en 1: salen del id fijo de cada request. Verificado en una base temporal local.
  - En local: lint, typecheck, Vitest y `pnpm test:db` (11 archivos, 148 pruebas) en verde.
- 2026-11-24: OPR-25, tablero y tarjetas:
  - `/` es el tablero. Barra superior con un marcador de logo, Live, Alerts con el conteo de toda la operación, Alarms, Anomalies y Actions en gris, y el filtro de operador (Only me espera a OPR-21). En el riel, Rosie activa y Observe, Geo, Incidents, Activity y Map en gris con "Available in a later release".
  - Cinco columnas con conteo y alertas abiertas. La etapa sale de OPR-20 §5; los jobs cancelados no aparecen; las Paid van en una fila colapsada de Validation.
  - Las tarjetas muestran nombre y número, estado bajo el número (Delayed parpadea), ciudad, type | service con ícono, chat, flags PO, PO missing y OSS, y los colores: verde, sombreado rojo, borde rojo y oscura. Lo que falta se ve "— —".
  - Server components: opsRUN por `opsrun_app` y BzzzBX por su puerto. Con BzzzBX caído se muestra lo último conocido, en memoria, con aviso.
  - El navegador pregunta cada 15 s a `/api/tablero/cambios`, que junta `cambiosDesde` con el último Audit, y refresca si hubo cambio.
  - `POST /api/falso` controla el stand-in desde los E2E (404 sin falso o en el servidor). La página de salud pasa a `/salud`. Variable nueva `OPSRUN_ZONA_HORARIA`.
  - En local pasan lint, typecheck, Vitest (194) y `next build`; el servidor de producción sirve el tablero contra el Postgres local. Playwright no corrió en local: el Supabase local solo tiene Postgres (Docker saturado) y su seed es anterior al arreglo de crosswalk IDs de OPR-22. E2E y la consulta contra la seed, en la CI.

- 2026-11-25: OPR-28, Fase A, enlace request ↔ job observado:
  - `buscarJobs` exige cliente o propiedad y un rango de fechas de hasta 62 días, y devuelve hasta 50 jobs ordenados (`FiltroInvalido` si no). Pruebas de contrato para el falso y el real. El falso trae cuatro jobs de la Fase A sin request (`bx-job-0102` a `0105`); la seed no cambia.
  - `src/lib/fase-a/`: `proponerEnlaces` busca con el borrador (propiedad o, si no, cliente; fecha ± 3 días o, sin fecha, desde el día antes de la llegada hasta 30 días después), quita cancelados, jobs de otras requests y rechazados para esa request, ordena, marca Suggested y avisa con `truncado` si BzzzBX llegó al tope. No guarda propuestas. Una carrera entre dos operadores sobre el mismo job sale como `job_ya_enlazado`. `confirmarEnlace` relee el job en BzzzBX y llama a la base; `rechazarEnlace` deja el rechazo.
  - Migración `20261125120000_fase_a_enlace.sql`: `opsrun.link_observed_job` (deja la request Scheduled con el gate de Schedule y `request_scheduled` con `mode: "linked"`) y `opsrun.reject_job_link` (`job_link_rejected`, motivo opcional). Sin instrucción a BzzzBX.
  - pgTAP `fase_a_enlace.test.sql` (27). G6 y la prueba nueva se vieron en rojo quitando `require_operator()`. Prueba de punta a punta contra la seed (`OPSRUN_REQUIERE_BASE=1`) dentro de una transacción que se deshace.
  - Validado en local en una base temporal del Supabase local (alta, migraciones y seed): los pgTAP en verde salvo `roles.test.sql`, que pide el esquema `auth` que una base vacía no tiene; Vitest de punta a punta en verde. lint, typecheck y `pnpm test` en verde. `supabase test db` completo, en la CI.

- 2026-11-27: OPR-26, Job window (rama `opr-26-job-window-impl`):
  - Ruta `/job/[requestId]` con ruta interceptada `@ventana/(.)job/[requestId]` (P-1): la tarjeta del tablero es un enlace y la ventana se abre encima; Esc, ✕ o atrás vuelven sin recargar. La recarga y la URL directa abren la página completa, con "Board". Con Cache Components, Next deja oculta (no desmontada) la ventana que se cerró.
  - `src/lib/ventana/`: `armarVentana` (pura; saca etapa, nombre y estado de `armarTablero`), consultas de solo lectura de §8.1 (una transacción), lectura de BzzzBX con presupuesto de 1,5 s y memoria por request (`leerVentanaDeBzzzbx`), `propuestaParaLaVentana` para la ranura del enlace. Sin migración.
  - `src/lib/acciones/`: registro de las acciones de §5.3, `disponibilidadDe` (los cinco valores) y `ejecutar` (el único camino; recalcula la disponibilidad, valida el motivo y la versión, y llama al ejecutor con el actor). Todas las de V1.1 beta salen `sin_construir`; Reject · re-clean, `fuera_de_release`. La Server Action `ejecutarAccion` está en `src/app/_ventana/acciones.ts`.
  - UI en `src/app/_ventana/`: encabezado, pestañas (tablist accesible, estado en el cliente y `?tab=` con `history.replaceState`), action bar con panel, franja de BzzzBX caído, sondeo (mismo `/api/tablero/cambios`) y las ranuras con su contrato en `src/lib/ventana/ranuras.ts`.
  - P-6: `Job.price` opcional en el puerto y en el falso (con prueba de contrato). P-3: R7 en la seed (dueño, las tres confirmaciones) y `bx-job-0107` en el falso. P-2: selector "Acting as" con las tres condiciones, `OPSRUN_ACTOR_DEMO` en `PROHIBIDAS_EN_SERVIDOR` y `auth_user_id` inventados en la seed.
  - Pruebas: Vitest nuevos (`armar`, disponibilidad, `ejecutar`, `leer`, consultas contra la seed, actor de demo, componentes) y Playwright A1 a A16 (`e2e/job-window.spec.ts`; A15 queda `fixme` hasta que OPR-28 ponga la ranura). Cada guard de P-2 y el de `ejecutarAccion` se vieron fallar quitando su condición.
  - En local: lint, typecheck y Vitest (sin `pool.test.ts`, que se deja a la CI) en verde; Playwright A1 a A16 y las del tablero contra el build de producción y una base temporal (alta, migraciones y seed nueva); pgTAP contra esa base, todos en verde salvo `roles.test.sql`, que pide el esquema `auth` que una base temporal no tiene.

- 2026-11-27: OPR-27, conversación (rama `opr-27-conversacion`):
  - Migración `20261130120000_conversacion.sql`, solo funciones: `add_note`, `send_email`, `send_text`, `discard_ai_draft` (del operador) y `record_instruction_delivery`, `resolve_instruction` (del sistema). Un envío guarda la instrucción `pending` con solo el crosswalk ID (hilo o equipo) y el cuerpo; el borrador de IA se decide `accepted` o `corrected` en la misma transacción. pgTAP `conversacion.test.sql` (103); los guards G5/G6/G7 las descubren solas y se vieron fallar quitando `require_operator()`/`require_system()`.
  - Ranura de la conversación en `src/app/_conversacion/` (hilo, Composer, borradores de IA) y su lectura en `src/lib/conversacion/`; despacho mínimo en `src/lib/instrucciones/` (entregar y reconciliar `send_*`, a lo sumo cada 5 s por proceso, desde `/api/tablero/cambios`). El registro de acciones gana `concurrencia: "request" | "ninguna"` (P-6) y `ejecutarAccion` rechaza `to`, `cc` y `from_number`.
  - El falso acepta `send_email` con `bzzzbx_thread_id` y `send_text` con `bzzzbx_team_id` y resuelve él los destinatarios (P-2); `/api/falso` gana `forzar_error`. La seed trae borradores de IA en R2 y R7 (P-3).
  - Guard "nada sale solo": una prueba descubre en `src/**` quién puede enviar y falla si no es el Composer o su ejecutor.
  - En local (base temporal propia): lint, typecheck, Vitest, pgTAP y Playwright C1 a C12 (C11 sin hilo, solo en Vitest: la seed no trae una request sin hilo de correo).

## Pendiente
- OPR-25: revisar el tablero contra el prototipo R23 (P-0 del spec) y ajustar los supuestos S-1 a S-6.
- Base local: `pnpm db:reset` para cargar la seed nueva, con R7 y los `auth_user_id` de demo (pide OK de Henry). Sin eso, la demo local no tiene R7 ni operadores que puedan actuar.
- OPR-26: revisar la Job window contra el prototipo R23 (S-1 del spec). Supuestos que tomó la implementación (ver el PR): 404 con estado HTTP 200 al ser streaming, A5 de R1 sigue el §4.1 (pestaña "4B"), `motivo: "no"` oculta el campo Reason, A7 entrega el clic al manejador de React porque React ignora los clics sobre un botón `disabled`.
- Fase A (OPR-28): botones de enlace en la Job window cuando exista OPR-26; deshacer un enlace queda para OPR-29 (P-4). Los supuestos S-1 a S-5 del spec se revisan con OPR-6 y el User Guide.
- `pool.test.ts` aplica las migraciones pendientes al Supabase local compartido cuando corre `pnpm test` con una migración nueva: la base local queda con una migración que otras ramas no tienen en disco, y `migrar` las rechaza hasta fusionar o hacer `pnpm db:reset`. Pasó con `20261125120000_fase_a_enlace`; el 2026-11-25 se reseteó la base local y se preparó con las migraciones de `main`. Hasta fusionar el PR de OPR-28, correr `pnpm test` en esta rama la vuelve a aplicar.
- OPR-22, con el equipo de BzzzBX (Henry ya decidió P-0 a P-4, spec §9): que confirme por escrito en OPR-6 el transporte de lectura (vistas por HTTP, P-1) y de dónde sale el aviso de cambios, y si soporta `end_job_manually` (P-3).
- OPR-22, cuando toque: `acknowledge_alert` al construir Clear alert; quitar los `ai_*` del catálogo con una migración nueva (pide OK); cambiar la migración de estados solo si una pantalla necesita "Waiting for approval" o "Couldn't confirm" desde la base (P-2).
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
- Henry revisa y fusiona el PR de OPR-27. Encender el envío en la Fase A se decide cuando OPR-6 confirme `send_email` y `send_text` (P-5).
- Henry revisa y fusiona el PR de OPR-26 (y el #13 del spec). Después, los botones del enlace (OPR-28), la conversación (OPR-27) y Audit (OPR-35) se enchufan en las ranuras de `src/app/_ventana/ranuras.tsx`; cada tarjeta de etapa agrega su `ejecutor` a `src/lib/acciones/registro.ts`.
- Demo del lunes: `pnpm db:reset` (con OK de Henry), `pnpm local` y en la Job window elegir "Acting as".
- Henry comparte el prototipo R23 para ajustar el aspecto del tablero.
- OPR-1: cuando llegue la red de OPR-6, el primer deploy a staging con `docs/runbook-servidor.md`.

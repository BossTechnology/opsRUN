# 0003 — opsRUN usa el Supabase de la caja, en su propio esquema y con su propio rol

- **Fecha:** 2026-11-24
- **Estado:** aceptada por Henry. Reemplaza la parte de la ADR 0002 que daba a opsRUN un Supabase propio
- **Tarjetas:** OPR-1, OPR-2, OPR-20, OPR-24

## Contexto
La ADR 0002 dejó a opsRUN al lado de la caja de BzzzBX, en el mismo servidor, con repo, Supabase, deploy y vuelta atrás propios. El mismo día Henry fijó una regla para todas las apps de Boss que corren al lado de la caja (BOb, opsRUN y las que vengan): todas usan el Supabase que ya corre en el servidor, el de la caja, cada una en su esquema y con sus roles.

El Supabase de la caja tiene dos reglas que opsRUN hoy no cumple:
- solo expone la base y GoTrue (Auth); no tiene PostgREST;
- no se permite la service role en ningún contenedor.

opsRUN hoy usa supabase-js con `SUPABASE_SECRET_KEY` (PostgREST con poder de service role) en una sola llamada (`rpc("opsrun_health")`), y el diseño de OPR-20 pone sus tablas en `public` y deja las escrituras del sistema a `service_role`.

## Opciones consideradas
1. **Supabase de la caja con conexión directa a Postgres y un rol propio de mínimo privilegio.** Lo que ya hizo bob-web con `bob_app` y el esquema `bob`.
2. **Supabase de la caja, pero agregando PostgREST a la caja.** Exige una decisión aparte en BzzzBX y abre otra superficie.
3. **Mantener el Supabase propio de la ADR 0002.**

## Decisión
La opción 1, confirmada por Henry:

- **Dónde corre la app:** sin cambios frente a la ADR 0002. Al lado de la caja, en el mismo servidor, con repo, deploy y vuelta atrás propios.
- **Base:** el Postgres del Supabase de la caja. Todo lo de opsRUN vive en el esquema `opsrun` y, para lo que no debe verse desde fuera, en `opsrun_private`. Nada en `public`, que es de Supabase.
- **Conexión:** el servidor de Next se conecta directo a Postgres con un rol propio, `opsrun_app`, de mínimo privilegio y solo sobre sus esquemas. Sin PostgREST, sin supabase-js para datos, sin service role.
- **Identidad:** los operadores entran con el GoTrue de la caja, compartido con las demás apps. El servidor de opsRUN valida la sesión contra GoTrue y pasa el operador a la base en cada transacción. El método concreto y la lista de usuarios siguen siendo de OPR-2.
- **Write-back (OPR-24):** las vistas `opsrun.writeback_v1_*` (o un esquema `opsrun_writeback`) con el rol de solo lectura `bzzzbx_reader`, ahora dentro de la misma base que la caja.
- **Migraciones:** siguen en este repo y se aplican con un rol dueño de los esquemas de opsRUN que no puede tocar los de las demás apps. Cómo se aplican en la caja se acuerda con BzzzBX.
- **Local:** sin cambios. Cada repo levanta su Supabase local para desarrollar y probar, con los mismos esquemas y roles que en la caja.

## Consecuencias
- **Se gana:**
  - una sola base y una sola identidad por servidor para todas las apps de Boss;
  - el write-back se lee en la misma base, sin cruzar la red;
  - se reusa lo que bob-web ya resolvió: rol propio, conexión directa, sesión contra GoTrue.
- **Se pierde:**
  - opsRUN depende de la base de la caja: sus backups, sus subidas de versión y su disponibilidad;
  - el modelo de RLS para `authenticated` de OPR-20 cambia: el navegador ya no habla con la base, y el actor lo fija el servidor;
  - hay que reescribir el cliente de OPR-1 y la parte de escrituras y guards de OPR-20 antes de migrar.
- **Qué cambiar:**
  - OPR-1: cambiar el cliente supabase-js con llave secreta por un pool de Postgres con `opsrun_app`; mover `opsrun_health()` a `opsrun`; acotar el guard de RLS a los esquemas de opsRUN;
  - OPR-20: el spec y la ADR 0001 pasan de `public`, `private` y `service_role` a `opsrun`, `opsrun_private` y `opsrun_app`; los guards prueban también que `opsrun_app` no llega a los esquemas de otras apps;
  - `PLAN.md` §2 y §3, y las variables de entorno.
- **Qué vigilar:**
  - que ningún rol de opsRUN herede de `authenticated`, `service_role` ni `postgres`;
  - que los nombres de esquemas y roles no choquen con los de BOb y los de la caja;
  - la carga: todas las apps comparten el mismo Postgres.

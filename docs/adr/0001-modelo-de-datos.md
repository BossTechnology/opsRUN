# 0001 — Modelo de datos de opsRUN

- **Fecha:** 2026-11-24
- **Estado:** propuesta. Ajustada a la [ADR 0003](0003-supabase-de-la-caja.md): esquemas `opsrun`, `opsrun_private` y `opsrun_writeback` en el Supabase de la caja, con dueño `opsrun_migrador`, el rol `opsrun_app` y el lector de la caja `bzzz_writeback_opsrun`. Nombres según las convenciones de las vecinas de Bzzz (D77 §2.8): los esquemas y los roles los crea el alta de opsRUN en Bzzz, y las migraciones solo crean objetos y conceden dentro de lo suyo
- **Tarjeta:** OPR-20

## Contexto
opsRUN guarda solo lo suyo y apunta a lo de PINCH con IDs de BzzzBX (principio 1 de `PLAN.md`). Toda acción sale como instrucción a BzzzBX (principio 2). Las IAs proponen y el operador confirma (principio 3). Todo queda en Audit (principio 5).

Hay que fijar un esquema que cumpla eso cuando todavía faltan decisiones que lo afectan:

- el método de login (OPR-2);
- el contrato de BzzzBX (OPR-6);
- la forma del write-back (D-2, OPR-24);
- qué acciones de las etapas Complete y Validation se escriben en la base de PINCH.

El detalle está en [`docs/spec/opr-20-modelo-de-datos.md`](../spec/opr-20-modelo-de-datos.md).

## Opciones consideradas
1. **Request → job:** una sola fila `request` que gana el crosswalk del job al programarse, *o* una tabla de vínculo que permita varios jobs por request.
2. **Etapa del tablero:** columna `stage` guardada, *o* etapa calculada con los hechos de opsRUN y el estado del job en BzzzBX.
3. **Audit:** solo lo que pasa en opsRUN, mezclado con los eventos de PINCH al mostrar, *o* una tabla única donde opsRUN también anota los hechos de PINCH que observa.
4. **Historial de alertas:** solo la resolución, *o* la ocurrencia completa con motivo, nivel y tiempos.
5. **IA:** borrador jsonb con la procedencia por campo, *o* columnas tipadas del borrador más una tabla de sugerencias con decisión.
6. **Usuarios:** `auth.users` con metadata, *o* tabla `operator` propia enlazada al login.
7. **Conversación:** copia del cuerpo y del estado de entrega, *o* solo el vínculo mensaje→request más las notas.
8. **Escrituras:** directas desde el navegador con RLS y triggers, *o* solo por funciones SQL que escriben el dato y su Audit juntos.
9. **Write-back:** tabla outbox que se empuja a BzzzBX, *o* vistas versionadas con un rol de solo lectura y cursores.

## Decisión
Se eligió, con el equipo, en este orden:

1. **Una fila por request, que se vuelve job.** En V1.1 beta una request da un job: cuando la IA detecta varios, solo avisa que se reserven aparte. Una tabla de vínculo agregaría un join a cada pantalla sin un caso que lo pida.
2. **La etapa se calcula; no hay columna `stage`.** opsRUN guarda sus hechos (`status`, `ended_manually_at`, `approved_at`) y BzzzBX da el check-in, el fin y Paid. Una etapa guardada se desincronizaría con los sistemas de PINCH, que son los dueños del job.
3. **Audit es una tabla única, append-only, que también anota lo observado.** Cuando la read layer ve un check-in, un fin o un Paid, escribe un evento `bzzzbx_observed` con solo el tipo, la hora y el crosswalk ID. El Audit queda completo e inmutable aunque BzzzBX no guarde historial, y viaja entero por el write-back. La inmutabilidad la imponen triggers que frenan a todos los roles, también a `opsrun_app`, a `opsrun_migrador` y a los superusuarios.
4. **Cada ocurrencia de alerta se guarda completa.** Se guardan la regla y su versión, el nivel, el motivo tal como llegó, la hora de apertura y la de resolución, y quién y cómo la resolvió. Resolved, el tiempo abierta y las repeticiones no dependen de BzzzBX. El motivo es la única columna marcada `bzzzbx-snapshot`: es un resultado calculado, no un dato del negocio.
5. **Borrador tipado más `ai_suggestion` con decisión.** El gate de Schedule y las validaciones necesitan tipos y constraints. Un campo está AI-marked mientras su sugerencia principal no tiene decisión, y confirmar o corregir anota quién, cuándo y el valor final.
6. **Tabla `operator` con `auth_user_id` opcional.** Audit y Assigned to apuntan a un id que no depende del método de login, así que OPR-2 se puede decidir sin migrar datos. Los roles, si llegan, van en una tabla aparte. Con la ADR 0003, `auth_user_id` es el usuario del GoTrue de la caja: el servidor valida la sesión y fija el actor en cada transacción (`opsrun.auth_user_id` para un operador, `opsrun.system_actor` para el sistema). La base no lee el esquema `auth`.
7. **De la conversación solo se guarda el vínculo y las notas.** El cuerpo, los adjuntos y el estado de entrega se leen de BzzzBX. El `bzzzbx_message_id` único es también la deduplicación de la intake.
8. **Escrituras solo por funciones SQL.** Ningún rol, salvo el dueño (`opsrun_migrador`), escribe directo en las tablas; `opsrun_app` solo lee y ejecuta funciones, que son `security definer` con dueño `opsrun_migrador`. Cada función valida el actor (`require_operator()` o `require_system()`), exige el motivo cuando aplica y escribe el dato y su `audit_event` en la misma transacción. Así no hay forma de actuar sin dejar Audit.
9. **Vistas `opsrun_writeback.v1_*` con el rol `bzzz_writeback_opsrun`.** El rol es de la caja y lo crea el alta en Bzzz; la migración de opsRUN solo le concede USAGE en `opsrun_writeback` y SELECT en sus vistas. Las tablas llevan cursores (`audit_event.id`, `change_seq`). Sirven para la consulta directa y para un pipeline, así que D-2 se puede decidir sin cambiar el esquema. Con la ADR 0003 están en la misma base que la caja, y ese rol es la única puerta de BzzzBX a los datos de opsRUN. Los guards no lo buscan por nombre: todo rol ajeno con privilegios en los esquemas de opsRUN debe limitarse a eso.

Mientras Federico confirma si se escriben en PINCH, Approve & confirm, End manually y Mark as OSS se diseñan como hechos de opsRUN. La caché de lectura queda fuera: la decide OPR-22, y si se persiste va en un esquema aparte y no autoritativo.

## Consecuencias
- **Se gana:**
  - un solo lugar para Audit, para Rosie y para el write-back;
  - el login y D-2 se pueden decidir sin migrar;
  - los guards pueden probar que nadie escribe sin dejar Audit y que ninguna columna entra sin declarar su dueño (G9).
- **Se pierde:**
  - opsRUN repite la hora de los hechos de PINCH en Audit. Se acepta porque es el registro de lo que opsRUN vio, no la fuente; si difiere de PINCH, manda PINCH;
  - cada acción nueva necesita su función SQL, lo que agrega trabajo frente a escribir directo desde la app;
  - abrir un job depende de que BzzzBX responda rápido, porque la conversación no está copiada (meta de 2 s de OPR-26).
- **Qué vigilar:**
  - que `audit_event.details` y `instruction.payload` no empiecen a cargar datos de PINCH. Es una regla de revisión: el esquema no la puede imponer sobre jsonb;
  - las respuestas de Federico (spec §11), que pueden mover OSS, Approve y End manually a instrucciones;
  - si alguna vez una request da varios jobs, esta ADR se reemplaza.

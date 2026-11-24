# OPR-20 — Modelo de datos de opsRUN

- **Tarjeta:** OPR-20 (P1 · Data model and opsRUN store)
- **Estado:** spec para revisión, ajustado a la [ADR 0003](../adr/0003-supabase-de-la-caja.md): opsRUN usa el Supabase de la caja, en sus propios esquemas y con sus propios roles, según las convenciones de las vecinas de Bzzz (D77 §2.8). Los esquemas y los roles los crea el alta de opsRUN en Bzzz, no las migraciones. La migración se escribe cuando OPR-1 deje la conexión directa y el script que imita el alta en local y en CI (§2).
- **Decisiones:** [ADR 0001](../adr/0001-modelo-de-datos.md), [ADR 0003](../adr/0003-supabase-de-la-caja.md)
- **Tarjetas que guardan datos aquí:** OPR-15, OPR-17, OPR-18, OPR-19, OPR-21, OPR-23, OPR-24, OPR-26 a OPR-32, OPR-34 a OPR-37.

## 1. Alcance

Este spec define el esquema de Supabase para **lo que es de opsRUN**, según el principio 1 de `PLAN.md`:

- requests con R number, su estado, el dueño y las reasignaciones;
- confirmaciones (details, sender, cleaner) y las preguntas al cleaner;
- notas internas;
- instrucciones a BzzzBX (acciones del operador con su motivo);
- historial de alertas: abierta, resuelta, por quién y cómo;
- Audit;
- análisis y sugerencias de IA, con las correcciones del operador;
- operadores;
- plantillas de mensajes.

Lo que es de PINCH (clientes, contactos, propiedades, espacios, servicios, equipos, jobs, mensajes, fotos, tiempos del Job Tracker, PO del job, Paid) **no se guarda**: se apunta con un *crosswalk ID* de BzzzBX y se lee por la read layer (OPR-22).

Fuera de alcance:

- la caché de lectura de OPR-22 (ver §10);
- las conversaciones con Rosie;
- todo lo que no entra en V1.1 beta.

## 1.1 Dónde guarda cada pantalla lo suyo

| Pantalla (tarjeta) | Lo que es de opsRUN | Dónde |
|---|---|---|
| Board y cards (OPR-25) | R number, Assigned to, marca AI, etapa (calculada), conteos de alertas | `request`, `request_ai_marks`, `alert_occurrence`; §5 |
| Header del Job window (OPR-26) | Assigned to y barras de carga | `request.owner_operator_id`, `operator` |
| Action bar (OPR-26) | Acción, motivo y resultado | `instruction`, `audit_event` |
| Conversation y Composer (OPR-27, OPR-15 a OPR-19) | Vínculo mensaje→request, notas, envíos y su resultado, borradores de IA | `request_message`, `note`, `instruction`, `ai_suggestion` (`draft_*`), `message_template` |
| Tab de la propiedad / Requests (OPR-28) | Borrador de Job details, Who is it from?, Cleaner, confirmaciones, gate de Schedule | `request` (borrador), `request_confirmation`, `cleaner_confirmation`, `ai_suggestion` |
| Scheduled (OPR-29) | Reschedule con motivo y su Waiting, Cancel job con motivo, Delayed en Audit | `cleaner_confirmation` (`reschedule`), `instruction`, `alert_occurrence`, `audit_event` |
| Job tracker (OPR-30) | Clear alert con motivo, End manually | `alert_occurrence`, `request.ended_manually_*`, `audit_event` (los tiempos y fotos se leen de BzzzBX) |
| Complete (OPR-31) | Mark as OSS / Not OSS, Approve & confirm | `request.oss_*`, `request.approved_*` |
| Billing / Validation (OPR-32) | PO capturado y su envío, Validate | `instruction` (`write_po`, `record_validation`), `audit_event` (PO del job y Paid se leen de BzzzBX) |
| Alerts y Alerts de la barra superior (OPR-34) | Needs action, Waiting, Resolved, quién y cómo, repeticiones | `alert_occurrence`, `cleaner_confirmation` |
| Audit (OPR-35) | Todo evento, con persona y motivo | `audit_event` |
| Sign-in (OPR-21) | Operadores y su enlace al login | `operator` |
| Rosie (OPR-38) | Lo que lee de opsRUN | vistas `opsrun_writeback.v1_*` |

## 2. Convenciones

| Tema | Regla |
|---|---|
| Esquemas | `opsrun`: tablas, vistas de lectura y funciones de escritura que invoca `opsrun_app`. `opsrun_private`: helpers y triggers, que solo alcanza `opsrun_migrador`. `opsrun_writeback`: vistas `v1_*` para BzzzBX (§7). Nada en `public`, que es de Supabase (ADR 0003). Los tres esquemas los crea el alta de opsRUN en Bzzz, con dueño `opsrun_migrador`; la migración no ejecuta `create schema`. "De opsRUN" es todo esquema llamado `opsrun` o `opsrun_*`, y todo rol llamado `opsrun_*`. |
| Claves | `uuid` con `gen_random_uuid()` para entidades. `bigint generated always as identity` para `audit_event`, que sirve de cursor. |
| Crosswalk IDs | Columnas `bzzzbx_<entidad>_id text`. El formato lo fija OPR-6; mientras tanto, `text` sin suponer forma. Nunca se guarda el nombre, la dirección ni otro atributo de la entidad. |
| Tiempo | Todo instante es `timestamptz` en UTC. La fecha del servicio (`date`) y la ventana (`time`) son locales a la operación; la zona horaria la fija OPR-4. |
| Catálogos | Los tipos que crecen (eventos de Audit, instrucciones, campos de IA) son tablas catálogo con su seed en la migración, no `enum`. Los estados cerrados son `enum`. |
| Columnas comunes | `created_at timestamptz not null default now()`; `updated_at` y `change_seq` con trigger en las tablas mutables (§7). |
| Comentarios | Cada columna lleva `COMMENT` con su dueño: `opsrun`, `crosswalk` o `bzzzbx-snapshot`. Un guard lo exige (G9). |
| Nombres | Tablas en singular y `snake_case`. Los valores de producto en inglés, como los ve el operador. |

### Actor

Toda fila que registra "quién" usa el mismo par:

```
actor_kind          actor_kind not null       -- 'operator' | 'system' | 'ai' | 'bzzzbx'
actor_operator_id   uuid null references operator(id)
check ((actor_kind = 'operator') = (actor_operator_id is not null))
```

`system` es opsRUN actuando solo (por ejemplo, el aviso Scheduled automático). `ai` es una sugerencia o lectura de la IA. `bzzzbx` es un hecho observado en los sistemas de PINCH.

### Roles y actor de la transacción

El navegador nunca habla con la base: no hay PostgREST en la caja (ADR 0003). El servidor de Next se conecta directo a Postgres.

| Rol | Qué es | Qué alcanza |
|---|---|---|
| `opsrun_migrador` | Dueño de `opsrun`, `opsrun_private` y `opsrun_writeback` y de todo lo que contienen; aplica las migraciones. `LOGIN`, `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`, sin pertenecer a ningún rol y sin `CREATE` en la base. La credencial no está en el repo. | Sus esquemas. No toca los de otras apps ni los de Supabase. |
| `opsrun_app` | El servidor de Next. `LOGIN`, con los mismos atributos; la credencial no está en el repo. | `USAGE` en `opsrun`, `SELECT` en sus tablas y vistas, `EXECUTE` en sus funciones de escritura. Nada más. |
| `bzzz_writeback_opsrun` | Rol de la caja (los suyos empiezan por `bzzz_`): BzzzBX leyendo el write-back de opsRUN. Entra solo desde la red de la caja, nunca desde la de opsRUN. | `USAGE` en `opsrun_writeback` y `SELECT` en sus vistas `v1_*`, que concede la migración de opsRUN. Nada más. |
| `anon`, `authenticated`, `service_role`, roles de otras apps | De Supabase o de las demás apps de la caja. | Nada en los esquemas de opsRUN. |

Ningún rol de opsRUN pertenece a otro rol: no hereda de `authenticated`, `anon`, `service_role`, `postgres` ni de los roles de otras apps.

**Quién crea esquemas y roles.** El guion de la caja, a partir del alta de opsRUN en Bzzz, que declara sus esquemas y sus roles. Las migraciones de opsRUN no ejecutan `create schema` ni `create role`, así que no necesitan `CREATEROLE` ni `CREATE` en la base. Solo crean objetos dentro de `opsrun`, `opsrun_private` y `opsrun_writeback`, y conceden sobre ellos a `opsrun_app` y a `bzzz_writeback_opsrun`. Las funciones `security definer` quedan con dueño `opsrun_migrador`, así que no pueden más que él. opsRUN no necesita nada fuera de sus esquemas: ni disparadores en `auth`, ni `supabase_realtime`, ni grants a `authenticated`.

**En local y en CI no hay alta de Bzzz.** Un script de prueba de este repo la imita antes de las migraciones: crea los tres esquemas con dueño `opsrun_migrador` y los roles `opsrun_migrador`, `opsrun_app` y `bzzz_writeback_opsrun` con los atributos de arriba. Así las migraciones y los guards ven la misma base que en la caja. El script lo construye OPR-1, que también fija cómo se aplican las migraciones como `opsrun_migrador` en local.

La caja comprueba por su lado que los roles `opsrun_*` sean exactamente los declarados, que ninguno herede ni tenga `USAGE` en esquemas ajenos y que `opsrun_migrador` no cree nada fuera de lo suyo (V13 a V15 de Bzzz). Esas comprobaciones complementan los guards de §8; no los sustituyen.

**Actor de la transacción.** El servidor declara quién actúa, en cada transacción, con `set_config(…, true)` (vale solo para esa transacción):

- un operador: valida la sesión contra el GoTrue de la caja y fija `opsrun.auth_user_id` con el id del usuario;
- el sistema (intake, read layer, resultados de IA y de instrucciones): fija `opsrun.system_actor` con el nombre del proceso.

Nunca los dos a la vez. La base no confía en nada más: las funciones de escritura leen el actor de ahí y lo escriben en Audit.

## 3. Tablas

### 3.1 `operator` — usuarios de Operations y Finance (OPR-21)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | Id estable. Audit, Assigned to y los filtros apuntan aquí. |
| `auth_user_id` | uuid null unique | Usuario del GoTrue de la caja. Se enlaza al primer login, con cualquier método que decida OPR-2. Sin FK a `auth.users`: ese esquema es de Supabase y `opsrun_migrador` no lo alcanza. |
| `email` | text not null | Único sobre `lower(email)`. Sirve para enlazar el login; no sale por el write-back. |
| `display_name` | text not null | El nombre que se ve en Audit y en Assigned to. |
| `team` | `operator_team` enum (`operations`, `finance`) | Informativo. En V1.1 beta no cambia los permisos (propuesta por defecto de OPR-2). |
| `active` | boolean not null default true | Un operador se desactiva, nunca se borra (las FK son `restrict`). |

Si OPR-2 decide limitar acciones por rol, se agrega la tabla `operator_permission (operator_id, permission)` y un chequeo en las funciones de escritura. `operator` no cambia.

Helpers, en `opsrun_private` (solo los llaman las funciones de escritura, que corren como `opsrun_migrador`):

- `opsrun_private.current_operator_id()` (`stable`) devuelve el `id` del operador activo cuyo `auth_user_id` es `opsrun.auth_user_id`, o `null`.
- `opsrun_private.require_operator()` hace lo mismo, pero lanza error si es `null` o si la transacción también declara un actor de sistema.
- `opsrun_private.require_system()` devuelve `opsrun.system_actor` y lanza error si está vacío o si la transacción también declara un operador.

`auth_user_id` apunta al usuario del GoTrue de la caja; la base no lee `auth.users` ni usa `auth.uid()`, así que `opsrun_app` no necesita nada en el esquema `auth`.

### 3.2 `request` — la request y, una vez programada, su job (OPR-15, OPR-28 a OPR-32)

Una fila por request durante toda su vida. Al programar gana el crosswalk del job: **una request da un job** en V1.1 beta.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `r_number` | bigint not null unique, default `nextval('request_r_number_seq')` | Se muestra como `R` + número. El formato y el número inicial están por confirmar (§11). |
| `status` | `request_status` enum (`open`, `scheduled`) | Solo el ciclo de opsRUN. La etapa del tablero se calcula (§5). |
| `received_at` | timestamptz not null | Hora de llegada del correo original, según BzzzBX. |
| `owner_operator_id` | uuid null → `operator` | Assigned to. El operador original y las reasignaciones salen de Audit. |
| **Borrador** (opsRUN hasta programar) | | |
| `bzzzbx_customer_id` | text null | Who is it from?: el cliente. |
| `bzzzbx_contact_id` | text null | Who is it from?: el representante. |
| `bzzzbx_property_id` | text null | |
| `bzzzbx_space_id` | text null | Por confirmar si el espacio es un registro de PINCH (§11). |
| `unit` | text null | |
| `beds` | smallint null, check `>= 0` | |
| `bzzzbx_service_id` | text null | Un servicio. |
| `service_date` | date null | |
| `window_start`, `window_end` | time null, check `window_end > window_start` | |
| `access_notes` | text null | Notas e instrucciones de acceso. |
| `po_number` | text null | PO capturado antes de programar. Después vive en el job de PINCH (instrucción `write_po`, OPR-8). |
| `bzzzbx_team_id` | text null | El cleaner elegido. |
| **Job** (crosswalk, al programar) | | |
| `bzzzbx_job_id` | text null unique | |
| `job_number` | text null unique | Job number, que en Audit también aparece como Work App number. |
| `scheduled_at` | timestamptz null | |
| **Hechos de opsRUN después de programar** (provisionales, §11) | | |
| `ended_manually_at`, `ended_manually_by` | timestamptz, uuid → `operator` | End manually (OPR-30). |
| `oss_mark` | `oss_mark` enum (`oss`, `not_oss`) null | Mark as OSS / Not OSS (OPR-31). |
| `oss_marked_at` | timestamptz null | |
| `oss_marked_by` | uuid null → `operator` | `null` con `oss_mark = 'oss'` y `oss_source = 'auto'` significa que se marcó sola por End manually sin fotos. |
| `oss_source` | `oss_source` enum (`operator`, `auto`) null | |
| `approved_at`, `approved_by` | timestamptz, uuid → `operator` | Approve & confirm (OPR-31). |

Constraints:

- `status = 'scheduled'` ⇔ `bzzzbx_job_id`, `job_number` y `scheduled_at` no nulos.
- Los tres campos de OSS van juntos: todos nulos o todos con valor (`oss_marked_by` puede ser nulo solo si `oss_source = 'auto'`).
- **Borrador congelado:** un trigger rechaza cualquier cambio a las columnas del borrador cuando `status = 'scheduled'`. Desde ese momento manda el job en PINCH y el borrador queda como registro de lo que se confirmó al programar (guard G11).

Índices: `(status, owner_operator_id)`, `(owner_operator_id) where status = 'open'` (para las barras de carga), y `bzzzbx_job_id` (ya único).

### 3.3 `request_confirmation` — el gate antes de Schedule (OPR-28)

Una fila por confirmación. Schedule exige `owner_operator_id` y una confirmación vigente de cada tipo.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `request_id` | uuid not null → `request` | |
| `kind` | `confirmation_kind` enum (`details`, `sender`, `cleaner`) | |
| `method` | `confirmation_method` enum (`operator`, `cleaner_text`, `phone`) | `cleaner_text`: el operador aceptó la respuesta por texto. `phone`: Confirm by phone. |
| `confirmed_value` | jsonb not null | Lo que se confirmó: solo valores del borrador y crosswalk IDs. |
| `cleaner_confirmation_id` | uuid null → `cleaner_confirmation` | Si `kind = 'cleaner'` y salió de un texto. |
| actor | | Siempre `operator`. |
| `confirmed_at` | timestamptz not null default now() | |
| `superseded_at` | timestamptz null | Se llena si el borrador cambia después de confirmar; esa confirmación deja de valer. |

Índice único parcial: `(request_id, kind) where superseded_at is null`, para que haya una sola vigente por tipo.

### 3.4 `cleaner_confirmation` — preguntas al cleaner y Waiting (OPR-17, OPR-28, OPR-29)

Cada vez que se le pide al cleaner que confirme: la primera vez (`initial`) o un Reschedule (`reschedule`). Alimenta la sección Waiting de Alerts.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `request_id` | uuid not null → `request` | |
| `purpose` | `cleaner_confirmation_purpose` enum (`initial`, `reschedule`) | |
| `bzzzbx_team_id` | text not null | |
| `new_service_date`, `new_window_start`, `new_window_end` | date, time null | Solo para `reschedule`: lo que se propone. |
| `reason` | text null | Obligatorio para `reschedule` (check). |
| `status` | `cleaner_confirmation_status` enum (`asked`, `replied`, `confirmed`, `declined`, `withdrawn`) | `replied`: llegó respuesta y la IA propuso una lectura. Solo pasa a `confirmed` o `declined` con un operador. |
| `ask_instruction_id` | uuid null → `instruction` | El `send_text` que hizo la pregunta. |
| `reply_bzzzbx_message_id` | text null | La respuesta del cleaner (crosswalk). |
| `decided_by`, `decided_at` | uuid → `operator`, timestamptz | |
| `asked_at`, actor | | |

La lectura de la IA sobre la respuesta ("yes", "can't", una hora propuesta) es una fila de `ai_suggestion` con `field = 'cleaner_reply'` y `cleaner_confirmation_id` (§3.9).

Índice: `(request_id) where status in ('asked', 'replied')`, que es la sección Waiting.

### 3.5 `request_message` — vínculo de la conversación (OPR-15, OPR-16, OPR-17, OPR-19, OPR-27)

opsRUN no guarda el cuerpo, los adjuntos ni el estado de entrega: se leen de BzzzBX. Guarda solo a qué request pertenece cada mensaje.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `request_id` | uuid not null → `request` | |
| `bzzzbx_message_id` | text not null **unique** | La deduplicación: el mismo correo no crea dos requests (OPR-15). |
| `bzzzbx_thread_id` | text null | Conversación de correo, para enhebrar respuestas. |
| `channel` | `message_channel` enum (`email`, `text`) | |
| `direction` | `message_direction` enum (`inbound`, `outbound`) | |
| `is_original` | boolean not null default false | El correo que creó la request. Índice único parcial `(request_id) where is_original`. |
| `instruction_id` | uuid null → `instruction` | El envío desde opsRUN, para mensajes `outbound`. |
| `linked_at`, actor | | `system` si lo enhebró la intake; `operator` si alguien lo movió a mano. |

### 3.6 `note` — notas internas (OPR-27)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `request_id` | uuid not null → `request` | |
| `author_operator_id` | uuid not null → `operator` | |
| `body` | text not null, check `length(trim(body)) > 0` | |
| `created_at` | timestamptz | |

Append-only: no se editan ni se borran (por confirmar, §11).

### 3.7 `instruction` — cada acción que sale a BzzzBX (OPR-23)

El registro de cada instrucción y de su resultado. Las acciones del operador con su motivo viven aquí y en `audit_event`.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `request_id` | uuid null → `request` | |
| `type` | text not null → `instruction_type(code)` | Seed: `send_email`, `send_text`, `create_job`, `reschedule_job`, `cancel_job`, `end_job_manually`, `write_po`, `record_validation`, `ai_analyze_request`, `ai_suggest`, `ai_draft`, `ai_read_reply`. Los que dependen de §11 se marcan en el catálogo. |
| `idempotency_key` | text not null unique | Va a BzzzBX para que un reintento no duplique la acción. |
| `payload` | jsonb not null | Lo que escribió el operador (texto del mensaje, nueva fecha, PO) y crosswalk IDs. Nada leído de PINCH. |
| `reason` | text null | Obligatorio si `instruction_type.requires_reason`. |
| actor | | |
| `status` | `instruction_status` enum (`pending`, `sent`, `confirmed`, `failed`, `timed_out`) | Solo avanza: un trigger rechaza volver atrás. |
| `bzzzbx_reference` | text null | El id que devuelve BzzzBX. |
| `error_code`, `error_message` | text null | Lo que se le muestra al operador (OPR-23: "a forced error is shown and recorded"). |
| `attempts` | smallint not null default 0 | |
| `created_at`, `sent_at`, `resolved_at` | timestamptz | |

Al crearse y al resolverse escribe un `audit_event`. Un error forzado queda como `failed` con su evento `instruction_failed`.

### 3.8 `alert_occurrence` — historial de alertas (OPR-19, OPR-29, OPR-30, OPR-31, OPR-32, OPR-34)

Las reglas las calcula BzzzBX (OPR-33). opsRUN guarda cada **ocurrencia** completa, para que Resolved y las repeticiones no dependan de que BzzzBX guarde historial.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `bzzzbx_alert_id` | text not null unique | |
| `request_id` | uuid not null → `request` | Las alertas de V1.1 beta son siempre de una request o job (OPS-001 aplica antes de que exista el job). |
| `rule_id` | text not null | `OPS-001` … `TRN-005` y la de Message not delivered. |
| `rule_version` | text not null | |
| `level` | `alert_level` enum (`amber`, `red`) | Puede cambiar (TRN-005 pasa de amber a red en Validation); cada cambio deja un evento en Audit. |
| `reason_text` | text not null | El motivo con su evidencia tal como llegó al abrirse. Es un `bzzzbx-snapshot`, no un dato del negocio. |
| `bzzzbx_message_id` | text null | Solo para Message not delivered. |
| `opened_at` | timestamptz not null | Hora de BzzzBX. |
| `first_seen_at` | timestamptz not null default now() | Cuándo la vio opsRUN. |
| `resolved_at` | timestamptz null | |
| `resolution` | `alert_resolution` enum (`auto_cleared`, `fixed_by_action`, `cleared_by_operator`) null | "Cleared automatically", resuelta por una acción, o Clear alert. |
| `resolved_by` | uuid null → `operator` | Obligatorio salvo `auto_cleared`. |
| `resolution_reason` | text null | Obligatorio con `cleared_by_operator` (Clear alert pide motivo). |
| `resolving_instruction_id` | uuid null → `instruction` | Cuando `fixed_by_action`. |

Checks: `resolved_at`, `resolution` y los demás campos de resolución son coherentes entre sí. Una alerta resuelta no se reabre: si BzzzBX la vuelve a disparar, llega como otra ocurrencia con otro `bzzzbx_alert_id` (por confirmar con OPR-6, §11).

Derivados:

- Needs action: `resolved_at is null`.
- Time open: `coalesce(resolved_at, now()) - opened_at`.
- Repeats: `count(*)` sobre `(request_id, rule_id)`.

Índices: `(request_id) where resolved_at is null`, `(request_id, rule_id)`.

### 3.9 `ai_analysis` y `ai_suggestion` — IA propone, operador confirma (OPR-17, OPR-28, OPR-36, OPR-37)

`ai_analysis`: una corrida de análisis sobre una request.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `request_id` | uuid not null → `request` | |
| `instruction_id` | uuid not null → `instruction` | La llamada salió por BzzzBX. |
| `status` | `ai_analysis_status` enum (`pending`, `completed`, `failed`, `timed_out`) | `pending`, `failed` y `timed_out` sin sugerencias se muestran como AI pending. |
| `model` | text null | Lo devuelve BzzzBX. |
| `requested_at`, `completed_at` | timestamptz | Para medir la meta de 1 minuto (OPR-39). |

`ai_suggestion`: una fila por campo y por propuesta.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `request_id` | uuid not null → `request` | |
| `ai_analysis_id` | uuid null → `ai_analysis` | |
| `cleaner_confirmation_id` | uuid null → `cleaner_confirmation` | Solo para `cleaner_reply`. |
| `field` | text not null → `ai_field(code)` | Seed: `property`, `space`, `unit`, `beds`, `service`, `service_date`, `time_window`, `access_notes`, `po_number`, `sender`, `cleaner_team`, `multiple_jobs`, `cleaner_reply`, `draft_cleaner_text`, `draft_customer_reply`. |
| `rank` | smallint not null default 1 | 1 es la propuesta principal y el resto, alternativas (por ejemplo, el cleaner: el default team primero). |
| `value` | jsonb not null | Valor propuesto: crosswalk IDs o valores del borrador. |
| `reason` | text null | El "con motivo" de OPR-37. |
| `decision` | `ai_decision` enum (`accepted`, `corrected`, `rejected`, `superseded`) null | `null` = sin decidir. |
| `final_value` | jsonb null | Obligatorio con `corrected`: lo que puso el operador. |
| `decided_by`, `decided_at` | uuid → `operator`, timestamptz | Obligatorios con `accepted`, `corrected` y `rejected`. `superseded` lo pone el sistema cuando llega un análisis nuevo. |
| `created_at` | timestamptz | |

Reglas:

- Cuando el análisis llega, la función de ingreso escribe las sugerencias **y** llena el borrador de `request` con las de `rank = 1`, solo en los campos que el operador no haya tocado.
- **Un campo está AI-marked** mientras exista para él una sugerencia `rank = 1` con `decision is null`. Lo expone la vista `request_ai_marks (request_id, field, suggestion_id)`.
- Si el operador edita un campo marcado, la función de escritura cierra la sugerencia como `corrected` con `final_value`. Confirm details cierra como `accepted` todas las de los campos de detalle que sigan abiertas.
- Ninguna sugerencia confirma nada sola: `request_confirmation` y `cleaner_confirmation.status = confirmed` exigen actor `operator` (check).
- Los borradores (`draft_*`) se cierran como `accepted` si se envían sin cambios y como `corrected` si el operador los editó.

Índice: `(request_id, field) where decision is null`.

### 3.10 `message_template` — plantillas (OPR-18)

| Columna | Tipo | Notas |
|---|---|---|
| `key` | text | Seed: `cleaner_confirmation_request`, `reschedule_request`, `cancellation_cleaner`, `cancellation_requester`, `requester_scheduled`, `requester_done`. |
| `version` | int | La pk es `(key, version)`. |
| `channel` | `message_channel` enum | |
| `subject` | text null | Solo para correo. |
| `body` | text not null | Con placeholders (`{{property}}`, `{{space}}`, `{{date}}`, `{{window}}`). Los placeholders son los que se llenan del job al momento de enviar, no se guardan llenos. |
| `active` | boolean | Una versión activa por `key` (índice único parcial). |

En V1.1 beta solo se cambian por migración (por confirmar, §11). Las instrucciones `send_*` guardan en su `payload` el `key` y la `version` usados.

### 3.11 `audit_event` — Audit, append-only (OPR-21, OPR-29, OPR-30, OPR-35)

Una sola tabla con todo lo que muestra la pestaña Audit, también los hechos de PINCH que la read layer observa.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | bigint identity pk | Orden de registro y cursor del write-back. |
| `request_id` | uuid null → `request` | `null` solo para eventos de operación (por ejemplo, alta de un operador). |
| `event_type` | text not null → `audit_event_type(code)` | |
| actor | | |
| `reason` | text null | Obligatorio si `audit_event_type.requires_reason` (trigger). |
| `occurred_at` | timestamptz not null | Cuándo pasó. Para hechos observados, la hora que da BzzzBX. |
| `recorded_at` | timestamptz not null default now() | Cuándo se escribió. |
| `source` | `audit_source` enum (`opsrun`, `bzzzbx_observed`) | |
| `bzzzbx_event_id` | text null unique | Deduplica los hechos observados. |
| `details` | jsonb not null default '{}' | Solo valores de opsRUN y crosswalk IDs (por ejemplo `{"from_operator_id": …, "to_operator_id": …}`). Nunca nombres, direcciones ni montos de PINCH. |
| `instruction_id`, `alert_occurrence_id`, `ai_suggestion_id`, `cleaner_confirmation_id` | null → su tabla | Para ir al detalle. |

Catálogo `audit_event_type (code pk, label, requires_reason bool, source audit_source)`. Seed inicial, en el orden de OPR-35:

| Grupo | Códigos |
|---|---|
| Request | `request_received`, `request_assigned`, `request_reassigned`, `details_confirmed`, `sender_confirmed`, `cleaner_confirmed`, `confirmation_superseded`, `request_scheduled` |
| Cleaner | `cleaner_asked`, `cleaner_replied`, `cleaner_declined` |
| Job (opsRUN) | `job_rescheduled`ᴿ, `job_cancelled`ᴿ, `job_ended_manually`ᴿ, `oss_marked`, `job_approved`, `po_entered`, `job_validated` |
| Job (observado) | `job_checked_in`, `job_started`, `job_completed`, `job_paid` |
| Mensajes | `email_sent`, `text_sent`, `requester_notified`, `note_added` |
| Alertas | `alert_opened`, `alert_level_changed`, `alert_resolved`, `alert_cleared`ᴿ |
| IA | `ai_analysis_completed`, `ai_analysis_failed`, `ai_suggestion_accepted`, `ai_suggestion_corrected`, `ai_suggestion_rejected` |
| Instrucciones | `instruction_failed` |
| Operadores | `operator_added`, `operator_deactivated` |

ᴿ = `requires_reason`. Los nombres finales de las acciones dependen de OPR-4; el `code` es interno y el `label` se ajusta sin migrar datos.

Inmutable:

- no se otorga UPDATE, DELETE ni TRUNCATE a ningún rol, tampoco a `opsrun_migrador` (la migración se los revoca);
- un trigger `BEFORE UPDATE OR DELETE` (por fila) y otro `BEFORE TRUNCATE` (por sentencia) lanzan error para todos, incluidos `opsrun_app`, `opsrun_migrador` y los superusuarios;
- una corrección es un evento nuevo, no una edición.

Las entradas de Audit de OPR-29 ("Delayed · not started by 1:00 PM", "Started · Delayed cleared") son `alert_opened` y `alert_resolved` de OPS-010 con su `label`.

Índice: `(request_id, occurred_at)`.

## 4. Escrituras: solo por funciones SQL

- Ningún rol tiene INSERT, UPDATE, DELETE ni TRUNCATE sobre las tablas de opsRUN, salvo `opsrun_migrador`. `opsrun_app` solo tiene SELECT y EXECUTE sobre las funciones de escritura.
- Las funciones de escritura viven en `opsrun`, son `security definer` con dueño `opsrun_migrador` (corren como él) y llevan `set search_path = ''`. Hay dos clases, según el actor de la transacción (§2):
  - **Escrituras del operador**, `opsrun.<verbo>_<objeto>`. Cada una:
    1. llama a `opsrun_private.require_operator()`;
    2. valida el estado (por ejemplo, el gate de Schedule);
    3. exige `reason` cuando el tipo lo pide;
    4. escribe el dato, la `instruction` si aplica y su `audit_event` **en la misma transacción**.
  - **Escrituras del sistema** (intake de correo, hechos observados, resultados de IA y de instrucciones, ocurrencias de alertas). Cada una llama a `opsrun_private.require_system()` y también escribe su `audit_event`.
- Primeras funciones previstas, que cada tarjeta completa al construirse:

| Función | Actor | Tarjeta |
|---|---|---|
| `assign_request`, `confirm_details`, `update_request_detail`, `confirm_sender`, `ask_cleaner`, `decide_cleaner_reply`, `confirm_cleaner_by_phone`, `schedule_request` | operador | OPR-28 |
| `reschedule_job`, `cancel_job` | operador | OPR-29 |
| `end_job_manually`, `clear_alert` | operador | OPR-30 |
| `mark_oss`, `approve_job` | operador | OPR-31 |
| `enter_po`, `validate_job` | operador | OPR-32 |
| `add_note`, `send_email`, `send_text` | operador | OPR-16, OPR-17, OPR-27 |
| `ingest_request_email`, `link_message`, `record_observed_event`, `upsert_alert_occurrence`, `record_ai_analysis`, `resolve_instruction` | sistema | OPR-15, OPR-22, OPR-23, OPR-34, OPR-36 |

## 5. Cómo se calcula la etapa del tablero

No hay columna `stage`. La read layer (OPR-22) la calcula con los hechos de opsRUN y el estado del job que da BzzzBX:

| Etapa | Condición |
|---|---|
| Requests | `request.status = 'open'` |
| Scheduled | programada, sin check-in en el Job Tracker |
| In Progress | check-in hecho, sin fin y sin `ended_manually_at` |
| Complete | fin en el Job Tracker o `ended_manually_at`, sin `approved_at` |
| Validation | `approved_at` con valor (Paid sale de BzzzBX y colorea la tarjeta) |

Un job cancelado sale del tablero según el estado de BzzzBX; la cancelación queda en Audit. Si §11 confirma que End manually o Approve se escriben en PINCH, la condición pasa a leer el estado de BzzzBX y la columna de opsRUN queda solo como registro.

## 6. Permisos y RLS

| Objeto | `opsrun_migrador` | `opsrun_app` | `bzzz_writeback_opsrun` | Cualquier otro rol (`anon`, `authenticated`, `service_role`, otras apps, `PUBLIC`) |
|---|---|---|---|---|
| Esquema `opsrun` | dueño | USAGE | nada | nada |
| Tablas y vistas de `opsrun` | todo, salvo modificar `audit_event` | SELECT | nada | nada |
| Funciones de escritura de `opsrun` | dueño | EXECUTE (validan el actor dentro) | nada | nada |
| Esquema `opsrun_private` y sus funciones | dueño | nada | nada | nada |
| Esquema `opsrun_writeback` y sus vistas `v1_*` | dueño | nada | USAGE y SELECT | nada |

Los esquemas y los roles ya existen cuando corre la migración (§2); ella solo crea los objetos y concede lo de esta tabla. Los permisos son la frontera. Además, RLS va activa en toda tabla de `opsrun` como respaldo, con una sola política:

```sql
create policy "<tabla>: opsrun_app lee"
  on opsrun.<tabla> for select to opsrun_app
  using (true);
```

`opsrun_app` lee todo sin exigir un actor: la read layer y la intake leen sin operador, y el login se controla en el servidor, porque el navegador no habla con la base. Si a otro rol se le diera SELECT por error, vería 0 filas. `opsrun_migrador`, dueño de las tablas, no está sujeto a RLS (no se usa `force row level security`), y las vistas de `opsrun_writeback` corren con sus permisos.

Ninguna política llama a un helper de `opsrun_private`. Por eso ningún rol necesita EXECUTE ahí, y G7 no tiene excepciones. Si algún día una política necesita un helper, G7 se ve en rojo y la decisión se revisa.

> **Historia.** Con el Supabase propio de la ADR 0002, la política de lectura de `authenticated` llamaba a `private.current_operator_id()`. Postgres evalúa una política con los permisos de quien consulta, así que `authenticated` necesitaba EXECUTE sobre ese helper. Henry eligió entonces que G7 lo permitiera solo para las funciones que usa una política (descubiertas en `pg_depend`), sin USAGE en el esquema, y que G6 mirara solo lo invocable (USAGE más EXECUTE). Con la ADR 0003 el navegador ya no llega a la base. El actor lo fija el servidor y lo leen las funciones de escritura, que corren como `opsrun_migrador`, y la política de respaldo no llama a ningún helper. La excepción de G7 deja de hacer falta. La regla de G6 se mantiene: mira lo que `opsrun_app` puede invocar.

## 7. Write-back (OPR-24)

D-2 no está decidida. El esquema sirve para los dos caminos (consulta directa o pipeline):

- Esquema `opsrun_writeback` con vistas versionadas `v1_<objeto>`: `request`, `request_confirmation`, `cleaner_confirmation`, `instruction`, `alert_occurrence`, `ai_suggestion`, `ai_analysis`, `audit_event` y `operator` (solo `id`, `display_name`, `team` y el cursor). Son el contrato: si cambia una tabla, la vista `v1` se mantiene o se crea `v2`.
- Rol `bzzz_writeback_opsrun`. Es de la caja: lo crea el alta de opsRUN en Bzzz, entra solo desde la red de la caja y su credencial no pasa por opsRUN. La migración de opsRUN no lo crea; solo le concede `USAGE` en `opsrun_writeback` y `SELECT` en sus vistas `v1_*`. Nada en `opsrun`, en `opsrun_private` ni en los esquemas de otras apps. Hay uno por vecina: un lector común leería el write-back de todas.
- Las vistas están en la misma base que la caja (ADR 0003): BzzzBX las lee sin cruzar la red, pero solo con ese rol. Es la única puerta de BzzzBX a los datos de opsRUN.
- Cursores incrementales:
  - en `audit_event`, el `id`;
  - en las tablas mutables, `change_seq bigint` asignado por trigger desde una secuencia global en cada INSERT o UPDATE, y expuesto en la vista.

  El lector vuelve a leer una ventana de seguridad hacia atrás, porque una secuencia no garantiza orden de commit. El detalle lo cierra OPR-24.
- Notas y plantillas no salen en `v1` (OPR-24 no las lista; §11).
- "Found in BzzzBX within 5 minutes" depende del lector, no del esquema.

## 8. Guards de seguridad (pgTAP, `supabase test db`)

Todos **descubren** los objetos desde el catálogo (`pg_namespace`, `pg_class`, `pg_proc`, `pg_roles`, `pg_auth_members`, `pg_policy`) y no tienen listas escritas a mano. Siguen el patrón que dejó OPR-1 en `supabase/tests/database/rls.test.sql`:

- "de opsRUN" es todo esquema llamado `opsrun` u `opsrun_*` y todo rol llamado `opsrun_*` (§2). Así quedan fuera, sin listarlos, `public`, los esquemas de Supabase y los de las demás apps de la caja, y entra cualquier esquema o rol nuevo de opsRUN;
- "el dueño" es el dueño de los esquemas de opsRUN según `pg_namespace` (`opsrun_migrador`), leído del catálogo y no escrito en el test;
- "rol ajeno" es todo rol de `pg_roles` (más `PUBLIC`) que no es de opsRUN. El lector del write-back (`bzzz_writeback_opsrun`) es un rol ajeno más: ningún guard lo busca por su nombre. Los superusuarios quedan fuera de las comprobaciones de privilegios, porque se los saltan, y por eso los triggers frenan también a los superusuarios;
- cada guard se ve fallar **en cada corrida**: dentro de la transacción del test crea un objeto o un grant de prueba que viola la regla, comprueba que lo detecta y hace rollback.

Así el "verlo fallar una vez" del principio 8 de `PLAN.md` queda en el propio test y no depende de que alguien lo pruebe a mano.

| # | Guard | Cómo descubre | Cómo se ve fallar |
|---|---|---|---|
| G1 | Toda tabla de opsRUN tiene RLS activada | **De OPR-1** (`rls.test.sql`, que OPR-1 acota a los esquemas de opsRUN). OPR-20 solo lo hereda | Tabla de prueba sin RLS |
| G2 | Ningún rol, salvo el dueño, tiene INSERT, UPDATE, DELETE ni TRUNCATE sobre tablas o vistas de opsRUN, ni USAGE o UPDATE sobre sus secuencias. Tampoco `opsrun_app`: escribe solo por funciones | `has_table_privilege` y `has_sequence_privilege` de cada rol de `pg_roles` sobre cada objeto de los esquemas de opsRUN | `grant insert` a `opsrun_app` |
| G3 | Todo rol ajeno con algún privilegio en los esquemas de opsRUN tiene solo USAGE en `opsrun_writeback` y SELECT en sus vistas `v1_*`. Nada en `opsrun` ni en `opsrun_private`, ni CREATE, ni otro privilegio en `opsrun_writeback`. `PUBLIC` no tiene nada. Y hay **a lo sumo un** rol ajeno con algún privilegio en los esquemas de opsRUN | `has_schema_privilege`, `has_table_privilege`, `has_sequence_privilege` y `has_function_privilege` de cada rol ajeno sobre cada esquema y objeto de opsRUN; los que tienen algo se cuentan y se comparan con lo permitido | El lector con un privilegio de más: `grant select on opsrun.request` o `grant usage on schema opsrun` al rol ajeno que tiene USAGE en `opsrun_writeback`, hallado en el catálogo; `grant usage on schema opsrun_writeback to public`; y un segundo lector: USAGE en `opsrun_writeback` y SELECT en una vista `v1_*` a otro rol ajeno (`authenticated` o uno creado en el test) |
| G4 | Con RLS como respaldo, un rol ajeno con SELECT por error lee 0 filas en toda tabla y vista de `opsrun`; `opsrun_app` lee filas en todas | Bucle dinámico con `set local role` sobre una fixture que llena cada tabla | Política `using (true)` para ese rol |
| G5 | Toda función `security definer` de opsRUN fija `search_path` | `pg_proc.prosecdef` y `proconfig` | Función de prueba sin `set search_path` |
| G6 | Toda función `security definer` que `opsrun_app` puede invocar (USAGE en el esquema más EXECUTE) llama a `opsrun_private.require_operator()` o a `opsrun_private.require_system()` | `pg_proc.prosecdef`, `has_schema_privilege`, `has_function_privilege('opsrun_app', …)` y `prosrc` | Función de prueba ejecutable por `opsrun_app` sin la llamada |
| G7 | Nadie más que `opsrun_migrador` alcanza `opsrun_private`: ningún rol (tampoco `opsrun_app` ni `PUBLIC`) tiene USAGE en el esquema ni EXECUTE en sus funciones | `has_schema_privilege` y `has_function_privilege` de cada rol | `grant execute` a `opsrun_app`; USAGE en `opsrun_private` |
| G8 | `audit_event` rechaza UPDATE, DELETE y TRUNCATE: ningún rol tiene el privilegio, y aunque alguien lo otorgue, el trigger lo frena también para `opsrun_app` y `opsrun_migrador` | `has_table_privilege` de cada rol y prueba directa con los dos roles | Quitar el trigger |
| G9 | Toda columna de una tabla de opsRUN tiene `COMMENT` con el dueño (`opsrun`, `crosswalk`, `bzzzbx-snapshot`). Toda `bzzzbx_*_id` es `text` y está marcada `crosswalk` | `pg_attribute` y `col_description` | Columna nueva sin comentario |
| G10 | Los roles de opsRUN (`opsrun_*`) no llegan más allá de lo suyo: `opsrun_app` solo a `opsrun` (USAGE, SELECT y EXECUTE), sin CREATE en ningún esquema; `opsrun_migrador` es dueño de todos los esquemas de opsRUN y no tiene CREATE en la base ni en esquemas ajenos. Ninguno tiene privilegios en esquemas de Supabase ni de otras apps, atributos peligrosos (`superuser`, `createrole`, `createdb`, `replication`, `bypassrls`) ni pertenece a otro rol | `has_*_privilege` sobre todo el catálogo (salvo `pg_catalog` e `information_schema`), `pg_roles` y `pg_auth_members` | `grant select` sobre una tabla de otro esquema; `grant authenticated to opsrun_app` |
| G11 | El borrador de una request `scheduled` no cambia | Columnas del borrador leídas del `COMMENT` (`:draft`) | Quitar el trigger |
| G12 | Todo `audit_event_type` e `instruction_type` con `requires_reason` rechaza filas sin motivo | Bucle sobre los catálogos | Quitar el chequeo del trigger |

G9 es el guard de "nadie copia datos de otro dueño": una columna nueva no pasa CI hasta que alguien declara de quién es. `bzzzbx-snapshot` se usa solo en `alert_occurrence.reason_text`. Cualquier otro uso pide una ADR.

G3 y G10 juntos son la frontera con la caja: de fuera solo entra el lector del write-back, y solo por `opsrun_writeback`; nadie de opsRUN sale a lo de otros.

El límite de un solo rol ajeno en G3 evita que un grant de más (por ejemplo, SELECT de `v1_*` a `authenticated`) pase el guard: las vistas de `opsrun_writeback` corren con los permisos de `opsrun_migrador`, así que cualquier rol con SELECT leería todo el write-back. G3 sigue sin nombrar al lector. Si algún día BzzzBX necesita un segundo lector, G3 falla a propósito, y cambiarlo pide una decisión explícita (una ADR), no ajustar el test.

Pruebas funcionales de la migración (no son guards): el gate de Schedule, la vista `request_ai_marks`, que `instruction.status` solo avance, el índice único de confirmación vigente, los helpers de actor (`require_operator()` y `require_system()` fallan sin actor o con los dos a la vez) y que la seed cargue.

## 9. Seed

`supabase/seed.sql`, solo con datos inventados:

- 4 operadores (dos de Operations y dos de Finance) con correos `@example.test`;
- requests en cada etapa con crosswalk IDs falsos (`bx-prop-0001`, `bx-job-0001`…);
- una alerta abierta y una resuelta de cada `resolution`;
- un análisis de IA con una sugerencia aceptada, una corregida y una abierta;
- las plantillas en su versión 1;
- los catálogos van en la migración, no en la seed;
- sin usuarios de GoTrue: el login lo decide OPR-2.

## 10. Caché de lectura

La caché de lectura de OPR-22 no entra en este esquema. Si se persiste, va en un esquema aparte `opsrun_read_cache`, marcada como no autoritativa, con caducidad, sin write-back y sin escritura desde la app. Su diseño es de OPR-22.

## 11. Preguntas abiertas (para Federico)

1. **R number:** ¿formato exacto y número inicial? ¿Continúa la numeración de un sistema anterior?
2. **Approve & confirm y End manually:** ¿se escriben en la base de PINCH por BzzzBX o son solo de opsRUN? Hoy se diseñan como hechos de opsRUN con write-back.
3. **Mark as OSS / Not OSS:** ¿hay un campo en el job de PINCH? ¿Qué significa la sigla OSS? Hoy se diseña como dato de opsRUN.
4. **Space:** ¿el espacio es un registro de PINCH con id (crosswalk) o texto libre del operador?
5. **Ventana:** ¿es un rango de horas o un set fijo de ventanas con nombre?
6. **Request sin job:** ¿una request se puede cerrar sin programar (spam, no es limpieza, duplicado con distinto Message-ID)? Hoy solo existen `open` y `scheduled`.
7. **Alertas re-disparadas:** cuando una regla se limpia y vuelve a disparar, ¿BzzzBX da un `alert id` nuevo? ¿Clear alert en opsRUN tiene que avisarle a Signal Maker para que no la vuelva a abrir?
8. **Notas internas:** ¿se pueden editar o borrar? ¿Viajan por el write-back para Rosie?
9. **Plantillas:** ¿las edita alguien de Operations desde opsRUN o solo el equipo por release?
10. **Chat icon de la tarjeta:** ¿indica una respuesta no leída? Si es así, falta guardar qué leyó cada operador (no está en ninguna tarjeta).
11. **Hechos observados en Audit:** ¿BzzzBX entrega un id de evento estable para check-in, inicio, fin y Paid (para deduplicar `bzzzbx_event_id`)?
12. **Conversaciones con Rosie:** ¿se guardan? Ninguna tarjeta lo pide.

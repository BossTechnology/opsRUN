# OPR-20 — Modelo de datos de opsRUN

- **Tarjeta:** OPR-20 (P1 · Data model and opsRUN store)
- **Estado:** spec para revisión. Sin migración todavía: se implementa cuando OPR-1 esté fusionada.
- **Decisiones:** [ADR 0001](../adr/0001-modelo-de-datos.md)
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
| Rosie (OPR-38) | Lo que lee de opsRUN | vistas `writeback.v1_*` |

## 2. Convenciones

| Tema | Regla |
|---|---|
| Esquemas | `public`: tablas y funciones RPC expuestas. `private`: helpers no expuestos por la API. `writeback`: vistas para BzzzBX (§7). |
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

## 3. Tablas

### 3.1 `operator` — usuarios de Operations y Finance (OPR-21)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | Id estable. Audit, Assigned to y los filtros apuntan aquí. |
| `auth_user_id` | uuid null unique → `auth.users(id)` on delete set null | Se enlaza al primer login, con cualquier método que decida OPR-2. |
| `email` | text not null | Único sobre `lower(email)`. Sirve para enlazar el login; no sale por el write-back. |
| `display_name` | text not null | El nombre que se ve en Audit y en Assigned to. |
| `team` | `operator_team` enum (`operations`, `finance`) | Informativo. En V1.1 beta no cambia los permisos (propuesta por defecto de OPR-2). |
| `active` | boolean not null default true | Un operador se desactiva, nunca se borra (las FK son `restrict`). |

Si OPR-2 decide limitar acciones por rol, se agrega la tabla `operator_permission (operator_id, permission)` y un chequeo en las funciones de escritura. `operator` no cambia.

Helper: `private.current_operator_id()` (security definer, `stable`) devuelve el `id` del operador activo cuyo `auth_user_id = auth.uid()`, o `null`. `private.require_operator()` hace lo mismo pero lanza error si es `null`.

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

- no se otorga UPDATE, DELETE ni TRUNCATE a ningún rol;
- un trigger `BEFORE UPDATE OR DELETE` (por fila) y otro `BEFORE TRUNCATE` (por sentencia) lanzan error para todos, incluidos `service_role` y `postgres`;
- una corrección es un evento nuevo, no una edición.

Las entradas de Audit de OPR-29 ("Delayed · not started by 1:00 PM", "Started · Delayed cleared") son `alert_opened` y `alert_resolved` de OPS-010 con su `label`.

Índice: `(request_id, occurred_at)`.

## 4. Escrituras: solo por funciones SQL

- `anon` y `authenticated` no tienen INSERT, UPDATE, DELETE ni TRUNCATE sobre ninguna tabla. Solo tienen SELECT, filtrado por RLS.
- **Escrituras del operador:** funciones `public.<verbo>_<objeto>` con `security definer` y `set search_path = ''`. Cada una:
  1. llama a `private.require_operator()`;
  2. valida el estado (por ejemplo, el gate de Schedule);
  3. exige `reason` cuando el tipo lo pide;
  4. escribe el dato, la `instruction` si aplica y su `audit_event` **en la misma transacción**.
- **Escrituras del sistema** (intake de correo, hechos observados, resultados de IA y de instrucciones, ocurrencias de alertas): funciones en el esquema `private`, ejecutables solo por `service_role`, llamadas desde el servidor de Next.js. También escriben su `audit_event`.
- Primeras funciones previstas, que cada tarjeta completa al construirse:

| Función | Tarjeta |
|---|---|
| `assign_request`, `confirm_details`, `update_request_detail`, `confirm_sender`, `ask_cleaner`, `decide_cleaner_reply`, `confirm_cleaner_by_phone`, `schedule_request` | OPR-28 |
| `reschedule_job`, `cancel_job` | OPR-29 |
| `end_job_manually`, `clear_alert` | OPR-30 |
| `mark_oss`, `approve_job` | OPR-31 |
| `enter_po`, `validate_job` | OPR-32 |
| `add_note`, `send_email`, `send_text` | OPR-16, OPR-17, OPR-27 |
| `private.ingest_request_email`, `private.link_message`, `private.record_observed_event`, `private.upsert_alert_occurrence`, `private.record_ai_analysis`, `private.resolve_instruction` | Sistema |

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

## 6. RLS prevista

| Objeto | anon | authenticated (operador activo) | authenticated sin operador | service_role | `bzzzbx_reader` |
|---|---|---|---|---|---|
| Tablas de `public` | nada | SELECT de todas las filas | 0 filas | todo (bypass), salvo modificar `audit_event` | nada |
| `audit_event` | nada | SELECT | 0 filas | INSERT y SELECT | nada |
| Funciones `public` de escritura | sin EXECUTE | EXECUTE (validan operador dentro) | error de `require_operator` | — | nada |
| Funciones `private` | nada | nada | nada | EXECUTE | nada |
| Vistas `writeback` | nada | nada | nada | SELECT | SELECT |

Política única de lectura, igual en todas las tablas de V1.1 beta (todos los operadores ven todo):

```sql
create policy "<tabla>: operadores activos leen"
  on public.<tabla> for select to authenticated
  using ((select private.current_operator_id()) is not null);
```

En `operator`, la misma política. El `email` se ve solo entre operadores y no sale por `writeback`.

## 7. Write-back (OPR-24)

D-2 no está decidida. El esquema sirve para los dos caminos (consulta directa o pipeline):

- Esquema `writeback` con vistas versionadas `writeback.v1_<objeto>`: `request`, `request_confirmation`, `cleaner_confirmation`, `instruction`, `alert_occurrence`, `ai_suggestion`, `ai_analysis`, `audit_event` y `operator` (solo `id`, `display_name`, `team`). Son el contrato: si cambia una tabla, la vista `v1` se mantiene o se crea `v2`.
- Rol `bzzzbx_reader`, `NOLOGIN` en la migración. El login y la credencial se dan en el servidor, fuera del repo. Solo tiene `USAGE` en `writeback` y `SELECT` en sus vistas; nada en `public` ni en `private`.
- Cursores incrementales:
  - en `audit_event`, el `id`;
  - en las tablas mutables, `change_seq bigint` asignado por trigger desde una secuencia global en cada INSERT o UPDATE, y expuesto en la vista.

  El lector vuelve a leer una ventana de seguridad hacia atrás, porque una secuencia no garantiza orden de commit. El detalle lo cierra OPR-24.
- Notas y plantillas no salen en `v1` (OPR-24 no las lista; §11).
- "Found in BzzzBX within 5 minutes" depende del lector, no del esquema.

## 8. Guards de seguridad (pgTAP, `supabase test db`)

Todos **descubren** los objetos desde el catálogo (`information_schema`, `pg_class`, `pg_proc`, `pg_policy`) y no tienen listas escritas a mano. Cada uno se ve fallar una vez antes de darlo por bueno: se quita la protección en una rama, se corre, se ve rojo y se restaura. El PR de la migración anota cómo falló cada uno.

| # | Guard | Cómo descubre | Cómo se ve fallar |
|---|---|---|---|
| G1 | Toda tabla de `public` tiene RLS activada | `pg_class` con `relkind = 'r'` en `public` | `alter table … disable row level security` en una tabla |
| G2 | Ninguna tabla de `public` da INSERT, UPDATE, DELETE ni TRUNCATE a `anon` o `authenticated` | `has_table_privilege` sobre todas las tablas | `grant insert` a `authenticated` |
| G3 | `anon` lee 0 filas (o recibe permiso denegado) en toda tabla y vista de `public` | Bucle dinámico con `set local role anon` | Política `using (true)` para `anon` |
| G4 | Un `authenticated` sin operador activo lee 0 filas en toda tabla de `public` | Igual que G3, con un JWT de prueba sin fila en `operator` | Política `using (true)` |
| G5 | Toda función `security definer` fija `search_path` | `pg_proc.prosecdef` y `proconfig` | Quitar `set search_path` |
| G6 | Toda función `security definer` de `public` llama a `private.require_operator()` | `prosrc` de `pg_proc` | Función nueva sin la llamada |
| G7 | Ninguna función de `private` es ejecutable por `anon` ni `authenticated` | `has_function_privilege` | `grant execute` a `authenticated` |
| G8 | `audit_event` rechaza UPDATE, DELETE y TRUNCATE, también como `service_role` y `postgres` | Prueba directa con los dos roles | Quitar el trigger |
| G9 | Toda columna de `public` tiene `COMMENT` con el dueño (`opsrun`, `crosswalk`, `bzzzbx-snapshot`). Toda `bzzzbx_*_id` es `text` y está marcada `crosswalk` | `information_schema.columns` y `col_description` | Columna nueva sin comentario |
| G10 | `bzzzbx_reader` no tiene ningún privilegio fuera de `writeback` y solo SELECT dentro | `has_*_privilege` sobre todos los objetos | `grant select` sobre una tabla de `public` |
| G11 | El borrador de una request `scheduled` no cambia | Columnas del borrador leídas del `COMMENT` (`opsrun:draft`) | Quitar el trigger |
| G12 | Todo `audit_event_type` con `requires_reason` rechaza eventos sin motivo | Bucle sobre el catálogo | Quitar el chequeo del trigger |

G9 es el guard de "nadie copia datos de otro dueño": una columna nueva no pasa CI hasta que alguien declara de quién es. `bzzzbx-snapshot` se usa solo en `alert_occurrence.reason_text`. Cualquier otro uso pide una ADR.

Pruebas funcionales de la migración (no son guards): el gate de Schedule, la vista `request_ai_marks`, que `instruction.status` solo avance, el índice único de confirmación vigente y que la seed cargue.

## 9. Seed

`supabase/seed.sql`, solo con datos inventados:

- 4 operadores (dos de Operations y dos de Finance) con correos `@example.test`;
- requests en cada etapa con crosswalk IDs falsos (`bx-prop-0001`, `bx-job-0001`…);
- una alerta abierta y una resuelta de cada `resolution`;
- un análisis de IA con una sugerencia aceptada, una corregida y una abierta;
- las plantillas en su versión 1;
- los catálogos van en la migración, no en la seed.

## 10. Caché de lectura

La caché de lectura de OPR-22 no entra en este esquema. Si se persiste, va en un esquema aparte `read_cache`, marcada como no autoritativa, con caducidad, sin write-back y sin escritura desde la app. Su diseño es de OPR-22.

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

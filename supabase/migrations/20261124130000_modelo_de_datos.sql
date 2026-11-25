-- OPR-20 · Modelo de datos de opsRUN.
--
-- Spec: docs/spec/opr-20-modelo-de-datos.md. Decisiones: docs/adr/0001-modelo-de-datos.md
-- y docs/adr/0003-supabase-de-la-caja.md.
--
-- Corre como opsrun_migrador después de 20261124120000_esquema_opsrun.sql. Los
-- esquemas (opsrun, opsrun_private, opsrun_writeback) y los roles (opsrun_migrador,
-- opsrun_app, bzzz_writeback_opsrun) ya existen: los crea el alta de opsRUN en
-- Bzzz (en local y en CI, supabase/alta-local.sql). Esta migración no ejecuta
-- create schema ni create role; solo crea objetos dentro de esos esquemas y
-- concede sobre ellos.
--
-- opsRUN guarda solo lo suyo y apunta a lo de PINCH con crosswalk IDs de BzzzBX.
-- opsrun_app lee `opsrun` y no escribe en ninguna tabla: escribe por funciones
-- SQL que agrega cada tarjeta (spec §4). Esta migración no trae ninguna.
--
-- Comentario de columna (guard G9). Empieza con el dueño:
--   opsrun           dato de opsRUN
--   crosswalk        identificador de BzzzBX que apunta a algo de PINCH
--   bzzzbx-snapshot  resultado de BzzzBX guardado tal como llegó (solo
--                    alert_occurrence.reason_text; otro uso pide una ADR)
-- seguido de ":draft" si la columna es parte del borrador de la request (G11),
-- y de " · " con la descripción.

-- ---------------------------------------------------------------------------
-- 1. Secuencia de cambios y comentarios de lo que ya existe
-- ---------------------------------------------------------------------------
-- Secuencia global de cambios: cursor incremental del write-back (spec §7).
create sequence opsrun_private.change_seq;
comment on sequence opsrun_private.change_seq is
  'Cursor global del write-back. La asigna opsrun_private.touch_row() en cada INSERT o UPDATE.';

-- schema_migration nació en la migración de OPR-1 con otro formato de
-- comentario; se alinea con el de G9.
comment on column opsrun.schema_migration.version is
  'opsrun · Versión de la migración, el prefijo numérico del archivo.';
comment on column opsrun.schema_migration.name is
  'opsrun · Nombre del archivo, sin la versión ni la extensión.';
comment on column opsrun.schema_migration.applied_at is
  'opsrun · Cuándo se aplicó.';

-- ---------------------------------------------------------------------------
-- 2. Enums (estados cerrados)
-- ---------------------------------------------------------------------------
create type opsrun.actor_kind as enum ('operator', 'system', 'ai', 'bzzzbx');
create type opsrun.operator_team as enum ('operations', 'finance');
create type opsrun.request_status as enum ('open', 'scheduled');
create type opsrun.oss_mark as enum ('oss', 'not_oss');
create type opsrun.oss_source as enum ('operator', 'auto');
create type opsrun.confirmation_kind as enum ('details', 'sender', 'cleaner');
create type opsrun.confirmation_method as enum ('operator', 'cleaner_text', 'phone');
create type opsrun.cleaner_confirmation_purpose as enum ('initial', 'reschedule');
create type opsrun.cleaner_confirmation_status as enum ('asked', 'replied', 'confirmed', 'declined', 'withdrawn');
create type opsrun.message_channel as enum ('email', 'text');
create type opsrun.message_direction as enum ('inbound', 'outbound');
-- El orden importa: el trigger de instruction solo deja avanzar en este orden.
create type opsrun.instruction_status as enum ('pending', 'sent', 'confirmed', 'failed', 'timed_out');
create type opsrun.alert_level as enum ('amber', 'red');
create type opsrun.alert_resolution as enum ('auto_cleared', 'fixed_by_action', 'cleared_by_operator');
create type opsrun.ai_analysis_status as enum ('pending', 'completed', 'failed', 'timed_out');
create type opsrun.ai_decision as enum ('accepted', 'corrected', 'rejected', 'superseded');
create type opsrun.audit_source as enum ('opsrun', 'bzzzbx_observed');

-- ---------------------------------------------------------------------------
-- 3. Catálogos (tipos que crecen), con su seed
-- ---------------------------------------------------------------------------
create table opsrun.instruction_type (
  code text primary key,
  label text not null,
  requires_reason boolean not null default false,
  pending_question smallint check (pending_question between 1 and 12)
);
comment on table opsrun.instruction_type is 'Tipos de instrucción a BzzzBX (OPR-23).';
comment on column opsrun.instruction_type.code is 'opsrun · Código interno estable.';
comment on column opsrun.instruction_type.label is 'opsrun · Nombre que ve el operador; se ajusta sin migrar datos.';
comment on column opsrun.instruction_type.requires_reason is 'opsrun · La instrucción exige motivo (trigger).';
comment on column opsrun.instruction_type.pending_question is
  'opsrun · Pregunta abierta del spec §11 de la que depende el tipo; null si no depende de ninguna.';

insert into opsrun.instruction_type (code, label, requires_reason, pending_question) values
  ('send_email',         'Send email',          false, null),
  ('send_text',          'Send text',           false, null),
  ('create_job',         'Schedule',            false, null),
  ('reschedule_job',     'Reschedule',          true,  null),
  ('cancel_job',         'Cancel job',          true,  null),
  ('end_job_manually',   'End manually',        true,  2),
  ('write_po',           'Enter PO',            false, null),
  ('record_validation',  'Validate',            false, null),
  ('ai_analyze_request', 'AI analyze request',  false, null),
  ('ai_suggest',         'AI suggest',          false, null),
  ('ai_draft',           'AI draft',            false, null),
  ('ai_read_reply',      'AI read reply',       false, null);

create table opsrun.ai_field (
  code text primary key,
  label text not null
);
comment on table opsrun.ai_field is 'Campos que la IA puede proponer (OPR-36, OPR-37).';
comment on column opsrun.ai_field.code is 'opsrun · Código interno estable.';
comment on column opsrun.ai_field.label is 'opsrun · Nombre que ve el operador.';

insert into opsrun.ai_field (code, label) values
  ('property',             'Property'),
  ('space',                'Space'),
  ('unit',                 'Unit'),
  ('beds',                 'Beds'),
  ('service',              'Service'),
  ('service_date',         'Date'),
  ('time_window',          'Window'),
  ('access_notes',         'Access notes'),
  ('po_number',            'PO'),
  ('sender',               'Who is it from?'),
  ('cleaner_team',         'Cleaner'),
  ('multiple_jobs',        'Multiple jobs'),
  ('cleaner_reply',        'Cleaner reply'),
  ('draft_cleaner_text',   'Draft text to cleaner'),
  ('draft_customer_reply', 'Draft reply to customer');

create table opsrun.audit_event_type (
  code text primary key,
  label text not null,
  requires_reason boolean not null default false,
  source opsrun.audit_source not null default 'opsrun',
  sort_order smallint not null unique
);
comment on table opsrun.audit_event_type is 'Tipos de evento de Audit (OPR-35). Los nombres finales dependen de OPR-4.';
comment on column opsrun.audit_event_type.code is 'opsrun · Código interno estable.';
comment on column opsrun.audit_event_type.label is 'opsrun · Texto que muestra la pestaña Audit; se ajusta sin migrar datos.';
comment on column opsrun.audit_event_type.requires_reason is 'opsrun · El evento exige motivo (trigger, guard G12).';
comment on column opsrun.audit_event_type.source is 'opsrun · Quién origina el evento: opsRUN o un hecho observado en PINCH.';
comment on column opsrun.audit_event_type.sort_order is 'opsrun · Orden de OPR-35.';

insert into opsrun.audit_event_type (code, label, requires_reason, source, sort_order) values
  -- Request
  ('request_received',        'Request received',          false, 'opsrun',          10),
  ('request_assigned',        'Assigned',                  false, 'opsrun',          20),
  ('request_reassigned',      'Reassigned',                false, 'opsrun',          30),
  ('details_confirmed',       'Details confirmed',         false, 'opsrun',          40),
  ('sender_confirmed',        'Sender confirmed',          false, 'opsrun',          50),
  ('cleaner_confirmed',       'Cleaner confirmed',         false, 'opsrun',          60),
  ('confirmation_superseded', 'Confirmation superseded',   false, 'opsrun',          70),
  ('request_scheduled',       'Scheduled',                 false, 'opsrun',          80),
  -- Cleaner
  ('cleaner_asked',           'Cleaner asked',             false, 'opsrun',          90),
  ('cleaner_replied',         'Cleaner replied',           false, 'opsrun',         100),
  ('cleaner_declined',        'Cleaner declined',          false, 'opsrun',         110),
  -- Job (opsRUN)
  ('job_rescheduled',         'Rescheduled',               true,  'opsrun',         120),
  ('job_cancelled',           'Job cancelled',             true,  'opsrun',         130),
  ('job_ended_manually',      'Ended manually',            true,  'opsrun',         140),
  ('oss_marked',              'Marked as OSS / Not OSS',   false, 'opsrun',         150),
  ('job_approved',            'Approved & confirmed',      false, 'opsrun',         160),
  ('po_entered',              'PO entered',                false, 'opsrun',         170),
  ('job_validated',           'Validated',                 false, 'opsrun',         180),
  -- Job (observado en PINCH)
  ('job_checked_in',          'Checked in',                false, 'bzzzbx_observed', 190),
  ('job_started',             'Started',                   false, 'bzzzbx_observed', 200),
  ('job_completed',           'Completed',                 false, 'bzzzbx_observed', 210),
  ('job_paid',                'Paid',                      false, 'bzzzbx_observed', 220),
  -- Mensajes
  ('email_sent',              'Email sent',                false, 'opsrun',         230),
  ('text_sent',               'Text sent',                 false, 'opsrun',         240),
  ('requester_notified',      'Requester notified',        false, 'opsrun',         250),
  ('note_added',              'Note added',                false, 'opsrun',         260),
  -- Alertas
  ('alert_opened',            'Alert opened',              false, 'opsrun',         270),
  ('alert_level_changed',     'Alert level changed',       false, 'opsrun',         280),
  ('alert_resolved',          'Alert resolved',            false, 'opsrun',         290),
  ('alert_cleared',           'Alert cleared',             true,  'opsrun',         300),
  -- IA
  ('ai_analysis_completed',   'AI analysis completed',     false, 'opsrun',         310),
  ('ai_analysis_failed',      'AI analysis failed',        false, 'opsrun',         320),
  ('ai_suggestion_accepted',  'AI suggestion accepted',    false, 'opsrun',         330),
  ('ai_suggestion_corrected', 'AI suggestion corrected',   false, 'opsrun',         340),
  ('ai_suggestion_rejected',  'AI suggestion rejected',    false, 'opsrun',         350),
  -- Instrucciones
  ('instruction_failed',      'Action failed',             false, 'opsrun',         360),
  -- Operadores
  ('operator_added',          'Operator added',            false, 'opsrun',         370),
  ('operator_deactivated',    'Operator deactivated',      false, 'opsrun',         380);

-- ---------------------------------------------------------------------------
-- 4. Tablas
-- ---------------------------------------------------------------------------

-- 4.1 operator (OPR-21)
create table opsrun.operator (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email text not null check (email = trim(email) and email <> ''),
  display_name text not null check (length(trim(display_name)) > 0),
  team opsrun.operator_team not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  change_seq bigint not null
);
create unique index operator_email_lower_key on opsrun.operator (lower(email));
comment on table opsrun.operator is
  'Usuarios de Operations y Finance. Se desactivan, nunca se borran. Desacoplada del login (OPR-2).';
comment on column opsrun.operator.id is 'opsrun · Id estable: Audit y Assigned to apuntan aquí.';
comment on column opsrun.operator.auth_user_id is
  'opsrun · Usuario del GoTrue de la caja; se enlaza al primer login. Sin FK: auth es de Supabase.';
comment on column opsrun.operator.email is 'opsrun · Sirve para enlazar el login. No sale por el write-back.';
comment on column opsrun.operator.display_name is 'opsrun · Nombre que se ve en Audit y en Assigned to.';
comment on column opsrun.operator.team is 'opsrun · Operations o Finance. Informativo en V1.1 beta.';
comment on column opsrun.operator.active is 'opsrun · Solo un operador activo actúa (require_operator).';
comment on column opsrun.operator.created_at is 'opsrun · Alta.';
comment on column opsrun.operator.updated_at is 'opsrun · Último cambio.';
comment on column opsrun.operator.change_seq is 'opsrun · Cursor del write-back.';

-- 4.2 request (OPR-15, OPR-28 a OPR-32)
create sequence opsrun.request_r_number_seq;

create table opsrun.request (
  id uuid primary key default gen_random_uuid(),
  r_number bigint not null unique default nextval('opsrun.request_r_number_seq'),
  status opsrun.request_status not null default 'open',
  received_at timestamptz not null,
  owner_operator_id uuid references opsrun.operator (id) on delete restrict,
  -- Borrador
  bzzzbx_customer_id text,
  bzzzbx_contact_id text,
  bzzzbx_property_id text,
  bzzzbx_space_id text,
  unit text,
  beds smallint check (beds >= 0),
  bzzzbx_service_id text,
  service_date date,
  window_start time,
  window_end time,
  access_notes text,
  po_number text,
  bzzzbx_team_id text,
  -- Job
  bzzzbx_job_id text unique,
  job_number text unique,
  scheduled_at timestamptz,
  -- Hechos de opsRUN después de programar (provisionales, spec §11)
  ended_manually_at timestamptz,
  ended_manually_by uuid references opsrun.operator (id) on delete restrict,
  oss_mark opsrun.oss_mark,
  oss_marked_at timestamptz,
  oss_marked_by uuid references opsrun.operator (id) on delete restrict,
  oss_source opsrun.oss_source,
  approved_at timestamptz,
  approved_by uuid references opsrun.operator (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  change_seq bigint not null,

  constraint request_window_order check (window_end > window_start),
  constraint request_job_fields_together check (num_nulls(bzzzbx_job_id, job_number, scheduled_at) in (0, 3)),
  constraint request_scheduled_has_job check ((status = 'scheduled') = (bzzzbx_job_id is not null)),
  constraint request_ended_manually_pair check ((ended_manually_at is null) = (ended_manually_by is null)),
  constraint request_oss_together check (num_nulls(oss_mark, oss_marked_at, oss_source) in (0, 3)),
  constraint request_oss_by_operator check (oss_source is distinct from 'operator' or oss_marked_by is not null),
  constraint request_oss_auto check (
    oss_source is distinct from 'auto' or (oss_mark = 'oss' and oss_marked_by is null)
  ),
  constraint request_oss_by_needs_mark check (oss_marked_by is null or oss_mark is not null),
  constraint request_approved_pair check ((approved_at is null) = (approved_by is null)),
  constraint request_job_facts_need_job check (
    status = 'scheduled' or num_nonnulls(ended_manually_at, oss_mark, approved_at) = 0
  )
);
alter sequence opsrun.request_r_number_seq owned by opsrun.request.r_number;

create index request_status_owner_idx on opsrun.request (status, owner_operator_id);
create index request_open_owner_idx on opsrun.request (owner_operator_id) where status = 'open';

comment on table opsrun.request is
  'Una fila por request durante toda su vida. Al programarse gana el crosswalk del job. La etapa del tablero se calcula (spec §5).';
comment on column opsrun.request.id is 'opsrun · Id interno.';
comment on column opsrun.request.r_number is 'opsrun · R number (se muestra como R + número). Formato por confirmar (spec §11.1).';
comment on column opsrun.request.status is 'opsrun · Ciclo de opsRUN: open o scheduled.';
comment on column opsrun.request.received_at is 'opsrun · Llegada del correo original, según BzzzBX.';
comment on column opsrun.request.owner_operator_id is 'opsrun · Assigned to. Las reasignaciones salen de Audit.';
comment on column opsrun.request.bzzzbx_customer_id is 'crosswalk:draft · Who is it from?: el cliente.';
comment on column opsrun.request.bzzzbx_contact_id is 'crosswalk:draft · Who is it from?: el representante.';
comment on column opsrun.request.bzzzbx_property_id is 'crosswalk:draft · La propiedad.';
comment on column opsrun.request.bzzzbx_space_id is 'crosswalk:draft · El espacio. Por confirmar si es un registro de PINCH (spec §11.4).';
comment on column opsrun.request.unit is 'opsrun:draft · Unidad.';
comment on column opsrun.request.beds is 'opsrun:draft · Camas.';
comment on column opsrun.request.bzzzbx_service_id is 'crosswalk:draft · El servicio.';
comment on column opsrun.request.service_date is 'opsrun:draft · Fecha del servicio, local a la operación.';
comment on column opsrun.request.window_start is 'opsrun:draft · Inicio de la ventana, local a la operación.';
comment on column opsrun.request.window_end is 'opsrun:draft · Fin de la ventana, local a la operación.';
comment on column opsrun.request.access_notes is 'opsrun:draft · Notas e instrucciones de acceso.';
comment on column opsrun.request.po_number is 'opsrun:draft · PO capturado antes de programar; después vive en el job de PINCH.';
comment on column opsrun.request.bzzzbx_team_id is 'crosswalk:draft · El cleaner elegido.';
comment on column opsrun.request.bzzzbx_job_id is 'crosswalk · El job creado al programar.';
comment on column opsrun.request.job_number is 'crosswalk · Job number (Work App number en Audit).';
comment on column opsrun.request.scheduled_at is 'opsrun · Cuándo se programó.';
comment on column opsrun.request.ended_manually_at is 'opsrun · End manually (OPR-30). Provisional (spec §11.2).';
comment on column opsrun.request.ended_manually_by is 'opsrun · Quién hizo End manually.';
comment on column opsrun.request.oss_mark is 'opsrun · Mark as OSS / Not OSS (OPR-31). Provisional (spec §11.3).';
comment on column opsrun.request.oss_marked_at is 'opsrun · Cuándo se marcó OSS.';
comment on column opsrun.request.oss_marked_by is 'opsrun · Quién marcó OSS; null si se marcó sola (oss_source = auto).';
comment on column opsrun.request.oss_source is 'opsrun · operator, o auto si salió de End manually sin fotos.';
comment on column opsrun.request.approved_at is 'opsrun · Approve & confirm (OPR-31). Provisional (spec §11.2).';
comment on column opsrun.request.approved_by is 'opsrun · Quién aprobó.';
comment on column opsrun.request.created_at is 'opsrun · Alta de la fila.';
comment on column opsrun.request.updated_at is 'opsrun · Último cambio.';
comment on column opsrun.request.change_seq is 'opsrun · Cursor del write-back.';

-- 4.3 instruction (OPR-23)
create table opsrun.instruction (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references opsrun.request (id) on delete restrict,
  type text not null references opsrun.instruction_type (code),
  idempotency_key text not null unique,
  payload jsonb not null,
  reason text,
  actor_kind opsrun.actor_kind not null,
  actor_operator_id uuid references opsrun.operator (id) on delete restrict,
  status opsrun.instruction_status not null default 'pending',
  bzzzbx_reference text,
  error_code text,
  error_message text,
  attempts smallint not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  change_seq bigint not null,
  constraint instruction_actor check ((actor_kind = 'operator') = (actor_operator_id is not null))
);
create index instruction_request_idx on opsrun.instruction (request_id);

comment on table opsrun.instruction is 'Cada acción que sale a BzzzBX y su resultado. El status solo avanza.';
comment on column opsrun.instruction.id is 'opsrun · Id interno.';
comment on column opsrun.instruction.request_id is 'opsrun · La request o job al que aplica.';
comment on column opsrun.instruction.type is 'opsrun · Tipo (catálogo instruction_type).';
comment on column opsrun.instruction.idempotency_key is 'opsrun · Va a BzzzBX para que un reintento no duplique la acción.';
comment on column opsrun.instruction.payload is
  'opsrun · Lo que escribió el operador y crosswalk IDs. Nada leído de PINCH.';
comment on column opsrun.instruction.reason is 'opsrun · Motivo; obligatorio si el tipo lo pide.';
comment on column opsrun.instruction.actor_kind is 'opsrun · Quién la originó.';
comment on column opsrun.instruction.actor_operator_id is 'opsrun · El operador, si actor_kind = operator.';
comment on column opsrun.instruction.status is 'opsrun · pending, sent, confirmed, failed o timed_out. Solo avanza.';
comment on column opsrun.instruction.bzzzbx_reference is 'crosswalk · Id que devuelve BzzzBX.';
comment on column opsrun.instruction.error_code is 'opsrun · Código del error que se le muestra al operador.';
comment on column opsrun.instruction.error_message is 'opsrun · Mensaje del error que se le muestra al operador.';
comment on column opsrun.instruction.attempts is 'opsrun · Intentos de envío.';
comment on column opsrun.instruction.created_at is 'opsrun · Creación.';
comment on column opsrun.instruction.sent_at is 'opsrun · Envío a BzzzBX.';
comment on column opsrun.instruction.resolved_at is 'opsrun · Confirmación, error o timeout.';
comment on column opsrun.instruction.updated_at is 'opsrun · Último cambio.';
comment on column opsrun.instruction.change_seq is 'opsrun · Cursor del write-back.';

-- 4.4 cleaner_confirmation (OPR-17, OPR-28, OPR-29)
create table opsrun.cleaner_confirmation (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references opsrun.request (id) on delete restrict,
  purpose opsrun.cleaner_confirmation_purpose not null,
  bzzzbx_team_id text not null,
  new_service_date date,
  new_window_start time,
  new_window_end time,
  reason text,
  status opsrun.cleaner_confirmation_status not null default 'asked',
  ask_instruction_id uuid references opsrun.instruction (id) on delete restrict,
  reply_bzzzbx_message_id text,
  decided_by uuid references opsrun.operator (id) on delete restrict,
  decided_at timestamptz,
  asked_at timestamptz not null default now(),
  actor_kind opsrun.actor_kind not null,
  actor_operator_id uuid references opsrun.operator (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  change_seq bigint not null,
  constraint cleaner_confirmation_actor check ((actor_kind = 'operator') = (actor_operator_id is not null)),
  constraint cleaner_confirmation_new_slot_only_reschedule check (
    purpose = 'reschedule' or num_nonnulls(new_service_date, new_window_start, new_window_end) = 0
  ),
  constraint cleaner_confirmation_reschedule_reason check (
    purpose <> 'reschedule' or coalesce(length(trim(reason)), 0) > 0
  ),
  constraint cleaner_confirmation_window_order check (new_window_end > new_window_start),
  constraint cleaner_confirmation_decided_pair check ((decided_by is null) = (decided_at is null)),
  -- Ninguna lectura de la IA confirma sola: confirmed y declined exigen operador.
  constraint cleaner_confirmation_decision_by_operator check (
    status not in ('confirmed', 'declined') or decided_by is not null
  )
);
create index cleaner_confirmation_request_idx on opsrun.cleaner_confirmation (request_id);
create index cleaner_confirmation_waiting_idx on opsrun.cleaner_confirmation (request_id)
  where status in ('asked', 'replied');

comment on table opsrun.cleaner_confirmation is
  'Cada pregunta al cleaner (inicial o Reschedule). Las abiertas forman la sección Waiting de Alerts.';
comment on column opsrun.cleaner_confirmation.id is 'opsrun · Id interno.';
comment on column opsrun.cleaner_confirmation.request_id is 'opsrun · La request o job.';
comment on column opsrun.cleaner_confirmation.purpose is 'opsrun · initial o reschedule.';
comment on column opsrun.cleaner_confirmation.bzzzbx_team_id is 'crosswalk · El cleaner al que se le pregunta.';
comment on column opsrun.cleaner_confirmation.new_service_date is 'opsrun · Reschedule: fecha propuesta.';
comment on column opsrun.cleaner_confirmation.new_window_start is 'opsrun · Reschedule: inicio de la ventana propuesta.';
comment on column opsrun.cleaner_confirmation.new_window_end is 'opsrun · Reschedule: fin de la ventana propuesta.';
comment on column opsrun.cleaner_confirmation.reason is 'opsrun · Motivo; obligatorio para reschedule.';
comment on column opsrun.cleaner_confirmation.status is 'opsrun · asked, replied, confirmed, declined o withdrawn.';
comment on column opsrun.cleaner_confirmation.ask_instruction_id is 'opsrun · El send_text que hizo la pregunta.';
comment on column opsrun.cleaner_confirmation.reply_bzzzbx_message_id is 'crosswalk · La respuesta del cleaner.';
comment on column opsrun.cleaner_confirmation.decided_by is 'opsrun · Operador que aceptó o rechazó la respuesta.';
comment on column opsrun.cleaner_confirmation.decided_at is 'opsrun · Cuándo se decidió.';
comment on column opsrun.cleaner_confirmation.asked_at is 'opsrun · Cuándo se preguntó.';
comment on column opsrun.cleaner_confirmation.actor_kind is 'opsrun · Quién preguntó.';
comment on column opsrun.cleaner_confirmation.actor_operator_id is 'opsrun · El operador, si actor_kind = operator.';
comment on column opsrun.cleaner_confirmation.created_at is 'opsrun · Alta de la fila.';
comment on column opsrun.cleaner_confirmation.updated_at is 'opsrun · Último cambio.';
comment on column opsrun.cleaner_confirmation.change_seq is 'opsrun · Cursor del write-back.';

-- 4.5 request_confirmation (OPR-28): el gate antes de Schedule
create table opsrun.request_confirmation (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references opsrun.request (id) on delete restrict,
  kind opsrun.confirmation_kind not null,
  method opsrun.confirmation_method not null,
  confirmed_value jsonb not null,
  cleaner_confirmation_id uuid references opsrun.cleaner_confirmation (id) on delete restrict,
  actor_kind opsrun.actor_kind not null default 'operator',
  actor_operator_id uuid not null references opsrun.operator (id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  change_seq bigint not null,
  -- Ninguna sugerencia confirma nada sola: siempre un operador.
  constraint request_confirmation_by_operator check (actor_kind = 'operator'),
  constraint request_confirmation_cleaner_link check (cleaner_confirmation_id is null or kind = 'cleaner'),
  constraint request_confirmation_cleaner_text check (
    method <> 'cleaner_text' or (kind = 'cleaner' and cleaner_confirmation_id is not null)
  ),
  constraint request_confirmation_superseded_after check (superseded_at is null or superseded_at >= confirmed_at)
);
create index request_confirmation_request_idx on opsrun.request_confirmation (request_id);
create unique index request_confirmation_current_key on opsrun.request_confirmation (request_id, kind)
  where superseded_at is null;

comment on table opsrun.request_confirmation is
  'Confirmaciones de details, sender y cleaner. Schedule exige una vigente de cada tipo y un dueño.';
comment on column opsrun.request_confirmation.id is 'opsrun · Id interno.';
comment on column opsrun.request_confirmation.request_id is 'opsrun · La request.';
comment on column opsrun.request_confirmation.kind is 'opsrun · details, sender o cleaner.';
comment on column opsrun.request_confirmation.method is 'opsrun · operator, cleaner_text (respuesta aceptada) o phone.';
comment on column opsrun.request_confirmation.confirmed_value is
  'opsrun · Lo que se confirmó: solo valores del borrador y crosswalk IDs.';
comment on column opsrun.request_confirmation.cleaner_confirmation_id is 'opsrun · La respuesta del cleaner que se aceptó.';
comment on column opsrun.request_confirmation.actor_kind is 'opsrun · Siempre operator.';
comment on column opsrun.request_confirmation.actor_operator_id is 'opsrun · Quién confirmó.';
comment on column opsrun.request_confirmation.confirmed_at is 'opsrun · Cuándo se confirmó.';
comment on column opsrun.request_confirmation.superseded_at is 'opsrun · Si el borrador cambió después; deja de valer.';
comment on column opsrun.request_confirmation.created_at is 'opsrun · Alta de la fila.';
comment on column opsrun.request_confirmation.updated_at is 'opsrun · Último cambio.';
comment on column opsrun.request_confirmation.change_seq is 'opsrun · Cursor del write-back.';

-- 4.6 request_message (OPR-15 a OPR-19, OPR-27): solo el vínculo
create table opsrun.request_message (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references opsrun.request (id) on delete restrict,
  bzzzbx_message_id text not null unique,
  bzzzbx_thread_id text,
  channel opsrun.message_channel not null,
  direction opsrun.message_direction not null,
  is_original boolean not null default false,
  instruction_id uuid references opsrun.instruction (id) on delete restrict,
  linked_at timestamptz not null default now(),
  actor_kind opsrun.actor_kind not null,
  actor_operator_id uuid references opsrun.operator (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  change_seq bigint not null,
  constraint request_message_actor check ((actor_kind = 'operator') = (actor_operator_id is not null)),
  constraint request_message_instruction_outbound check (instruction_id is null or direction = 'outbound'),
  constraint request_message_original_inbound check (not is_original or direction = 'inbound')
);
create index request_message_request_idx on opsrun.request_message (request_id);
create unique index request_message_one_original_key on opsrun.request_message (request_id) where is_original;

comment on table opsrun.request_message is
  'A qué request pertenece cada mensaje. El cuerpo, los adjuntos y la entrega se leen de BzzzBX.';
comment on column opsrun.request_message.id is 'opsrun · Id interno.';
comment on column opsrun.request_message.request_id is 'opsrun · La request.';
comment on column opsrun.request_message.bzzzbx_message_id is 'crosswalk · El mensaje. Único: deduplica la intake.';
comment on column opsrun.request_message.bzzzbx_thread_id is 'crosswalk · La conversación de correo.';
comment on column opsrun.request_message.channel is 'opsrun · email o text.';
comment on column opsrun.request_message.direction is 'opsrun · inbound u outbound.';
comment on column opsrun.request_message.is_original is 'opsrun · El correo que creó la request.';
comment on column opsrun.request_message.instruction_id is 'opsrun · El envío desde opsRUN, para mensajes outbound.';
comment on column opsrun.request_message.linked_at is 'opsrun · Cuándo se vinculó.';
comment on column opsrun.request_message.actor_kind is 'opsrun · system si lo enhebró la intake; operator si se movió a mano.';
comment on column opsrun.request_message.actor_operator_id is 'opsrun · El operador, si actor_kind = operator.';
comment on column opsrun.request_message.created_at is 'opsrun · Alta de la fila.';
comment on column opsrun.request_message.updated_at is 'opsrun · Último cambio.';
comment on column opsrun.request_message.change_seq is 'opsrun · Cursor del write-back.';

-- 4.7 note (OPR-27). Append-only por diseño (por confirmar, spec §11.8).
create table opsrun.note (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references opsrun.request (id) on delete restrict,
  author_operator_id uuid not null references opsrun.operator (id) on delete restrict,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index note_request_idx on opsrun.note (request_id, created_at);

comment on table opsrun.note is 'Notas internas de la conversación. No salen en el write-back v1.';
comment on column opsrun.note.id is 'opsrun · Id interno.';
comment on column opsrun.note.request_id is 'opsrun · La request.';
comment on column opsrun.note.author_operator_id is 'opsrun · Autor.';
comment on column opsrun.note.body is 'opsrun · Texto de la nota.';
comment on column opsrun.note.created_at is 'opsrun · Cuándo se escribió.';

-- 4.8 alert_occurrence (OPR-19, OPR-29 a OPR-32, OPR-34)
create table opsrun.alert_occurrence (
  id uuid primary key default gen_random_uuid(),
  bzzzbx_alert_id text not null unique,
  request_id uuid not null references opsrun.request (id) on delete restrict,
  rule_id text not null,
  rule_version text not null,
  level opsrun.alert_level not null,
  reason_text text not null,
  bzzzbx_message_id text,
  opened_at timestamptz not null,
  first_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution opsrun.alert_resolution,
  resolved_by uuid references opsrun.operator (id) on delete restrict,
  resolution_reason text,
  resolving_instruction_id uuid references opsrun.instruction (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  change_seq bigint not null,
  constraint alert_occurrence_resolved_pair check ((resolved_at is null) = (resolution is null)),
  constraint alert_occurrence_open_has_no_resolution check (
    resolved_at is not null
    or num_nonnulls(resolved_by, resolution_reason, resolving_instruction_id) = 0
  ),
  constraint alert_occurrence_resolved_by check (
    resolution is null
    or (resolution = 'auto_cleared') = (resolved_by is null)
  ),
  constraint alert_occurrence_clear_reason check (
    resolution is distinct from 'cleared_by_operator' or coalesce(length(trim(resolution_reason)), 0) > 0
  ),
  constraint alert_occurrence_instruction_fixed check (
    resolving_instruction_id is null or resolution = 'fixed_by_action'
  ),
  constraint alert_occurrence_resolved_after check (resolved_at is null or resolved_at >= opened_at)
);
create index alert_occurrence_open_idx on opsrun.alert_occurrence (request_id) where resolved_at is null;
create index alert_occurrence_rule_idx on opsrun.alert_occurrence (request_id, rule_id);

comment on table opsrun.alert_occurrence is
  'Cada apertura de una regla de alerta, completa, con su resolución. Las reglas las calcula BzzzBX (OPR-33).';
comment on column opsrun.alert_occurrence.id is 'opsrun · Id interno.';
comment on column opsrun.alert_occurrence.bzzzbx_alert_id is 'crosswalk · La ocurrencia en BzzzBX.';
comment on column opsrun.alert_occurrence.request_id is 'opsrun · La request o job.';
comment on column opsrun.alert_occurrence.rule_id is 'crosswalk · La regla (OPS-001 … TRN-005, Message not delivered).';
comment on column opsrun.alert_occurrence.rule_version is 'crosswalk · Versión de la regla.';
comment on column opsrun.alert_occurrence.level is 'opsrun · amber o red; cada cambio deja un evento en Audit.';
comment on column opsrun.alert_occurrence.reason_text is
  'bzzzbx-snapshot · El motivo con su evidencia tal como llegó al abrirse. No es un dato del negocio.';
comment on column opsrun.alert_occurrence.bzzzbx_message_id is 'crosswalk · Solo para Message not delivered.';
comment on column opsrun.alert_occurrence.opened_at is 'opsrun · Apertura, hora de BzzzBX.';
comment on column opsrun.alert_occurrence.first_seen_at is 'opsrun · Cuándo la vio opsRUN.';
comment on column opsrun.alert_occurrence.resolved_at is 'opsrun · Resolución.';
comment on column opsrun.alert_occurrence.resolution is 'opsrun · auto_cleared, fixed_by_action o cleared_by_operator.';
comment on column opsrun.alert_occurrence.resolved_by is 'opsrun · Operador; obligatorio salvo auto_cleared.';
comment on column opsrun.alert_occurrence.resolution_reason is 'opsrun · Motivo; obligatorio con Clear alert.';
comment on column opsrun.alert_occurrence.resolving_instruction_id is 'opsrun · La acción que la resolvió.';
comment on column opsrun.alert_occurrence.created_at is 'opsrun · Alta de la fila.';
comment on column opsrun.alert_occurrence.updated_at is 'opsrun · Último cambio.';
comment on column opsrun.alert_occurrence.change_seq is 'opsrun · Cursor del write-back.';

-- 4.9 ai_analysis y ai_suggestion (OPR-17, OPR-28, OPR-36, OPR-37)
create table opsrun.ai_analysis (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references opsrun.request (id) on delete restrict,
  instruction_id uuid not null references opsrun.instruction (id) on delete restrict,
  status opsrun.ai_analysis_status not null default 'pending',
  model text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  change_seq bigint not null
);
create index ai_analysis_request_idx on opsrun.ai_analysis (request_id);

comment on table opsrun.ai_analysis is 'Una corrida de análisis de IA sobre una request; salió por BzzzBX.';
comment on column opsrun.ai_analysis.id is 'opsrun · Id interno.';
comment on column opsrun.ai_analysis.request_id is 'opsrun · La request.';
comment on column opsrun.ai_analysis.instruction_id is 'opsrun · La instrucción que pidió el análisis.';
comment on column opsrun.ai_analysis.status is 'opsrun · pending, completed, failed o timed_out.';
comment on column opsrun.ai_analysis.model is 'opsrun · Modelo que reporta BzzzBX.';
comment on column opsrun.ai_analysis.requested_at is 'opsrun · Pedido (meta de 1 minuto, OPR-39).';
comment on column opsrun.ai_analysis.completed_at is 'opsrun · Respuesta.';
comment on column opsrun.ai_analysis.created_at is 'opsrun · Alta de la fila.';
comment on column opsrun.ai_analysis.updated_at is 'opsrun · Último cambio.';
comment on column opsrun.ai_analysis.change_seq is 'opsrun · Cursor del write-back.';

create table opsrun.ai_suggestion (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references opsrun.request (id) on delete restrict,
  ai_analysis_id uuid references opsrun.ai_analysis (id) on delete restrict,
  cleaner_confirmation_id uuid references opsrun.cleaner_confirmation (id) on delete restrict,
  field text not null references opsrun.ai_field (code),
  rank smallint not null default 1 check (rank >= 1),
  value jsonb not null,
  reason text,
  decision opsrun.ai_decision,
  final_value jsonb,
  decided_by uuid references opsrun.operator (id) on delete restrict,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  change_seq bigint not null,
  constraint ai_suggestion_cleaner_reply check ((field = 'cleaner_reply') = (cleaner_confirmation_id is not null)),
  constraint ai_suggestion_corrected_value check ((decision = 'corrected') = (final_value is not null)),
  constraint ai_suggestion_undecided check (decision is not null or num_nonnulls(decided_by, decided_at) = 0),
  constraint ai_suggestion_operator_decision check (
    decision is null or decision = 'superseded' or (decided_by is not null and decided_at is not null)
  ),
  constraint ai_suggestion_superseded_by_system check (decision is distinct from 'superseded' or decided_by is null)
);
create index ai_suggestion_request_idx on opsrun.ai_suggestion (request_id);
create index ai_suggestion_open_idx on opsrun.ai_suggestion (request_id, field) where decision is null;

comment on table opsrun.ai_suggestion is
  'Una fila por campo y por propuesta de la IA. Sin decisión, el campo se ve AI-marked.';
comment on column opsrun.ai_suggestion.id is 'opsrun · Id interno.';
comment on column opsrun.ai_suggestion.request_id is 'opsrun · La request.';
comment on column opsrun.ai_suggestion.ai_analysis_id is 'opsrun · El análisis que la propuso.';
comment on column opsrun.ai_suggestion.cleaner_confirmation_id is 'opsrun · Solo para cleaner_reply.';
comment on column opsrun.ai_suggestion.field is 'opsrun · Campo (catálogo ai_field).';
comment on column opsrun.ai_suggestion.rank is 'opsrun · 1 es la propuesta principal; el resto, alternativas.';
comment on column opsrun.ai_suggestion.value is 'opsrun · Valor propuesto: crosswalk IDs o valores del borrador.';
comment on column opsrun.ai_suggestion.reason is 'opsrun · Por qué lo propone.';
comment on column opsrun.ai_suggestion.decision is 'opsrun · accepted, corrected, rejected o superseded; null sin decidir.';
comment on column opsrun.ai_suggestion.final_value is 'opsrun · Lo que puso el operador al corregir.';
comment on column opsrun.ai_suggestion.decided_by is 'opsrun · Operador que decidió.';
comment on column opsrun.ai_suggestion.decided_at is 'opsrun · Cuándo se decidió.';
comment on column opsrun.ai_suggestion.created_at is 'opsrun · Alta de la fila.';
comment on column opsrun.ai_suggestion.updated_at is 'opsrun · Último cambio.';
comment on column opsrun.ai_suggestion.change_seq is 'opsrun · Cursor del write-back.';

-- 4.10 message_template (OPR-18). En V1.1 beta se cambian por migración (spec §11.9).
create table opsrun.message_template (
  key text not null,
  version integer not null check (version >= 1),
  channel opsrun.message_channel not null,
  subject text,
  body text not null check (length(trim(body)) > 0),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  change_seq bigint not null,
  primary key (key, version),
  constraint message_template_subject_email check (subject is null or channel = 'email')
);
create unique index message_template_one_active_key on opsrun.message_template (key) where active;

comment on table opsrun.message_template is 'Plantillas de mensajes, versionadas. No salen en el write-back v1.';
comment on column opsrun.message_template.key is 'opsrun · Clave de la plantilla.';
comment on column opsrun.message_template.version is 'opsrun · Versión.';
comment on column opsrun.message_template.channel is 'opsrun · email o text.';
comment on column opsrun.message_template.subject is 'opsrun · Asunto, solo para correo.';
comment on column opsrun.message_template.body is
  'opsrun · Texto con placeholders ({{property}}, {{space}}, {{date}}, {{window}}); se llenan al enviar.';
comment on column opsrun.message_template.active is 'opsrun · Una versión activa por clave.';
comment on column opsrun.message_template.created_at is 'opsrun · Alta de la fila.';
comment on column opsrun.message_template.updated_at is 'opsrun · Último cambio.';
comment on column opsrun.message_template.change_seq is 'opsrun · Cursor del write-back.';

-- 4.11 audit_event (OPR-21, OPR-29, OPR-30, OPR-35): append-only
create table opsrun.audit_event (
  id bigint generated always as identity primary key,
  request_id uuid references opsrun.request (id) on delete restrict,
  event_type text not null references opsrun.audit_event_type (code),
  actor_kind opsrun.actor_kind not null,
  actor_operator_id uuid references opsrun.operator (id) on delete restrict,
  reason text,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  source opsrun.audit_source not null default 'opsrun',
  bzzzbx_event_id text unique,
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  instruction_id uuid references opsrun.instruction (id) on delete restrict,
  alert_occurrence_id uuid references opsrun.alert_occurrence (id) on delete restrict,
  ai_suggestion_id uuid references opsrun.ai_suggestion (id) on delete restrict,
  cleaner_confirmation_id uuid references opsrun.cleaner_confirmation (id) on delete restrict,
  constraint audit_event_actor check ((actor_kind = 'operator') = (actor_operator_id is not null))
);
create index audit_event_request_idx on opsrun.audit_event (request_id, occurred_at);

comment on table opsrun.audit_event is
  'Audit: todo lo que pasa en opsRUN y lo que observa de PINCH. Append-only: una corrección es un evento nuevo.';
comment on column opsrun.audit_event.id is 'opsrun · Orden de registro y cursor del write-back.';
comment on column opsrun.audit_event.request_id is 'opsrun · La request; null solo en eventos de operación.';
comment on column opsrun.audit_event.event_type is 'opsrun · Tipo (catálogo audit_event_type).';
comment on column opsrun.audit_event.actor_kind is 'opsrun · operator, system, ai o bzzzbx.';
comment on column opsrun.audit_event.actor_operator_id is 'opsrun · El operador, si actor_kind = operator.';
comment on column opsrun.audit_event.reason is 'opsrun · Motivo; obligatorio si el tipo lo pide.';
comment on column opsrun.audit_event.occurred_at is 'opsrun · Cuándo pasó; para hechos observados, la hora de BzzzBX.';
comment on column opsrun.audit_event.recorded_at is 'opsrun · Cuándo se escribió.';
comment on column opsrun.audit_event.source is 'opsrun · opsrun o bzzzbx_observed.';
comment on column opsrun.audit_event.bzzzbx_event_id is 'crosswalk · Deduplica los hechos observados.';
comment on column opsrun.audit_event.details is
  'opsrun · Solo valores de opsRUN y crosswalk IDs. Nunca nombres, direcciones ni montos de PINCH.';
comment on column opsrun.audit_event.instruction_id is 'opsrun · Detalle: la instrucción.';
comment on column opsrun.audit_event.alert_occurrence_id is 'opsrun · Detalle: la alerta.';
comment on column opsrun.audit_event.ai_suggestion_id is 'opsrun · Detalle: la sugerencia de IA.';
comment on column opsrun.audit_event.cleaner_confirmation_id is 'opsrun · Detalle: la pregunta al cleaner.';

-- ---------------------------------------------------------------------------
-- 5. Actor de la transacción
-- ---------------------------------------------------------------------------
-- El servidor declara quién actúa, en cada transacción, con
-- set_config(..., true): opsrun.auth_user_id para un operador (el id del
-- usuario del GoTrue de la caja, ya validado) u opsrun.system_actor para un
-- proceso del sistema. Nunca los dos. Solo los llaman las funciones de
-- escritura, que corren como opsrun_migrador; nadie más alcanza opsrun_private.

-- Valor de un ajuste de la transacción, o null si no está o está vacío.
create function opsrun_private.setting(p_name text)
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(trim(current_setting(p_name, true)), '');
$$;
comment on function opsrun_private.setting(text) is
  'current_setting(nombre, true) con vacío como null.';

create function opsrun_private.current_operator_id()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_auth text := opsrun_private.setting('opsrun.auth_user_id');
begin
  if v_auth is null then
    return null;
  end if;
  return (
    select o.id
    from opsrun.operator as o
    where o.auth_user_id = v_auth::uuid
      and o.active
  );
exception
  when invalid_text_representation then
    return null;
end;
$$;
comment on function opsrun_private.current_operator_id() is
  'Id del operador activo cuyo auth_user_id es opsrun.auth_user_id, o null.';

create function opsrun_private.require_operator()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_operator_id uuid;
begin
  if opsrun_private.setting('opsrun.system_actor') is not null then
    raise exception 'opsRUN: la transacción declara a la vez un operador y un actor de sistema'
      using errcode = '42501';
  end if;
  v_operator_id := opsrun_private.current_operator_id();
  if v_operator_id is null then
    raise exception 'opsRUN: se requiere un operador activo'
      using errcode = '42501';
  end if;
  return v_operator_id;
end;
$$;
comment on function opsrun_private.require_operator() is
  'Como current_operator_id(), pero lanza 42501 sin operador activo o si también hay actor de sistema. La llama toda escritura del operador (G6).';

create function opsrun_private.require_system()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_system text := opsrun_private.setting('opsrun.system_actor');
begin
  if opsrun_private.setting('opsrun.auth_user_id') is not null then
    raise exception 'opsRUN: la transacción declara a la vez un actor de sistema y un operador'
      using errcode = '42501';
  end if;
  if v_system is null then
    raise exception 'opsRUN: se requiere un actor de sistema (opsrun.system_actor)'
      using errcode = '42501';
  end if;
  return v_system;
end;
$$;
comment on function opsrun_private.require_system() is
  'Devuelve opsrun.system_actor; lanza 42501 si falta o si también hay operador. La llama toda escritura del sistema (G6).';

-- ---------------------------------------------------------------------------
-- 6. Triggers
-- ---------------------------------------------------------------------------
-- Corren como quien escribe: opsrun_migrador, directo (seed) o a través de
-- las funciones de escritura. Ninguno necesita security definer.

-- 6.1 updated_at y change_seq en las tablas mutables.
create function opsrun_private.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.change_seq := nextval('opsrun_private.change_seq');
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger touch_row before insert or update on opsrun.operator
  for each row execute function opsrun_private.touch_row();
create trigger touch_row before insert or update on opsrun.request
  for each row execute function opsrun_private.touch_row();
create trigger touch_row before insert or update on opsrun.instruction
  for each row execute function opsrun_private.touch_row();
create trigger touch_row before insert or update on opsrun.cleaner_confirmation
  for each row execute function opsrun_private.touch_row();
create trigger touch_row before insert or update on opsrun.request_confirmation
  for each row execute function opsrun_private.touch_row();
create trigger touch_row before insert or update on opsrun.request_message
  for each row execute function opsrun_private.touch_row();
create trigger touch_row before insert or update on opsrun.alert_occurrence
  for each row execute function opsrun_private.touch_row();
create trigger touch_row before insert or update on opsrun.ai_analysis
  for each row execute function opsrun_private.touch_row();
create trigger touch_row before insert or update on opsrun.ai_suggestion
  for each row execute function opsrun_private.touch_row();
create trigger touch_row before insert or update on opsrun.message_template
  for each row execute function opsrun_private.touch_row();

-- 6.2 Audit inmutable, para todos los roles (también opsrun_migrador y los
-- superusuarios).
create function opsrun_private.audit_event_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'opsRUN: audit_event es append-only (% rechazado); una corrección es un evento nuevo', tg_op
    using errcode = 'OP001';
end;
$$;

create trigger audit_event_immutable_row before update or delete on opsrun.audit_event
  for each row execute function opsrun_private.audit_event_immutable();
create trigger audit_event_immutable_truncate before truncate on opsrun.audit_event
  for each statement execute function opsrun_private.audit_event_immutable();

-- 6.3 Motivo obligatorio según el catálogo.
create function opsrun_private.audit_event_require_reason()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(length(trim(new.reason)), 0) = 0
     and exists (
       select 1 from opsrun.audit_event_type as t
       where t.code = new.event_type and t.requires_reason
     ) then
    raise exception 'opsRUN: el evento % exige motivo', new.event_type
      using errcode = 'OP002';
  end if;
  return new;
end;
$$;

create trigger audit_event_require_reason before insert on opsrun.audit_event
  for each row execute function opsrun_private.audit_event_require_reason();

create function opsrun_private.instruction_require_reason()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(length(trim(new.reason)), 0) = 0
     and exists (
       select 1 from opsrun.instruction_type as t
       where t.code = new.type and t.requires_reason
     ) then
    raise exception 'opsRUN: la instrucción % exige motivo', new.type
      using errcode = 'OP002';
  end if;
  return new;
end;
$$;

create trigger instruction_require_reason before insert or update of type, reason on opsrun.instruction
  for each row execute function opsrun_private.instruction_require_reason();

-- 6.4 Borrador congelado. Una vez programada, manda el job en PINCH: el
-- borrador queda como registro de lo que se confirmó, y la request no vuelve
-- a open. Las columnas del borrador son las marcadas ":draft" en su COMMENT;
-- el guard G11 las lee de ahí y comprueba que esta lista no se quede corta.
create function opsrun_private.request_draft_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'scheduled' then
    if new.status <> 'scheduled' then
      raise exception 'opsRUN: una request programada no vuelve a open'
        using errcode = 'OP003';
    end if;
    if (
      old.bzzzbx_customer_id, old.bzzzbx_contact_id, old.bzzzbx_property_id, old.bzzzbx_space_id,
      old.unit, old.beds, old.bzzzbx_service_id, old.service_date, old.window_start, old.window_end,
      old.access_notes, old.po_number, old.bzzzbx_team_id
    ) is distinct from (
      new.bzzzbx_customer_id, new.bzzzbx_contact_id, new.bzzzbx_property_id, new.bzzzbx_space_id,
      new.unit, new.beds, new.bzzzbx_service_id, new.service_date, new.window_start, new.window_end,
      new.access_notes, new.po_number, new.bzzzbx_team_id
    ) then
      raise exception 'opsRUN: el borrador de una request programada no cambia; manda el job en PINCH'
        using errcode = 'OP003';
    end if;
  end if;
  return new;
end;
$$;

create trigger request_draft_frozen before update on opsrun.request
  for each row execute function opsrun_private.request_draft_frozen();

-- 6.5 Gate de Schedule: dueño y una confirmación vigente de cada tipo.
create function opsrun_private.request_schedule_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_missing text;
begin
  if new.status = 'scheduled' and (tg_op = 'INSERT' or old.status <> 'scheduled') then
    if new.owner_operator_id is null then
      raise exception 'opsRUN: Schedule exige un dueño (Assigned to)'
        using errcode = 'OP005';
    end if;

    select string_agg(k::text, ', ' order by k)
      into v_missing
      from unnest(enum_range(null::opsrun.confirmation_kind)) as k
     where not exists (
       select 1 from opsrun.request_confirmation as c
        where c.request_id = new.id
          and c.kind = k
          and c.superseded_at is null
     );

    if v_missing is not null then
      raise exception 'opsRUN: Schedule exige confirmación vigente de: %', v_missing
        using errcode = 'OP005';
    end if;
  end if;
  return new;
end;
$$;

create trigger request_schedule_gate before insert or update of status on opsrun.request
  for each row execute function opsrun_private.request_schedule_gate();

-- 6.6 instruction.status solo avanza: pending → sent → confirmed | failed | timed_out.
create function opsrun_private.instruction_status_forward()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and (old.status in ('confirmed', 'failed', 'timed_out') or new.status < old.status) then
    raise exception 'opsRUN: instruction.status no vuelve atrás (% → %)', old.status, new.status
      using errcode = 'OP004';
  end if;
  return new;
end;
$$;

create trigger instruction_status_forward before update of status on opsrun.instruction
  for each row execute function opsrun_private.instruction_status_forward();

-- ---------------------------------------------------------------------------
-- 7. Vista request_ai_marks
-- ---------------------------------------------------------------------------
-- Un campo está AI-marked mientras tenga una sugerencia principal sin decidir.
-- security_invoker: lee ai_suggestion con los permisos y la RLS de quien consulta.
create view opsrun.request_ai_marks
with (security_invoker = true)
as
  select s.request_id, s.field, s.id as suggestion_id
  from opsrun.ai_suggestion as s
  where s.rank = 1
    and s.decision is null;
comment on view opsrun.request_ai_marks is
  'Campos AI-marked: los que tienen una sugerencia rank 1 sin decidir.';

-- ---------------------------------------------------------------------------
-- 8. Permisos y RLS (spec §6)
-- ---------------------------------------------------------------------------
-- opsrun_app solo lee `opsrun`. Nadie más tiene nada; el dueño escribe.
revoke all on all tables in schema opsrun from public;
revoke all on all sequences in schema opsrun from public;
grant select on all tables in schema opsrun to opsrun_app;

-- Audit: nadie lo modifica, tampoco el dueño. El trigger lo frena igual.
revoke update, delete, truncate on opsrun.audit_event from public, opsrun_migrador;

-- opsrun_private: solo el dueño. (Las funciones ya nacen sin EXECUTE para
-- PUBLIC por el ALTER DEFAULT PRIVILEGES de la migración de OPR-1.)
revoke all on all functions in schema opsrun_private from public;
revoke all on all sequences in schema opsrun_private from public;

-- RLS de respaldo: los permisos son la frontera. Una sola política por tabla,
-- para opsrun_app; cualquier otro rol con SELECT por error vería 0 filas.
alter table opsrun.operator enable row level security;
alter table opsrun.instruction_type enable row level security;
alter table opsrun.ai_field enable row level security;
alter table opsrun.audit_event_type enable row level security;
alter table opsrun.request enable row level security;
alter table opsrun.instruction enable row level security;
alter table opsrun.cleaner_confirmation enable row level security;
alter table opsrun.request_confirmation enable row level security;
alter table opsrun.request_message enable row level security;
alter table opsrun.note enable row level security;
alter table opsrun.alert_occurrence enable row level security;
alter table opsrun.ai_analysis enable row level security;
alter table opsrun.ai_suggestion enable row level security;
alter table opsrun.message_template enable row level security;
alter table opsrun.audit_event enable row level security;

create policy "operator: opsrun_app lee" on opsrun.operator
  for select to opsrun_app using (true);
create policy "instruction_type: opsrun_app lee" on opsrun.instruction_type
  for select to opsrun_app using (true);
create policy "ai_field: opsrun_app lee" on opsrun.ai_field
  for select to opsrun_app using (true);
create policy "audit_event_type: opsrun_app lee" on opsrun.audit_event_type
  for select to opsrun_app using (true);
create policy "request: opsrun_app lee" on opsrun.request
  for select to opsrun_app using (true);
create policy "instruction: opsrun_app lee" on opsrun.instruction
  for select to opsrun_app using (true);
create policy "cleaner_confirmation: opsrun_app lee" on opsrun.cleaner_confirmation
  for select to opsrun_app using (true);
create policy "request_confirmation: opsrun_app lee" on opsrun.request_confirmation
  for select to opsrun_app using (true);
create policy "request_message: opsrun_app lee" on opsrun.request_message
  for select to opsrun_app using (true);
create policy "note: opsrun_app lee" on opsrun.note
  for select to opsrun_app using (true);
create policy "alert_occurrence: opsrun_app lee" on opsrun.alert_occurrence
  for select to opsrun_app using (true);
create policy "ai_analysis: opsrun_app lee" on opsrun.ai_analysis
  for select to opsrun_app using (true);
create policy "ai_suggestion: opsrun_app lee" on opsrun.ai_suggestion
  for select to opsrun_app using (true);
create policy "message_template: opsrun_app lee" on opsrun.message_template
  for select to opsrun_app using (true);
create policy "audit_event: opsrun_app lee" on opsrun.audit_event
  for select to opsrun_app using (true);

-- ---------------------------------------------------------------------------
-- 9. Write-back (OPR-24): vistas v1 para bzzz_writeback_opsrun
-- ---------------------------------------------------------------------------
-- Las vistas son el contrato: si cambia una tabla, v1 se mantiene o se crea v2.
-- Corren con los permisos de su dueño (opsrun_migrador, no sujeto a RLS), así
-- que el lector no necesita nada sobre las tablas. Notas y plantillas no salen
-- en v1 (spec §7). bzzz_writeback_opsrun es de la caja: lo crea el alta en
-- Bzzz; aquí solo se le concede.
create view opsrun_writeback.v1_operator as
  select o.id, o.display_name, o.team, o.change_seq
  from opsrun.operator as o;

create view opsrun_writeback.v1_request as
  select r.id, r.r_number, r.status, r.received_at, r.owner_operator_id,
         r.bzzzbx_customer_id, r.bzzzbx_contact_id, r.bzzzbx_property_id, r.bzzzbx_space_id,
         r.unit, r.beds, r.bzzzbx_service_id, r.service_date, r.window_start, r.window_end,
         r.access_notes, r.po_number, r.bzzzbx_team_id,
         r.bzzzbx_job_id, r.job_number, r.scheduled_at,
         r.ended_manually_at, r.ended_manually_by,
         r.oss_mark, r.oss_marked_at, r.oss_marked_by, r.oss_source,
         r.approved_at, r.approved_by,
         r.created_at, r.updated_at, r.change_seq
  from opsrun.request as r;

create view opsrun_writeback.v1_request_confirmation as
  select c.id, c.request_id, c.kind, c.method, c.confirmed_value, c.cleaner_confirmation_id,
         c.actor_kind, c.actor_operator_id, c.confirmed_at, c.superseded_at,
         c.created_at, c.updated_at, c.change_seq
  from opsrun.request_confirmation as c;

create view opsrun_writeback.v1_cleaner_confirmation as
  select c.id, c.request_id, c.purpose, c.bzzzbx_team_id,
         c.new_service_date, c.new_window_start, c.new_window_end, c.reason, c.status,
         c.ask_instruction_id, c.reply_bzzzbx_message_id, c.decided_by, c.decided_at,
         c.asked_at, c.actor_kind, c.actor_operator_id,
         c.created_at, c.updated_at, c.change_seq
  from opsrun.cleaner_confirmation as c;

create view opsrun_writeback.v1_instruction as
  select i.id, i.request_id, i.type, i.idempotency_key, i.payload, i.reason,
         i.actor_kind, i.actor_operator_id, i.status, i.bzzzbx_reference,
         i.error_code, i.error_message, i.attempts,
         i.created_at, i.sent_at, i.resolved_at, i.updated_at, i.change_seq
  from opsrun.instruction as i;

create view opsrun_writeback.v1_alert_occurrence as
  select a.id, a.bzzzbx_alert_id, a.request_id, a.rule_id, a.rule_version, a.level,
         a.reason_text, a.bzzzbx_message_id, a.opened_at, a.first_seen_at,
         a.resolved_at, a.resolution, a.resolved_by, a.resolution_reason, a.resolving_instruction_id,
         a.created_at, a.updated_at, a.change_seq
  from opsrun.alert_occurrence as a;

create view opsrun_writeback.v1_ai_analysis as
  select a.id, a.request_id, a.instruction_id, a.status, a.model,
         a.requested_at, a.completed_at, a.created_at, a.updated_at, a.change_seq
  from opsrun.ai_analysis as a;

create view opsrun_writeback.v1_ai_suggestion as
  select s.id, s.request_id, s.ai_analysis_id, s.cleaner_confirmation_id, s.field, s.rank,
         s.value, s.reason, s.decision, s.final_value, s.decided_by, s.decided_at,
         s.created_at, s.updated_at, s.change_seq
  from opsrun.ai_suggestion as s;

create view opsrun_writeback.v1_audit_event as
  select e.id, e.request_id, e.event_type, e.actor_kind, e.actor_operator_id, e.reason,
         e.occurred_at, e.recorded_at, e.source, e.bzzzbx_event_id, e.details,
         e.instruction_id, e.alert_occurrence_id, e.ai_suggestion_id, e.cleaner_confirmation_id
  from opsrun.audit_event as e;

revoke all on all tables in schema opsrun_writeback from public;
grant usage on schema opsrun_writeback to bzzz_writeback_opsrun;
grant select on all tables in schema opsrun_writeback to bzzz_writeback_opsrun;

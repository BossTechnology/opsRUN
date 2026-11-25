-- Seed de desarrollo local de opsRUN (spec OPR-20 §9).
--
-- Solo datos inventados: el repo es público. Correos @example.test, crosswalk
-- IDs con forma bx-…, nombres genéricos. Ningún cliente, propiedad, cleaner,
-- teléfono ni PO de PINCH.
--
-- Los catálogos van en la migración, no aquí. Las requests cubren las cinco
-- etapas del tablero; la etapa se calcula (spec §5) y lo que depende del Job
-- Tracker o de Paid se lee de BzzzBX, así que aquí solo aparece como eventos
-- observados en Audit.
--
-- La carga scripts/base-local.mjs como opsrun_migrador (el dueño), justo
-- después de aplicar las migraciones. Los operadores van sin auth_user_id: el
-- enlace con el usuario del GoTrue de la caja llega con OPR-2.

-- ---------------------------------------------------------------------------
-- Operadores: dos de Operations y dos de Finance. Sin login enlazado (OPR-2).
-- ---------------------------------------------------------------------------
insert into opsrun.operator (id, email, display_name, team) values
  ('0a000000-0000-4000-8000-0000000000a1', 'ops.uno@example.test',     'Ops Uno',     'operations'),
  ('0a000000-0000-4000-8000-0000000000a2', 'ops.dos@example.test',     'Ops Dos',     'operations'),
  ('0a000000-0000-4000-8000-0000000000b1', 'finance.uno@example.test', 'Finance Uno', 'finance'),
  ('0a000000-0000-4000-8000-0000000000b2', 'finance.dos@example.test', 'Finance Dos', 'finance');

insert into opsrun.audit_event (event_type, actor_kind, occurred_at, details)
select 'operator_added', 'system', now() - interval '30 days', jsonb_build_object('operator_id', id)
from opsrun.operator;

-- ---------------------------------------------------------------------------
-- Plantillas, versión 1 (OPR-18)
-- ---------------------------------------------------------------------------
insert into opsrun.message_template (key, version, channel, subject, body, active) values
  ('cleaner_confirmation_request', 1, 'text', null,
   'New job: {{property}} {{space}} on {{date}}, {{window}}. Can you confirm?', true),
  ('reschedule_request', 1, 'text', null,
   'Can we move {{property}} {{space}} to {{date}}, {{window}}? Please confirm.', true),
  ('cancellation_cleaner', 1, 'text', null,
   'The job at {{property}} {{space}} on {{date}} is cancelled.', true),
  ('cancellation_requester', 1, 'email', 'Cleaning cancelled',
   'The cleaning at {{property}} {{space}} on {{date}} has been cancelled.', true),
  ('requester_scheduled', 1, 'email', 'Cleaning scheduled',
   'Your cleaning at {{property}} {{space}} is scheduled for {{date}}, {{window}}.', true),
  ('requester_done', 1, 'email', 'Cleaning done',
   'The cleaning at {{property}} {{space}} is done.', true);

-- ---------------------------------------------------------------------------
-- Requests: una por etapa, más una en Requests sin dueño.
--   Los crosswalk IDs que se arman (bx-job-000N, bx-msg-000N, bx-thread-000N,
--   EX-0000N) salen del último dígito del id de la request, no del R number:
--   el R number depende de la secuencia y en una base ya usada no empieza en 1.
--   Son los mismos que usa el stand-in de BzzzBX (src/lib/bzzzbx/falso/datos.ts).
--   R1 Requests (sin dueño, con análisis de IA)
--   R2 Requests (con dueño, details confirmados, esperando al cleaner)
--   R3 Scheduled
--   R4 In Progress (check-in observado)
--   R5 Complete (terminada a mano, sin fotos: OSS automático)
--   R6 Validation (aprobada, PO escrito, Paid observado)
-- ---------------------------------------------------------------------------
insert into opsrun.request (
  id, received_at, owner_operator_id,
  bzzzbx_customer_id, bzzzbx_contact_id, bzzzbx_property_id, bzzzbx_space_id,
  unit, beds, bzzzbx_service_id, service_date, window_start, window_end,
  access_notes, po_number, bzzzbx_team_id
) values
  ('b0000000-0000-4000-8000-0000000000a1', now() - interval '20 minutes', null,
   null, null, 'bx-prop-0001', null, '4B', 2, null, null, null, null, null, null, null),
  ('b0000000-0000-4000-8000-0000000000a2', now() - interval '3 hours', '0a000000-0000-4000-8000-0000000000a1',
   'bx-cust-0001', 'bx-cont-0001', 'bx-prop-0002', 'bx-space-0002',
   '12', 1, 'bx-svc-0001', current_date + 2, '09:00', '12:00',
   'Key at the front desk.', null, 'bx-team-0001'),
  ('b0000000-0000-4000-8000-0000000000a3', now() - interval '2 days', '0a000000-0000-4000-8000-0000000000a1',
   'bx-cust-0001', 'bx-cont-0001', 'bx-prop-0003', null,
   '7C', 3, 'bx-svc-0001', current_date + 1, '10:00', '14:00',
   null, 'PO-EX-0003', 'bx-team-0002'),
  ('b0000000-0000-4000-8000-0000000000a4', now() - interval '3 days', '0a000000-0000-4000-8000-0000000000a2',
   'bx-cust-0002', 'bx-cont-0002', 'bx-prop-0004', null,
   null, 2, 'bx-svc-0002', current_date, '08:00', '11:00',
   'Gate code from the requester.', null, 'bx-team-0001'),
  ('b0000000-0000-4000-8000-0000000000a5', now() - interval '5 days', '0a000000-0000-4000-8000-0000000000a2',
   'bx-cust-0002', 'bx-cont-0003', 'bx-prop-0005', null,
   '2A', 1, 'bx-svc-0001', current_date - 1, '13:00', '16:00',
   null, null, 'bx-team-0003'),
  ('b0000000-0000-4000-8000-0000000000a6', now() - interval '9 days', '0a000000-0000-4000-8000-0000000000b1',
   'bx-cust-0003', 'bx-cont-0004', 'bx-prop-0006', null,
   null, 4, 'bx-svc-0003', current_date - 5, '09:00', '15:00',
   null, null, 'bx-team-0002');

-- El correo original de cada request.
insert into opsrun.request_message (request_id, bzzzbx_message_id, bzzzbx_thread_id, channel, direction, is_original, actor_kind, linked_at)
select r.id, 'bx-msg-000' || right(r.id::text, 1), 'bx-thread-000' || right(r.id::text, 1),
       'email', 'inbound', true, 'system', r.received_at
from opsrun.request as r;

insert into opsrun.audit_event (request_id, event_type, actor_kind, occurred_at)
select id, 'request_received', 'system', received_at from opsrun.request;

insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at, details)
select id, 'request_assigned', 'operator', owner_operator_id, received_at + interval '5 minutes',
       jsonb_build_object('to_operator_id', owner_operator_id)
from opsrun.request
where owner_operator_id is not null;

-- ---------------------------------------------------------------------------
-- IA: un análisis de R1 con una sugerencia aceptada, una corregida y una
-- abierta (el campo sigue AI-marked).
-- ---------------------------------------------------------------------------
insert into opsrun.instruction (id, request_id, type, idempotency_key, payload, actor_kind, status, sent_at, resolved_at, attempts)
values ('c0000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000a1',
        'ai_analyze_request', 'seed-ai-0001', '{}', 'system', 'confirmed',
        now() - interval '19 minutes', now() - interval '19 minutes', 1);

insert into opsrun.ai_analysis (id, request_id, instruction_id, status, model, requested_at, completed_at)
values ('e0000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000a1',
        'c0000000-0000-4000-8000-0000000000a1', 'completed', 'example-model',
        now() - interval '19 minutes', now() - interval '18 minutes');

insert into opsrun.ai_suggestion (id, request_id, ai_analysis_id, field, rank, value, reason,
                                  decision, final_value, decided_by, decided_at) values
  ('5a000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-0000000000a1',
   'property', 1, '"bx-prop-0001"', 'Address in the email matches the property.',
   'accepted', null, '0a000000-0000-4000-8000-0000000000a2', now() - interval '10 minutes'),
  ('5a000000-0000-4000-8000-0000000000a2', 'b0000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-0000000000a1',
   'beds', 1, '3', 'The email says "three bedrooms".',
   'corrected', '2', '0a000000-0000-4000-8000-0000000000a2', now() - interval '9 minutes'),
  ('5a000000-0000-4000-8000-0000000000a3', 'b0000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-0000000000a1',
   'unit', 1, '"4B"', 'Unit written in the subject.',
   null, null, null, null),
  ('5a000000-0000-4000-8000-0000000000a4', 'b0000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-0000000000a1',
   'cleaner_team', 1, '"bx-team-0001"', 'Default team for the property.',
   null, null, null, null),
  ('5a000000-0000-4000-8000-0000000000a5', 'b0000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-0000000000a1',
   'cleaner_team', 2, '"bx-team-0003"', 'Available that day.',
   null, null, null, null);

insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at, ai_suggestion_id) values
  ('b0000000-0000-4000-8000-0000000000a1', 'ai_analysis_completed', 'ai', null, now() - interval '18 minutes', null),
  ('b0000000-0000-4000-8000-0000000000a1', 'ai_suggestion_accepted', 'operator', '0a000000-0000-4000-8000-0000000000a2',
   now() - interval '10 minutes', '5a000000-0000-4000-8000-0000000000a1'),
  ('b0000000-0000-4000-8000-0000000000a1', 'ai_suggestion_corrected', 'operator', '0a000000-0000-4000-8000-0000000000a2',
   now() - interval '9 minutes', '5a000000-0000-4000-8000-0000000000a2');

-- ---------------------------------------------------------------------------
-- R2: details y sender confirmados; se le preguntó al cleaner (Waiting).
-- ---------------------------------------------------------------------------
insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id, confirmed_at) values
  ('b0000000-0000-4000-8000-0000000000a2', 'details', 'operator',
   '{"bzzzbx_property_id": "bx-prop-0002", "unit": "12", "beds": 1}', '0a000000-0000-4000-8000-0000000000a1',
   now() - interval '2 hours'),
  ('b0000000-0000-4000-8000-0000000000a2', 'sender', 'operator',
   '{"bzzzbx_customer_id": "bx-cust-0001", "bzzzbx_contact_id": "bx-cont-0001"}', '0a000000-0000-4000-8000-0000000000a1',
   now() - interval '2 hours');

insert into opsrun.instruction (id, request_id, type, idempotency_key, payload, actor_kind, actor_operator_id,
                                status, sent_at, resolved_at, attempts, bzzzbx_reference)
values ('c0000000-0000-4000-8000-0000000000a2', 'b0000000-0000-4000-8000-0000000000a2', 'send_text', 'seed-text-0002',
        '{"template": {"key": "cleaner_confirmation_request", "version": 1}, "bzzzbx_team_id": "bx-team-0001"}',
        'operator', '0a000000-0000-4000-8000-0000000000a1', 'confirmed',
        now() - interval '110 minutes', now() - interval '110 minutes', 1, 'bx-ref-0002');

insert into opsrun.cleaner_confirmation (id, request_id, purpose, bzzzbx_team_id, status, ask_instruction_id,
                                         asked_at, actor_kind, actor_operator_id)
values ('d0000000-0000-4000-8000-0000000000a2', 'b0000000-0000-4000-8000-0000000000a2', 'initial', 'bx-team-0001',
        'asked', 'c0000000-0000-4000-8000-0000000000a2', now() - interval '110 minutes',
        'operator', '0a000000-0000-4000-8000-0000000000a1');

insert into opsrun.request_message (request_id, bzzzbx_message_id, channel, direction, instruction_id, actor_kind, linked_at)
values ('b0000000-0000-4000-8000-0000000000a2', 'bx-msg-0102', 'text', 'outbound',
        'c0000000-0000-4000-8000-0000000000a2', 'system', now() - interval '110 minutes');

insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at, instruction_id, cleaner_confirmation_id) values
  ('b0000000-0000-4000-8000-0000000000a2', 'details_confirmed', 'operator', '0a000000-0000-4000-8000-0000000000a1',
   now() - interval '2 hours', null, null),
  ('b0000000-0000-4000-8000-0000000000a2', 'sender_confirmed', 'operator', '0a000000-0000-4000-8000-0000000000a1',
   now() - interval '2 hours', null, null),
  ('b0000000-0000-4000-8000-0000000000a2', 'cleaner_asked', 'operator', '0a000000-0000-4000-8000-0000000000a1',
   now() - interval '110 minutes', 'c0000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-0000000000a2');

insert into opsrun.note (request_id, author_operator_id, body, created_at)
values ('b0000000-0000-4000-8000-0000000000a2', '0a000000-0000-4000-8000-0000000000a1',
        'Requester prefers mornings.', now() - interval '100 minutes');

-- ---------------------------------------------------------------------------
-- R3 a R6: confirmadas y programadas (el gate de Schedule se cumple).
-- ---------------------------------------------------------------------------
insert into opsrun.request_confirmation (request_id, kind, method, confirmed_value, actor_operator_id, confirmed_at)
select r.id, k, case when k = 'cleaner' then 'phone'::opsrun.confirmation_method else 'operator' end,
       '{}', r.owner_operator_id, r.received_at + interval '1 hour'
from opsrun.request as r
cross join unnest(enum_range(null::opsrun.confirmation_kind)) as k
where r.id in ('b0000000-0000-4000-8000-0000000000a3', 'b0000000-0000-4000-8000-0000000000a4',
               'b0000000-0000-4000-8000-0000000000a5', 'b0000000-0000-4000-8000-0000000000a6');

insert into opsrun.instruction (request_id, type, idempotency_key, payload, actor_kind, actor_operator_id,
                                status, sent_at, resolved_at, attempts, bzzzbx_reference)
select r.id, 'create_job', 'seed-job-000' || right(r.id::text, 1), '{}', 'operator', r.owner_operator_id,
       'confirmed', r.received_at + interval '2 hours', r.received_at + interval '2 hours', 1,
       'bx-ref-job-000' || right(r.id::text, 1)
from opsrun.request as r
where r.id in ('b0000000-0000-4000-8000-0000000000a3', 'b0000000-0000-4000-8000-0000000000a4',
               'b0000000-0000-4000-8000-0000000000a5', 'b0000000-0000-4000-8000-0000000000a6');

update opsrun.request
set status = 'scheduled',
    bzzzbx_job_id = 'bx-job-000' || right(id::text, 1),
    job_number = 'EX-0000' || right(id::text, 1),
    scheduled_at = received_at + interval '2 hours'
where id in ('b0000000-0000-4000-8000-0000000000a3', 'b0000000-0000-4000-8000-0000000000a4',
             'b0000000-0000-4000-8000-0000000000a5', 'b0000000-0000-4000-8000-0000000000a6');

insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at, details)
select id, 'request_scheduled', 'operator', owner_operator_id, scheduled_at,
       jsonb_build_object('bzzzbx_job_id', bzzzbx_job_id, 'job_number', job_number)
from opsrun.request
where status = 'scheduled';

-- R4 In Progress: check-in observado en el Job Tracker.
insert into opsrun.audit_event (request_id, event_type, actor_kind, occurred_at, source, bzzzbx_event_id) values
  ('b0000000-0000-4000-8000-0000000000a4', 'job_checked_in', 'bzzzbx', now() - interval '1 hour', 'bzzzbx_observed', 'bx-evt-0001'),
  ('b0000000-0000-4000-8000-0000000000a4', 'job_started',    'bzzzbx', now() - interval '55 minutes', 'bzzzbx_observed', 'bx-evt-0002');

-- R5 Complete: End manually sin fotos, que marca OSS sola.
insert into opsrun.instruction (id, request_id, type, idempotency_key, payload, reason, actor_kind, actor_operator_id,
                                status, sent_at, resolved_at, attempts)
values ('c0000000-0000-4000-8000-0000000000a5', 'b0000000-0000-4000-8000-0000000000a5', 'end_job_manually',
        'seed-end-0005', '{}', 'Cleaner finished but the app did not sync.', 'operator',
        '0a000000-0000-4000-8000-0000000000a2', 'confirmed', now() - interval '20 hours', now() - interval '20 hours', 1);

update opsrun.request
set ended_manually_at = now() - interval '20 hours',
    ended_manually_by = '0a000000-0000-4000-8000-0000000000a2',
    oss_mark = 'oss', oss_marked_at = now() - interval '20 hours', oss_source = 'auto'
where id = 'b0000000-0000-4000-8000-0000000000a5';

insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at, reason, instruction_id) values
  ('b0000000-0000-4000-8000-0000000000a5', 'job_ended_manually', 'operator', '0a000000-0000-4000-8000-0000000000a2',
   now() - interval '20 hours', 'Cleaner finished but the app did not sync.', 'c0000000-0000-4000-8000-0000000000a5'),
  ('b0000000-0000-4000-8000-0000000000a5', 'oss_marked', 'system', null, now() - interval '20 hours', null, null);

-- R6 Validation: completada, aprobada, PO escrito y Paid observado.
insert into opsrun.audit_event (request_id, event_type, actor_kind, occurred_at, source, bzzzbx_event_id) values
  ('b0000000-0000-4000-8000-0000000000a6', 'job_checked_in', 'bzzzbx', now() - interval '5 days 6 hours', 'bzzzbx_observed', 'bx-evt-0003'),
  ('b0000000-0000-4000-8000-0000000000a6', 'job_completed',  'bzzzbx', now() - interval '5 days 1 hour',  'bzzzbx_observed', 'bx-evt-0004');

update opsrun.request
set oss_mark = 'not_oss', oss_marked_at = now() - interval '4 days', oss_marked_by = '0a000000-0000-4000-8000-0000000000b1',
    oss_source = 'operator',
    approved_at = now() - interval '4 days', approved_by = '0a000000-0000-4000-8000-0000000000b1'
where id = 'b0000000-0000-4000-8000-0000000000a6';

insert into opsrun.instruction (id, request_id, type, idempotency_key, payload, actor_kind, actor_operator_id,
                                status, sent_at, resolved_at, attempts)
values ('c0000000-0000-4000-8000-0000000000a6', 'b0000000-0000-4000-8000-0000000000a6', 'write_po', 'seed-po-0006',
        '{"po_number": "PO-EX-0006"}', 'operator', '0a000000-0000-4000-8000-0000000000b1',
        'confirmed', now() - interval '3 days', now() - interval '3 days', 1);

insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at, instruction_id, source, bzzzbx_event_id) values
  ('b0000000-0000-4000-8000-0000000000a6', 'oss_marked',   'operator', '0a000000-0000-4000-8000-0000000000b1', now() - interval '4 days', null, 'opsrun', null),
  ('b0000000-0000-4000-8000-0000000000a6', 'job_approved', 'operator', '0a000000-0000-4000-8000-0000000000b1', now() - interval '4 days', null, 'opsrun', null),
  ('b0000000-0000-4000-8000-0000000000a6', 'po_entered',   'operator', '0a000000-0000-4000-8000-0000000000b1', now() - interval '3 days',
   'c0000000-0000-4000-8000-0000000000a6', 'opsrun', null),
  ('b0000000-0000-4000-8000-0000000000a6', 'job_paid',     'bzzzbx',   null, now() - interval '1 day', null, 'bzzzbx_observed', 'bx-evt-0005');

-- ---------------------------------------------------------------------------
-- Alertas: una abierta y una resuelta de cada resolution.
-- ---------------------------------------------------------------------------
insert into opsrun.alert_occurrence (id, bzzzbx_alert_id, request_id, rule_id, rule_version, level, reason_text,
                                     opened_at, resolved_at, resolution, resolved_by, resolution_reason, resolving_instruction_id) values
  -- Abierta: R1 sin dueño.
  ('a1000000-0000-4000-8000-0000000000a1', 'bx-alert-0001', 'b0000000-0000-4000-8000-0000000000a1',
   'OPS-001', '1', 'amber', 'Unassigned for 15 min.',
   now() - interval '5 minutes', null, null, null, null, null),
  -- Cleared automatically: R4 se marcó Delayed y el check-in la limpió.
  ('a1000000-0000-4000-8000-0000000000a2', 'bx-alert-0002', 'b0000000-0000-4000-8000-0000000000a4',
   'OPS-010', '1', 'red', 'Not started by 1:00 PM.',
   now() - interval '2 hours', now() - interval '1 hour', 'auto_cleared', null, null, null),
  -- Resuelta por una acción: R6 sin PO hasta que se escribió.
  ('a1000000-0000-4000-8000-0000000000a3', 'bx-alert-0003', 'b0000000-0000-4000-8000-0000000000a6',
   'TRN-005', '1', 'amber', 'Customer requires a PO.',
   now() - interval '4 days', now() - interval '3 days', 'fixed_by_action', '0a000000-0000-4000-8000-0000000000b1', null,
   'c0000000-0000-4000-8000-0000000000a6'),
  -- Clear alert con motivo: R5 Running long revisado.
  ('a1000000-0000-4000-8000-0000000000a4', 'bx-alert-0004', 'b0000000-0000-4000-8000-0000000000a5',
   'MEC-003', '1', 'amber', 'Running 90 min over the window.',
   now() - interval '22 hours', now() - interval '21 hours', 'cleared_by_operator', '0a000000-0000-4000-8000-0000000000a2',
   'Large unit, cleaner called ahead.', null);

insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at, reason, alert_occurrence_id)
select a.request_id, 'alert_opened', 'bzzzbx', null, a.opened_at, null, a.id
from opsrun.alert_occurrence as a;

insert into opsrun.audit_event (request_id, event_type, actor_kind, actor_operator_id, occurred_at, reason, alert_occurrence_id) values
  ('b0000000-0000-4000-8000-0000000000a4', 'alert_resolved', 'bzzzbx', null,
   now() - interval '1 hour', null, 'a1000000-0000-4000-8000-0000000000a2'),
  ('b0000000-0000-4000-8000-0000000000a6', 'alert_resolved', 'operator', '0a000000-0000-4000-8000-0000000000b1',
   now() - interval '3 days', null, 'a1000000-0000-4000-8000-0000000000a3'),
  ('b0000000-0000-4000-8000-0000000000a5', 'alert_cleared', 'operator', '0a000000-0000-4000-8000-0000000000a2',
   now() - interval '21 hours', 'Large unit, cleaner called ahead.', 'a1000000-0000-4000-8000-0000000000a4');

/**
 * Datos del falso. TODO INVENTADO: el repo es público. Correos @example.test,
 * teléfonos de la serie 555-01xx (reservada para ficción), nombres genéricos.
 * Ningún cliente, propiedad, cleaner, teléfono ni PO de PINCH.
 *
 * Los crosswalk IDs son los mismos que usa `supabase/seed.sql`, y los estados
 * encajan con sus requests (spec OPR-22 §5):
 *   R1  Requests, sin dueño; alerta OPS-001 abierta     correo bx-msg-0001
 *   R2  Requests, esperando al cleaner                  correo bx-msg-0002, texto bx-msg-0102
 *   R3  Scheduled                                       bx-job-0003
 *   R4  In Progress: check-in e inicio, Running long    bx-job-0004 (MEC-003 abierta: Clear alert)
 *   R5  Complete: End manually, sin fotos               bx-job-0005
 *   R6  Validation: terminado, PO escrito y Paid        bx-job-0006 (su cliente exige PO)
 *   R7  Requests, lista para enlazar (OPR-26, P-3)      correo bx-msg-0007, job de PINCH bx-job-0107
 *   R8  Requests, nueva y sin dueño (OPR-28, P-7)       correo bx-msg-0008, alerta OPS-001 abierta, job de PINCH bx-job-0108
 *                                                       (su cliente bx-cust-0003 exige PO y no hay: Add PO, OPR-32)
 * Y jobs de la Fase A, creados en las herramientas de PINCH y sin request
 * (spec Fase A §3): bx-job-0102 encaja con R2 (cliente, propiedad, fecha y
 * ventana), bx-job-0103 es de la misma propiedad otro día, bx-job-0104 está
 * cancelado y bx-job-0105 es de otro cliente.
 * Como la seed (que usa current_date y now()), las fechas salen del reloj.
 * `seed-y-falso.test.ts` comprueba que los IDs sigan coincidiendo.
 */
import type { Entidades } from "../tipos";

export type DatosIniciales = { [E in keyof Entidades]: Entidades[E][] };

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

export function datosIniciales(ahora: Date): DatosIniciales {
  const t = ahora.getTime();
  const hace = (ms: number) => new Date(t - ms).toISOString();
  const dia = (desplazamiento: number) => new Date(t + desplazamiento * DIA).toISOString().slice(0, 10);

  return {
    customer: [
      { bzzzbx_customer_id: "bx-cust-0001", name: "Example Property Group", po_required: false },
      { bzzzbx_customer_id: "bx-cust-0002", name: "Sample Rentals", po_required: false },
      { bzzzbx_customer_id: "bx-cust-0003", name: "Demo Housing Co", po_required: true },
    ],
    contact: [
      { bzzzbx_contact_id: "bx-cont-0001", bzzzbx_customer_id: "bx-cust-0001", name: "Contact One", email: "contact.one@example.test", phone: "+1 555 0101" },
      { bzzzbx_contact_id: "bx-cont-0002", bzzzbx_customer_id: "bx-cust-0002", name: "Contact Two", email: "contact.two@example.test", phone: "+1 555 0102" },
      { bzzzbx_contact_id: "bx-cont-0003", bzzzbx_customer_id: "bx-cust-0002", name: "Contact Three", email: "contact.three@example.test", phone: null },
      { bzzzbx_contact_id: "bx-cont-0004", bzzzbx_customer_id: "bx-cust-0003", name: "Contact Four", email: "contact.four@example.test", phone: "+1 555 0104" },
    ],
    property: [
      { bzzzbx_property_id: "bx-prop-0001", name: "Example Tower", city: "Example City", units: [], default_team_id: "bx-team-0001" },
      { bzzzbx_property_id: "bx-prop-0002", name: "Sample Court", city: "Example City", units: [{ bzzzbx_space_id: "bx-space-0002", label: "Unit 12" }], default_team_id: "bx-team-0001" },
      { bzzzbx_property_id: "bx-prop-0003", name: "Demo Lofts", city: "Sample Town", units: [], default_team_id: "bx-team-0002" },
      { bzzzbx_property_id: "bx-prop-0004", name: "Placeholder House", city: "Sample Town", units: [], default_team_id: "bx-team-0001" },
      { bzzzbx_property_id: "bx-prop-0005", name: "Mock Gardens", city: "Example City", units: [], default_team_id: "bx-team-0003" },
      { bzzzbx_property_id: "bx-prop-0006", name: "Test Terrace", city: "Demo Village", units: [], default_team_id: "bx-team-0002" },
    ],
    cleaner_team: [
      { bzzzbx_team_id: "bx-team-0001", name: "Team Alpha", phone: "+1 555 0111", active: true, available_dates: [dia(0), dia(1), dia(2)] },
      { bzzzbx_team_id: "bx-team-0002", name: "Team Beta", phone: "+1 555 0112", active: true, available_dates: [dia(1), dia(3)] },
      { bzzzbx_team_id: "bx-team-0003", name: "Team Gamma", phone: "+1 555 0113", active: true, available_dates: [dia(2)] },
    ],
    service: [
      { bzzzbx_service_id: "bx-svc-0001", name: "Standard clean", type: "standard" },
      { bzzzbx_service_id: "bx-svc-0002", name: "Deep clean", type: "deep" },
      { bzzzbx_service_id: "bx-svc-0003", name: "Move-out clean", type: "move_out" },
    ],
    job: [
      { bzzzbx_job_id: "bx-job-0003", job_number: "EX-00003", bzzzbx_customer_id: "bx-cust-0001", bzzzbx_property_id: "bx-prop-0003", bzzzbx_space_id: null, bzzzbx_service_id: "bx-svc-0001", service_date: dia(1), window_start: "10:00", window_end: "14:00", status: "scheduled", bzzzbx_team_id: "bx-team-0002", po_number: "PO-EX-0003", price: { amount_cents: 18_500, currency: "USD" } },
      { bzzzbx_job_id: "bx-job-0004", job_number: "EX-00004", bzzzbx_customer_id: "bx-cust-0002", bzzzbx_property_id: "bx-prop-0004", bzzzbx_space_id: null, bzzzbx_service_id: "bx-svc-0002", service_date: dia(0), window_start: "08:00", window_end: "11:00", status: "scheduled", bzzzbx_team_id: "bx-team-0001", po_number: null, price: { amount_cents: 24_000, currency: "USD" } },
      { bzzzbx_job_id: "bx-job-0005", job_number: "EX-00005", bzzzbx_customer_id: "bx-cust-0002", bzzzbx_property_id: "bx-prop-0005", bzzzbx_space_id: null, bzzzbx_service_id: "bx-svc-0001", service_date: dia(-1), window_start: "13:00", window_end: "16:00", status: "scheduled", bzzzbx_team_id: "bx-team-0003", po_number: null, price: { amount_cents: 16_000, currency: "USD" } },
      { bzzzbx_job_id: "bx-job-0006", job_number: "EX-00006", bzzzbx_customer_id: "bx-cust-0003", bzzzbx_property_id: "bx-prop-0006", bzzzbx_space_id: null, bzzzbx_service_id: "bx-svc-0003", service_date: dia(-5), window_start: "09:00", window_end: "15:00", status: "scheduled", bzzzbx_team_id: "bx-team-0002", po_number: "PO-EX-0006", price: { amount_cents: 31_000, currency: "USD" } },
      // Fase A: jobs creados en las herramientas de PINCH, todavía sin request en opsRUN.
      // R7 de la seed: lista para enlazar (dueño y las tres confirmaciones). Encaja en cliente, propiedad, fecha, ventana y equipo.
      { bzzzbx_job_id: "bx-job-0107", job_number: "EX-00107", bzzzbx_customer_id: "bx-cust-0002", bzzzbx_property_id: "bx-prop-0004", bzzzbx_space_id: null, bzzzbx_service_id: "bx-svc-0001", service_date: dia(3), window_start: "13:00", window_end: "16:00", status: "scheduled", bzzzbx_team_id: "bx-team-0001", po_number: null, price: { amount_cents: 17_500, currency: "USD" } },
      // R8 de la seed (OPR-28, P-7): una request nueva que recorre Requests entera. Encaja en cliente, propiedad, fecha, ventana y equipo.
      // Su cliente exige PO y el job no trae (OPR-30 a OPR-32, P-14): el E2E pasa por "Add PO" antes de Validate.
      { bzzzbx_job_id: "bx-job-0108", job_number: "EX-00108", bzzzbx_customer_id: "bx-cust-0003", bzzzbx_property_id: "bx-prop-0005", bzzzbx_space_id: null, bzzzbx_service_id: "bx-svc-0002", service_date: dia(4), window_start: "09:00", window_end: "12:00", status: "scheduled", bzzzbx_team_id: "bx-team-0003", po_number: null, price: { amount_cents: 21_000, currency: "USD" } },
      { bzzzbx_job_id: "bx-job-0102", job_number: "EX-00102", bzzzbx_customer_id: "bx-cust-0001", bzzzbx_property_id: "bx-prop-0002", bzzzbx_space_id: "bx-space-0002", bzzzbx_service_id: "bx-svc-0001", service_date: dia(2), window_start: "09:00", window_end: "12:00", status: "scheduled", bzzzbx_team_id: "bx-team-0001", po_number: null, price: { amount_cents: 15_500, currency: "USD" } },
      { bzzzbx_job_id: "bx-job-0103", job_number: "EX-00103", bzzzbx_customer_id: "bx-cust-0001", bzzzbx_property_id: "bx-prop-0002", bzzzbx_space_id: null, bzzzbx_service_id: "bx-svc-0001", service_date: dia(4), window_start: "13:00", window_end: "16:00", status: "scheduled", bzzzbx_team_id: "bx-team-0002", po_number: null, price: { amount_cents: 15_500, currency: "USD" } },
      { bzzzbx_job_id: "bx-job-0104", job_number: "EX-00104", bzzzbx_customer_id: "bx-cust-0001", bzzzbx_property_id: "bx-prop-0001", bzzzbx_space_id: null, bzzzbx_service_id: "bx-svc-0002", service_date: dia(2), window_start: "09:00", window_end: "12:00", status: "cancelled", bzzzbx_team_id: null, po_number: null, price: { amount_cents: 20_000, currency: "USD" } },
      { bzzzbx_job_id: "bx-job-0105", job_number: "EX-00105", bzzzbx_customer_id: "bx-cust-0002", bzzzbx_property_id: "bx-prop-0002", bzzzbx_space_id: null, bzzzbx_service_id: "bx-svc-0001", service_date: dia(2), window_start: "09:00", window_end: "12:00", status: "scheduled", bzzzbx_team_id: "bx-team-0001", po_number: null, price: { amount_cents: 15_500, currency: "USD" } },
    ],
    assignment: [
      { bzzzbx_assignment_id: "bx-asg-0003", bzzzbx_job_id: "bx-job-0003", bzzzbx_team_id: "bx-team-0002", status: "confirmed" },
      { bzzzbx_assignment_id: "bx-asg-0004", bzzzbx_job_id: "bx-job-0004", bzzzbx_team_id: "bx-team-0001", status: "confirmed" },
      { bzzzbx_assignment_id: "bx-asg-0005", bzzzbx_job_id: "bx-job-0005", bzzzbx_team_id: "bx-team-0003", status: "confirmed" },
      { bzzzbx_assignment_id: "bx-asg-0006", bzzzbx_job_id: "bx-job-0006", bzzzbx_team_id: "bx-team-0002", status: "confirmed" },
    ],
    jobtracker_event: [
      { bzzzbx_event_id: "bx-evt-0001", bzzzbx_job_id: "bx-job-0004", kind: "checked_in", occurred_at: hace(HORA) },
      { bzzzbx_event_id: "bx-evt-0002", bzzzbx_job_id: "bx-job-0004", kind: "started", occurred_at: hace(55 * MIN) },
      { bzzzbx_event_id: "bx-evt-0003", bzzzbx_job_id: "bx-job-0006", kind: "checked_in", occurred_at: hace(5 * DIA + 6 * HORA) },
      { bzzzbx_event_id: "bx-evt-0004", bzzzbx_job_id: "bx-job-0006", kind: "completed", occurred_at: hace(5 * DIA + HORA) },
    ],
    photo: [
      { bzzzbx_photo_id: "bx-photo-0001", bzzzbx_job_id: "bx-job-0006", phase: "before", taken_at: hace(5 * DIA + 6 * HORA), ref: "stand-in:photo/bx-photo-0001" },
      { bzzzbx_photo_id: "bx-photo-0002", bzzzbx_job_id: "bx-job-0006", phase: "after", taken_at: hace(5 * DIA + HORA), ref: "stand-in:photo/bx-photo-0002" },
    ],
    message: [
      correoOriginal(1, "someone@example.test", "Cleaning request for Example Tower 4B", hace(20 * MIN)),
      correoOriginal(2, "contact.one@example.test", "Clean for Sample Court unit 12", hace(3 * HORA)),
      correoOriginal(3, "contact.one@example.test", "Demo Lofts 7C tomorrow", hace(2 * DIA)),
      correoOriginal(4, "contact.two@example.test", "Deep clean at Placeholder House", hace(3 * DIA)),
      correoOriginal(5, "contact.three@example.test", "Mock Gardens 2A", hace(5 * DIA)),
      correoOriginal(6, "contact.four@example.test", "Move-out at Test Terrace", hace(9 * DIA)),
      correoOriginal(7, "contact.two@example.test", "Clean for Placeholder House", hace(4 * HORA)),
      correoOriginal(8, "contact.three@example.test", "Deep clean at Mock Gardens 5D", hace(25 * MIN)),
      {
        bzzzbx_message_id: "bx-msg-0102",
        bzzzbx_thread_id: null,
        channel: "text",
        direction: "outbound",
        from: "opsrun",
        to: ["+1 555 0111"],
        subject: null,
        body: "New job: Sample Court Unit 12. Can you confirm?",
        sent_at: hace(110 * MIN),
        delivery: "delivered",
      },
    ],
    payment: [
      { bzzzbx_job_id: "bx-job-0003", paid: false, paid_at: null, bzzzbx_event_id: null },
      { bzzzbx_job_id: "bx-job-0004", paid: false, paid_at: null, bzzzbx_event_id: null },
      { bzzzbx_job_id: "bx-job-0005", paid: false, paid_at: null, bzzzbx_event_id: null },
      { bzzzbx_job_id: "bx-job-0006", paid: true, paid_at: hace(DIA), bzzzbx_event_id: "bx-evt-0005" },
      // R8 (OPR-30 a OPR-32): sin pagar; `/api/falso cambiar payment` lo lleva a Paid.
      { bzzzbx_job_id: "bx-job-0108", paid: false, paid_at: null, bzzzbx_event_id: null },
    ],
    alert_result: [
      { bzzzbx_alert_id: "bx-alert-0001", sujeto: { tipo: "request", request_id: "b0000000-0000-4000-8000-0000000000a1" }, rule_id: "OPS-001", rule_version: "1", level: "amber", reason_text: "Unassigned for 15 min.", opened_at: hace(5 * MIN), cleared_at: null },
      // R8: sin dueño desde hace más de 15 minutos; la cierra BzzzBX cuando ve el dueño por el write-back (OPR-28, S-3).
      { bzzzbx_alert_id: "bx-alert-0005", sujeto: { tipo: "request", request_id: "b0000000-0000-4000-8000-0000000000a8" }, rule_id: "OPS-001", rule_version: "1", level: "amber", reason_text: "Unassigned for 15 min.", opened_at: hace(10 * MIN), cleared_at: null },
      { bzzzbx_alert_id: "bx-alert-0002", sujeto: { tipo: "job", bzzzbx_job_id: "bx-job-0004" }, rule_id: "OPS-010", rule_version: "1", level: "red", reason_text: "Not started by 1:00 PM.", opened_at: hace(2 * HORA), cleared_at: hace(HORA) },
      { bzzzbx_alert_id: "bx-alert-0003", sujeto: { tipo: "job", bzzzbx_job_id: "bx-job-0006" }, rule_id: "TRN-005", rule_version: "1", level: "amber", reason_text: "Customer requires a PO.", opened_at: hace(4 * DIA), cleared_at: hace(3 * DIA) },
      { bzzzbx_alert_id: "bx-alert-0004", sujeto: { tipo: "job", bzzzbx_job_id: "bx-job-0005" }, rule_id: "MEC-003", rule_version: "1", level: "amber", reason_text: "Running 90 min over the window.", opened_at: hace(22 * HORA), cleared_at: hace(21 * HORA) },
      // R4 (OPR-30, P-14): Running long abierta, para Clear alert. (bx-alert-0005 es la OPS-001 de R8.)
      { bzzzbx_alert_id: "bx-alert-0006", sujeto: { tipo: "job", bzzzbx_job_id: "bx-job-0004" }, rule_id: "MEC-003", rule_version: "1", level: "amber", reason_text: "Running 45 min over the window.", opened_at: hace(10 * MIN), cleared_at: null },
    ],
    job_health: [
      { bzzzbx_job_id: "bx-job-0003", status: "on_track" },
      { bzzzbx_job_id: "bx-job-0004", status: "at_risk" },
      { bzzzbx_job_id: "bx-job-0005", status: "on_track" },
      { bzzzbx_job_id: "bx-job-0006", status: "on_track" },
      { bzzzbx_job_id: "bx-job-0108", status: "on_track" },
    ],
  };
}

function correoOriginal(n: number, from: string, subject: string, sent_at: string): Entidades["message"] {
  const sufijo = String(n).padStart(4, "0");
  return {
    bzzzbx_message_id: `bx-msg-${sufijo}`,
    bzzzbx_thread_id: `bx-thread-${sufijo}`,
    channel: "email",
    direction: "inbound",
    from,
    to: ["requests@example.test"],
    subject,
    body: `${subject}. Please let us know the window.`,
    sent_at,
    delivery: "delivered",
  };
}

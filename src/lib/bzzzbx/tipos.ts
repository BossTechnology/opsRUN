/**
 * Lo que opsRUN lee de BzzzBX: las proyecciones del Runbook 1.1 §4.1, cada una
 * con su crosswalk ID (spec OPR-22 §3.1).
 *
 * PROVISIONAL: los nombres y tipos de los campos son el supuesto S-1 del spec
 * y cambian con el contrato real (OPR-6). opsRUN muestra estos datos; nunca
 * los guarda. Lo único que persiste en la base son los crosswalk IDs.
 *
 * Fechas de servicio en `YYYY-MM-DD`, ventanas en `HH:MM` (locales a la
 * operación, OPR-4); instantes en ISO 8601 UTC.
 */

/** Cursor opaco: solo se pasa de vuelta al puerto que lo dio. */
export type Cursor = string & { readonly __marca: "Cursor" };

export type Job = {
  bzzzbx_job_id: string;
  job_number: string;
  bzzzbx_customer_id: string;
  bzzzbx_property_id: string;
  bzzzbx_space_id: string | null;
  bzzzbx_service_id: string;
  service_date: string;
  window_start: string | null;
  window_end: string | null;
  status: "scheduled" | "cancelled";
  /** El cleaner del job. */
  bzzzbx_team_id: string | null;
  po_number: string | null;
};

export type Assignment = {
  bzzzbx_assignment_id: string;
  bzzzbx_job_id: string;
  bzzzbx_team_id: string;
  status: "assigned" | "confirmed" | "declined" | "cancelled";
};

export type Customer = {
  bzzzbx_customer_id: string;
  name: string;
  /** Marca de PO requerido (OPR-8). */
  po_required: boolean;
};

export type Contact = {
  bzzzbx_contact_id: string;
  bzzzbx_customer_id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

export type Property = {
  bzzzbx_property_id: string;
  name: string;
  city: string;
  units: { bzzzbx_space_id: string; label: string }[];
  default_team_id: string | null;
};

export type CleanerTeam = {
  bzzzbx_team_id: string;
  name: string;
  phone: string | null;
  active: boolean;
  available_dates: string[];
};

/** No está en el Runbook §4.1; la card la necesita (supuesto S-2). */
export type Service = {
  bzzzbx_service_id: string;
  name: string;
  type: string;
};

export type JobTrackerEvent = {
  bzzzbx_event_id: string;
  bzzzbx_job_id: string;
  kind: "checked_in" | "started" | "completed";
  occurred_at: string;
};

export type Photo = {
  bzzzbx_photo_id: string;
  bzzzbx_job_id: string;
  phase: "before" | "after";
  taken_at: string;
  /** Referencia a la foto, no el archivo. */
  ref: string;
};

export type Message = {
  bzzzbx_message_id: string;
  bzzzbx_thread_id: string | null;
  channel: "email" | "text";
  direction: "inbound" | "outbound";
  from: string;
  to: string[];
  subject: string | null;
  body: string;
  sent_at: string;
  delivery: "queued" | "sent" | "delivered" | "failed";
};

/** Paid de QuickBooks; frescura ≤ 1 h (Runbook §4.1). */
export type Payment = {
  bzzzbx_job_id: string;
  paid: boolean;
  paid_at: string | null;
  /** El evento de pago, para deduplicar `job_paid` en Audit (OPR-20 §3.11). */
  bzzzbx_event_id: string | null;
};

/**
 * Sobre qué es una alerta (supuesto S-3). OPS-001 y OPS-002 salen del estado
 * vivo de opsRUN, antes de que haya job: su sujeto es la request de opsRUN.
 */
export type SujetoAlerta =
  | { tipo: "job"; bzzzbx_job_id: string }
  | { tipo: "request"; request_id: string }
  | { tipo: "message"; bzzzbx_message_id: string };

export type AlertResult = {
  bzzzbx_alert_id: string;
  sujeto: SujetoAlerta;
  rule_id: string;
  rule_version: string;
  level: "amber" | "red";
  reason_text: string;
  opened_at: string;
  cleared_at: string | null;
};

export type JobHealth = {
  bzzzbx_job_id: string;
  status: "on_track" | "at_risk" | "breached";
};

export type Entidades = {
  job: Job;
  assignment: Assignment;
  customer: Customer;
  contact: Contact;
  property: Property;
  cleaner_team: CleanerTeam;
  service: Service;
  jobtracker_event: JobTrackerEvent;
  photo: Photo;
  message: Message;
  payment: Payment;
  alert_result: AlertResult;
  job_health: JobHealth;
};

export type Entidad = keyof Entidades;

/** El campo que es el crosswalk ID de cada entidad. */
export const CLAVE = {
  job: "bzzzbx_job_id",
  assignment: "bzzzbx_assignment_id",
  customer: "bzzzbx_customer_id",
  contact: "bzzzbx_contact_id",
  property: "bzzzbx_property_id",
  cleaner_team: "bzzzbx_team_id",
  service: "bzzzbx_service_id",
  jobtracker_event: "bzzzbx_event_id",
  photo: "bzzzbx_photo_id",
  message: "bzzzbx_message_id",
  payment: "bzzzbx_job_id",
  alert_result: "bzzzbx_alert_id",
  job_health: "bzzzbx_job_id",
} as const satisfies { [E in Entidad]: keyof Entidades[E] & string };

export const ENTIDADES = Object.keys(CLAVE) as Entidad[];

/** Filtros por relación de `listarPor`. */
export type Filtros = {
  assignment: { bzzzbx_job_id: string };
  contact: { bzzzbx_customer_id: string };
  jobtracker_event: { bzzzbx_job_id: string };
  photo: { bzzzbx_job_id: string };
  message: { bzzzbx_thread_id: string };
  alert_result: { sujeto: SujetoAlerta };
};

export type EntidadHija = keyof Filtros;

/** Lo que devuelve una lectura: la entidad, su versión y la hora de BzzzBX. */
export type Leido<T> = T & { version: string; leido_en: string };

export type Cambio = { entidad: Entidad; id: string; version: string };

export type LoteDeCambios = {
  cambios: Cambio[];
  cursor: Cursor;
  /** Si es true, hay más cambios: se vuelve a pedir enseguida. */
  hay_mas: boolean;
};

export type FiltroDeJobs = {
  bzzzbx_customer_id?: string;
  bzzzbx_property_id?: string;
  service_date?: string;
};

// ---------------------------------------------------------------------------
// Instrucciones (spec §4)
// ---------------------------------------------------------------------------

/** El catálogo `opsrun.instruction_type` de OPR-20 (la lista del Runbook §4.3 difiere: P-3). */
export const TIPOS_INSTRUCCION = [
  "send_email",
  "send_text",
  "create_job",
  "reschedule_job",
  "cancel_job",
  "end_job_manually",
  "write_po",
  "record_validation",
  "ai_analyze_request",
  "ai_suggest",
  "ai_draft",
  "ai_read_reply",
] as const;

export type TipoInstruccion = (typeof TIPOS_INSTRUCCION)[number];

export type ActorInstruccion =
  | { tipo: "operator"; operator_id: string }
  | { tipo: "system"; proceso: string };

export type Instruccion = {
  /** = opsrun.instruction.idempotency_key (supuesto S-7). */
  idempotency_key: string;
  tipo: TipoInstruccion;
  /** Lo que escribió el operador y crosswalk IDs; nada leído de PINCH. */
  payload: Record<string, unknown>;
  actor: ActorInstruccion;
  sujeto?: { bzzzbx_job_id?: string; request_id?: string };
};

export type Acuse = { idempotency_key: string; bzzzbx_reference: string; aceptada_en: string };

/** Los pasos del Runbook §7.1 antes del cierre. */
export const PASOS = [
  "requested",
  "authorized",
  "awaiting_approval",
  "dispatched",
  "executed",
  "observed",
] as const;

export type Paso = (typeof PASOS)[number];

export type Resultado =
  | { idempotency_key: string; estado: "en_curso"; paso: Paso }
  | {
      idempotency_key: string;
      estado: "confirmada";
      bzzzbx_reference: string;
      datos?: Record<string, unknown>;
    }
  | { idempotency_key: string; estado: "fallida"; error_code: string; error_message: string }
  | { idempotency_key: string; estado: "sin_confirmar"; motivo: string };

export type LoteDeResultados = {
  resultados: Resultado[];
  cursor: Cursor;
  hay_mas: boolean;
};

export const esCierre = (r: Resultado) => r.estado !== "en_curso";

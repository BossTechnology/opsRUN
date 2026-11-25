/**
 * Modelo del tablero (spec OPR-25). Lo arma `armarTablero` con lo de opsRUN y
 * lo leído de BzzzBX; los componentes solo lo pintan.
 */
import type {
  AlertResult,
  Customer,
  Job,
  JobHealth,
  JobTrackerEvent,
  Message,
  Payment,
  Property,
  Service,
} from "../bzzzbx/tipos";

export const ETAPAS = ["requests", "scheduled", "in_progress", "complete", "validation"] as const;
export type Etapa = (typeof ETAPAS)[number];

export const TITULOS: Record<Etapa, string> = {
  requests: "Requests",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  complete: "Complete",
  validation: "Validation",
};

/** Lo que se muestra cuando un valor no está definido. */
export const SIN_VALOR = "— —";

/** Una fila de `opsrun.request` con lo que el tablero necesita de opsRUN. */
export type FilaRequest = {
  id: string;
  r_number: number;
  status: "open" | "scheduled";
  received_at: string;
  owner_operator_id: string | null;
  owner_display_name: string | null;
  bzzzbx_customer_id: string | null;
  bzzzbx_property_id: string | null;
  bzzzbx_space_id: string | null;
  unit: string | null;
  bzzzbx_service_id: string | null;
  service_date: string | null;
  window_start: string | null;
  window_end: string | null;
  po_number: string | null;
  bzzzbx_job_id: string | null;
  job_number: string | null;
  ended_manually_at: string | null;
  oss_mark: "oss" | "not_oss" | null;
  approved_at: string | null;
  /** Hilo del correo original (`request_message.is_original`). */
  bzzzbx_thread_id: string | null;
};

/** Lo leído de BzzzBX para pintar el tablero. Nada de esto se guarda. */
export type Leidos = {
  jobs: Job[];
  properties: Property[];
  customers: Customer[];
  services: Service[];
  eventos: JobTrackerEvent[];
  mensajes: Message[];
  pagos: Payment[];
  /** Alertas de las requests y jobs del tablero (abiertas o no). */
  alertas: AlertResult[];
  salud: JobHealth[];
};

export const LEIDOS_VACIOS: Leidos = {
  jobs: [],
  properties: [],
  customers: [],
  services: [],
  eventos: [],
  mensajes: [],
  pagos: [],
  alertas: [],
  salud: [],
};

export type NivelAlerta = "amber" | "red";
export type ResumenAlertas = { total: number; nivel: NivelAlerta | null };

/** Prioridad de colores del spec §1.4. */
export type Color = "pagada" | "sombreada" | "borde" | "sin_dueno" | "normal";

export type TipoEstado = "recibida" | "programada" | "delayed" | "en_curso" | "terminada" | "aprobada" | "paid";

export type Tarjeta = {
  requestId: string;
  etapa: Etapa;
  numero: string;
  nombre: string;
  estado: { tipo: TipoEstado; texto: string };
  ciudad: string;
  tipo: string;
  servicio: string;
  chat: boolean;
  flags: string[];
  color: Color;
  dueno: { id: string; nombre: string; iniciales: string } | null;
  alertas: ResumenAlertas;
  /** Para ordenar dentro de la columna. */
  orden: string;
};

export type Columna = {
  etapa: Etapa;
  titulo: string;
  tarjetas: Tarjeta[];
  /** Validation: las Paid van en una fila aparte, colapsada. */
  pagadas: Tarjeta[];
  alertas: ResumenAlertas;
};

export type Tablero = {
  columnas: Columna[];
  alertasAbiertas: ResumenAlertas;
  bzzzbx: { disponible: boolean; actualizadoEn: string | null };
};

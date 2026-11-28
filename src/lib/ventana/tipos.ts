/**
 * Modelo de la Job window (spec OPR-26). Lo arma `armarVentana` con lo de
 * opsRUN y lo leído de BzzzBX; los componentes solo lo pintan. Nada de esto se
 * guarda ni se escribe: la ventana solo lee.
 */
import type { Insignia } from "../alertas/tipos";
import type { VistaIa } from "../analisis-ia/tipos";
import type { Coincidencia } from "../fase-a/enlace";
import type { AlertResult, CleanerTeam, Contact, Photo } from "../bzzzbx/tipos";
import type { PoVigente } from "../billing/po";
import type { Etapa, FilaRequest, Leidos } from "../tablero/tipos";

export type EtapaVentana = Etapa | "cancelled";

/** Una fila de `opsrun.request` con lo del tablero y lo que la ventana agrega (§8.1). */
export type FilaVentana = FilaRequest & {
  bzzzbx_contact_id: string | null;
  bzzzbx_team_id: string | null;
  access_notes: string | null;
  /** Camas del borrador (OPR-36: la IA las propone y el operador las corrige). */
  beds?: number | null;
  /** `change_seq` de la request: lo que vio el operador (S-12). Texto: es un bigint. */
  change_seq: string;
  /** Cuándo capturó el operador el PO en opsRUN (OPR-32). */
  entered_po_at: string | null;
  /** Quién marcó OSS: `auto` si salió de End manually sin fotos (OPR-31). */
  oss_source: "operator" | "auto" | null;
  /** Nombre de quien aprobó (Billing: "Approved Nov 27 by Ops Uno"). */
  approved_by_nombre: string | null;
  /** Nombre de quien validó. */
  validated_by_nombre: string | null;
  /** Cuándo se enlazó (o se cambió) el job por última vez, de `request_scheduled` o `job_relinked` en Audit (OPR-29). */
  linked_at: string | null;
  /** Quién lo enlazó o lo cambió. */
  linked_by_nombre: string | null;
};

/**
 * Un job al que Change linked job puede cambiar el enlace (OPR-29): lo que el panel pinta de un candidato de
 * `proponerEnlaces`, ya como texto. Los lee el servidor al armar la ventana; nunca se guardan.
 */
export type CandidatoDeCambio = {
  bzzzbxJobId: string;
  jobNumber: string;
  /** "Nov 28 · 10:00 AM–2:00 PM". */
  fecha: string;
  /** Nombre del cleaner; "— —" si no se pudo leer. */
  cleaner: string;
  coincide: Coincidencia[];
  sugerido: boolean;
};

/** Lo leído de BzzzBX para la ventana: lo del tablero y los dos `obtener` de §8.2. */
export type LeidosVentana = Leidos & { contactos: Contact[]; equipos: CleanerTeam[]; fotos: Photo[] };

export const LEIDOS_VENTANA_VACIOS: LeidosVentana = {
  jobs: [],
  properties: [],
  customers: [],
  services: [],
  eventos: [],
  mensajes: [],
  pagos: [],
  alertas: [],
  salud: [],
  contactos: [],
  equipos: [],
  fotos: [],
};

/** Un operador activo con su carga (S-5): requests suyas que aún no llegan a Validation. */
export type OperadorConCarga = { id: string; nombre: string; abiertas: number };

/** Las confirmaciones vigentes de la request (gate de Schedule). */
export type Confirmaciones = { details: boolean; sender: boolean; cleaner: boolean };

export type IdPestana = "property" | "audit" | "tracker" | "billing" | "dollar" | "people" | "alerts";

/** Las que se pueden pedir en `?tab=`. $ y People nunca se seleccionan. */
export const PESTANAS_EN_URL = ["property", "alerts", "audit", "tracker", "billing"] as const;

export type Pestana = {
  id: IdPestana;
  nombre: string;
  /** $ y People: se ven en gris y no se seleccionan. */
  deshabilitada: boolean;
  titulo?: string;
  /** Alerts: las que piden acción (Needs action). */
  conteo?: number;
  /** Alerts: la insignia (roja, ámbar o gris con Waiting, OPR-34 §5.2); null si no hay nada. */
  insignia?: Insignia | null;
  /** Alerts: los `bzzzbx_alert_id` rojos de Needs action, para el pulso. */
  idsRojos?: string[];
};

export type CampoPropiedad = {
  clave: "customer" | "contact" | "property" | "space" | "service" | "date" | "cleaner" | "po" | "access" | "linked";
  etiqueta: string;
  valor: string;
  /** BzzzBX respondió, pero no conoce esa entidad (§6.3). */
  noEncontrado: boolean;
};

/** Una sugerencia de IA abierta (rank 1, sin decidir) de un campo del borrador: la marca AI de los paneles de Confirm. */
export type SugerenciaAbierta = {
  /** `ai_field.code`: `property`, `service`, `sender`, `cleaner_team`, … */
  campo: string;
  razon: string | null;
};

/**
 * La respuesta del cleaner a la pregunta inicial (`status = 'replied'`). El
 * texto vive en BzzzBX y se lee en la conversación; aquí su id, el equipo y el
 * motivo de la lectura de la IA (`cleaner_reply`), si la hay.
 */
export type RespuestaDelCleaner = { id: string; equipoId: string; lectura: string | null };

export type AlertaVista = { id: string; regla: string; nivel: "amber" | "red"; razon: string; pideAccion: boolean };

export type Encabezado = {
  stage: { etapa: EtapaVentana; texto: string; pagada: boolean };
  /** Chip OSS junto a Stage (OPR-31): solo con la marca OSS. */
  oss: boolean;
  /** Chip gris Delayed junto a Stage (OPR-29): Scheduled con OPS-010 abierta, la misma condición que la tarjeta. */
  delayed: boolean;
  /** "Demo Lofts 7C": propiedad y espacio, como el nombre de la tarjeta. */
  nombre: string;
  linea: { numero: string; fecha: string; servicio: string; cleaner: string };
  precio: string;
  asignado: { operadorId: string | null; nombre: string };
  cargas: { id: string; nombre: string; abiertas: number; proporcion: number }[];
};

export type VentanaJob = {
  requestId: string;
  /** `change_seq` de la request que se leyó. */
  version: string;
  etapa: EtapaVentana;
  bzzzbx: { disponible: boolean; actualizadoEn: string | null };
  zona: string;
  encabezado: Encabezado;
  pestanas: Pestana[];
  /** La pestaña que abre la ventana (§4.2) y si la eligió la regla 2 (alertas que piden acción). */
  inicial: { id: IdPestana; porRegla: boolean };
  propiedad: { tab: string; campos: CampoPropiedad[] };
  alertas: AlertaVista[];
  /** Las mismas alertas abiertas, tal como las leyó el puerto (para la ranura de Alerts, OPR-34). */
  alertasLeidas: AlertResult[];
  /** Hilos de la request, el original primero. */
  hilos: string[];
  /** El cleaner de la request: el del job desde Scheduled, el del borrador antes (OPR-27); null si no hay. */
  equipoId: string | null;
  gate: { dueno: boolean; details: boolean; sender: boolean; cleaner: boolean };
  /**
   * Datos de los que dependen los bloqueos de las acciones (§6.2) y los paneles
   * de Assign y Confirm (OPR-28 §7): lo que falta del borrador para confirmar
   * los detalles, si hay cliente y equipo en el borrador, la respuesta del
   * cleaner que se puede aceptar y las sugerencias de IA abiertas.
   */
  datos: {
    /** Crosswalk ID del job; null si todavía no hay (Requests). */
    bzzzbxJobId: string | null;
    tienePropiedad: boolean;
    poRequerido: boolean;
    tienePo: boolean;
    /** El PO vigente (OPR-32, P-2): el capturado en opsRUN, el de PINCH o el del borrador. */
    poVigente: PoVigente | null;
    /** Las alertas abiertas que Clear alert puede limpiar (OPR-30, P-6). */
    alertasLimpiables: { id: string; regla: string; nivel: "amber" | "red"; razon: string; abierta: string }[];
    /** La marca OSS del job. */
    oss: "oss" | "not_oss" | null;
    /** La marca salió sola (End manually sin fotos, R5): el operador puede cambiarla. */
    ossAuto: boolean;
    /** Approve & confirm ya se hizo. */
    aprobada: boolean;
    /** Validate ya se hizo. */
    validada: boolean;
    /** Cuándo terminó el job según el Job Tracker o End manually, en la zona de la operación; null si no ha terminado. */
    fin: string | null;
    faltanDetalles: string[];
    tieneCliente: boolean;
    tieneEquipo: boolean;
    respuestaDelCleaner: RespuestaDelCleaner | null;
    sugerencias: SugerenciaAbierta[];
    /**
     * El análisis de IA de la request (OPR-36 §10), solo en Requests: por campo, "AI pending", vacío o con su
     * sugerencia abierta. null fuera de Requests o si no se leyó.
     */
    ia?: VistaIa | null;
    /** Los jobs a los que Change linked job puede cambiar el enlace (OPR-29); vacío si no hay o no se pudieron leer. */
    candidatosDeCambio: CandidatoDeCambio[];
    /** BzzzBX devolvió el máximo de `buscarJobs`: puede haber más candidatos que no llegaron. */
    candidatosTruncado: boolean;
  };
  /** Hay una instrucción de la request sin cerrar. */
  instruccionAbierta: boolean;
};

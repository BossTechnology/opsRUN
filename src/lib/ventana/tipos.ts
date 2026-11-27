/**
 * Modelo de la Job window (spec OPR-26). Lo arma `armarVentana` con lo de
 * opsRUN y lo leído de BzzzBX; los componentes solo lo pintan. Nada de esto se
 * guarda ni se escribe: la ventana solo lee.
 */
import type { AlertResult, CleanerTeam, Contact } from "../bzzzbx/tipos";
import type { Etapa, FilaRequest, Leidos } from "../tablero/tipos";

export type EtapaVentana = Etapa | "cancelled";

/** Una fila de `opsrun.request` con lo del tablero y lo que la ventana agrega (§8.1). */
export type FilaVentana = FilaRequest & {
  bzzzbx_contact_id: string | null;
  bzzzbx_team_id: string | null;
  access_notes: string | null;
  /** `change_seq` de la request: lo que vio el operador (S-12). Texto: es un bigint. */
  change_seq: string;
};

/** Lo leído de BzzzBX para la ventana: lo del tablero y los dos `obtener` de §8.2. */
export type LeidosVentana = Leidos & { contactos: Contact[]; equipos: CleanerTeam[] };

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
  /** Alerts: las que piden acción. */
  conteo?: number;
};

export type CampoPropiedad = {
  clave: "customer" | "contact" | "property" | "space" | "service" | "date" | "cleaner" | "po" | "access";
  etiqueta: string;
  valor: string;
  /** BzzzBX respondió, pero no conoce esa entidad (§6.3). */
  noEncontrado: boolean;
};

export type AlertaVista = { id: string; regla: string; nivel: "amber" | "red"; razon: string; pideAccion: boolean };

export type Encabezado = {
  stage: { etapa: EtapaVentana; texto: string; pagada: boolean };
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
  /** Datos de los que dependen los bloqueos de las acciones (§6.2). */
  datos: { tienePropiedad: boolean; poRequerido: boolean; tienePo: boolean };
  /** Hay una instrucción de la request sin cerrar. */
  instruccionAbierta: boolean;
};

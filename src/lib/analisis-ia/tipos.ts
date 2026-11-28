/**
 * Lo que la Job window lee del análisis de IA y lo que pinta (spec OPR-36 §7 y §10).
 * Sin imports del servidor: lo usan la ventana, sus componentes y las pruebas.
 */
import type { CampoDeIa } from "../bzzzbx/tipos-ia";

export type EstadoDelAnalisis = "pending" | "completed" | "failed" | "timed_out";

/** El último `ai_analysis` de la request. */
export type AnalisisLeido = {
  id: string;
  estado: EstadoDelAnalisis;
  requested_at: string;
  completed_at: string | null;
};

/** Una sugerencia sin decidir de un campo de §4.1: la principal (`rank` 1) o una alternativa. */
export type SugerenciaLeida = {
  id: string;
  campo: CampoDeIa;
  rank: number;
  valor: unknown;
  razon: string | null;
};

/** Lo que la ventana lee de opsRUN para armar la vista de IA, en una sola transacción de solo lectura. */
export type LecturaDeIa = {
  analisis: AnalisisLeido | null;
  sugerencias: SugerenciaLeida[];
};

/** Las columnas del borrador que el análisis llena, tal como las lee la ventana. */
export type BorradorLeido = {
  bzzzbx_customer_id: string | null;
  bzzzbx_contact_id: string | null;
  bzzzbx_property_id: string | null;
  bzzzbx_space_id: string | null;
  unit: string | null;
  beds?: number | null;
  bzzzbx_service_id: string | null;
  service_date: string | null;
  window_start: string | null;
  window_end: string | null;
  access_notes: string | null;
  po_number: string | null;
};

export type OpcionDeCambio = {
  /** El valor que se guarda (un crosswalk ID, con la forma de §4.1). */
  valor: unknown;
  texto: string;
  /** Un crosswalk ID sin nombre (BzzzBX caído): el ID como texto secundario. */
  secundario: string | null;
  origen: "ia" | "alternativa" | "propiedad";
};

export type SugerenciaAbiertaDeIa = {
  /** `ai_suggestion.id` de la principal. */
  id: string;
  valor: unknown;
  texto: string;
  secundario: string | null;
  razon: string | null;
  /** El valor de la IA es el del borrador: se puede aceptar tal cual. */
  igualAlBorrador: boolean;
  /** Para Change de un crosswalk ID: lo que se puede elegir. Vacío en los campos de texto, fecha, ventana y camas. */
  opciones: OpcionDeCambio[];
};

export type VistaDeCampoIa = {
  campo: CampoDeIa;
  etiqueta: string;
  /** Para el `aria-label` de los controles: "Accept AI property". */
  nombreCorto: string;
  /** El borrador no tiene nada en las columnas de este campo. */
  vacio: boolean;
  /** Lo que el borrador tiene hoy, con la forma de §4.1; null si está vacío. Es lo que Change edita. */
  borrador: unknown;
  abierta: SugerenciaAbiertaDeIa | null;
};

export type VistaIa = {
  /**
   * "AI pending" (§10.1): sin análisis, o el último sigue pending, falló o venció. Solo se ve en
   * los campos vacíos; no deshabilita nada.
   */
  pendiente: boolean;
  campos: Record<CampoDeIa, VistaDeCampoIa>;
  /** Hay una sugerencia `multiple_jobs` abierta: solo un aviso (P-12). */
  variosJobs: { id: string; cantidad: number } | null;
};

/**
 * Tipos del puerto de IA de BzzzBX (spec OPR-36 §12.1). PROVISIONALES hasta OPR-6,
 * como `buscarJobs` y `buscarMensajes`: la forma real de la ruta de IA la fija el
 * contrato de BzzzBX. Van en su propio archivo para no tocar `tipos.ts`.
 *
 * Solo viajan crosswalk IDs: el correo (remitente, asunto, cuerpo, adjuntos) es de
 * PINCH y BzzzBX lo lee por su lado (spec §6, P-3).
 */

/** Los campos que pide el análisis (spec §4.1): los de `opsrun.ai_field` que llena esta tarjeta. */
export const CAMPOS_DE_IA = [
  "property",
  "space",
  "unit",
  "beds",
  "service",
  "service_date",
  "time_window",
  "access_notes",
  "po_number",
  "sender",
  "multiple_jobs",
] as const;

export type CampoDeIa = (typeof CAMPOS_DE_IA)[number];

/** Lo único que opsRUN le manda a BzzzBX para analizar una request. */
export type PedidoDeAnalisis = {
  /** El `ai_analysis.id`: la misma clave no repite el trabajo. */
  clave: string;
  /** El correo original de la request. */
  bzzzbx_message_id: string;
  bzzzbx_thread_id: string | null;
  campos: CampoDeIa[];
};

/** Una propuesta: la principal (`rank` 1) o una alternativa (2 y 3). `valor` tiene la forma de §4.1. */
export type Propuesta = { campo: CampoDeIa; rank: 1 | 2 | 3; valor: unknown; motivo: string | null };

export type ResultadoDeAnalisis =
  | { estado: "en_curso" }
  | { estado: "listo"; modelo: string | null; propuestas: Propuesta[]; terminado_at: string }
  | { estado: "fallido"; error_code: string; terminado_at: string };

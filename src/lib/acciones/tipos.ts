/**
 * Contrato del registro de acciones (spec OPR-26 §5.4). La lista de §5.3 es un
 * registro; cada tarjeta de etapa (OPR-28 a OPR-32) le agrega su ejecutor.
 */
import type { ComponentType } from "react";

import type { Actor } from "../db/pool";
import type { Etapa } from "../tablero/tipos";
import type { VentanaJob } from "../ventana/tipos";

/** "reschedule_job", "schedule", … Los que tienen instrucción usan el código de `instruction_type`. */
export type CodigoAccion = string;

export type Motivo = "obligatorio" | "opcional" | "no";

export type ContextoAccion = {
  /** Quién actúa: el servidor lo declara en la transacción de escritura (P-2). */
  actor: Extract<Actor, { tipo: "operador" }>;
  /** La ventana recalculada en este momento. */
  ventana: VentanaJob;
};

export type EntradaAccion = {
  requestId: string;
  codigo: CodigoAccion;
  motivo: string | null;
  /** Lo del panel propio de la acción. */
  datos: Record<string, unknown>;
  /** `change_seq` de la request que vio el operador (S-12). */
  version: string;
};

export type ResultadoAccion =
  | { tipo: "guardada" } // decisión registrada en opsRUN, con su Audit
  | { tipo: "instruccion"; idempotency_key: string } // el panel sigue su estado
  | {
      tipo: "rechazada";
      codigo: "no_disponible" | "motivo_requerido" | "cambio_concurrente" | string;
      mensaje: string;
    };

/** Props del panel propio de una acción (§7.5). Las otras tarjetas lo implementan. */
export type PropsPanelAccion = {
  requestId: string;
  etapa: Etapa | "cancelled";
  bzzzbx: { disponible: boolean; actualizadoEn: string | null };
  zona: string;
  ventana: VentanaJob;
  /** Quién actúa (el operador de la transacción), para "Assign to me"; null si no hay. */
  actorId?: string | null;
  /** Lo que un botón de la pestaña Alerts le prellena a la acción (OPR-34 §5.3); null si la eligió el operador. */
  inicial?: Record<string, unknown> | null;
  onCambio: (datos: Record<string, unknown>, completo: boolean) => void;
};

export type DefinicionAccion = {
  codigo: CodigoAccion;
  /** Label visible; sale del catálogo cuando existe (P-5). */
  etiqueta: string;
  /** Una línea de qué hace, para el panel. */
  descripcion: string;
  etapas: Etapa[];
  /** false → fuera_de_release. */
  enRelease: boolean;
  /**
   * La acción es de la Fase B (OPR-30, P-10): se hace en las herramientas de PINCH y opsRUN
   * la observa. Se ve en gris con "Available when actions are switched on", sale
   * `fuera_de_release` y nunca corre, aunque tuviera ejecutor.
   */
  faseB?: boolean;
  motivo: Motivo;
  /** Si necesita BzzzBX para correr (lectura o instrucción). Sin BzzzBX → bloqueada. */
  necesitaBzzzbx: boolean;
  /** Bloqueos propios de la acción con los datos de la ventana; null si no hay. */
  bloqueo?: (v: VentanaJob) => string | null;
  /** Lo registra la tarjeta que la construye. Sin ejecutor → sin_construir. */
  ejecutor?: (ctx: ContextoAccion, entrada: EntradaAccion) => Promise<ResultadoAccion>;
  /** Campos extra del panel (componente de cliente), si la acción los pide. */
  panel?: ComponentType<PropsPanelAccion>;
  /** Interna: la usa una ranura (por ejemplo el rechazo del enlace) y no sale en la action bar. */
  interna?: boolean;
  /**
   * Si un cambio en la request desde que el operador la vio rechaza la acción
   * (`change_seq`, S-12). `"request"` por defecto; `"ninguna"` para lo que no
   * depende del estado de la request: una nota, un mensaje, descartar un
   * borrador de IA (OPR-27, P-6).
   */
  concurrencia?: "request" | "ninguna";
};

export type Disponibilidad =
  | { tipo: "disponible" }
  | { tipo: "no_aplica" }
  | { tipo: "bloqueada"; motivo: string }
  | { tipo: "sin_construir" }
  /** `fase: "b"` es lo que se hace en PINCH hasta que se enciendan las acciones (OPR-30, P-10). */
  | { tipo: "fuera_de_release"; fase?: "b" };

/** Lo que la action bar necesita de una acción: serializable, sin funciones. */
export type AccionVista = {
  codigo: CodigoAccion;
  etiqueta: string;
  descripcion: string;
  motivo: Motivo;
  disponibilidad: Disponibilidad;
  /** El texto en gris de las que no corren; null si corre. */
  nota: string | null;
};

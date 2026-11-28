/**
 * Las reglas de alerta de V1.1 beta (CONTEXT.md, "Standard alerts"): sus nombres
 * y el botón que arregla cada una (spec OPR-34 §5.3). Viven en código hasta que
 * OPR-3 y OPR-33 los traigan del catálogo de reglas (spec OPR-35, S-11). Una
 * regla que no está aquí se ve solo con su código.
 */

/**
 * El id de la regla Message not delivered. PROVISIONAL hasta OPR-33 (P-12): el
 * contexto no le da código y este es inventado. La migración de OPR-34
 * (`opsrun_private.alert_fixing_events()`) lo repite; una prueba lo comprueba.
 */
export const REGLA_MENSAJE_NO_ENTREGADO = "MSG-001";

export const NOMBRES_DE_REGLAS: Record<string, string> = {
  "OPS-001": "Unassigned request",
  "OPS-002": "Request open too long",
  "OPS-010": "Delayed",
  "OPS-020": "Cleaner declined",
  "MEC-003": "Running long",
  "ORG-002": "No photos",
  "ORG-003": "Partial photos",
  "TRN-005": "PO missing",
  [REGLA_MENSAJE_NO_ENTREGADO]: "Message not delivered",
};

export function reglaConNombre(ruleId: string): string {
  const nombre = NOMBRES_DE_REGLAS[ruleId];
  return nombre ? `${ruleId} ${nombre}` : ruleId;
}

/**
 * Qué se le pone al operador en la alerta para arreglarla (§5.3). El botón no
 * ejecuta nada: abre una acción de la action bar, que corre por `ejecutarAccion`.
 *
 * - `accion`: el código del registro de acciones (`src/lib/acciones/registro.ts`) y
 *   lo que se le prellena: `asignarme` (Assign to me elegido) o `alerta` (la
 *   `bzzzbx_alert_id` de esa alerta, para Clear alert).
 * - `reenviar`: lleva el foco al mensaje en la conversación, cuyo botón Edit and
 *   resend ya existe (OPR-27, S-6). No es una acción de la barra.
 * - `ninguno`: la alerta no se arregla con un botón (la limpia otra cosa).
 */
export type Arreglo =
  | { tipo: "accion"; codigo: string; prellenado: "asignarme" | "alerta" | null }
  | { tipo: "reenviar" }
  | { tipo: "ninguno"; texto: string };

export const ARREGLO_DE_REGLA: Record<string, Arreglo> = {
  "OPS-001": { tipo: "accion", codigo: "assign", prellenado: "asignarme" },
  "OPS-002": { tipo: "accion", codigo: "schedule", prellenado: null },
  "OPS-010": { tipo: "ninguno", texto: "Clears at check-in" },
  "OPS-020": { tipo: "accion", codigo: "confirm_cleaner", prellenado: null },
  "MEC-003": { tipo: "accion", codigo: "clear_alert", prellenado: "alerta" },
  "ORG-002": { tipo: "accion", codigo: "mark_oss", prellenado: null },
  "ORG-003": { tipo: "accion", codigo: "mark_oss", prellenado: null },
  "TRN-005": { tipo: "accion", codigo: "write_po", prellenado: null },
  [REGLA_MENSAJE_NO_ENTREGADO]: { tipo: "reenviar" },
};

/** El arreglo de una regla; las que no conoce no traen botón. */
export const arregloDe = (ruleId: string): Arreglo => ARREGLO_DE_REGLA[ruleId] ?? { tipo: "ninguno", texto: "" };

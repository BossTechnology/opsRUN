/**
 * Nombres de las reglas de alerta de V1.1 beta (CONTEXT.md, "Standard alerts").
 * Viven en código hasta que OPR-3 y OPR-33 los traigan del catálogo de reglas
 * (spec OPR-35, S-11). Una regla que no está aquí se ve solo con su código.
 */
export const NOMBRES_DE_REGLAS: Record<string, string> = {
  "OPS-001": "Unassigned request",
  "OPS-002": "Request open too long",
  "OPS-010": "Delayed",
  "OPS-020": "Cleaner declined",
  "MEC-003": "Running long",
  "ORG-002": "No photos",
  "ORG-003": "Partial photos",
  "TRN-005": "PO missing",
};

export function reglaConNombre(ruleId: string): string {
  const nombre = NOMBRES_DE_REGLAS[ruleId];
  return nombre ? `${ruleId} ${nombre}` : ruleId;
}

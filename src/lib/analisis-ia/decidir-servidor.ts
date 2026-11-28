import "server-only";

/**
 * Entrada del servidor a Accept, Change y Reject (spec OPR-36 §8.1): los datos de opsRUN
 * por SQL como opsrun_app. El ejecutor de `src/lib/acciones/ia.ts` lo carga al correr, no
 * al importar el registro de acciones.
 */
import type { DatosDeDecision } from "./decidir";
import { crearDatosDeDecision } from "./decidir-sql";

export function datosDeDecision(): DatosDeDecision {
  return crearDatosDeDecision();
}

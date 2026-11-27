import "server-only";

/**
 * Entrada del servidor a Assign y Confirm (spec OPR-28 §7): los datos de
 * opsRUN por SQL como opsrun_app. Los ejecutores de `src/lib/acciones/requests.ts`
 * lo cargan al correr, no al importar el registro de acciones.
 */
import { crearDatosDeRequests } from "./datos-sql";
import type { DatosDeRequests } from "./tipos";

export function datosDeRequests(): DatosDeRequests {
  return crearDatosDeRequests();
}

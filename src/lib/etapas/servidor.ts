import "server-only";

/**
 * Entrada del servidor a las acciones de las etapas (spec OPR-30 a OPR-32 §7.1):
 * los datos de opsRUN por SQL como opsrun_app y el puerto de lectura de BzzzBX
 * que los ejecutores usan para volver a leer la alerta, el job y el cliente. Los
 * ejecutores de `src/lib/acciones/etapas.ts` lo cargan al correr, no al importar
 * el registro de acciones.
 */
import type { LecturaBzzzbx } from "../bzzzbx/puertos";
import { lecturaOAusente } from "../tablero/servidor";

import { crearDatosDeEtapas } from "./datos-sql";
import type { DatosDeEtapas } from "./tipos";

export function dependenciasDeEtapas(): { datos: DatosDeEtapas; lectura: LecturaBzzzbx } {
  return { datos: crearDatosDeEtapas(), lectura: lecturaOAusente() };
}

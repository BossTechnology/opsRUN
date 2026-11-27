import "server-only";

/**
 * Entrada del servidor al enlace de la Fase A: el puerto de lectura de BzzzBX
 * que elige `BZZZBX_MODO` y los datos de opsRUN por SQL como opsrun_app. Las
 * pantallas (OPR-26, OPR-28) le ponen botones; el actor sale de la sesión
 * (OPR-2, OPR-21).
 */
import { obtenerBzzzbx } from "@/lib/bzzzbx";

import { crearDatosDeEnlace } from "./datos-sql";
import type { DependenciasDeEnlace } from "./enlace";

export { confirmarEnlace, EnlaceInvalido, proponerEnlaces, rechazarEnlace } from "./enlace";
export type { Candidato, Coincidencia, MotivoVacio, Propuesta } from "./enlace";

export function dependenciasDeEnlace(): DependenciasDeEnlace {
  return { lectura: obtenerBzzzbx().lectura, datos: crearDatosDeEnlace() };
}

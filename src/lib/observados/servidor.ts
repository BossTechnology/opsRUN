import "server-only";

/**
 * El observador de hechos de PINCH en el servidor (spec OPR-30 a OPR-32 §7.5, P-9).
 * `correrObservador()` es lo que el ciclo de fondo de opsRUN (OPR-15, P-1) llama
 * en cada vuelta; hasta que ese ciclo exista nadie lo llama. Nunca desde una
 * consulta de lectura.
 */
import { lecturaOAusente } from "../tablero/servidor";

import { crearDatosDelObservador } from "./datos-sql";
import { crearObservador, type ResultadoDeVuelta } from "./observar";

const global = globalThis as typeof globalThis & { __opsrunObservador?: ReturnType<typeof crearObservador> };

/** Una vuelta del observador; a lo sumo una cada 15 s por proceso. */
export function correrObservador(): Promise<ResultadoDeVuelta> {
  global.__opsrunObservador ??= crearObservador({ lectura: () => lecturaOAusente(), datos: crearDatosDelObservador() });
  return global.__opsrunObservador.vuelta();
}

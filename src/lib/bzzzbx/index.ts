/**
 * Entrada de opsRUN a BzzzBX (ADR 0005): los dos puertos, de la implementación
 * que elija `BZZZBX_MODO` (`./modo.ts`). Las pantallas y las capas de lectura
 * e instrucciones usan esto, nunca el falso directamente.
 */
import { ErrorDeConfiguracion } from "../db/entorno";

import { crearFalso } from "./falso";
import { modoBzzzbx, problemasBzzzbx } from "./modo";
import type { Bzzzbx } from "./puertos";

export { modoBzzzbx, problemasBzzzbx, type ModoBzzzbx } from "./modo";
export type { Bzzzbx, InstruccionesBzzzbx, LecturaBzzzbx } from "./puertos";

type Entorno = Record<string, string | undefined>;

export function crearBzzzbx(env: Entorno = process.env): Bzzzbx {
  const problemas = problemasBzzzbx(env);
  if (problemas.length > 0) throw new ErrorDeConfiguracion(problemas.join("; "));
  if (modoBzzzbx(env) === "real") {
    throw new Error("La implementación real de BzzzBX no existe todavía: espera el contrato de OPR-6.");
  }
  const { lectura, instrucciones } = crearFalso();
  return { lectura, instrucciones };
}

// Una instancia por proceso; en `next dev` sobrevive a la recarga en caliente.
const global = globalThis as typeof globalThis & { __opsrunBzzzbx?: Bzzzbx };

export function obtenerBzzzbx(env: Entorno = process.env): Bzzzbx {
  global.__opsrunBzzzbx ??= crearBzzzbx(env);
  return global.__opsrunBzzzbx;
}

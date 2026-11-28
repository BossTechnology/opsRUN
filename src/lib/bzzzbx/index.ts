/**
 * Entrada de opsRUN a BzzzBX (ADR 0005): los dos puertos, de la implementación
 * que elija `BZZZBX_MODO` (`./modo.ts`). Las pantallas y las capas de lectura
 * e instrucciones usan esto, nunca el falso directamente.
 */
import { ErrorDeConfiguracion } from "../db/entorno";

import { crearFalso, type Falso } from "./falso";
import { modoBzzzbx, problemasBzzzbx } from "./modo";
import type { Bzzzbx } from "./puertos";

export { modoBzzzbx, problemasBzzzbx, type ModoBzzzbx } from "./modo";
export type { Bzzzbx, IaBzzzbx, InstruccionesBzzzbx, LecturaBzzzbx } from "./puertos";

type Entorno = Record<string, string | undefined>;

export function crearBzzzbx(env: Entorno = process.env): Bzzzbx {
  const problemas = problemasBzzzbx(env);
  if (problemas.length > 0) throw new ErrorDeConfiguracion(problemas.join("; "));
  if (modoBzzzbx(env) === "real") {
    throw new Error("La implementación real de BzzzBX no existe todavía: espera el contrato de OPR-6.");
  }
  return crearFalso();
}

// Una instancia por proceso; en `next dev` sobrevive a la recarga en caliente.
const global = globalThis as typeof globalThis & { __opsrunBzzzbx?: Bzzzbx; __opsrunFalso?: Falso };

export function obtenerBzzzbx(env: Entorno = process.env): Bzzzbx {
  if (!global.__opsrunBzzzbx) {
    const elegido = crearBzzzbx(env);
    if (modoBzzzbx(env) === "falso") {
      // Los puertos siguen al falso vigente, para que `reiniciarFalso` no deje
      // a nadie leyendo datos viejos.
      global.__opsrunFalso = elegido as Falso;
      global.__opsrunBzzzbx = {
        get lectura() {
          return global.__opsrunFalso!.lectura;
        },
        get instrucciones() {
          return global.__opsrunFalso!.instrucciones;
        },
        get ia() {
          return global.__opsrunFalso!.ia;
        },
      };
    } else {
      global.__opsrunBzzzbx = elegido;
    }
  }
  return global.__opsrunBzzzbx;
}

/**
 * El falso del proceso, con sus controles de prueba (spec OPR-25, P-7). Null
 * con el real y siempre en el servidor: ahí el falso no existe.
 */
export function obtenerFalso(env: Entorno = process.env): Falso | null {
  if (problemasBzzzbx(env).length > 0 || env.OPSRUN_SERVIDOR === "1" || modoBzzzbx(env) !== "falso") return null;
  obtenerBzzzbx(env);
  return global.__opsrunFalso ?? null;
}

/** Vuelve el falso a sus datos iniciales (entre E2E). */
export function reiniciarFalso(env: Entorno = process.env): void {
  if (!obtenerFalso(env)) throw new Error("No hay falso de BzzzBX que reiniciar");
  global.__opsrunFalso = crearFalso();
}

import "server-only";

/**
 * La Job window en el servidor (spec OPR-26 §8): opsRUN por el pool de
 * `opsrun_app` en una transacción de solo lectura, y BzzzBX por su puerto, con
 * el presupuesto de §2. Nada de esto se lee desde el navegador.
 */
import { comoOpsrunApp } from "../db/servidor";
import { crearDatosDeEnlace } from "../fase-a/datos-sql";
import { lecturaOAusente, zonaDeLaOperacion } from "../tablero/servidor";

import { armarVentana } from "./armar";
import { esIdDeRequest, leerDeOpsrun } from "./consultas";
import { leerVentanaDeBzzzbx, type MemoriaVentana } from "./leer";
import { propuestaParaLaVentana, type PropuestaDeRanura } from "./propuesta";
import type { VentanaJob } from "./tipos";

const global = globalThis as typeof globalThis & { __opsrunMemoriaVentana?: MemoriaVentana };

/** Lo último que BzzzBX respondió por request: por proceso, nunca en la base. */
const memoria = (): MemoriaVentana => (global.__opsrunMemoriaVentana ??= new Map());

/** Vuelve a cero lo recordado (el control de los E2E que reinicia el falso). */
export function olvidarVentanas(): void {
  global.__opsrunMemoriaVentana = new Map();
}

/**
 * La ventana de una request, recalculada con los datos de este momento; null si
 * el id no es un uuid o la request no existe. `tab` es el `?tab=` de la URL.
 */
export async function obtenerVentana(requestId: string, tab: string | null = null): Promise<VentanaJob | null> {
  if (!esIdDeRequest(requestId)) return null;
  const deOpsrun = await comoOpsrunApp((db) => leerDeOpsrun(db, requestId));
  if (!deOpsrun) return null;

  const ahora = new Date();
  const { leidos, bzzzbx } = await leerVentanaDeBzzzbx({
    fila: deOpsrun.fila,
    hilos: deOpsrun.hilos,
    lectura: lecturaOAusente(),
    ahora,
    memoria: memoria(),
  });
  return armarVentana({
    fila: deOpsrun.fila,
    leidos,
    hilos: deOpsrun.hilos,
    operadores: deOpsrun.operadores,
    confirmaciones: deOpsrun.confirmaciones,
    instruccionAbierta: deOpsrun.instruccionAbierta,
    ahora,
    zona: zonaDeLaOperacion(),
    bzzzbx,
    tab,
  });
}

/** La propuesta de enlace de una request en Requests, para la ranura de la Fase A (§7.2). */
export function propuestaDeLaRequest(requestId: string): Promise<PropuestaDeRanura> {
  return propuestaParaLaVentana({ lectura: lecturaOAusente(), datos: crearDatosDeEnlace() }, requestId);
}

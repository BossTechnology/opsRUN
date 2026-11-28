import "server-only";

/**
 * La conversación en el servidor (spec OPR-27 §6): opsRUN por el pool de
 * `opsrun_app` en una transacción de solo lectura, y BzzzBX por su puerto con el
 * presupuesto de la Job window. Nada de esto se lee desde el navegador.
 */
import { comoOpsrunApp } from "../db/servidor";
import { lecturaOAusente } from "../tablero/servidor";

import { leerConversacionDeOpsrun } from "./consultas";
import { leerConversacion, type DatosDeConversacion, type MemoriaConversacion } from "./leer";

const global = globalThis as typeof globalThis & { __opsrunMemoriaConversacion?: MemoriaConversacion };

/** Lo último que BzzzBX respondió por request: por proceso, nunca en la base. */
const memoria = (): MemoriaConversacion => (global.__opsrunMemoriaConversacion ??= new Map());

/** Vuelve a cero lo recordado (el control de los E2E que reinicia el falso). */
export function olvidarConversaciones(): void {
  global.__opsrunMemoriaConversacion = new Map();
}

/** Los hilos de la request, el original primero: los mismos que arma la Job window desde `request_message`. */
const hilosDe = (vinculos: { bzzzbx_thread_id: string | null }[]) => [
  ...new Set(vinculos.map((v) => v.bzzzbx_thread_id).filter((h): h is string => h !== null)),
];

/**
 * `hilos` es opcional: sin él salen de los vínculos de la request (la pestaña Alerts los necesita para saber si el
 * modo Customer está disponible, OPR-19 §6.3, y su ranura no los recibe). Misma lectura, misma memoria.
 */
export async function obtenerConversacion(entrada: {
  requestId: string;
  etapa: string;
  hilos?: string[];
  puedeEnviar: boolean;
  zona: string;
}): Promise<DatosDeConversacion | null> {
  const opsrun = await comoOpsrunApp((db) => leerConversacionDeOpsrun(db, entrada.requestId));
  if (!opsrun) return null;
  return leerConversacion({
    ...entrada,
    hilos: entrada.hilos ?? hilosDe(opsrun.vinculos),
    opsrun,
    lectura: lecturaOAusente(),
    ahora: new Date(),
    memoria: memoria(),
  });
}

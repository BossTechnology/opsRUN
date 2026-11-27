import "server-only";

/**
 * La Job window en el servidor (spec OPR-26 §8): opsRUN por el pool de
 * `opsrun_app` en una transacción de solo lectura, y BzzzBX por su puerto, con
 * el presupuesto de §2. Nada de esto se lee desde el navegador.
 */
import { comoOpsrunApp } from "../db/servidor";
import { crearDatosDeEnlace } from "../fase-a/datos-sql";
import type { DependenciasDeEnlace } from "../fase-a/enlace";
import { lecturaOAusente, zonaDeLaOperacion } from "../tablero/servidor";

import { armarVentana } from "./armar";
import { leerParaConfirmar } from "./confirmar";
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
  // Todo de opsRUN en una sola transacción de solo lectura: la ventana y lo que piden los paneles de Confirm (OPR-28).
  const leido = await comoOpsrunApp(async (db) => {
    const base = await leerDeOpsrun(db, requestId);
    return base ? { base, confirmar: await leerParaConfirmar(db, requestId) } : null;
  });
  if (!leido) return null;
  const { base: deOpsrun, confirmar } = leido;

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
    respuestaDelCleaner: confirmar.respuestaDelCleaner,
    sugerencias: confirmar.sugerencias,
  });
}

/**
 * Lo que el enlace de la Fase A necesita: el puerto de BzzzBX (o uno que dice
 * "no disponible") y los datos de opsRUN. Lo usan la propuesta de la ranura y
 * los ejecutores de `schedule` y `reject_job_link`.
 */
export function dependenciasDeEnlaceDeLaVentana(): DependenciasDeEnlace {
  return { lectura: lecturaOAusente(), datos: crearDatosDeEnlace() };
}

/**
 * Nombre del cleaner de cada equipo dado, para la línea de los candidatos. Si
 * BzzzBX no responde, vacío: la ranura muestra "— —" y no pierde la lista.
 */
export async function nombresDeEquipos(ids: string[]): Promise<Record<string, string>> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return {};
  try {
    const equipos = await dependenciasDeEnlaceDeLaVentana().lectura.obtenerVarios("cleaner_team", unicos);
    return Object.fromEntries(equipos.map((t) => [t.bzzzbx_team_id, t.name]));
  } catch {
    return {};
  }
}

/** La propuesta de enlace de una request en Requests, para la ranura de la Fase A (§7.2). */
export function propuestaDeLaRequest(requestId: string): Promise<PropuestaDeRanura> {
  return propuestaParaLaVentana(dependenciasDeEnlaceDeLaVentana(), requestId);
}

import "server-only";

/**
 * El tablero en el servidor: opsRUN por el pool de `opsrun_app` y BzzzBX por
 * su puerto. Nada de esto se lee desde el navegador.
 */
import { obtenerBzzzbx } from "../bzzzbx";
import { BzzzbxNoDisponible } from "../bzzzbx/errores";
import type { LecturaBzzzbx } from "../bzzzbx/puertos";
import { comoOpsrunApp } from "../db/servidor";

import { revisarCambios, type Revision } from "./cambios";
import { leerFilas, leerMarca } from "./consultas";
import { leerTablero, type MemoriaTablero } from "./leer";
import type { Tablero } from "./tipos";

/** Cada cuánto el navegador pregunta si hubo cambios (S-5 de OPR-22). */
export const SONDEO_MS = 15_000;

/** Zona de la operación (S-6, hasta OPR-4). Una zona inválida cae a UTC. */
export function zonaDeLaOperacion(env: Record<string, string | undefined> = process.env): string {
  const zona = env.OPSRUN_ZONA_HORARIA?.trim();
  if (!zona) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zona });
    return zona;
  } catch {
    console.error("[opsRUN] OPSRUN_ZONA_HORARIA no es una zona válida; uso UTC");
    return "UTC";
  }
}

/**
 * El puerto de lectura, o uno que siempre responde "no disponible" si BzzzBX
 * no se pudo crear (hoy, el real en el servidor hasta OPR-6). Así el tablero
 * muestra lo de opsRUN con el aviso en vez de caerse.
 */
export function lecturaOAusente(crear: () => LecturaBzzzbx = () => obtenerBzzzbx().lectura): LecturaBzzzbx {
  try {
    return crear();
  } catch (e) {
    console.error("[opsRUN] tablero: BzzzBX no está disponible:", e instanceof Error ? e.message : e);
    const ausente = () => Promise.reject(new BzzzbxNoDisponible());
    return { obtener: ausente, obtenerVarios: ausente, listarPor: ausente, buscarJobs: ausente, cambiosDesde: ausente };
  }
}

const global = globalThis as typeof globalThis & { __opsrunMemoriaTablero?: MemoriaTablero };

export async function obtenerTablero(): Promise<Tablero> {
  const filas = await comoOpsrunApp(leerFilas);
  global.__opsrunMemoriaTablero ??= { leidos: null, en: null };
  return leerTablero({
    filas,
    lectura: lecturaOAusente(),
    ahora: new Date(),
    zona: zonaDeLaOperacion(),
    memoria: global.__opsrunMemoriaTablero,
  });
}

export async function revisarCambiosDelTablero(cursor: string | null): Promise<Revision> {
  return revisarCambios({ cursor, lectura: lecturaOAusente(), marcaOpsrun: () => comoOpsrunApp(leerMarca) });
}

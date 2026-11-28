import "server-only";

/**
 * El tablero en el servidor: opsRUN por el pool de `opsrun_app` y BzzzBX por
 * su puerto. Nada de esto se lee desde el navegador.
 */
import { lecturaOAusente } from "../bzzzbx/ausente";
import { comoOpsrunApp } from "../db/servidor";

import { revisarCambios, type Revision } from "./cambios";
import { leerFilas, leerMarca, leerParaElPanel } from "./consultas";
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

/** Vive en `../bzzzbx/ausente` para que el ciclo de fondo lo use sin `server-only`. */
export { lecturaOAusente };

const global = globalThis as typeof globalThis & { __opsrunMemoriaTablero?: MemoriaTablero };

export async function obtenerTablero(): Promise<Tablero> {
  // Todo de opsRUN en una sola transacción de solo lectura: las filas, y lo que pide el panel de Alerts.
  const { filas, panel } = await comoOpsrunApp(async (db) => ({ filas: await leerFilas(db), panel: await leerParaElPanel(db) }));
  global.__opsrunMemoriaTablero ??= { leidos: null, en: null };
  return leerTablero({
    filas,
    esperas: panel.esperas,
    operadores: panel.operadores,
    lectura: lecturaOAusente(),
    ahora: new Date(),
    zona: zonaDeLaOperacion(),
    memoria: global.__opsrunMemoriaTablero,
  });
}

export async function revisarCambiosDelTablero(cursor: string | null): Promise<Revision> {
  return revisarCambios({ cursor, lectura: lecturaOAusente(), marcaOpsrun: () => comoOpsrunApp(leerMarca) });
}

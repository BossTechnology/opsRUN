/**
 * El puerto de lectura, o uno que siempre responde "no disponible" si BzzzBX no
 * se pudo crear (hoy, el real en el servidor hasta OPR-6). Así el tablero, la
 * conversación y la entrada de correo siguen con lo de opsRUN y el aviso en vez
 * de caerse. Sin `server-only`: también lo usa el ciclo de fondo, que arranca
 * desde `instrumentation`.
 */
import { obtenerBzzzbx } from ".";

import { BzzzbxNoDisponible } from "./errores";
import type { IaBzzzbx, LecturaBzzzbx } from "./puertos";

export function lecturaOAusente(crear: () => LecturaBzzzbx = () => obtenerBzzzbx().lectura): LecturaBzzzbx {
  try {
    return crear();
  } catch (e) {
    console.error("[opsRUN] tablero: BzzzBX no está disponible:", e instanceof Error ? e.message : e);
    const ausente = () => Promise.reject(new BzzzbxNoDisponible());
    return {
      obtener: ausente,
      obtenerVarios: ausente,
      listarPor: ausente,
      buscarJobs: ausente,
      buscarMensajes: ausente,
      leerFoto: ausente,
      cambiosDesde: ausente,
    };
  }
}

/**
 * El puerto de IA, o uno que siempre responde "no disponible" si BzzzBX no se pudo
 * crear (hoy, el real en el servidor hasta OPR-6): el servidor arranca y todo
 * queda en "AI pending", que es el fallback (spec OPR-36 §12.3). Sin log por
 * llamada: la tarea de análisis avisa una vez al caer y una al volver.
 */
export function iaOAusente(crear: () => IaBzzzbx = () => obtenerBzzzbx().ia): IaBzzzbx {
  try {
    return crear();
  } catch {
    const ausente = () => Promise.reject(new BzzzbxNoDisponible());
    return { pedirAnalisis: ausente, resultadoDeAnalisis: ausente };
  }
}

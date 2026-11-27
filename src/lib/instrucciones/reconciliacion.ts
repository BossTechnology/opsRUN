/**
 * La reconciliación de envíos de OPR-27 (spec §7) como tarea del ciclo de fondo
 * único (ADR 0006): cada 5 s toma los `send_*` abiertos y cierra los que
 * BzzzBX ya resolvió. Sin `server-only`: la arranca `instrumentation`, no una
 * ruta. Ninguna lectura la importa (guard G16): una lectura nunca escribe.
 */
import { obtenerBzzzbx } from "../bzzzbx";
import { BzzzbxNoDisponible } from "../bzzzbx/errores";
import type { InstruccionesBzzzbx } from "../bzzzbx/puertos";
import type { Tarea } from "../ciclo/ciclo";

import { crearDatosDeDespacho } from "./datos-sql";
import { reconciliarInstrucciones, type DependenciasDeDespacho } from "./despacho";

/** Cada cuánto reconcilia (S-15): lo que cierra se ve en el siguiente refresco del tablero. */
export const RECONCILIACION_CADENCIA_MS = 5_000;

export const NOMBRE_DE_LA_TAREA = "reconciliacion_envios";

/**
 * El puerto de instrucciones, o uno que siempre responde "no disponible" si
 * BzzzBX no se pudo crear (hoy, el real en el servidor hasta OPR-6): lo guardado
 * queda `pending` y sale cuando BzzzBX vuelve.
 */
function instruccionesOAusente(): InstruccionesBzzzbx {
  try {
    return obtenerBzzzbx().instrucciones;
  } catch (e) {
    console.error("[opsRUN] despacho: BzzzBX no está disponible:", e instanceof Error ? e.message : e);
    const ausente = () => Promise.reject(new BzzzbxNoDisponible());
    return { entregar: ausente, resultadosDesde: ausente, estado: ausente };
  }
}

export function dependenciasDeDespacho(): DependenciasDeDespacho {
  return { instrucciones: instruccionesOAusente(), datos: crearDatosDeDespacho() };
}

/**
 * La tarea `reconciliacion_envios`. Las dependencias se piden en cada vuelta:
 * el stand-in se reemplaza al reiniciarlo y la tarea vive todo el proceso. Una
 * vuelta a la vez la garantiza el ciclo; un error lo registra el ciclo.
 */
export function tareaReconciliacionEnvios(deps: () => DependenciasDeDespacho = dependenciasDeDespacho): Tarea {
  return { nombre: NOMBRE_DE_LA_TAREA, cadenciaMs: RECONCILIACION_CADENCIA_MS, vuelta: () => reconciliarInstrucciones(deps()) };
}

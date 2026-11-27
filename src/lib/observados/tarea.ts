/**
 * El observador de hechos de PINCH como tarea del ciclo de fondo único (ADR 0006,
 * spec OPR-30 a OPR-32 §7.5, P-9): cada 15 s lee los eventos del Job Tracker y el
 * pago de los jobs enlazados y los escribe en Audit. Sin `server-only`: la
 * arranca `instrumentation`, no una ruta. Ninguna lectura la importa
 * (`solo-en-segundo-plano.test.ts`): una lectura nunca escribe.
 */
import { lecturaOAusente } from "../bzzzbx/ausente";
import type { Tarea } from "../ciclo/ciclo";

import { crearDatosDelObservador } from "./datos-sql";
import { crearObservador, type DependenciasDelObservador } from "./observar";

/** Cada cuánto observa (spec §7.5). */
export const OBSERVADOR_CADENCIA_MS = 15_000;

export const NOMBRE_DE_LA_TAREA = "observador_etapas";

export function dependenciasDelObservador(): DependenciasDelObservador {
  return { lectura: lecturaOAusente(), datos: crearDatosDelObservador() };
}

/**
 * La tarea `observador_etapas`. Las dependencias se piden en cada vuelta: el
 * stand-in se reemplaza al reiniciarlo y la tarea vive todo el proceso. Lo que
 * recuerda entre vueltas (los ids ya escritos) vive en esta tarea, creada una
 * vez por `tareasDeOpsrun()`. Una vuelta a la vez la garantiza el ciclo; un
 * error lo registra el ciclo.
 */
export function tareaObservadorEtapas(deps: () => DependenciasDelObservador = dependenciasDelObservador): Tarea {
  const observador = crearObservador(deps);
  return { nombre: NOMBRE_DE_LA_TAREA, cadenciaMs: OBSERVADOR_CADENCIA_MS, vuelta: () => observador.vuelta() };
}

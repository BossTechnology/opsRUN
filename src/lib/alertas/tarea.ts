/**
 * El registrador de alertas como tarea del ciclo de fondo único (ADR 0006, spec
 * OPR-34 §4, P-2): cada 15 s lee los cambios de alertas de BzzzBX y los anota en
 * `alert_occurrence` y en Audit. Sin `server-only`: la arranca `instrumentation`,
 * no una ruta. Ninguna lectura la importa (`un-solo-ciclo.test.ts` y
 * `solo-en-segundo-plano.test.ts`): una lectura nunca escribe. Sigue el patrón de
 * `observados/tarea.ts` y de `instrucciones/reconciliacion.ts`: las dependencias
 * se piden en cada vuelta, sin temporizador propio ni `globalThis`.
 */
import { lecturaOAusente } from "../bzzzbx/ausente";
import type { Tarea } from "../ciclo/ciclo";

import { crearDatosDelRegistrador } from "./datos-sql";
import { crearRegistrador, type DependenciasDelRegistrador } from "./registrador";

/** Cada cuánto registra (spec §4): una alerta nueva aparece en una vuelta, dentro del minuto de OPR-22. */
export const REGISTRADOR_CADENCIA_MS = 15_000;

export const NOMBRE_DE_LA_TAREA = "registrador_alertas";

export function dependenciasDelRegistrador(): DependenciasDelRegistrador {
  return { lectura: lecturaOAusente(), datos: crearDatosDelRegistrador() };
}

/**
 * La tarea `registrador_alertas`. Las dependencias se piden en cada vuelta: el
 * stand-in se reemplaza al reiniciarlo y la tarea vive todo el proceso. Lo que
 * recuerda entre vueltas (el cursor) vive en esta tarea, creada una vez por
 * `tareasDeOpsrun()`. Una vuelta a la vez la garantiza el ciclo; un error lo
 * registra el ciclo, y una caída de BzzzBX no es un error de la tarea.
 */
export function tareaRegistradorAlertas(deps: () => DependenciasDelRegistrador = dependenciasDelRegistrador): Tarea {
  const registrador = crearRegistrador(deps);
  return { nombre: NOMBRE_DE_LA_TAREA, cadenciaMs: REGISTRADOR_CADENCIA_MS, vuelta: () => registrador.vuelta() };
}

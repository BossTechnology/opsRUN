/**
 * El análisis de IA como tarea del ciclo de fondo único (ADR 0006, spec OPR-36 §9.1):
 * cada 5 s abre el análisis de las requests nuevas, sigue los pendientes con BzzzBX y
 * guarda el resultado. Sin `server-only`: la arranca `instrumentation`, no una ruta.
 * Ninguna lectura la importa (`solo-en-segundo-plano.test.ts`): una lectura nunca
 * pide un análisis.
 */
import { iaOAusente } from "../bzzzbx/ausente";
import type { Tarea } from "../ciclo/ciclo";

import { crearAnalisis, type DependenciasDeAnalisis } from "./analisis";
import { crearDatosDeAnalisis } from "./datos-sql";

/** Cada cuánto corre (P-7): la request nueva sale a BzzzBX en unos 5 s. */
export const ANALISIS_CADENCIA_MS = 5_000;

export const NOMBRE_DE_LA_TAREA = "analisis_ia";

export function dependenciasDelAnalisis(): DependenciasDeAnalisis {
  return { ia: iaOAusente(), datos: crearDatosDeAnalisis() };
}

/** La tarea y el aviso que le da la entrada de correo al crear una request. */
export type TareaDeAnalisis = Tarea & { despertar: (requestId: string) => void };

/**
 * La tarea `analisis_ia`. Las dependencias se piden en cada vuelta: el stand-in se
 * reemplaza al reiniciarlo y la tarea vive todo el proceso. Lo que recuerda entre
 * vueltas (las requests despertadas y si BzzzBX estaba caído) vive en esta tarea,
 * creada una vez por `tareasDeOpsrun()`. Una vuelta a la vez la garantiza el ciclo;
 * un error lo registra el ciclo.
 */
export function tareaAnalisisIa(deps: () => DependenciasDeAnalisis = dependenciasDelAnalisis): TareaDeAnalisis {
  const analisis = crearAnalisis(deps);
  return {
    nombre: NOMBRE_DE_LA_TAREA,
    cadenciaMs: ANALISIS_CADENCIA_MS,
    vuelta: () => analisis.vuelta(),
    despertar: (requestId) => analisis.despertar(requestId),
  };
}

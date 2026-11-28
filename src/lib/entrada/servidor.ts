/**
 * La entrada de correo con sus dependencias reales, como tarea del ciclo de
 * fondo único (spec OPR-15 §8.1, ADR 0006): el puerto de lectura que elige
 * `BZZZBX_MODO` y los datos de opsRUN por SQL. Sin `server-only`: la arranca
 * `instrumentation`, no una ruta. No abre un temporizador propio.
 */
import { obtenerBzzzbx } from "../bzzzbx";
import { BzzzbxNoDisponible } from "../bzzzbx/errores";
import type { LecturaBzzzbx } from "../bzzzbx/puertos";
import type { Tarea } from "../ciclo/ciclo";

import { crearDatosDeEntrada } from "./datos-sql";
import { crearEntrada } from "./entrada";

/** Cada cuánto mira BzzzBX (spec §8.2): el tramo de opsRUN cabe en una vuelta. */
export const ENTRADA_CADENCIA_MS = 15_000;

export const NOMBRE_DE_LA_TAREA = "entrada_correo";

const ausente = () => Promise.reject(new BzzzbxNoDisponible());
const LECTURA_AUSENTE: LecturaBzzzbx = {
  obtener: ausente,
  obtenerVarios: ausente,
  listarPor: ausente,
  buscarJobs: ausente,
  buscarMensajes: ausente,
  leerFoto: ausente,
  cambiosDesde: ausente,
};

/**
 * El puerto de lectura vigente en cada llamada, no el de cuando arrancó el
 * ciclo: el stand-in se reemplaza al reiniciarlo (`reiniciarFalso`) y la
 * entrada, que vive todo el proceso, no debe quedarse leyendo el anterior. Si
 * BzzzBX no se puede crear (hoy, el real en el servidor hasta OPR-6) responde
 * siempre "no disponible", sin llenar el log cada vuelta: la entrada avisa
 * una vez.
 */
export function lecturaVigente(obtener: () => LecturaBzzzbx = () => obtenerBzzzbx().lectura): LecturaBzzzbx {
  const actual = (): LecturaBzzzbx => {
    try {
      return obtener();
    } catch {
      return LECTURA_AUSENTE;
    }
  };
  return {
    obtener: (entidad, id) => actual().obtener(entidad, id),
    obtenerVarios: (entidad, ids) => actual().obtenerVarios(entidad, ids),
    listarPor: (entidad, filtro) => actual().listarPor(entidad, filtro),
    buscarJobs: (filtro) => actual().buscarJobs(filtro),
    buscarMensajes: (filtro) => actual().buscarMensajes(filtro),
    leerFoto: (ref) => actual().leerFoto(ref),
    cambiosDesde: (cursor) => actual().cambiosDesde(cursor),
  };
}

/**
 * La tarea `entrada_correo`. Un proceso, una entrada: el cursor vive en su memoria (P-2).
 * `alCrearRequest` es el enganche de OPR-36: `tareasDeOpsrun()` le pasa el `despertar` de la
 * tarea de análisis, que solo anota la request. La vuelta de la entrada nunca llama a BzzzBX por la IA.
 */
export function tareaEntradaCorreo({ alCrearRequest }: { alCrearRequest?: (requestId: string) => void } = {}): Tarea {
  const entrada = crearEntrada({
    lectura: lecturaVigente(),
    datos: crearDatosDeEntrada(),
    alCrearRequest,
  });
  return { nombre: NOMBRE_DE_LA_TAREA, cadenciaMs: ENTRADA_CADENCIA_MS, vuelta: () => entrada.vuelta() };
}

/**
 * Qué puede hacer el Composer (spec OPR-27 §5.1). Funciones puras: el servidor
 * las usa para pintar los modos y para que `ejecutarAccion` rechace lo que no
 * corre; el navegador, para deshabilitar Send. La interfaz no es la defensa.
 */
import { LIMITE_DE_CARACTERES, type ModoComposer } from "./tipos";

export const RAZON_BZZZBX_CAIDO = "BzzzBX unavailable";
export const RAZON_JOB_CANCELADO = "Job cancelled";
export const RAZON_SIN_HILO = "No email thread for this request";
export const RAZON_SIN_CLEANER = "Choose a cleaner first";
/** Edit To, Cc y Temporary number (P-4): se ven en gris y no corren. */
export const TEXTO_PARA_UN_RELEASE_POSTERIOR = "Available in a later release";

export type DisponibilidadDelModo = { disponible: true } | { disponible: false; razon: string };

export type EntradaDeDisponibilidad = {
  etapa: string;
  /** BzzzBX responde ahora. */
  bzzzbxDisponible: boolean;
  /** Hilos de correo de la request (`hilos`, OPR-26 §7.1). */
  hilos: string[];
  /** El cleaner: el del job desde Scheduled, el del borrador en Requests. */
  equipoId: string | null;
};

const si = (razon: string | null): DisponibilidadDelModo => (razon ? { disponible: false, razon } : { disponible: true });

/**
 * Con el job cancelado todo queda en gris. Con BzzzBX caído, Customer y
 * Cleaner se apagan y Note sigue: solo escribe en opsRUN (OPR-26 S-13).
 */
export function disponibilidadDelComposer(e: EntradaDeDisponibilidad): Record<ModoComposer, DisponibilidadDelModo> {
  const cancelado = e.etapa === "cancelled";
  return {
    customer: si(
      cancelado
        ? RAZON_JOB_CANCELADO
        : !e.bzzzbxDisponible
          ? RAZON_BZZZBX_CAIDO
          : e.hilos.length === 0
            ? RAZON_SIN_HILO
            : null,
    ),
    cleaner: si(
      cancelado
        ? RAZON_JOB_CANCELADO
        : !e.bzzzbxDisponible
          ? RAZON_BZZZBX_CAIDO
          : !e.equipoId
            ? RAZON_SIN_CLEANER
            : null,
    ),
    note: si(cancelado ? RAZON_JOB_CANCELADO : null),
  };
}

export type ValidacionDelCuerpo = { ok: true; cuerpo: string } | { ok: false; razon: string };

/** El cuerpo recortado, o por qué no sirve: vacío o pasado del límite del modo (S-9). */
export function validarCuerpo(modo: ModoComposer, texto: unknown): ValidacionDelCuerpo {
  if (typeof texto !== "string") return { ok: false, razon: "Write a message first." };
  const cuerpo = texto.trim();
  if (cuerpo === "") return { ok: false, razon: "Write a message first." };
  const limite = LIMITE_DE_CARACTERES[modo];
  if (cuerpo.length > limite) return { ok: false, razon: `Too long (${limite} characters at most).` };
  return { ok: true, cuerpo };
}

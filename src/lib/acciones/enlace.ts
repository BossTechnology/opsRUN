/**
 * Ejecutores de las acciones del enlace de la Fase A (spec OPR-26 §7.2 y spec
 * Fase A §5 y §6): `schedule` (confirmar el job observado) y la interna
 * `reject_job_link`. Los dos pasan por `ejecutarAccion`, que ya comprobó la
 * disponibilidad, el motivo y la versión; aquí solo se llama a `src/lib/fase-a`
 * con el actor de la transacción y se traducen sus errores a un mensaje para
 * el operador. La función SQL deja el Audit en la misma transacción.
 *
 * Las dependencias entran por una función para no cargar el módulo de servidor
 * (`server-only`, pool de la base) hasta que la acción corre de verdad.
 */
import { esNoDisponible } from "../bzzzbx/errores";
import {
  confirmarEnlace,
  esEnlaceInvalido,
  rechazarEnlace,
  type CodigoEnlaceInvalido,
  type DependenciasDeEnlace,
} from "../fase-a/enlace";

import type { DefinicionAccion, ResultadoAccion } from "./tipos";

/** Lo que el operador lee cuando el enlace no se pudo hacer. Nada se escribió. */
export const MENSAJES_DE_ENLACE: Record<CodigoEnlaceInvalido, string> = {
  request_no_encontrada: "Job not found.",
  request_no_abierta: "This request is not open anymore.",
  gate_incompleto: "Confirm the owner, the details, the sender and the cleaner first.",
  job_no_encontrado: "That job no longer exists in BzzzBX.",
  job_cancelado: "That job is cancelled. Choose another one.",
  job_ya_enlazado: "That job is already linked to another request.",
};

export const MENSAJE_SIN_JOB = "Choose a job from the list first.";
export const MENSAJE_BZZZBX_CAIDO = "BzzzBX unavailable";

type ObtenerDependencias = () => Promise<DependenciasDeEnlace>;
type Ejecutor = NonNullable<DefinicionAccion["ejecutor"]>;

const rechazada = (codigo: string, mensaje: string): ResultadoAccion => ({ tipo: "rechazada", codigo, mensaje });

/** El job que eligió el operador, de `datos`; null si no vino o no es un texto. */
function jobElegido(datos: Record<string, unknown>): string | null {
  const id = datos.bzzzbx_job_id;
  return typeof id === "string" && id.trim() !== "" ? id.trim() : null;
}

/** Los errores que el operador puede provocar son un resultado; el resto sube y `ejecutarAccion` lo registra. */
function comoResultado(e: unknown): ResultadoAccion {
  if (esEnlaceInvalido(e)) return rechazada(e.codigo, MENSAJES_DE_ENLACE[e.codigo] ?? "That link is not valid.");
  if (esNoDisponible(e)) return rechazada("bzzzbx_no_disponible", MENSAJE_BZZZBX_CAIDO);
  throw e;
}

export function crearEjecutoresDeEnlace(dependencias: ObtenerDependencias): { schedule: Ejecutor; reject_job_link: Ejecutor } {
  return {
    schedule: async ({ actor }, entrada) => {
      const bzzzbxJobId = jobElegido(entrada.datos);
      if (!bzzzbxJobId) return rechazada("job_no_elegido", MENSAJE_SIN_JOB);
      try {
        await confirmarEnlace(await dependencias(), { requestId: entrada.requestId, bzzzbxJobId }, actor);
        return { tipo: "guardada" };
      } catch (e) {
        return comoResultado(e);
      }
    },

    reject_job_link: async ({ actor }, entrada) => {
      const bzzzbxJobId = jobElegido(entrada.datos);
      if (!bzzzbxJobId) return rechazada("job_no_elegido", MENSAJE_SIN_JOB);
      try {
        await rechazarEnlace(
          await dependencias(),
          { requestId: entrada.requestId, bzzzbxJobId, motivo: entrada.motivo },
          actor,
        );
        return { tipo: "guardada" };
      } catch (e) {
        return comoResultado(e);
      }
    },
  };
}

/**
 * La propuesta de enlace que recibe la ranura de la Fase A (spec OPR-26 §7.2):
 * `proponerEnlaces` (src/lib/fase-a), o el error si BzzzBX no respondió. Los
 * errores del puerto se reconocen por nombre (`esNoDisponible`,
 * `esFiltroInvalido`), no con `instanceof`.
 */
import { esFiltroInvalido, esNoDisponible } from "../bzzzbx/errores";
import { proponerEnlaces, type DependenciasDeEnlace, type Propuesta } from "../fase-a/enlace";
import { fechaYVentana } from "../tablero/formato";
import { SIN_VALOR } from "../tablero/tipos";

import type { CandidatoDeCambio } from "./tipos";

export type PropuestaDeRanura = Propuesta | { error: "bzzzbx_no_disponible" };

export async function propuestaParaLaVentana(
  deps: DependenciasDeEnlace,
  requestId: string,
  opciones: { paraCambio?: boolean } = {},
): Promise<PropuestaDeRanura> {
  try {
    return await proponerEnlaces(deps, requestId, opciones);
  } catch (e) {
    if (esNoDisponible(e)) return { error: "bzzzbx_no_disponible" };
    // BzzzBX no aceptó el filtro (fechas raras del borrador): para el operador es "no hay candidatos".
    if (esFiltroInvalido(e)) return { candidatos: [], truncado: false, motivo_vacio: "sin_candidatos" };
    throw e;
  }
}

/**
 * Lo que Change linked job (OPR-29) necesita de la propuesta, ya como texto para el panel y para el bloqueo "No
 * other job to link". Con BzzzBX caído la propuesta es un error: sin candidatos (la acción ya sale bloqueada por
 * BzzzBX). El cleaner sale de `equipos` (por `bzzzbx_team_id`); sin nombre, "— —".
 */
export function candidatosParaElCambio(
  propuesta: PropuestaDeRanura,
  equipos: Record<string, string> = {},
): { candidatosDeCambio: CandidatoDeCambio[]; candidatosTruncado: boolean } {
  if ("error" in propuesta) return { candidatosDeCambio: [], candidatosTruncado: false };
  return {
    candidatosDeCambio: propuesta.candidatos.map((c) => ({
      bzzzbxJobId: c.job.bzzzbx_job_id,
      jobNumber: c.job.job_number,
      fecha: fechaYVentana(c.job.service_date, c.job.window_start, c.job.window_end),
      cleaner: (c.job.bzzzbx_team_id && equipos[c.job.bzzzbx_team_id]) || SIN_VALOR,
      coincide: c.coincide,
      sugerido: c.sugerido,
    })),
    candidatosTruncado: propuesta.truncado,
  };
}

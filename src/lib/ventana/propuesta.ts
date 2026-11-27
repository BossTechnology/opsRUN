/**
 * La propuesta de enlace que recibe la ranura de la Fase A (spec OPR-26 §7.2):
 * `proponerEnlaces` (src/lib/fase-a), o el error si BzzzBX no respondió. Los
 * errores del puerto se reconocen por nombre (`esNoDisponible`,
 * `esFiltroInvalido`), no con `instanceof`.
 */
import { esFiltroInvalido, esNoDisponible } from "../bzzzbx/errores";
import { proponerEnlaces, type DependenciasDeEnlace, type Propuesta } from "../fase-a/enlace";

export type PropuestaDeRanura = Propuesta | { error: "bzzzbx_no_disponible" };

export async function propuestaParaLaVentana(deps: DependenciasDeEnlace, requestId: string): Promise<PropuestaDeRanura> {
  try {
    return await proponerEnlaces(deps, requestId);
  } catch (e) {
    if (esNoDisponible(e)) return { error: "bzzzbx_no_disponible" };
    // BzzzBX no aceptó el filtro (fechas raras del borrador): para el operador es "no hay candidatos".
    if (esFiltroInvalido(e)) return { candidatos: [], truncado: false, motivo_vacio: "sin_candidatos" };
    throw e;
  }
}

/**
 * Disponibilidad de una acción (spec OPR-26 §5.2). Se calcula en el servidor,
 * con los datos de la ventana: la interfaz solo pinta el resultado, y
 * `ejecutarAccion` la vuelve a calcular antes de correr nada.
 */
import type { VentanaJob } from "../ventana/tipos";

import { REGISTRO_DE_ACCIONES } from "./registro";
import type { AccionVista, DefinicionAccion, Disponibilidad } from "./tipos";

export const BZZZBX_NO_DISPONIBLE = "BzzzBX unavailable";
export const INSTRUCCION_EN_CURSO = "Instruction in progress";
export const NO_CONSTRUIDA = "Not built yet";
export const FUERA_DE_RELEASE = "Not available in this release";

/**
 * El orden importa: lo que no es de esta etapa no aparece, lo que no entra en
 * el release se dice, un bloqueo concreto (BzzzBX, instrucción, dato que falta)
 * le gana a "Not built yet" porque le dice algo más útil al operador.
 */
export function disponibilidadDe(def: DefinicionAccion, v: VentanaJob): Disponibilidad {
  if (v.etapa === "cancelled" || !def.etapas.includes(v.etapa)) return { tipo: "no_aplica" };
  if (!def.enRelease) return { tipo: "fuera_de_release" };
  if (def.necesitaBzzzbx) {
    if (!v.bzzzbx.disponible) return { tipo: "bloqueada", motivo: BZZZBX_NO_DISPONIBLE };
    if (v.instruccionAbierta) return { tipo: "bloqueada", motivo: INSTRUCCION_EN_CURSO };
  }
  const motivo = def.bloqueo?.(v);
  if (motivo) return { tipo: "bloqueada", motivo };
  if (!def.ejecutor) return { tipo: "sin_construir" };
  return { tipo: "disponible" };
}

/** El texto en gris de lo que no corre; null si corre o no se muestra. */
export function nota(d: Disponibilidad): string | null {
  switch (d.tipo) {
    case "bloqueada":
      return d.motivo;
    case "sin_construir":
      return NO_CONSTRUIDA;
    case "fuera_de_release":
      return FUERA_DE_RELEASE;
    default:
      return null;
  }
}

/** Las acciones de la action bar para esta ventana: las de su etapa, sin las internas ni las que no aplican. */
export function accionesVisibles(v: VentanaJob, registro: DefinicionAccion[] = REGISTRO_DE_ACCIONES): AccionVista[] {
  return registro
    .filter((def) => !def.interna)
    .map((def) => ({ def, disponibilidad: disponibilidadDe(def, v) }))
    .filter(({ disponibilidad }) => disponibilidad.tipo !== "no_aplica")
    .map(({ def, disponibilidad }) => ({
      codigo: def.codigo,
      etiqueta: def.etiqueta,
      descripcion: def.descripcion,
      motivo: def.motivo,
      disponibilidad,
      nota: nota(disponibilidad),
    }));
}

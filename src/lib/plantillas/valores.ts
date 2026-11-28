/**
 * Los cuatro valores de una plantilla (spec OPR-18 §4.3 y §8.1), sacados de lo que ya se leyó: el borrador de la
 * request (opsRUN), el job y la propiedad (BzzzBX, por su puerto). Nada se guarda. Desde Scheduled manda el job; en
 * Requests, el borrador. Lo que no hay no tiene valor y el placeholder queda literal.
 */
import type { Job, Property } from "../bzzzbx/tipos";
import { fechaCorta, ventanaCorta } from "../tablero/formato";

import type { ValoresDePlantilla } from "./llenar";

/** Las columnas del borrador de `opsrun.request` que llenan una plantilla. */
export type BorradorDePlantilla = {
  bzzzbx_property_id: string | null;
  bzzzbx_space_id: string | null;
  unit: string | null;
  service_date: string | null;
  window_start: string | null;
  window_end: string | null;
};

/** De dónde manda: el job (BzzzBX es su dueño) desde Scheduled, el borrador en Requests. */
export type FuenteDeValores = {
  fuente: "borrador" | "job";
  borrador: BorradorDePlantilla;
  /** El job que BzzzBX devolvió; null si no lo conoce. Solo cuenta con `fuente: "job"`. */
  job: Job | null;
  /** La propiedad que BzzzBX devolvió; null si no la conoce. */
  propiedad: Property | null;
};

/**
 * @param canal el de la plantilla. En una de texto la ventana lleva guion ASCII ("9:00 AM-12:00 PM") y no la media
 * raya del tablero, que es de UCS-2: con ella un SMS cabría en 70 caracteres y no en 160 (§4.4, S-11).
 */
export function valoresDelJob({ fuente, borrador, job, propiedad }: FuenteDeValores, canal: "email" | "text" = "email"): ValoresDePlantilla {
  const delJob = fuente === "job";
  const espacioId = delJob ? (job?.bzzzbx_space_id ?? null) : borrador.bzzzbx_space_id;
  const fecha = delJob ? (job?.service_date ?? null) : borrador.service_date;
  const inicio = delJob ? (job?.window_start ?? null) : borrador.window_start;
  const fin = delJob ? (job?.window_end ?? null) : borrador.window_end;

  // La etiqueta del espacio en BzzzBX; si no hay, la unidad del borrador (como el tablero); si no hay ninguna, vacío.
  const etiqueta = espacioId ? propiedad?.units.find((u) => u.bzzzbx_space_id === espacioId)?.label : undefined;
  const space = etiqueta ?? borrador.unit?.trim() ?? "";

  return {
    property: propiedad?.name,
    space,
    date: fechaCorta(fecha) ?? undefined,
    window: ventanaCorta(inicio, fin, canal === "text" ? "-" : "–") ?? undefined,
  };
}

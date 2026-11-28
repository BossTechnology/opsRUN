/**
 * Datos de prueba de la Job window: las requests R1 a R6 de la seed con lo que
 * la ventana agrega, y lo que el falso de BzzzBX devuelve para ellas. Solo
 * para pruebas. Todo inventado.
 */
import { datosIniciales } from "../bzzzbx/falso/datos";
import { filasDeLaSeed, leidosDelFalso } from "../tablero/prueba-datos";

import type { Confirmaciones, FilaVentana, LeidosVentana, OperadorConCarga } from "./tipos";

const EXTRAS: Record<number, Pick<FilaVentana, "bzzzbx_contact_id" | "bzzzbx_team_id" | "access_notes">> = {
  1: { bzzzbx_contact_id: null, bzzzbx_team_id: null, access_notes: null },
  2: { bzzzbx_contact_id: "bx-cont-0001", bzzzbx_team_id: "bx-team-0001", access_notes: "Key at the front desk." },
  3: { bzzzbx_contact_id: "bx-cont-0001", bzzzbx_team_id: "bx-team-0002", access_notes: null },
  4: { bzzzbx_contact_id: "bx-cont-0002", bzzzbx_team_id: "bx-team-0001", access_notes: "Gate code from the requester." },
  5: { bzzzbx_contact_id: "bx-cont-0003", bzzzbx_team_id: "bx-team-0003", access_notes: null },
  6: { bzzzbx_contact_id: "bx-cont-0004", bzzzbx_team_id: "bx-team-0002", access_notes: null },
};

/** R`n` de la seed (1 a 6) como la lee la ventana. */
export function filaVentana(ahora: Date, n: number): FilaVentana {
  const fila = filasDeLaSeed(ahora)[n - 1];
  if (!fila) throw new Error(`no hay R${n} en la seed de prueba`);
  return {
    ...fila,
    ...EXTRAS[n]!,
    change_seq: String(100 + n),
    entered_po_at: null,
    // R5 se marcó OSS sola al terminar a mano (seed); R6 la marcó Finance Uno.
    oss_source: fila.oss_mark === null ? null : n === 5 ? "auto" : "operator",
    approved_by_nombre: fila.approved_at ? "Finance Uno" : null,
    validated_by_nombre: fila.validated_at ? "Finance Uno" : null,
    // OPR-29: el enlace del job, de Audit.
    linked_at: fila.job_number ? new Date(ahora.getTime() - 86_400_000).toISOString() : null,
    linked_by_nombre: fila.job_number ? "Ops Uno" : null,
  };
}

export function leidosVentanaDelFalso(ahora: Date): LeidosVentana {
  const d = datosIniciales(ahora);
  return { ...leidosDelFalso(ahora), contactos: d.contact, equipos: d.cleaner_team, fotos: d.photo };
}

export const OPERADORES_DE_PRUEBA: OperadorConCarga[] = [
  { id: "0a000000-0000-4000-8000-0000000000a1", nombre: "Ops Uno", abiertas: 2 },
  { id: "0a000000-0000-4000-8000-0000000000a2", nombre: "Ops Dos", abiertas: 4 },
  { id: "0a000000-0000-4000-8000-0000000000b1", nombre: "Finance Uno", abiertas: 0 },
];

export const CONFIRMACIONES_COMPLETAS: Confirmaciones = { details: true, sender: true, cleaner: true };
export const SIN_CONFIRMACIONES: Confirmaciones = { details: false, sender: false, cleaner: false };

/**
 * Arma la pestaña Billing (spec OPR-32 §5.5): PO #, OSS status, Approved,
 * Validated y Paid. Función pura: sin base, sin puerto, sin reloj propio. Lo de
 * opsRUN (el PO capturado, la marca OSS, quién aprobó y quién validó) sale de la
 * request; lo de PINCH (el PO del job, si el cliente exige PO y Paid) se lee del
 * puerto al pintar y nunca se guarda.
 */
import type { Customer, Job, Payment } from "../bzzzbx/tipos";
import { diaCorto } from "../tablero/formato";
import { SIN_VALOR } from "../tablero/tipos";
import type { FilaVentana } from "../ventana/tipos";

import { poVigente, type PoVigente } from "./po";

export type VistaBilling = {
  po: {
    /** El que el operador capturó en opsRUN: el valor editable. */
    capturado: string | null;
    /** "In PINCH: <po>": el del job en PINCH si es otro distinto del capturado; solo se lee. */
    enPinch: string | null;
    /** El cliente exige PO. */
    requerido: boolean;
    /** Editable hasta Validate (P-13). */
    editable: boolean;
    vigente: PoVigente | null;
  };
  oss: { texto: "OSS" | "Not OSS" | typeof SIN_VALOR; auto: boolean };
  /** "Approved Nov 27 by Ops Uno". */
  aprobada: string;
  /** "Validated Nov 27 by Finance Uno" o "Not validated". */
  validada: string;
  /** "Paid Nov 26", "Not paid yet" o `— —` (BzzzBX caído y sin nada leído). */
  pagada: { texto: string; pagada: boolean };
};

export type EntradaBilling = {
  fila: Pick<
    FilaVentana,
    | "entered_po_number"
    | "po_number"
    | "oss_mark"
    | "oss_source"
    | "approved_at"
    | "approved_by_nombre"
    | "validated_at"
    | "validated_by_nombre"
  >;
  job: Pick<Job, "po_number"> | undefined;
  customer: Pick<Customer, "po_required"> | undefined;
  pago: Pick<Payment, "paid" | "paid_at"> | undefined;
  zona: string;
  bzzzbxDisponible: boolean;
};

const conPersona = (texto: string, nombre: string | null) => (nombre ? `${texto} by ${nombre}` : texto);

export function armarBilling({ fila, job, customer, pago, zona, bzzzbxDisponible }: EntradaBilling): VistaBilling {
  const capturado = fila.entered_po_number?.trim() || null;
  const pinch = job?.po_number?.trim() || null;
  const validada = fila.validated_at !== null;

  let pagada: VistaBilling["pagada"];
  if (pago?.paid) {
    pagada = { texto: pago.paid_at ? `Paid ${diaCorto(pago.paid_at, zona)}` : "Paid", pagada: true };
  } else if (pago || bzzzbxDisponible) {
    pagada = { texto: "Not paid yet", pagada: false };
  } else {
    // BzzzBX caído y nada leído antes: no se sabe.
    pagada = { texto: SIN_VALOR, pagada: false };
  }

  return {
    po: {
      capturado,
      enPinch: pinch !== null && pinch !== capturado ? pinch : null,
      requerido: Boolean(customer?.po_required),
      editable: !validada,
      vigente: poVigente({ capturado, pinch, borrador: fila.po_number }),
    },
    oss: {
      texto: fila.oss_mark === "oss" ? "OSS" : fila.oss_mark === "not_oss" ? "Not OSS" : SIN_VALOR,
      auto: fila.oss_mark !== null && fila.oss_source === "auto",
    },
    aprobada: fila.approved_at ? conPersona(`Approved ${diaCorto(fila.approved_at, zona)}`, fila.approved_by_nombre) : SIN_VALOR,
    validada: validada ? conPersona(`Validated ${diaCorto(fila.validated_at!, zona)}`, fila.validated_by_nombre) : "Not validated",
    pagada,
  };
}

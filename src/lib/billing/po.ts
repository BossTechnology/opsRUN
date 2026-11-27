/**
 * El PO vigente de un job (spec OPR-32 §5.3, P-2). Tres fuentes, en este orden:
 * el PO que el operador capturó en opsRUN, el PO del job en PINCH (leído del
 * puerto, nunca guardado) y el PO del borrador (congelado al programar). El job
 * tiene PO si cualquiera no está vacío. Es la misma regla que aplica la base en
 * `opsrun_private.current_po` al validar; aquí sirve para pintar y para el
 * bloqueo "Add PO".
 */

export type FuenteDePo = "opsrun" | "pinch" | "draft";

export type PoVigente = { valor: string; fuente: FuenteDePo };

const limpio = (valor: string | null | undefined): string | null => {
  const recortado = valor?.trim();
  return recortado ? recortado : null;
};

export function poVigente(fuentes: {
  /** `request.entered_po_number`. */
  capturado: string | null | undefined;
  /** `Job.po_number`, leído de BzzzBX. */
  pinch: string | null | undefined;
  /** `request.po_number`, el del borrador. */
  borrador: string | null | undefined;
}): PoVigente | null {
  const capturado = limpio(fuentes.capturado);
  if (capturado) return { valor: capturado, fuente: "opsrun" };
  const pinch = limpio(fuentes.pinch);
  if (pinch) return { valor: pinch, fuente: "pinch" };
  const borrador = limpio(fuentes.borrador);
  if (borrador) return { valor: borrador, fuente: "draft" };
  return null;
}

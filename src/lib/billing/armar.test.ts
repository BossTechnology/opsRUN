// @vitest-environment node
import { describe, expect, it } from "vitest";

import { armarBilling, type EntradaBilling } from "./armar";
import { poVigente } from "./po";

const FILA: EntradaBilling["fila"] = {
  entered_po_number: null,
  po_number: null,
  oss_mark: null,
  oss_source: null,
  approved_at: "2026-11-27T15:00:00Z",
  approved_by_nombre: "Ops Uno",
  validated_at: null,
  validated_by_nombre: null,
};

function armar(parche: Omit<Partial<EntradaBilling>, "fila"> & { fila?: Partial<EntradaBilling["fila"]> } = {}) {
  const { fila, ...resto } = parche;
  return armarBilling({
    fila: { ...FILA, ...fila },
    job: { po_number: null },
    customer: { po_required: false },
    pago: undefined,
    zona: "America/New_York",
    bzzzbxDisponible: true,
    ...resto,
  });
}

describe("poVigente: las tres fuentes en orden (OPR-32, P-2)", () => {
  it("el capturado en opsRUN le gana al de PINCH y al del borrador", () => {
    expect(poVigente({ capturado: "A", pinch: "B", borrador: "C" })).toEqual({ valor: "A", fuente: "opsrun" });
  });
  it("sin capturado, el de PINCH le gana al del borrador", () => {
    expect(poVigente({ capturado: null, pinch: "B", borrador: "C" })).toEqual({ valor: "B", fuente: "pinch" });
  });
  it("solo el del borrador", () => {
    expect(poVigente({ capturado: null, pinch: null, borrador: "C" })).toEqual({ valor: "C", fuente: "draft" });
  });
  it("vacíos y en blanco no cuentan; sin ninguno, null", () => {
    expect(poVigente({ capturado: "  ", pinch: "", borrador: undefined })).toBeNull();
    expect(poVigente({ capturado: undefined, pinch: undefined, borrador: undefined })).toBeNull();
  });
  it("recorta los espacios", () => {
    expect(poVigente({ capturado: "  PO-1  ", pinch: null, borrador: null })).toEqual({ valor: "PO-1", fuente: "opsrun" });
  });
});

describe("armarBilling: PO #", () => {
  it("el capturado en opsRUN es el valor editable; sin validar, editable", () => {
    const v = armar({ fila: { entered_po_number: "PO-EX-0108" } });
    expect(v.po).toMatchObject({ capturado: "PO-EX-0108", editable: true, vigente: { valor: "PO-EX-0108", fuente: "opsrun" }, enPinch: null });
  });

  it("'In PINCH' sale solo si PINCH tiene un PO distinto del capturado", () => {
    expect(armar({ fila: { entered_po_number: "A" }, job: { po_number: "B" } }).po.enPinch).toBe("B");
    expect(armar({ fila: { entered_po_number: "A" }, job: { po_number: "A" } }).po.enPinch).toBeNull();
    expect(armar({ job: { po_number: "B" } }).po.enPinch).toBe("B"); // PINCH tiene uno y opsRUN no
    expect(armar({ job: { po_number: null } }).po.enPinch).toBeNull();
    expect(armar({ job: undefined }).po.enPinch).toBeNull();
  });

  it("el vigente cae al de PINCH y después al del borrador", () => {
    expect(armar({ job: { po_number: "B" }, fila: { po_number: "C" } }).po.vigente).toEqual({ valor: "B", fuente: "pinch" });
    expect(armar({ fila: { po_number: "C" } }).po.vigente).toEqual({ valor: "C", fuente: "draft" });
    expect(armar().po.vigente).toBeNull();
  });

  it("'PO required' viene de si el cliente lo exige", () => {
    expect(armar({ customer: { po_required: true } }).po.requerido).toBe(true);
    expect(armar({ customer: { po_required: false } }).po.requerido).toBe(false);
    expect(armar({ customer: undefined }).po.requerido).toBe(false);
  });

  it("validado, el PO deja de ser editable (P-13)", () => {
    const v = armar({ fila: { validated_at: "2026-11-28T15:00:00Z", validated_by_nombre: "Finance Uno" } });
    expect(v.po.editable).toBe(false);
  });
});

describe("armarBilling: OSS, Approved y Validated", () => {
  it("OSS status: OSS, Not OSS o `— —`, con 'auto' si salió sola", () => {
    expect(armar().oss).toEqual({ texto: "— —", auto: false });
    expect(armar({ fila: { oss_mark: "oss", oss_source: "auto" } }).oss).toEqual({ texto: "OSS", auto: true });
    expect(armar({ fila: { oss_mark: "oss", oss_source: "operator" } }).oss).toEqual({ texto: "OSS", auto: false });
    expect(armar({ fila: { oss_mark: "not_oss", oss_source: "operator" } }).oss).toEqual({ texto: "Not OSS", auto: false });
  });

  it("Approved con el día en la zona de la operación y el nombre de quien aprobó", () => {
    expect(armar().aprobada).toBe("Approved Nov 27 by Ops Uno");
    // A las 02:00 UTC del 28 todavía es 27 en Nueva York.
    expect(armar({ fila: { approved_at: "2026-11-28T02:00:00Z" } }).aprobada).toBe("Approved Nov 27 by Ops Uno");
    expect(armar({ fila: { approved_at: null, approved_by_nombre: null } }).aprobada).toBe("— —");
  });

  it("Validated con nombre, o 'Not validated'", () => {
    expect(armar().validada).toBe("Not validated");
    expect(armar({ fila: { validated_at: "2026-11-28T15:00:00Z", validated_by_nombre: "Finance Uno" } }).validada).toBe(
      "Validated Nov 28 by Finance Uno",
    );
  });
});

describe("armarBilling: Paid (de QuickBooks, solo lectura)", () => {
  it("Paid con la fecha", () => {
    expect(armar({ pago: { paid: true, paid_at: "2026-11-26T15:00:00Z" } }).pagada).toEqual({ texto: "Paid Nov 26", pagada: true });
  });
  it("Paid sin fecha todavía dice Paid", () => {
    expect(armar({ pago: { paid: true, paid_at: null } }).pagada).toEqual({ texto: "Paid", pagada: true });
  });
  it("sin pagar, 'Not paid yet'", () => {
    expect(armar({ pago: { paid: false, paid_at: null } }).pagada).toEqual({ texto: "Not paid yet", pagada: false });
    expect(armar({ pago: undefined }).pagada).toEqual({ texto: "Not paid yet", pagada: false });
  });
  it("con BzzzBX caído: lo último leído, o `— —` si no hay nada", () => {
    expect(armar({ bzzzbxDisponible: false, pago: { paid: true, paid_at: "2026-11-26T15:00:00Z" } }).pagada.texto).toBe("Paid Nov 26");
    expect(armar({ bzzzbxDisponible: false, pago: { paid: false, paid_at: null } }).pagada.texto).toBe("Not paid yet");
    expect(armar({ bzzzbxDisponible: false, pago: undefined }).pagada).toEqual({ texto: "— —", pagada: false });
  });
});

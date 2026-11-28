// @vitest-environment node
/** La vista de IA de la pestaña de la propiedad (spec OPR-36 §10 y §15.2), pura. */
import { describe, expect, it } from "vitest";

import { CAMPOS_DE_IA } from "../bzzzbx/tipos-ia";

import { armarIa, valorDelBorrador } from "./armar";
import type { AnalisisLeido, BorradorLeido, SugerenciaLeida } from "./tipos";

const VACIO: BorradorLeido = {
  bzzzbx_customer_id: null,
  bzzzbx_contact_id: null,
  bzzzbx_property_id: null,
  bzzzbx_space_id: null,
  unit: null,
  beds: null,
  bzzzbx_service_id: null,
  service_date: null,
  window_start: null,
  window_end: null,
  access_notes: null,
  po_number: null,
};

const analisis = (estado: AnalisisLeido["estado"]): AnalisisLeido => ({
  id: "an-1",
  estado,
  requested_at: "2030-01-15T15:00:00.000Z",
  completed_at: estado === "pending" ? null : "2030-01-15T15:00:05.000Z",
});

const s = (id: string, campo: SugerenciaLeida["campo"], rank: number, valor: unknown, razon: string | null = null): SugerenciaLeida => ({ id, campo, rank, valor, razon });

const NOMBRES = {
  "bx-prop-0001": "Example Tower",
  "bx-prop-0002": "Example Plaza",
  "bx-svc-0001": "Regular clean",
  "bx-cust-0001": "Example Property Group",
  "bx-cont-0001": "Ana Ejemplo",
};

describe("AI pending (§10.1)", () => {
  it.each(["pending", "failed", "timed_out"] as const)("con el último análisis %s, pendiente", (estado) => {
    expect(armarIa({ borrador: VACIO, analisis: analisis(estado), sugerencias: [], nombres: {} }).pendiente).toBe(true);
  });

  it("sin análisis, pendiente", () => {
    expect(armarIa({ borrador: VACIO, analisis: null, sugerencias: [], nombres: {} }).pendiente).toBe(true);
  });

  it("con el análisis completed, ya no: los campos vacíos se ven como hoy", () => {
    const v = armarIa({ borrador: VACIO, analisis: analisis("completed"), sugerencias: [], nombres: {} });
    expect(v.pendiente).toBe(false);
    expect(v.campos.property.vacio).toBe(true);
  });

  it("trae los once campos, con su etiqueta y el nombre corto para el aria-label", () => {
    const v = armarIa({ borrador: VACIO, analisis: null, sugerencias: [], nombres: {} });
    expect(Object.keys(v.campos).sort()).toEqual([...CAMPOS_DE_IA].sort());
    expect(v.campos.property).toMatchObject({ etiqueta: "Property", nombreCorto: "property", vacio: true, abierta: null });
    expect(v.campos.service_date.nombreCorto).toBe("date");
  });

  it("un campo con valor no está vacío, y un null confirmado no cuenta como valor", () => {
    const v = armarIa({
      borrador: { ...VACIO, unit: "4B", beds: 0, window_start: "09:00", window_end: "12:00", bzzzbx_contact_id: "bx-cont-0001" },
      analisis: analisis("completed"),
      sugerencias: [],
      nombres: {},
    });
    expect(v.campos.unit.vacio).toBe(false);
    expect(v.campos.beds.vacio).toBe(false);
    expect(v.campos.time_window.vacio).toBe(false);
    expect(v.campos.sender.vacio).toBe(false);
    expect(v.campos.po_number.vacio).toBe(true);
  });
});

describe("campos AI-marked (§10.2)", () => {
  const borrador: BorradorLeido = { ...VACIO, bzzzbx_property_id: "bx-prop-0001", unit: "4B", beds: 3 };

  it("la principal sin decidir marca el campo, con su valor, su motivo y los nombres que leyó BzzzBX", () => {
    const v = armarIa({
      borrador,
      analisis: analisis("completed"),
      sugerencias: [s("s1", "property", 1, "bx-prop-0001", "The address matches."), s("s2", "unit", 1, "4B", "In the subject.")],
      nombres: NOMBRES,
    });
    expect(v.campos.property.abierta).toMatchObject({
      id: "s1",
      texto: "Example Tower",
      secundario: null,
      razon: "The address matches.",
      igualAlBorrador: true,
    });
    expect(v.campos.unit.abierta).toMatchObject({ texto: "4B", igualAlBorrador: true });
    expect(v.campos.beds.abierta).toBeNull();
  });

  it("Change de un crosswalk ofrece solo las alternativas de la IA (si el borrador es el de la IA)", () => {
    const v = armarIa({
      borrador,
      analisis: analisis("completed"),
      sugerencias: [s("s1", "property", 1, "bx-prop-0001"), s("s2", "property", 2, "bx-prop-0002", "Same street.")],
      nombres: NOMBRES,
    });
    expect(v.campos.property.abierta!.opciones).toEqual([{ valor: "bx-prop-0002", texto: "Example Plaza", secundario: null, origen: "alternativa" }]);
  });

  it("si el borrador ya no es el de la IA, se ofrece también lo que propuso, y no se puede aceptar tal cual", () => {
    const v = armarIa({
      borrador: { ...borrador, bzzzbx_property_id: "bx-prop-0009" },
      analisis: analisis("completed"),
      sugerencias: [s("s1", "property", 1, "bx-prop-0001"), s("s2", "property", 2, "bx-prop-0002")],
      nombres: NOMBRES,
    });
    expect(v.campos.property.abierta!.igualAlBorrador).toBe(false);
    expect(v.campos.property.abierta!.opciones.map((o) => o.origen)).toEqual(["ia", "alternativa"]);
  });

  it("sin nombre (BzzzBX caído) el nombre sale `— —` y el ID como texto secundario", () => {
    const v = armarIa({ borrador, analisis: analisis("completed"), sugerencias: [s("s1", "property", 1, "bx-prop-0001")], nombres: {} });
    expect(v.campos.property.abierta).toMatchObject({ texto: "— —", secundario: "bx-prop-0001" });
  });

  it("sender: cliente y contacto con sus nombres; sin contacto, solo el cliente", () => {
    const completo = armarIa({
      borrador: { ...VACIO, bzzzbx_customer_id: "bx-cust-0001", bzzzbx_contact_id: "bx-cont-0001" },
      analisis: analisis("completed"),
      sugerencias: [s("s1", "sender", 1, { bzzzbx_customer_id: "bx-cust-0001", bzzzbx_contact_id: "bx-cont-0001" })],
      nombres: NOMBRES,
    });
    expect(completo.campos.sender.abierta).toMatchObject({ texto: "Example Property Group · Ana Ejemplo", igualAlBorrador: true });
    const soloCliente = armarIa({
      borrador: { ...VACIO, bzzzbx_customer_id: "bx-cust-0001" },
      analisis: analisis("completed"),
      sugerencias: [s("s1", "sender", 1, { bzzzbx_customer_id: "bx-cust-0001", bzzzbx_contact_id: null })],
      nombres: NOMBRES,
    });
    expect(soloCliente.campos.sender.abierta).toMatchObject({ texto: "Example Property Group", igualAlBorrador: true });
  });

  it("time_window y date con su texto; camas y notas con el suyo", () => {
    const v = armarIa({
      borrador: { ...VACIO, window_start: "09:00", window_end: "12:00", service_date: "2030-01-16", beds: 3 },
      analisis: analisis("completed"),
      sugerencias: [
        s("s1", "time_window", 1, { start: "09:00", end: "12:00" }),
        s("s2", "service_date", 1, "2030-01-16"),
        s("s3", "beds", 1, 3),
      ],
      nombres: {},
    });
    expect(v.campos.time_window.abierta).toMatchObject({ texto: "09:00–12:00", igualAlBorrador: true, opciones: [] });
    expect(v.campos.service_date.abierta).toMatchObject({ texto: "2030-01-16", igualAlBorrador: true });
    expect(v.campos.beds.abierta).toMatchObject({ texto: "3", igualAlBorrador: true });
  });

  it("una alternativa sola, sin principal, no marca nada", () => {
    const v = armarIa({ borrador, analisis: analisis("completed"), sugerencias: [s("s2", "property", 2, "bx-prop-0002")], nombres: NOMBRES });
    expect(v.campos.property.abierta).toBeNull();
  });

  it("space ofrece las alternativas de la IA y los espacios de la propiedad, sin repetir", () => {
    const v = armarIa({
      borrador: { ...VACIO, bzzzbx_property_id: "bx-prop-0001", bzzzbx_space_id: "bx-space-0101" },
      analisis: analisis("completed"),
      sugerencias: [s("s1", "space", 1, "bx-space-0101"), s("s2", "space", 2, "bx-space-0102")],
      nombres: {},
      espacios: [
        { id: "bx-space-0101", label: "Suite 101" },
        { id: "bx-space-0102", label: "Suite 102" },
        { id: "bx-space-0103", label: "Suite 103" },
      ],
    });
    expect(v.campos.space.abierta).toMatchObject({ texto: "Suite 101", igualAlBorrador: true });
    expect(v.campos.space.abierta!.opciones).toEqual([
      { valor: "bx-space-0102", texto: "Suite 102", secundario: null, origen: "alternativa" },
      { valor: "bx-space-0101", texto: "Suite 101", secundario: null, origen: "propiedad" },
      { valor: "bx-space-0103", texto: "Suite 103", secundario: null, origen: "propiedad" },
    ]);
  });
});

describe("varios jobs (§10.3)", () => {
  it("una sugerencia multiple_jobs abierta da el aviso con su cantidad", () => {
    const v = armarIa({ borrador: VACIO, analisis: analisis("completed"), sugerencias: [s("sj", "multiple_jobs", 1, { count: 2 })], nombres: {} });
    expect(v.variosJobs).toEqual({ id: "sj", cantidad: 2 });
  });

  it("sin ella, ningún aviso; y nunca es un campo vacío ni pendiente de por sí", () => {
    expect(armarIa({ borrador: VACIO, analisis: analisis("completed"), sugerencias: [], nombres: {} }).variosJobs).toBeNull();
  });
});

describe("valorDelBorrador", () => {
  it("usa la forma de §4.1: ventana con las dos horas, sender con las dos claves", () => {
    expect(valorDelBorrador("time_window", { ...VACIO, window_start: "09:00", window_end: "12:00" })).toEqual({ start: "09:00", end: "12:00" });
    expect(valorDelBorrador("time_window", VACIO)).toBeNull();
    expect(valorDelBorrador("sender", { ...VACIO, bzzzbx_customer_id: "bx-cust-0001" })).toEqual({ bzzzbx_customer_id: "bx-cust-0001", bzzzbx_contact_id: null });
    expect(valorDelBorrador("multiple_jobs", VACIO)).toBeNull();
  });
});

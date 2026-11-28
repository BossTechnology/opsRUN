// @vitest-environment node
/** La forma de cada campo del análisis de IA (spec OPR-36 §4.1 y §15.2), buena y mala. */
import { describe, expect, it } from "vitest";

import { CAMPOS_DE_IA, type CampoDeIa, type Propuesta } from "../bzzzbx/tipos-ia";

import { normalizar, valorDeEntrada, valorValido, validarPropuestas } from "./forma";

const buenos: [CampoDeIa, unknown][] = [
  ["property", "bx-prop-0001"],
  ["space", "bx-space-0101"],
  ["service", "bx-svc-0001"],
  ["unit", "4B"],
  ["unit", "x".repeat(32)],
  ["beds", 0],
  ["beds", 3],
  ["beds", 50],
  ["service_date", "2030-02-28"],
  ["service_date", "2032-02-29"],
  ["time_window", { start: "09:00", end: "12:30" }],
  ["access_notes", "Key at the front desk."],
  ["access_notes", "x".repeat(500)],
  ["po_number", "PO-123"],
  ["po_number", "x".repeat(64)],
  ["sender", { bzzzbx_customer_id: "bx-cust-0001", bzzzbx_contact_id: "bx-cont-0001" }],
  ["sender", { bzzzbx_customer_id: "bx-cust-0001", bzzzbx_contact_id: null }],
  ["sender", { bzzzbx_customer_id: "bx-cust-0001" }],
  ["multiple_jobs", { count: 2 }],
  ["multiple_jobs", { count: 5 }],
];

const malos: [CampoDeIa, unknown][] = [
  ["property", "Example Tower"],
  ["property", "bx-prop-"],
  ["property", 3],
  ["property", null],
  ["space", ""],
  ["service", "svc-0001"],
  ["unit", ""],
  ["unit", "   "],
  ["unit", "x".repeat(33)],
  ["unit", 4],
  ["beds", -1],
  ["beds", 51],
  ["beds", 2.5],
  ["beds", "3"],
  ["service_date", "2030-02-30"],
  ["service_date", "2030-2-3"],
  ["service_date", "tomorrow"],
  ["service_date", "2031-02-29"],
  ["time_window", { start: "12:00", end: "09:00" }],
  ["time_window", { start: "09:00", end: "09:00" }],
  ["time_window", { start: "9:00", end: "12:00" }],
  ["time_window", { start: "09:00", end: "24:00" }],
  ["time_window", { start: "09:00" }],
  ["time_window", { start: "09:00", end: "12:00", tz: "x" }],
  ["time_window", "09:00-12:00"],
  ["access_notes", "x".repeat(501)],
  ["access_notes", ""],
  ["po_number", "x".repeat(65)],
  ["sender", { bzzzbx_customer_id: "bx-cust-0001", name: "Maria Ejemplo" }],
  ["sender", { bzzzbx_contact_id: "bx-cont-0001" }],
  ["sender", { bzzzbx_customer_id: "Ejemplo SA" }],
  ["sender", { bzzzbx_customer_id: "bx-cust-0001", bzzzbx_contact_id: "Maria" }],
  ["sender", "bx-cust-0001"],
  ["multiple_jobs", { count: 1 }],
  ["multiple_jobs", { count: 21 }],
  ["multiple_jobs", { count: 2.5 }],
  ["multiple_jobs", { count: 2, why: "x" }],
  ["multiple_jobs", 2],
];

describe("valorValido", () => {
  it.each(buenos)("%s acepta %j", (campo, valor) => expect(valorValido(campo, valor)).toBe(true));
  it.each(malos)("%s rechaza %j", (campo, valor) => expect(valorValido(campo, valor)).toBe(false));

  it("cubre los once campos, bueno y malo", () => {
    for (const campo of CAMPOS_DE_IA) {
      expect(buenos.some(([c]) => c === campo), campo).toBe(true);
      expect(malos.some(([c]) => c === campo), campo).toBe(true);
    }
  });
});

describe("normalizar", () => {
  it("sender siempre lleva las dos claves", () => {
    expect(normalizar("sender", { bzzzbx_customer_id: "bx-cust-0001" })).toEqual({ bzzzbx_customer_id: "bx-cust-0001", bzzzbx_contact_id: null });
    expect(normalizar("beds", 3)).toBe(3);
  });
});

const p = (campo: CampoDeIa, rank: 1 | 2 | 3, valor: unknown, motivo: string | null = null): Propuesta => ({ campo, rank, valor, motivo });

describe("validarPropuestas", () => {
  it("acepta un resultado válido con alternativas y lo deja con las claves de la base", () => {
    const r = validarPropuestas([p("property", 1, "bx-prop-0001", "El domicilio"), p("property", 2, "bx-prop-0002"), p("unit", 1, "4B")], CAMPOS_DE_IA);
    expect(r).toEqual({
      ok: true,
      propuestas: [
        { field: "property", rank: 1, value: "bx-prop-0001", reason: "El domicilio" },
        { field: "property", rank: 2, value: "bx-prop-0002", reason: null },
        { field: "unit", rank: 1, value: "4B", reason: null },
      ],
    });
  });

  it("un resultado vacío es válido (la IA no supo nada)", () => {
    expect(validarPropuestas([], CAMPOS_DE_IA)).toEqual({ ok: true, propuestas: [] });
  });

  it.each([
    ["un campo que no se pidió", [p("unit", 1, "4B")], ["beds"], "campo_no_pedido"],
    ["un campo que no existe", [{ campo: "cleaner_team", rank: 1, valor: "bx-team-0001", motivo: null } as unknown as Propuesta], [...CAMPOS_DE_IA], "campo_no_pedido"],
    ["un rango fuera de 1 a 3", [{ campo: "unit", rank: 4, valor: "4B", motivo: null } as unknown as Propuesta], [...CAMPOS_DE_IA], "rango"],
    ["una forma mala", [p("beds", 1, "tres")], [...CAMPOS_DE_IA], "forma"],
    ["un motivo de más de 200 caracteres", [p("unit", 1, "4B", "x".repeat(201))], [...CAMPOS_DE_IA], "motivo"],
    ["dos rank 1 del mismo campo", [p("unit", 1, "4B"), p("unit", 1, "5C")], [...CAMPOS_DE_IA], "repetida"],
    ["una alternativa sin principal", [p("property", 2, "bx-prop-0002")], [...CAMPOS_DE_IA], "sin_principal"],
  ])("rechaza %s, con el campo y sin el valor", (_nombre, propuestas, pedidos, motivo) => {
    const r = validarPropuestas(propuestas, pedidos as CampoDeIa[]);
    expect(r).toMatchObject({ ok: false, motivo });
    expect(JSON.stringify(r)).not.toContain("tres");
  });

  it("una mala entre buenas descarta todo (S-9)", () => {
    expect(validarPropuestas([p("unit", 1, "4B"), p("beds", 1, 99)], CAMPOS_DE_IA)).toMatchObject({ ok: false, campo: "beds" });
  });
});

describe("valorDeEntrada (lo que escribe el operador en Change)", () => {
  it("texto, camas, fecha y ventana con la forma del campo", () => {
    expect(valorDeEntrada("unit", " 4B ")).toBe("4B");
    expect(valorDeEntrada("beds", "2")).toBe(2);
    expect(valorDeEntrada("service_date", "2030-03-01")).toBe("2030-03-01");
    expect(valorDeEntrada("time_window", { start: "09:00", end: "12:00" })).toEqual({ start: "09:00", end: "12:00" });
    expect(valorDeEntrada("access_notes", "Ring twice.")).toBe("Ring twice.");
  });

  it("devuelve null con lo que no sirve, y nunca acepta texto libre para un crosswalk ID", () => {
    expect(valorDeEntrada("unit", "")).toBeNull();
    expect(valorDeEntrada("beds", "dos")).toBeNull();
    expect(valorDeEntrada("beds", "99")).toBeNull();
    expect(valorDeEntrada("service_date", "mañana")).toBeNull();
    expect(valorDeEntrada("time_window", { start: "12:00", end: "09:00" })).toBeNull();
    expect(valorDeEntrada("property", "bx-prop-0001")).toBeNull();
    expect(valorDeEntrada("sender", "bx-cust-0001")).toBeNull();
  });
});

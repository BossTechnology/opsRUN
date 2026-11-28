// @vitest-environment node
/** `llenarPlantilla` (spec OPR-18 §4.3 y §10.2): una sola pasada, texto plano, lo que no se llena queda literal. */
import { describe, expect, it } from "vitest";

import { llenarPlantilla, placeholdersSinLlenar } from "./llenar";

const TEXTO = "New job: {{property}} {{space}} on {{date}}, {{window}}. Can you confirm?";
const TODOS = { property: "Sample Court", space: "Unit 12", date: "Wed, Nov 25", window: "9:00 AM–12:00 PM" };

describe("llenarPlantilla", () => {
  it("llena los cuatro valores", () => {
    expect(llenarPlantilla(TEXTO, TODOS)).toEqual({
      texto: "New job: Sample Court Unit 12 on Wed, Nov 25, 9:00 AM–12:00 PM. Can you confirm?",
      faltan: [],
    });
  });

  it("un espacio vacío no deja doble espacio", () => {
    expect(llenarPlantilla(TEXTO, { ...TODOS, space: "" }).texto).toBe(
      "New job: Sample Court on Wed, Nov 25, 9:00 AM–12:00 PM. Can you confirm?",
    );
    expect(llenarPlantilla("The job at {{property}} {{space}} is cancelled.", { property: "Demo Lofts", space: "" }).texto).toBe(
      "The job at Demo Lofts is cancelled.",
    );
  });

  it("un placeholder sin valor queda literal y entra en faltan, en orden y sin repetir", () => {
    const r = llenarPlantilla("{{date}} y otra vez {{date}}, {{window}} en {{property}}", { property: "Sample Court" });
    expect(r.texto).toBe("{{date}} y otra vez {{date}}, {{window}} en Sample Court");
    expect(r.faltan).toEqual(["{{date}}", "{{window}}"]);
  });

  it("un valor undefined cuenta como sin valor", () => {
    expect(llenarPlantilla("On {{date}}", { date: undefined }).faltan).toEqual(["{{date}}"]);
  });

  it("una sola pasada: un valor que contiene {{date}} no se vuelve a expandir", () => {
    const r = llenarPlantilla("At {{property}} on {{date}}", { property: "Odd {{date}} Place", date: "Wed, Nov 25" });
    expect(r.texto).toBe("At Odd {{date}} Place on Wed, Nov 25");
    expect(r.faltan).toEqual([]);
  });

  it("un valor con HTML o con $& queda como texto", () => {
    const r = llenarPlantilla("At {{property}}.", { property: "<b>$&</b> $1 $$" });
    expect(r.texto).toBe("At <b>$&</b> $1 $$.");
  });

  it("los placeholders 'a mano' quedan siempre literales, aunque haya valor", () => {
    const r = llenarPlantilla("Can we move {{property}} {{space}} to {{date}}, {{window}}? Please confirm.", TODOS, ["date", "window"]);
    expect(r.texto).toBe("Can we move Sample Court Unit 12 to {{date}}, {{window}}? Please confirm.");
    expect(r.faltan).toEqual(["{{date}}", "{{window}}"]);
  });

  it("la misma plantilla dos veces con valores distintos no se contamina", () => {
    const a = llenarPlantilla(TEXTO, TODOS);
    const b = llenarPlantilla(TEXTO, { property: "Demo Lofts", space: "", date: "Thu, Nov 26", window: "10:00 AM–2:00 PM" });
    expect(a.texto).toContain("Sample Court Unit 12");
    expect(b.texto).toBe("New job: Demo Lofts on Thu, Nov 26, 10:00 AM–2:00 PM. Can you confirm?");
  });

  it("un nombre que no es uno de los cuatro no se llena y se reporta", () => {
    const r = llenarPlantilla("Hi {{cleaner}}", { property: "x" });
    expect(r.texto).toBe("Hi {{cleaner}}");
    expect(r.faltan).toEqual(["{{cleaner}}"]);
  });

  it("sin placeholders, el texto no cambia", () => {
    expect(llenarPlantilla("Plain text.", TODOS)).toEqual({ texto: "Plain text.", faltan: [] });
  });
});

describe("placeholdersSinLlenar", () => {
  it("los {{…}} que hay en un texto, en orden y sin repetir", () => {
    expect(placeholdersSinLlenar("Move to {{date}}, {{window}} or {{date}}")).toEqual(["{{date}}", "{{window}}"]);
    expect(placeholdersSinLlenar("Todo lleno")).toEqual([]);
    expect(placeholdersSinLlenar("")).toEqual([]);
  });

  it("es el mismo patrón que la base rechaza con OP056: minúsculas y guion bajo", () => {
    expect(placeholdersSinLlenar("{{Date}} {{a-b}} {{}} { {date} }")).toEqual([]);
    expect(placeholdersSinLlenar("{{cleaner_name}}")).toEqual(["{{cleaner_name}}"]);
  });
});

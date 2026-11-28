import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ResultadoAccion } from "@/lib/acciones/tipos";
import { armarIa } from "@/lib/analisis-ia/armar";
import type { BorradorLeido, SugerenciaLeida, VistaIa } from "@/lib/analisis-ia/tipos";
import { armarVentana } from "@/lib/ventana/armar";
import { filaVentana, leidosVentanaDelFalso, OPERADORES_DE_PRUEBA, SIN_CONFIRMACIONES } from "@/lib/ventana/prueba-datos";

import { AvisoVariosJobs } from "./aviso-varios-jobs";
import { CampoIa } from "./campo-ia";
import { PanelPropiedad } from "./paneles";

afterEach(cleanup);

const AHORA = new Date("2026-11-24T18:00:00Z");
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
const guardada: ResultadoAccion = { tipo: "guardada" };
const COMPLETADO = { id: "an-1", estado: "completed" as const, requested_at: AHORA.toISOString(), completed_at: AHORA.toISOString() };
const s = (id: string, campo: SugerenciaLeida["campo"], rank: number, valor: unknown, razon: string | null = null): SugerenciaLeida => ({ id, campo, rank, valor, razon });
const NOMBRES = { "bx-prop-0001": "Example Tower", "bx-prop-0002": "Example Plaza", "bx-svc-0001": "Regular clean" };

function vistaDe(borrador: BorradorLeido, sugerencias: SugerenciaLeida[], analisis: typeof COMPLETADO | null = COMPLETADO): VistaIa {
  return armarIa({ borrador, analisis, sugerencias, nombres: NOMBRES });
}

function pintarCampo(campo: "property" | "beds" | "time_window" | "unit", vista: VistaIa, resultado: ResultadoAccion = guardada) {
  const decidir = vi.fn(async () => resultado);
  render(<CampoIa vista={vista.campos[campo]} decidir={decidir} />);
  return decidir;
}

describe("CampoIa: chip AI, Why? y los tres controles (OPR-36 §10.2)", () => {
  const vista = vistaDe({ ...VACIO, bzzzbx_property_id: "bx-prop-0001" }, [
    s("s1", "property", 1, "bx-prop-0001", "The address matches."),
    s("s2", "property", 2, "bx-prop-0002", "Same street."),
  ]);

  it("muestra el chip AI y tres controles con su aria-label, sin repetir el valor si es el del borrador", () => {
    pintarCampo("property", vista);
    expect(screen.getByTestId("ia-marca").textContent).toBe("AI");
    expect(screen.getByRole("button", { name: "Accept AI property" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change AI property" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject AI property" })).toBeTruthy();
    expect(screen.queryByTestId("ia-propuesta")).toBeNull();
  });

  it("el motivo se despliega con Why? y aria-expanded", () => {
    pintarCampo("property", vista);
    const why = screen.getByRole("button", { name: "Why?" });
    expect(why.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("ia-razon")).toBeNull();
    fireEvent.click(why);
    expect(why.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("ia-razon").textContent).toContain("The address matches.");
  });

  it("sin motivo no hay Why?", () => {
    pintarCampo("beds", vistaDe({ ...VACIO, beds: 3 }, [s("s3", "beds", 1, 3)]));
    expect(screen.queryByRole("button", { name: "Why?" })).toBeNull();
  });

  it("Accept manda accepted con el id de la sugerencia, sin valor final", async () => {
    const decidir = pintarCampo("property", vista);
    fireEvent.click(screen.getByRole("button", { name: "Accept AI property" }));
    await waitFor(() => expect(decidir).toHaveBeenCalledWith({ suggestionId: "s1", decision: "accepted" }));
  });

  it("Reject manda rejected", async () => {
    const decidir = pintarCampo("property", vista);
    fireEvent.click(screen.getByRole("button", { name: "Reject AI property" }));
    await waitFor(() => expect(decidir).toHaveBeenCalledWith({ suggestionId: "s1", decision: "rejected" }));
  });

  it("Change de un crosswalk ofrece solo las alternativas de la IA, y Save manda corrected con ese valor", async () => {
    const decidir = pintarCampo("property", vista);
    fireEvent.click(screen.getByRole("button", { name: "Change AI property" }));
    const edicion = screen.getByTestId("ia-edicion");
    const opciones = within(edicion).getAllByRole("radio");
    expect(opciones).toHaveLength(1);
    expect(edicion.textContent).toContain("Example Plaza");
    expect(edicion.querySelector("input[type=text]")).toBeNull();
    fireEvent.click(within(edicion).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(decidir).toHaveBeenCalledWith({ suggestionId: "s1", decision: "corrected", finalValue: "bx-prop-0002" }));
  });

  it("Change de camas: un campo numérico con la forma del campo; Save no se deja con un valor que no sirve", async () => {
    const decidir = pintarCampo("beds", vistaDe({ ...VACIO, beds: 3 }, [s("s3", "beds", 1, 3, "Three bedrooms.")]));
    fireEvent.click(screen.getByRole("button", { name: "Change AI beds" }));
    const campo = screen.getByLabelText("Beds") as HTMLInputElement;
    expect(campo.value).toBe("3");
    fireEvent.change(campo, { target: { value: "99" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(campo, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(decidir).toHaveBeenCalledWith({ suggestionId: "s3", decision: "corrected", finalValue: 2 }));
  });

  it("Change de la ventana: dos horas con start menor que end", async () => {
    const decidir = pintarCampo("time_window", vistaDe({ ...VACIO, window_start: "09:00", window_end: "12:00" }, [s("s4", "time_window", 1, { start: "09:00", end: "12:00" })]));
    fireEvent.click(screen.getByRole("button", { name: "Change AI window" }));
    fireEvent.change(screen.getByLabelText("Window end"), { target: { value: "08:00" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Window end"), { target: { value: "13:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(decidir).toHaveBeenCalledWith({ suggestionId: "s4", decision: "corrected", finalValue: { start: "09:00", end: "13:30" } }),
    );
  });

  it("si el borrador ya no es el valor de la IA, lo dice y Accept queda en gris (Change y Reject siguen)", () => {
    pintarCampo("unit", vistaDe({ ...VACIO, unit: "8H" }, [s("s5", "unit", 1, "4B")]));
    expect(screen.getByTestId("ia-propuesta").textContent).toContain("AI suggested 4B");
    expect((screen.getByRole("button", { name: "Accept AI unit" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Change AI unit" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Reject AI unit" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("un rechazo del servidor se dice con su mensaje y no cierra la edición", async () => {
    pintarCampo("beds", vistaDe({ ...VACIO, beds: 3 }, [s("s3", "beds", 1, 3)]), {
      tipo: "rechazada",
      codigo: "cambio_concurrente",
      mensaje: "This job changed. Review and try again.",
    });
    fireEvent.click(screen.getByRole("button", { name: "Change AI beds" }));
    fireEvent.change(screen.getByLabelText("Beds"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toContain("This job changed. Review and try again.");
    expect(screen.getByTestId("ia-edicion")).toBeTruthy();
  });

  it("sin sugerencia abierta no pinta nada", () => {
    const { container } = render(<CampoIa vista={vistaDe(VACIO, []).campos.property} decidir={vi.fn(async () => guardada)} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("AvisoVariosJobs (OPR-36 §10.3)", () => {
  it("dice cuántos jobs, es un status con Got it y Not multiple", async () => {
    const decidir = vi.fn(async () => guardada);
    render(<AvisoVariosJobs aviso={{ id: "sj", cantidad: 2 }} decidir={decidir} />);
    const aviso = screen.getByRole("status");
    expect(aviso.textContent).toContain("AI: this email may ask for 2 jobs.");
    fireEvent.click(within(aviso).getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(decidir).toHaveBeenCalledWith({ suggestionId: "sj", decision: "accepted" }));
    fireEvent.click(within(aviso).getByRole("button", { name: "Not multiple" }));
    await waitFor(() => expect(decidir).toHaveBeenCalledWith({ suggestionId: "sj", decision: "rejected" }));
  });
});

function ventanaConIa(ia: VistaIa | null, n = 2) {
  return armarVentana({
    fila: { ...filaVentana(AHORA, n), status: "open", beds: null },
    leidos: leidosVentanaDelFalso(AHORA),
    hilos: [`bx-thread-000${n}`],
    operadores: OPERADORES_DE_PRUEBA,
    confirmaciones: SIN_CONFIRMACIONES,
    instruccionAbierta: false,
    ahora: AHORA,
    zona: "UTC",
    bzzzbx: { disponible: true, actualizadoEn: AHORA.toISOString() },
    tab: null,
    ia,
  });
}

describe("PanelPropiedad con IA (OPR-36 §10.1)", () => {
  const sinNada = (analisis: typeof COMPLETADO | null) =>
    armarIa({ borrador: VACIO, analisis, sugerencias: [], nombres: {} });

  it("con el análisis pendiente, los campos vacíos dicen AI pending, en un grupo aria-live, y nada se deshabilita", () => {
    const v = ventanaConIa(sinNada(null));
    render(<PanelPropiedad ventana={v} decidir={vi.fn(async () => guardada)} />);
    expect(screen.getByTestId("campos-propiedad").getAttribute("aria-live")).toBe("polite");
    expect(screen.getAllByTestId("ia-pendiente").length).toBeGreaterThan(0);
    expect(screen.getByTestId("campo-beds").textContent).toContain("AI pending");
    for (const b of screen.queryAllByRole("button")) expect((b as HTMLButtonElement).disabled).toBe(false);
  });

  it("con el análisis completed, lo vacío vuelve a `— —` y ya no dice AI pending", () => {
    const v = ventanaConIa(null);
    render(<PanelPropiedad ventana={{ ...v, datos: { ...v.datos, ia: sinNada(COMPLETADO) } }} decidir={vi.fn(async () => guardada)} />);
    expect(screen.queryByTestId("ia-pendiente")).toBeNull();
    expect(screen.getByTestId("campo-beds").textContent).toContain("— —");
  });

  it("fuera de Requests o sin IA, la pestaña queda como siempre: sin aria-live, sin Beds, sin AI pending", () => {
    const v = ventanaConIa(null);
    render(<PanelPropiedad ventana={v} />);
    expect(screen.getByTestId("campos-propiedad").getAttribute("aria-live")).toBeNull();
    expect(screen.queryByTestId("campo-beds")).toBeNull();
    expect(screen.queryByTestId("ia-pendiente")).toBeNull();
  });

  it("el aviso de varios jobs va arriba y un campo con sugerencia lleva su chip dentro de su fila", () => {
    const base = ventanaConIa(null);
    const ia = armarIa({
      borrador: { ...VACIO, beds: 3, bzzzbx_property_id: "bx-prop-0001" },
      analisis: COMPLETADO,
      sugerencias: [s("sj", "multiple_jobs", 1, { count: 2 }), s("s3", "beds", 1, 3), s("s1", "property", 1, "bx-prop-0001")],
      nombres: NOMBRES,
    });
    render(<PanelPropiedad ventana={{ ...base, datos: { ...base.datos, ia } }} decidir={vi.fn(async () => guardada)} />);
    expect(screen.getByTestId("aviso-varios-jobs")).toBeTruthy();
    expect(within(screen.getByTestId("campo-beds")).getByTestId("ia-marca")).toBeTruthy();
    expect(within(screen.getByTestId("campo-property")).getByRole("button", { name: "Accept AI property" })).toBeTruthy();
    expect(within(screen.getByTestId("campo-service")).queryByTestId("ia-marca")).toBeNull();
  });
});

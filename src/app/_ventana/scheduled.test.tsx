import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { accionesVisibles } from "@/lib/acciones/disponibilidad";
import type { EntradaAccion, ResultadoAccion } from "@/lib/acciones/tipos";
import type { AlertResult } from "@/lib/bzzzbx/tipos";
import { armarVentana, type EntradaVentana } from "@/lib/ventana/armar";
import { CONFIRMACIONES_COMPLETAS, filaVentana, leidosVentanaDelFalso, OPERADORES_DE_PRUEBA } from "@/lib/ventana/prueba-datos";
import type { CandidatoDeCambio, VentanaJob } from "@/lib/ventana/tipos";

// La Server Action y sus dependencias de servidor no corren en jsdom.
vi.mock("./acciones", () => ({ ejecutarAccion: vi.fn(), elegirActor: vi.fn() }));

import { BarraAcciones } from "./barra-acciones";
import { Encabezado } from "./encabezado";
import { PanelPropiedad } from "./paneles";

afterEach(cleanup);

/**
 * Scheduled en la Job window (OPR-29): el chip gris Delayed, la fila Linked job y el panel de Change linked job.
 */
const AHORA = new Date("2026-11-24T18:00:00Z");

const OPS010: AlertResult = {
  bzzzbx_alert_id: "bx-alert-9010",
  sujeto: { tipo: "job", bzzzbx_job_id: "bx-job-0003" },
  rule_id: "OPS-010",
  rule_version: "1",
  level: "red",
  reason_text: "Not started by 1:00 PM.",
  opened_at: "2026-11-24T17:00:00.000Z",
  cleared_at: null,
};

const CANDIDATOS: CandidatoDeCambio[] = [
  { bzzzbxJobId: "bx-job-0112", jobNumber: "EX-00112", fecha: "Sat, Nov 28 · 1:00 PM–4:00 PM", cleaner: "Team Beta", coincide: ["misma_propiedad", "mismo_cliente"], sugerido: true },
  { bzzzbxJobId: "bx-job-0113", jobNumber: "EX-00113", fecha: "Sun, Nov 29 · 9:00 AM–12:00 PM", cleaner: "— —", coincide: ["misma_propiedad"], sugerido: false },
];

function ventana(n: number, parche: Partial<EntradaVentana> = {}, alertas: AlertResult[] = []): VentanaJob {
  const leidos = leidosVentanaDelFalso(AHORA);
  return armarVentana({
    fila: filaVentana(AHORA, n),
    leidos: { ...leidos, alertas: [...leidos.alertas, ...alertas] },
    hilos: [`bx-thread-000${n}`],
    operadores: OPERADORES_DE_PRUEBA,
    confirmaciones: CONFIRMACIONES_COMPLETAS,
    instruccionAbierta: false,
    ahora: AHORA,
    zona: "UTC",
    bzzzbx: { disponible: true, actualizadoEn: AHORA.toISOString() },
    tab: null,
    ...parche,
  });
}

describe("Encabezado: el chip Delayed", () => {
  it("Scheduled con OPS-010 abierta: un chip Delayed junto a Stage, gris y sin animación", () => {
    render(<Encabezado ventana={ventana(3, {}, [OPS010])} />);
    const chip = screen.getByTestId("chip-delayed");
    expect(chip.textContent).toBe("Delayed");
    expect(screen.getByTestId("stage").textContent).toBe("Scheduled");
    // El parpadeo es de la tarjeta (`.tarjeta-estado[data-tipo="delayed"]`): el chip no lo hereda ni trae animación propia.
    expect(chip.getAttribute("data-tipo")).toBeNull();
    expect(chip.className).toBe("chip-delayed");
  });

  it("sin OPS-010, o en otra etapa, no hay chip", () => {
    render(<Encabezado ventana={ventana(3)} />);
    expect(screen.queryByTestId("chip-delayed")).toBeNull();
    cleanup();
    render(<Encabezado ventana={ventana(4, {}, [{ ...OPS010, sujeto: { tipo: "job", bzzzbx_job_id: "bx-job-0004" } }])} />);
    expect(screen.queryByTestId("chip-delayed")).toBeNull();
  });
});

describe("la pestaña de la propiedad: Linked job", () => {
  it("dice el job number y quién lo enlazó y cuándo", () => {
    render(<PanelPropiedad ventana={ventana(3)} />);
    const campos = screen.getByTestId("campos-propiedad");
    expect(within(campos).getByText("Linked job")).toBeTruthy();
    expect(within(campos).getByText("EX-00003 · Linked Nov 23 by Ops Uno")).toBeTruthy();
  });

  it("una request en Requests no tiene esa fila", () => {
    render(<PanelPropiedad ventana={ventana(2)} />);
    expect(screen.queryByText("Linked job")).toBeNull();
  });
});

describe("Change linked job: el panel", () => {
  const conCandidatos = (parche: Partial<EntradaVentana> = {}) => ventana(3, { candidatosDeCambio: CANDIDATOS, ...parche });
  function pintar(v: VentanaJob) {
    const ejecutar = vi.fn<(entrada: EntradaAccion) => Promise<ResultadoAccion>>(async () => ({ tipo: "guardada" }));
    render(<BarraAcciones requestId={v.requestId} version={v.version} acciones={accionesVisibles(v)} ventana={v} ejecutar={ejecutar} />);
    return ejecutar;
  }
  const elegirAccion = () => fireEvent.change(screen.getByTestId("accion"), { target: { value: "relink_job" } });
  const go = () => screen.getByTestId("go") as HTMLButtonElement;

  it("ofrece los candidatos con Suggested y por qué coinciden, sin el actual", () => {
    pintar(conCandidatos());
    elegirAccion();
    const filas = screen.getAllByTestId("candidato-cambio");
    expect(filas.map((f) => f.getAttribute("data-job"))).toEqual(["bx-job-0112", "bx-job-0113"]);
    expect(within(filas[0]!).getByTestId("sugerido-cambio").textContent).toBe("Suggested");
    expect(within(filas[1]!).queryByTestId("sugerido-cambio")).toBeNull();
    expect(filas[0]!.textContent).toContain("EX-00112");
    expect(filas[0]!.textContent).toContain("Team Beta");
    expect(within(filas[0]!).getByText("Same property")).toBeTruthy();
    expect(within(filas[0]!).getByText("Same customer")).toBeTruthy();
    expect(screen.queryByText("EX-00003")).toBeNull();
    expect(screen.queryByTestId("aviso-truncado-cambio")).toBeNull();
  });

  it("avisa cuando BzzzBX devolvió el máximo de resultados", () => {
    pintar(conCandidatos({ candidatosTruncado: true }));
    elegirAccion();
    expect(screen.getByTestId("aviso-truncado-cambio").textContent).toMatch(/^Showing the first \d+ jobs/);
  });

  it("Go queda deshabilitado sin job elegido y sin motivo; con los dos manda el crosswalk ID y el motivo", async () => {
    const ejecutar = pintar(conCandidatos());
    elegirAccion();
    expect(go().disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    expect(go().disabled).toBe(true); // falta el motivo
    fireEvent.change(screen.getByTestId("motivo"), { target: { value: "   " } });
    expect(go().disabled).toBe(true);
    fireEvent.change(screen.getByTestId("motivo"), { target: { value: "PINCH replaced the job." } });
    await waitFor(() => expect(go().disabled).toBe(false));
    fireEvent.click(go());
    await waitFor(() => expect(ejecutar).toHaveBeenCalledTimes(1));
    expect(ejecutar).toHaveBeenCalledWith({
      requestId: "b0000000-0000-4000-8000-0000000000a3",
      codigo: "relink_job",
      motivo: "PINCH replaced the job.",
      datos: { bzzzbx_job_id: "bx-job-0112" },
      version: "103",
    });
    await waitFor(() => expect(screen.getByTestId("resultado-accion").textContent).toBe("Saved"));
  });

  it("sin candidatos sale en gris con 'No other job to link' y no se puede elegir", () => {
    pintar(ventana(3));
    const opcion = screen.getByRole("option", { name: /^Change linked job/ }) as HTMLOptionElement;
    expect(opcion.textContent).toBe("Change linked job — No other job to link");
    expect(opcion.disabled).toBe(true);
  });

  it("con BzzzBX caído sale en gris con 'BzzzBX unavailable'", () => {
    pintar(conCandidatos({ bzzzbx: { disponible: false, actualizadoEn: AHORA.toISOString() } }));
    const opcion = screen.getByRole("option", { name: /^Change linked job/ }) as HTMLOptionElement;
    expect(opcion.textContent).toBe("Change linked job — BzzzBX unavailable");
    expect(opcion.disabled).toBe(true);
  });

  it("con el job cancelado es la única acción y se puede elegir", () => {
    const v = { ...conCandidatos(), etapa: "cancelled" as const };
    pintar(v);
    const opciones = (screen.getAllByRole("option") as HTMLOptionElement[]).slice(1);
    expect(opciones.map((o) => o.textContent)).toEqual(["Change linked job"]);
    expect(opciones[0]!.disabled).toBe(false);
  });

  it("Reschedule y Cancel job siguen en gris con el texto de OPR-42 y la descripción dice dónde se hace", () => {
    const v = conCandidatos();
    pintar(v);
    for (const [etiqueta, descripcion] of [
      ["Reschedule", "Reschedule the job in the PINCH tools; opsRUN shows the new date."],
      ["Cancel job", "Cancel the job in the PINCH tools; opsRUN takes it off the board."],
    ] as const) {
      const opcion = screen.getByRole("option", { name: new RegExp(`^${etiqueta}`) }) as HTMLOptionElement;
      expect(opcion.textContent).toBe(`${etiqueta} — Available when actions are switched on`);
      expect(opcion.disabled).toBe(true);
      expect(accionesVisibles(v).find((a) => a.etiqueta === etiqueta)!.descripcion).toBe(descripcion);
    }
  });
});

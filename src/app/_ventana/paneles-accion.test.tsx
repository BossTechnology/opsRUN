import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { accionesVisibles } from "@/lib/acciones/disponibilidad";
import type { EntradaAccion, ResultadoAccion } from "@/lib/acciones/tipos";
import { armarVentana, type EntradaVentana } from "@/lib/ventana/armar";
import { CONFIRMACIONES_COMPLETAS, filaVentana, leidosVentanaDelFalso, OPERADORES_DE_PRUEBA, SIN_CONFIRMACIONES } from "@/lib/ventana/prueba-datos";
import type { VentanaJob } from "@/lib/ventana/tipos";

// La Server Action y sus dependencias de servidor no corren en jsdom.
vi.mock("./acciones", () => ({ ejecutarAccion: vi.fn(), elegirActor: vi.fn() }));

import { BarraAcciones } from "./barra-acciones";

afterEach(cleanup);

const AHORA = new Date("2026-11-24T18:00:00Z");
const OPS_UNO = "0a000000-0000-4000-8000-0000000000a1";
const OPS_DOS = "0a000000-0000-4000-8000-0000000000a2";
const FINANCE_UNO = "0a000000-0000-4000-8000-0000000000b1";
const RESPUESTA = { id: "5c000000-0000-4000-8000-0000000000c1", equipoId: "bx-team-0001", lectura: "The cleaner said yes." };

function ventana(n: number, parche: Partial<EntradaVentana> = {}): VentanaJob {
  return armarVentana({
    fila: filaVentana(AHORA, n),
    leidos: leidosVentanaDelFalso(AHORA),
    hilos: [`bx-thread-000${n}`],
    operadores: OPERADORES_DE_PRUEBA,
    confirmaciones: SIN_CONFIRMACIONES,
    instruccionAbierta: false,
    ahora: AHORA,
    zona: "UTC",
    bzzzbx: { disponible: true, actualizadoEn: AHORA.toISOString() },
    tab: null,
    ...parche,
  });
}

const GUARDADA: ResultadoAccion = { tipo: "guardada" };

function pintar(v: VentanaJob, { actorId = OPS_UNO }: { actorId?: string | null } = {}) {
  const ejecutar = vi.fn<(entrada: EntradaAccion) => Promise<ResultadoAccion>>(async () => GUARDADA);
  render(<BarraAcciones requestId={v.requestId} version={v.version} acciones={accionesVisibles(v)} ventana={v} actorId={actorId} ejecutar={ejecutar} />);
  return ejecutar;
}

const elegir = (codigo: string) => fireEvent.change(screen.getByTestId("accion"), { target: { value: codigo } });
const go = () => screen.getByTestId("go") as HTMLButtonElement;
const operadores = () => screen.getAllByTestId("opcion-operador").map((o) => o.getAttribute("data-operador"));

describe("Assign / Reassign: el panel", () => {
  it("lista a los operadores activos con su barra de carga, sin el dueño actual", () => {
    pintar(ventana(2)); // R2 es de Ops Uno
    elegir("assign");
    expect(operadores()).toEqual([OPS_DOS, FINANCE_UNO]);
    const dos = screen.getAllByTestId("opcion-operador")[0]!;
    expect(dos.textContent).toContain("Ops Dos");
    expect(within(dos).getByTestId("carga-operador").getAttribute("data-abiertas")).toBe("4");
  });

  it("sin dueño la acción es Assign y se ofrecen todos; con dueño, Reassign", () => {
    pintar(ventana(1));
    elegir("assign");
    expect(screen.getByTestId("modo-assign").textContent).toBe("Assign this request to");
    expect(operadores()).toEqual([OPS_UNO, OPS_DOS, FINANCE_UNO]);
    cleanup();
    pintar(ventana(2));
    elegir("assign");
    expect(screen.getByTestId("modo-assign").textContent).toBe("Reassign from Ops Uno to");
  });

  it("Go queda deshabilitado hasta elegir un operador; después se manda operator_id y la versión", async () => {
    const ejecutar = pintar(ventana(1));
    elegir("assign");
    expect(go().disabled).toBe(true);
    fireEvent.click(within(screen.getAllByTestId("opcion-operador")[1]!).getByRole("radio"));
    expect(go().disabled).toBe(false);
    fireEvent.click(go());
    await waitFor(() => expect(ejecutar).toHaveBeenCalledTimes(1));
    expect(ejecutar).toHaveBeenCalledWith({
      requestId: ventana(1).requestId,
      codigo: "assign",
      motivo: null,
      datos: { operator_id: OPS_DOS },
      version: ventana(1).version,
    });
    await waitFor(() => expect(screen.getByTestId("resultado-accion").textContent).toBe("Saved"));
  });

  it("Assign to me elige al actor", async () => {
    const ejecutar = pintar(ventana(1), { actorId: OPS_UNO });
    elegir("assign");
    fireEvent.click(screen.getByTestId("assign-to-me"));
    const elegido = screen.getAllByRole("radio").find((r) => (r as HTMLInputElement).checked)!;
    expect(elegido.closest("[data-testid=opcion-operador]")!.getAttribute("data-operador")).toBe(OPS_UNO);
    expect(go().disabled).toBe(false);
    fireEvent.click(go());
    await waitFor(() => expect(ejecutar).toHaveBeenCalledWith(expect.objectContaining({ datos: { operator_id: OPS_UNO } })));
  });

  it("Assign to me no se ofrece al que ya es el dueño ni sin actor", () => {
    pintar(ventana(2), { actorId: OPS_UNO }); // Ops Uno ya es el dueño de R2
    elegir("assign");
    expect(screen.queryByTestId("assign-to-me")).toBeNull();
    cleanup();
    pintar(ventana(1), { actorId: null });
    elegir("assign");
    expect((screen.getByTestId("assign-to-me") as HTMLButtonElement).disabled).toBe(true);
  });

  it("el motivo es opcional: se puede mandar vacío y, si se escribe, va recortado", async () => {
    const ejecutar = pintar(ventana(1));
    elegir("assign");
    expect(screen.getByText("Reason (optional)")).toBeTruthy();
    fireEvent.click(screen.getByTestId("assign-to-me"));
    fireEvent.change(screen.getByTestId("motivo"), { target: { value: "  Covering the weekend  " } });
    fireEvent.click(go());
    await waitFor(() => expect(ejecutar).toHaveBeenCalledWith(expect.objectContaining({ motivo: "Covering the weekend" })));
  });

  it("un operador elegido que pasa a ser el dueño deja de estar elegido", () => {
    const v1 = ventana(1);
    const { rerender } = render(<BarraAcciones requestId={v1.requestId} version={v1.version} acciones={accionesVisibles(v1)} ventana={v1} actorId={OPS_UNO} />);
    elegir("assign");
    fireEvent.click(screen.getByTestId("assign-to-me"));
    expect(go().disabled).toBe(false);
    // Se refresca la ventana: Ops Uno ya es el dueño.
    const v2 = { ...v1, version: "999", encabezado: { ...v1.encabezado, asignado: { operadorId: OPS_UNO, nombre: "Ops Uno" } } };
    rerender(<BarraAcciones requestId={v2.requestId} version={v2.version} acciones={accionesVisibles(v2)} ventana={v2} actorId={OPS_UNO} />);
    expect(operadores()).toEqual([OPS_DOS, FINANCE_UNO]);
    expect(go().disabled).toBe(true);
  });
});

describe("Confirm details y Confirm sender: los paneles", () => {
  it("Confirm details muestra lo que la ventana leyó y manda solo la acción: sin valores", async () => {
    const v = ventana(2);
    const ejecutar = pintar(v);
    elegir("confirm_details");
    const panel = screen.getByTestId("panel-confirm-details");
    expect(within(panel).getByTestId("confirmar-property").textContent).toContain("Sample Court");
    expect(within(panel).getByTestId("confirmar-service").textContent).toContain("Standard clean");
    expect(within(panel).getByTestId("confirmar-date").textContent).toContain("9:00 AM");
    expect(within(panel).queryByTestId("motivo")).toBeNull(); // sin Reason
    expect(go().disabled).toBe(false); // no pide valor: confirma lo que se ve
    fireEvent.click(go());
    await waitFor(() => expect(ejecutar).toHaveBeenCalledTimes(1));
    expect(ejecutar).toHaveBeenCalledWith({ requestId: v.requestId, codigo: "confirm_details", motivo: null, datos: {}, version: v.version });
  });

  it("la marca AI sale solo en los campos con una sugerencia abierta, con su motivo", () => {
    pintar(ventana(2, { sugerencias: [{ campo: "property", razon: "Address matches." }, { campo: "time_window", razon: null }] }));
    elegir("confirm_details");
    const panel = screen.getByTestId("panel-confirm-details");
    expect(within(panel).getByTestId("confirmar-property").querySelector("[data-testid=marca-ai]")).toBeTruthy();
    expect(within(panel).getByTestId("confirmar-property").textContent).toContain("Address matches.");
    expect(within(panel).getByTestId("confirmar-date").querySelector("[data-testid=marca-ai]")).toBeTruthy();
    expect(within(panel).getByTestId("confirmar-service").querySelector("[data-testid=marca-ai]")).toBeNull();
    expect(within(panel).getAllByTestId("marca-ai")).toHaveLength(2);
  });

  it("sin sugerencias abiertas no hay marca AI", () => {
    pintar(ventana(2));
    elegir("confirm_details");
    expect(screen.queryByTestId("marca-ai")).toBeNull();
  });

  it("lo que no está definido se ve — —", () => {
    pintar(ventana(2, { fila: { ...filaVentana(AHORA, 2), access_notes: null } }));
    elegir("confirm_details");
    expect(screen.getByTestId("confirmar-access").textContent).toContain("— —");
  });

  it("Confirm sender muestra el cliente y el representante con la marca AI y su motivo", async () => {
    const v = ventana(2, { sugerencias: [{ campo: "sender", razon: "Known sender." }] });
    const ejecutar = pintar(v);
    elegir("confirm_sender");
    const panel = screen.getByTestId("panel-confirm-sender");
    expect(within(panel).getByTestId("confirmar-customer").textContent).toContain("Example Property Group");
    expect(within(panel).getByTestId("confirmar-contact").textContent).toContain("Contact One");
    expect(within(panel).getAllByTestId("marca-ai")).toHaveLength(1);
    expect(panel.textContent).toContain("Known sender.");
    expect(go().disabled).toBe(false);
    fireEvent.click(go());
    await waitFor(() => expect(ejecutar).toHaveBeenCalledWith({ requestId: v.requestId, codigo: "confirm_sender", motivo: null, datos: {}, version: v.version }));
  });

  it("Change (buscar otro cliente) no existe todavía: es de update_request_detail", () => {
    pintar(ventana(2));
    elegir("confirm_sender");
    expect(screen.queryByRole("button", { name: /change/i })).toBeNull();
  });
});

describe("Confirm cleaner: el panel", () => {
  it("muestra el equipo con su nombre y la marca AI de cleaner_team", () => {
    pintar(ventana(2, { sugerencias: [{ campo: "cleaner_team", razon: "Default team for the property." }] }));
    elegir("confirm_cleaner");
    const panel = screen.getByTestId("panel-confirm-cleaner");
    expect(within(panel).getByTestId("confirmar-cleaner").textContent).toContain("Team Alpha");
    expect(within(panel).getAllByTestId("marca-ai")).toHaveLength(1);
  });

  it("exige un método: Go deshabilitado hasta elegirlo", async () => {
    const v = ventana(2);
    const ejecutar = pintar(v);
    elegir("confirm_cleaner");
    expect(go().disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /Confirm by phone/ }));
    expect(go().disabled).toBe(false);
    fireEvent.change(screen.getByTestId("motivo"), { target: { value: "Called the cleaner" } });
    fireEvent.click(go());
    await waitFor(() => expect(ejecutar).toHaveBeenCalledTimes(1));
    expect(ejecutar).toHaveBeenCalledWith({
      requestId: v.requestId,
      codigo: "confirm_cleaner",
      motivo: "Called the cleaner",
      datos: { method: "phone" },
      version: v.version,
    });
  });

  it("sin una respuesta del cleaner no se ofrece 'Cleaner replied yes'", () => {
    pintar(ventana(2, { respuestaDelCleaner: null }));
    elegir("confirm_cleaner");
    expect(screen.queryByRole("radio", { name: /Cleaner replied yes/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /Confirm by phone/ })).toBeTruthy();
  });

  it("una respuesta de otro equipo del que está en el borrador tampoco se ofrece", () => {
    pintar(ventana(2, { respuestaDelCleaner: { ...RESPUESTA, equipoId: "bx-team-0003" } }));
    elegir("confirm_cleaner");
    expect(screen.queryByRole("radio", { name: /Cleaner replied yes/ })).toBeNull();
  });

  it("con la respuesta del equipo del borrador: se ofrece, se ve la lectura de la IA y se manda su id", async () => {
    const v = ventana(2, { respuestaDelCleaner: RESPUESTA });
    const ejecutar = pintar(v);
    elegir("confirm_cleaner");
    expect(screen.getByTestId("lectura-del-cleaner").textContent).toContain("The cleaner said yes.");
    fireEvent.click(screen.getByRole("radio", { name: /Cleaner replied yes/ }));
    fireEvent.click(go());
    await waitFor(() => expect(ejecutar).toHaveBeenCalledTimes(1));
    expect(ejecutar).toHaveBeenCalledWith(
      expect.objectContaining({ codigo: "confirm_cleaner", datos: { method: "cleaner_text", cleaner_confirmation_id: RESPUESTA.id } }),
    );
  });

  it("cambiar de método cambia lo que se manda: de cleaner_text a phone no lleva la respuesta", async () => {
    const ejecutar = pintar(ventana(2, { respuestaDelCleaner: RESPUESTA }));
    elegir("confirm_cleaner");
    fireEvent.click(screen.getByRole("radio", { name: /Cleaner replied yes/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Confirm by phone/ }));
    fireEvent.click(go());
    await waitFor(() => expect(ejecutar).toHaveBeenCalledWith(expect.objectContaining({ datos: { method: "phone" } })));
  });

  it("no hay método operator: la tarjeta dice 'confirm on reply or Confirm by phone'", () => {
    pintar(ventana(2, { respuestaDelCleaner: RESPUESTA }));
    elegir("confirm_cleaner");
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });
});

describe("la barra con paneles", () => {
  it("al cambiar de acción se limpia lo elegido", () => {
    pintar(ventana(1));
    elegir("assign");
    fireEvent.click(screen.getByTestId("assign-to-me"));
    expect(go().disabled).toBe(false);
    elegir("");
    elegir("assign");
    expect(go().disabled).toBe(true);
  });

  it("las que no corren no abren su panel ni se pueden ir, y dicen por qué", () => {
    const v = ventana(2, { confirmaciones: { details: true, sender: true, cleaner: false } });
    pintar(v);
    elegir("confirm_details");
    expect(screen.getByTestId("nota-accion").textContent).toBe("Already confirmed");
    expect(go().disabled).toBe(true);
  });

  it("una acción sin panel propio sigue como antes: Go habilitado si corre", () => {
    const v = ventana(2, { confirmaciones: CONFIRMACIONES_COMPLETAS });
    render(<BarraAcciones requestId={v.requestId} version={v.version} acciones={accionesVisibles(v)} />);
    elegir("schedule");
    expect(go().disabled).toBe(false);
  });
});

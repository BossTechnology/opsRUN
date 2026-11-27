import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { accionesVisibles } from "@/lib/acciones/disponibilidad";
import type { EntradaAccion, ResultadoAccion } from "@/lib/acciones/tipos";
import { armarBilling } from "@/lib/billing/armar";
import { armarTracker, type FotoVista } from "@/lib/tracker/armar";
import { armarVentana, type EntradaVentana } from "@/lib/ventana/armar";
import { CONFIRMACIONES_COMPLETAS, filaVentana, leidosVentanaDelFalso, OPERADORES_DE_PRUEBA } from "@/lib/ventana/prueba-datos";
import type { VentanaJob } from "@/lib/ventana/tipos";

// La Server Action y sus dependencias de servidor no corren en jsdom.
vi.mock("./acciones", () => ({ ejecutarAccion: vi.fn(), elegirActor: vi.fn() }));

import { BarraAcciones } from "./barra-acciones";
import { Encabezado } from "./encabezado";
import { FormularioPo } from "./formulario-po";
import { GaleriaDeFotos } from "./galeria-fotos";
import { VistaBillingPestana } from "./vista-billing";
import { VistaTrackerPestana } from "./vista-tracker";

afterEach(cleanup);

const AHORA = new Date("2026-11-24T18:00:00Z");

function ventana(n: number, fila: Partial<ReturnType<typeof filaVentana>> = {}, parche: Partial<EntradaVentana> = {}): VentanaJob {
  return armarVentana({
    fila: { ...filaVentana(AHORA, n), ...fila },
    leidos: leidosVentanaDelFalso(AHORA),
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

const GUARDADA: ResultadoAccion = { tipo: "guardada" };

function pintar(v: VentanaJob) {
  const ejecutar = vi.fn<(entrada: EntradaAccion) => Promise<ResultadoAccion>>(async () => GUARDADA);
  render(<BarraAcciones requestId={v.requestId} version={v.version} acciones={accionesVisibles(v)} ventana={v} ejecutar={ejecutar} />);
  return ejecutar;
}
const elegir = (codigo: string) => fireEvent.change(screen.getByTestId("accion"), { target: { value: codigo } });
const go = () => screen.getByTestId("go") as HTMLButtonElement;

const fotos = (): { before: FotoVista[]; after: FotoVista[] } => ({
  before: [
    { id: "p1", fase: "before", alt: "Before photo, Nov 27, 10:05 AM", hora: "Nov 27, 10:05 AM", src: "/api/fotos/p1?request=r" },
    { id: "p2", fase: "before", alt: "Before photo, Nov 27, 10:10 AM", hora: "Nov 27, 10:10 AM", src: "/api/fotos/p2?request=r" },
  ],
  after: [{ id: "p3", fase: "after", alt: "After photo, Nov 27, 12:00 PM", hora: "Nov 27, 12:00 PM", src: "/api/fotos/p3?request=r" }],
});

describe("GaleriaDeFotos (OPR-30 §4.2)", () => {
  it("agrupa Before y After con una miniatura por foto y su alt", () => {
    render(<GaleriaDeFotos {...fotos()} disponible />);
    expect(within(screen.getByTestId("fotos-before")).getAllByTestId("miniatura")).toHaveLength(2);
    expect(within(screen.getByTestId("fotos-after")).getAllByTestId("miniatura")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Before photo, Nov 27, 10:05 AM" })).toBeTruthy();
    expect(screen.queryByTestId("foto-dialogo")).toBeNull();
  });

  it("'No photos' si el job no tiene ninguna; 'No before photos' / 'No after photos' si falta un grupo", () => {
    const { rerender } = render(<GaleriaDeFotos before={[]} after={[]} disponible />);
    expect(screen.getByTestId("sin-fotos").textContent).toBe("No photos");
    rerender(<GaleriaDeFotos before={[]} after={fotos().after} disponible />);
    expect(screen.getByTestId("sin-fotos-before").textContent).toBe("No before photos");
    expect(screen.queryByTestId("sin-fotos-after")).toBeNull();
    rerender(<GaleriaDeFotos before={fotos().before} after={[]} disponible />);
    expect(screen.getByTestId("sin-fotos-after").textContent).toBe("No after photos");
  });

  it("un clic en la miniatura la agranda en un diálogo con su alt", () => {
    render(<GaleriaDeFotos {...fotos()} disponible />);
    fireEvent.click(screen.getAllByTestId("miniatura")[0]!);
    const dialogo = screen.getByTestId("foto-dialogo");
    expect(dialogo.tagName).toBe("DIALOG");
    expect(dialogo.hasAttribute("open")).toBe(true);
    expect(within(dialogo).getByTestId("foto-grande").getAttribute("alt")).toBe("Before photo, Nov 27, 10:05 AM");
  });

  it("las flechas van a la anterior y a la siguiente, dando la vuelta, y pasan de Before a After", () => {
    render(<GaleriaDeFotos {...fotos()} disponible />);
    fireEvent.click(screen.getAllByTestId("miniatura")[1]!); // p2
    const dialogo = screen.getByTestId("foto-dialogo");
    const grande = () => within(dialogo).getByTestId("foto-grande").getAttribute("alt");
    fireEvent.keyDown(dialogo, { key: "ArrowRight" });
    expect(grande()).toBe("After photo, Nov 27, 12:00 PM");
    fireEvent.keyDown(dialogo, { key: "ArrowRight" });
    expect(grande()).toBe("Before photo, Nov 27, 10:05 AM");
    fireEvent.keyDown(dialogo, { key: "ArrowLeft" });
    expect(grande()).toBe("After photo, Nov 27, 12:00 PM");
    fireEvent.click(within(dialogo).getByTestId("foto-anterior"));
    expect(grande()).toBe("Before photo, Nov 27, 10:10 AM");
  });

  it("Esc cierra el diálogo, devuelve el foco a la miniatura y no se le pasa a la Job window", () => {
    const alVentana = vi.fn((e: KeyboardEvent) => e.defaultPrevented);
    window.addEventListener("keydown", alVentana);
    try {
      render(<GaleriaDeFotos {...fotos()} disponible />);
      const miniatura = screen.getAllByTestId("miniatura")[0]!;
      fireEvent.click(miniatura);
      fireEvent.keyDown(screen.getByTestId("foto-dialogo"), { key: "Escape" });
      expect(screen.queryByTestId("foto-dialogo")).toBeNull();
      expect(document.activeElement).toBe(miniatura);
      // El Modal de la Job window escucha en `window` y mira `defaultPrevented`: el Esc no le llega, o le llega ya prevenido.
      for (const r of alVentana.mock.results) expect(r.value).toBe(true);
    } finally {
      window.removeEventListener("keydown", alVentana);
    }
  });

  it("la ✕ y un clic fuera de la foto también cierran", () => {
    render(<GaleriaDeFotos {...fotos()} disponible />);
    fireEvent.click(screen.getAllByTestId("miniatura")[0]!);
    fireEvent.click(screen.getByTestId("foto-cerrar"));
    expect(screen.queryByTestId("foto-dialogo")).toBeNull();
    fireEvent.click(screen.getAllByTestId("miniatura")[0]!);
    fireEvent.click(screen.getByTestId("foto-dialogo")); // el fondo del diálogo
    expect(screen.queryByTestId("foto-dialogo")).toBeNull();
    fireEvent.click(screen.getAllByTestId("miniatura")[0]!);
    fireEvent.click(screen.getByTestId("foto-grande")); // dentro de la foto no cierra
    expect(screen.getByTestId("foto-dialogo")).toBeTruthy();
  });

  it("con BzzzBX caído, o si la imagen falla, la miniatura es 'Photo unavailable' y no se abre", () => {
    const { unmount } = render(<GaleriaDeFotos {...fotos()} disponible={false} />);
    expect(screen.getAllByTestId("foto-no-disponible")).toHaveLength(3);
    expect(screen.queryByTestId("miniatura")).toBeNull();
    unmount();

    render(<GaleriaDeFotos {...fotos()} disponible />);
    fireEvent.error(screen.getAllByTestId("miniatura")[0]!.querySelector("img")!);
    expect(screen.getAllByTestId("foto-no-disponible")).toHaveLength(1);
    expect(screen.getAllByTestId("miniatura")).toHaveLength(2);
  });
});

describe("VistaTrackerPestana (OPR-30 §4.1)", () => {
  const tracker = (parche: Partial<Parameters<typeof armarTracker>[0]> = {}) =>
    armarTracker({
      requestId: "r",
      etapa: "In Progress",
      job: { service_date: "2026-11-24", window_start: "08:00", window_end: "11:00" },
      eventos: [
        { bzzzbx_event_id: "e1", bzzzbx_job_id: "j", kind: "checked_in", occurred_at: "2026-11-24T17:00:00Z" },
        { bzzzbx_event_id: "e2", bzzzbx_job_id: "j", kind: "started", occurred_at: "2026-11-24T17:05:00Z" },
      ],
      fotos: [],
      alertas: [{ rule_id: "MEC-003" }],
      ahora: AHORA,
      zona: "UTC",
      bzzzbxDisponible: true,
      ...parche,
    });

  it("estado y ventana en una fila, Arrival, Start, End con `— —` y la duración corriendo con la esperada", () => {
    render(<VistaTrackerPestana vista={tracker()} etapa="in_progress" />);
    const seccion = screen.getByRole("region", { name: "Job tracker" });
    expect(seccion.getAttribute("data-ranura")).toBe("tracker");
    expect(screen.getByTestId("tracker-etapa").textContent).toBe("In Progress");
    expect(screen.getByTestId("tracker-ventana").textContent).toBe("Tue, Nov 24 · 8:00 AM–11:00 AM");
    expect(screen.getByTestId("tracker-llegada").textContent).toContain("Nov 24, 5:00 PM");
    expect(screen.getByTestId("tracker-inicio").textContent).toContain("Nov 24, 5:05 PM");
    expect(screen.getByTestId("tracker-fin").textContent).toContain("— —");
    expect(screen.getByTestId("tracker-duracion").textContent).toContain("55m");
    expect(screen.getByTestId("tracker-duracion").textContent).toContain("running");
    expect(screen.getByTestId("tracker-duracion").textContent).toContain("expected 3h 00m");
  });

  it("el chip Running long sale mientras la MEC-003 está abierta, y la galería dice 'No photos'", () => {
    const { rerender } = render(<VistaTrackerPestana vista={tracker()} etapa="in_progress" />);
    expect(screen.getByTestId("chip-running-long").textContent).toBe("Running long");
    expect(screen.getByTestId("sin-fotos").textContent).toBe("No photos");
    rerender(<VistaTrackerPestana vista={tracker({ alertas: [] })} etapa="in_progress" />);
    expect(screen.queryByTestId("chip-running-long")).toBeNull();
  });
});

describe("VistaBillingPestana (OPR-32 §5.5)", () => {
  const billing = (fila: Partial<Parameters<typeof armarBilling>[0]["fila"]> = {}, resto: Partial<Parameters<typeof armarBilling>[0]> = {}) =>
    armarBilling({
      fila: {
        entered_po_number: null,
        po_number: null,
        oss_mark: "not_oss",
        oss_source: "operator",
        approved_at: "2026-11-23T15:00:00Z",
        approved_by_nombre: "Ops Uno",
        validated_at: null,
        validated_by_nombre: null,
        ...fila,
      },
      job: { po_number: null },
      customer: { po_required: true },
      pago: undefined,
      zona: "UTC",
      bzzzbxDisponible: true,
      ...resto,
    });

  it("sin validar: PO # editable con 'PO required', OSS, Approved con nombre, Not validated y Not paid yet", () => {
    render(<VistaBillingPestana vista={billing()} requestId="r" version="9" etapa="validation" />);
    expect(screen.getByRole("region", { name: "Billing" }).getAttribute("data-ranura")).toBe("billing");
    expect(screen.getByTestId("po-input")).toBeTruthy();
    expect(screen.getByTestId("po-requerido").textContent).toBe("PO required");
    expect(screen.getByTestId("billing-oss").textContent).toContain("Not OSS");
    expect(screen.getByTestId("billing-aprobada").textContent).toContain("Approved Nov 23 by Ops Uno");
    expect(screen.getByTestId("billing-validada").textContent).toContain("Not validated");
    expect(screen.getByTestId("billing-paid").textContent).toContain("Not paid yet");
  });

  it("'In PINCH: …' sale solo si PINCH tiene otro PO", () => {
    const { rerender } = render(
      <VistaBillingPestana vista={billing({ entered_po_number: "A" }, { job: { po_number: "B" } })} requestId="r" version="9" etapa="validation" />,
    );
    expect(screen.getByTestId("po-en-pinch").textContent).toBe("In PINCH: B");
    rerender(<VistaBillingPestana vista={billing({ entered_po_number: "A" }, { job: { po_number: "A" } })} requestId="r" version="9" etapa="validation" />);
    expect(screen.queryByTestId("po-en-pinch")).toBeNull();
  });

  it("validado y pagado: PO de solo lectura sin ningún control, y 'Paid <fecha>' sin control", () => {
    render(
      <VistaBillingPestana
        vista={billing(
          { validated_at: "2026-11-24T15:00:00Z", validated_by_nombre: "Finance Uno" },
          { job: { po_number: "PO-EX-0006" }, pago: { paid: true, paid_at: "2026-11-24T10:00:00Z" } },
        )}
        requestId="r"
        version="9"
        etapa="validation"
      />,
    );
    expect(screen.queryByTestId("po-input")).toBeNull();
    expect(screen.queryByTestId("guardar-po")).toBeNull();
    expect(screen.getByTestId("po-valor").textContent).toBe("PO-EX-0006");
    // Con el PO de PINCH como valor, no se repite en "In PINCH".
    expect(screen.queryByTestId("po-en-pinch")).toBeNull();
    expect(screen.getByTestId("billing-validada").textContent).toContain("Validated Nov 24 by Finance Uno");
    expect(screen.getByTestId("billing-paid").textContent).toContain("Paid Nov 24");
    expect(within(screen.getByTestId("billing-paid")).queryAllByRole("button")).toHaveLength(0);
    expect(within(screen.getByTestId("billing-paid")).queryAllByRole("textbox")).toHaveLength(0);
  });

  it("OSS automático se ve con 'auto'", () => {
    render(<VistaBillingPestana vista={billing({ oss_mark: "oss", oss_source: "auto" })} requestId="r" version="9" etapa="validation" />);
    expect(screen.getByTestId("oss-auto").textContent).toContain("auto");
  });
});

describe("FormularioPo", () => {
  it("Save pasa por ejecutarAccion con write_po, la versión y el PO recortado, y dice Saved", async () => {
    const ejecutar = vi.fn<(e: EntradaAccion) => Promise<ResultadoAccion>>(async () => GUARDADA);
    render(<FormularioPo requestId="r1" version="42" capturado={null} ejecutar={ejecutar} />);
    const guardar = screen.getByTestId("guardar-po") as HTMLButtonElement;
    expect(guardar.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("po-input"), { target: { value: "  PO-EX-0108  " } });
    expect(guardar.disabled).toBe(false);
    fireEvent.click(guardar);
    await waitFor(() => expect(screen.getByTestId("resultado-po").textContent).toBe("Saved"));
    expect(ejecutar).toHaveBeenCalledWith({ requestId: "r1", codigo: "write_po", motivo: null, datos: { po_number: "PO-EX-0108" }, version: "42" });
  });

  it("Save queda deshabilitado con el PO en blanco o igual al capturado, y muestra el rechazo del servidor", async () => {
    const ejecutar = vi.fn<(e: EntradaAccion) => Promise<ResultadoAccion>>(async () => ({ tipo: "rechazada", codigo: "ya_validado", mensaje: "This job is already validated." }));
    render(<FormularioPo requestId="r1" version="42" capturado="PO-1" ejecutar={ejecutar} />);
    const guardar = screen.getByTestId("guardar-po") as HTMLButtonElement;
    expect(guardar.disabled).toBe(true); // igual al capturado
    fireEvent.change(screen.getByTestId("po-input"), { target: { value: "   " } });
    expect(guardar.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("po-input"), { target: { value: "PO-2" } });
    fireEvent.click(guardar);
    await waitFor(() => expect(screen.getByTestId("resultado-po").textContent).toBe("This job is already validated."));
    expect(screen.getByTestId("resultado-po").getAttribute("data-tipo")).toBe("rechazada");
  });
});

describe("Encabezado: chip OSS (OPR-31)", () => {
  it("sale con la marca OSS y no con Not OSS ni sin marca", () => {
    const { rerender } = render(<Encabezado ventana={ventana(5)} />); // R5: OSS automático
    expect(screen.getByTestId("chip-oss").textContent).toBe("OSS");
    rerender(<Encabezado ventana={ventana(6)} />); // R6: Not OSS
    expect(screen.queryByTestId("chip-oss")).toBeNull();
    rerender(<Encabezado ventana={ventana(3)} />);
    expect(screen.queryByTestId("chip-oss")).toBeNull();
  });
});

describe("Paneles de las etapas en la action bar", () => {
  it("Clear alert: la alerta limpiable con regla, nivel, texto y hace cuánto; sin elegir nada porque hay una sola; el motivo es obligatorio", async () => {
    const ejecutar = pintar(ventana(4));
    elegir("clear_alert");
    const alerta = screen.getByTestId("alerta-limpiable");
    expect(alerta.getAttribute("data-regla")).toBe("MEC-003");
    expect(alerta.textContent).toContain("MEC-003 Running long");
    expect(alerta.textContent).toContain("amber");
    expect(alerta.textContent).toContain("Running 45 min over the window.");
    expect(screen.getByTestId("alerta-hace").textContent).toMatch(/^opened .+ ago$|^opened just now$/);
    // Con una sola, no hay radios: ya está elegida. Go espera el motivo.
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(go().disabled).toBe(true);
    fireEvent.change(screen.getByTestId("motivo"), { target: { value: "   " } });
    expect(go().disabled).toBe(true);
    fireEvent.change(screen.getByTestId("motivo"), { target: { value: "Large unit." } });
    expect(go().disabled).toBe(false);
    fireEvent.click(go());
    await waitFor(() => expect(screen.getByTestId("resultado-accion").textContent).toBe("Saved"));
    expect(ejecutar).toHaveBeenCalledWith(
      expect.objectContaining({ codigo: "clear_alert", motivo: "Large unit.", datos: { bzzzbx_alert_id: "bx-alert-0006" } }),
    );
  });

  it("Clear alert con varias alertas pide elegir una", async () => {
    const base = ventana(4);
    const v: VentanaJob = {
      ...base,
      datos: {
        ...base.datos,
        alertasLimpiables: [
          ...base.datos.alertasLimpiables,
          { id: "bx-alert-9", regla: "MEC-003", nivel: "red", razon: "Running 2 h over.", abierta: "2 h ago" },
        ],
      },
    };
    const ejecutar = pintar(v);
    elegir("clear_alert");
    fireEvent.change(screen.getByTestId("motivo"), { target: { value: "Checked." } });
    expect(go().disabled).toBe(true); // falta elegir la alerta
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    expect(go().disabled).toBe(false);
    fireEvent.click(go());
    await waitFor(() => expect(ejecutar).toHaveBeenCalled());
    expect(ejecutar.mock.calls[0]![0].datos).toEqual({ bzzzbx_alert_id: "bx-alert-9" });
  });

  it("Mark as OSS / Not OSS: marca la actual, Go deshabilitado con la misma, y el motivo es opcional", async () => {
    const ejecutar = pintar(ventana(5)); // R5: OSS automático
    elegir("mark_oss");
    expect(screen.getByTestId("oss-actual").textContent).toBe("Current: OSS (auto)");
    expect((screen.getByRole("radio", { name: "OSS" }) as HTMLInputElement).checked).toBe(true);
    expect(go().disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Not OSS" }));
    expect(go().disabled).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: "OSS" }));
    expect(go().disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Not OSS" }));
    fireEvent.click(go());
    await waitFor(() => expect(ejecutar).toHaveBeenCalled());
    expect(ejecutar.mock.calls[0]![0]).toMatchObject({ codigo: "mark_oss", motivo: null, datos: { mark: "not_oss" } });
  });

  it("Approve & confirm: resumen del fin y el OSS, sin motivo, Go habilitado", async () => {
    const ejecutar = pintar(ventana(5));
    elegir("approve_confirm");
    expect(screen.getByTestId("approve-oss").textContent).toBe("OSS (auto)");
    expect(screen.getByTestId("approve-fin").textContent).toContain("Nov 23");
    expect(screen.queryByTestId("motivo")).toBeNull();
    expect(go().disabled).toBe(false);
    fireEvent.click(go());
    await waitFor(() => expect(ejecutar).toHaveBeenCalled());
    expect(ejecutar.mock.calls[0]![0]).toMatchObject({ codigo: "approve_confirm", motivo: null, datos: {} });
  });

  it("Enter PO: Go espera un PO distinto del capturado, recortado y de hasta 64 caracteres", async () => {
    const ejecutar = pintar(ventana(6, { validated_at: null, validated_by_nombre: null }));
    elegir("write_po");
    expect(go().disabled).toBe(true);
    fireEvent.change(screen.getByTestId("panel-po-input"), { target: { value: "   " } });
    expect(go().disabled).toBe(true);
    fireEvent.change(screen.getByTestId("panel-po-input"), { target: { value: "  PO-NEW-1  " } });
    expect(go().disabled).toBe(false);
    fireEvent.click(go());
    await waitFor(() => expect(ejecutar).toHaveBeenCalled());
    expect(ejecutar.mock.calls[0]![0]).toMatchObject({ codigo: "write_po", datos: { po_number: "PO-NEW-1" } });
  });

  it("Enter PO enseña el PO que ya hay en PINCH, solo lectura", () => {
    pintar(ventana(6, { validated_at: null, validated_by_nombre: null }));
    elegir("write_po");
    expect(screen.getByTestId("po-otra-fuente").textContent).toBe("In PINCH: PO-EX-0006");
  });

  it("la barra de R6 validada: Enter PO y Validate quedan grises con 'Already validated'", () => {
    pintar(ventana(6));
    const opcion = (codigo: string) => screen.getByRole("option", { name: new RegExp(`^${codigo}`) }) as HTMLOptionElement;
    expect(opcion("Enter PO").textContent).toBe("Enter PO — Already validated");
    expect(opcion("Enter PO").disabled).toBe(true);
    expect(opcion("Validate").textContent).toBe("Validate — Already validated");
  });

  it("Reschedule, Cancel job y End manually salen grises con el texto de OPR-42 y no se pueden elegir", () => {
    pintar(ventana(4));
    const opcion = screen.getByRole("option", { name: /^End manually/ }) as HTMLOptionElement;
    expect(opcion.textContent).toBe("End manually — Available when actions are switched on");
    expect(opcion.disabled).toBe(true);
    expect(opcion.getAttribute("data-disponibilidad")).toBe("fuera_de_release");
  });
});

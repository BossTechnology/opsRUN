import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { accionesVisibles } from "@/lib/acciones/disponibilidad";
import type { AccionVista } from "@/lib/acciones/tipos";
import { armarVentana } from "@/lib/ventana/armar";
import {
  CONFIRMACIONES_COMPLETAS,
  filaVentana,
  leidosVentanaDelFalso,
  OPERADORES_DE_PRUEBA,
  SIN_CONFIRMACIONES,
} from "@/lib/ventana/prueba-datos";

// La Server Action y sus dependencias de servidor no corren en jsdom.
vi.mock("./acciones", () => ({ ejecutarAccion: vi.fn(), elegirActor: vi.fn() }));

import { BarraAcciones, textoDelResultado } from "./barra-acciones";
import { Encabezado } from "./encabezado";
import { Pestanas } from "./pestanas";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

const AHORA = new Date("2026-11-24T18:00:00Z");

const ventana = (n: number) =>
  armarVentana({
    fila: filaVentana(AHORA, n),
    leidos: leidosVentanaDelFalso(AHORA),
    hilos: [`bx-thread-000${n}`],
    operadores: OPERADORES_DE_PRUEBA,
    confirmaciones: n === 1 ? SIN_CONFIRMACIONES : CONFIRMACIONES_COMPLETAS,
    instruccionAbierta: false,
    ahora: AHORA,
    zona: "UTC",
    bzzzbx: { disponible: true, actualizadoEn: AHORA.toISOString() },
    tab: null,
  });

const paneles = (v: ReturnType<typeof ventana>) =>
  Object.fromEntries(v.pestanas.filter((p) => !p.deshabilitada).map((p) => [p.id, <p key={p.id}>{`contenido ${p.id}`}</p>]));

describe("Pestanas", () => {
  const pintar = (n: number, pideAccion = 0, inicial?: { id: "property" | "alerts" | "audit"; porRegla: boolean }) => {
    const v = ventana(n);
    return render(<Pestanas pestanas={v.pestanas} inicial={inicial ?? v.inicial} pideAccion={pideAccion} paneles={paneles(v)} />);
  };
  const tab = (nombre: string) => screen.getByRole("tab", { name: nombre });

  it("un tablist con las pestañas de la etapa, la activa seleccionada y Alerts al final", () => {
    pintar(3);
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["7C", "Audit", "$", "People", "Alerts"]);
    expect(tab("7C").getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("tab", { selected: true })).toHaveLength(1);
  });

  it("$ y People se ven en gris y no se seleccionan, ni con clic ni con teclado, ni cambian la URL", () => {
    pintar(3);
    window.history.replaceState(null, "", "/job/x");
    for (const nombre of ["$", "People"]) {
      const t = tab(nombre);
      expect(t.getAttribute("aria-disabled")).toBe("true");
      expect(t.getAttribute("title")).toBe("Not available in this release");
      expect(t.getAttribute("tabindex")).toBe("-1");
      fireEvent.click(t);
      fireEvent.keyDown(t, { key: "Enter" });
      fireEvent.keyDown(t, { key: " " });
      expect(t.getAttribute("aria-selected")).toBe("false");
    }
    expect(tab("7C").getAttribute("aria-selected")).toBe("true");
    expect(window.location.search).toBe("");
  });

  it("elegir una pestaña muestra su panel y pone ?tab= en la URL, sin pedir nada al servidor", () => {
    pintar(3);
    window.history.replaceState(null, "", "/job/x?otro=1");
    fireEvent.click(tab("Audit"));
    expect(tab("Audit").getAttribute("aria-selected")).toBe("true");
    expect(window.location.search).toBe("?otro=1&tab=audit");
    const paneles = screen.getAllByRole("tabpanel", { hidden: true });
    expect(paneles.filter((p) => !p.hidden).map((p) => p.textContent)).toEqual(["contenido audit"]);
  });

  it("las flechas se mueven solo entre las disponibles, dan la vuelta, y Home y End", () => {
    pintar(3);
    fireEvent.keyDown(tab("7C"), { key: "ArrowRight" });
    expect(tab("Audit").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Audit"), { key: "ArrowRight" });
    expect(tab("Alerts").getAttribute("aria-selected")).toBe("true"); // salta $ y People
    fireEvent.keyDown(tab("Alerts"), { key: "ArrowRight" });
    expect(tab("7C").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("7C"), { key: "ArrowLeft" });
    expect(tab("Alerts").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Alerts"), { key: "Home" });
    expect(tab("7C").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("7C"), { key: "End" });
    expect(tab("Alerts").getAttribute("aria-selected")).toBe("true");
  });

  it("Alerts abierta por la regla vuelve a la propiedad cuando ya no hay alertas que pidan acción", () => {
    const v = ventana(1);
    const { rerender } = render(
      <Pestanas pestanas={v.pestanas} inicial={{ id: "alerts", porRegla: true }} pideAccion={1} paneles={paneles(v)} />,
    );
    expect(tab("Alerts1").getAttribute("aria-selected")).toBe("true");
    const sinAlertas = v.pestanas.map((p) => (p.id === "alerts" ? { ...p, conteo: 0 } : p));
    rerender(<Pestanas pestanas={sinAlertas} inicial={{ id: "alerts", porRegla: true }} pideAccion={0} paneles={paneles(v)} />);
    expect(tab("4B").getAttribute("aria-selected")).toBe("true");
    expect(tab("Alerts").getAttribute("aria-selected")).toBe("false");
  });

  it("Alerts elegida a mano no vuelve sola", () => {
    const v = ventana(1);
    const { rerender } = render(
      <Pestanas pestanas={v.pestanas} inicial={{ id: "property", porRegla: false }} pideAccion={1} paneles={paneles(v)} />,
    );
    fireEvent.click(tab("Alerts1"));
    rerender(<Pestanas pestanas={v.pestanas} inicial={{ id: "property", porRegla: false }} pideAccion={0} paneles={paneles(v)} />);
    expect(tab("Alerts1").getAttribute("aria-selected")).toBe("true");
  });

  it("Alerts abierta por la regla y luego elegida a mano tampoco vuelve sola", () => {
    const v = ventana(1);
    const { rerender } = render(
      <Pestanas pestanas={v.pestanas} inicial={{ id: "alerts", porRegla: true }} pideAccion={1} paneles={paneles(v)} />,
    );
    fireEvent.click(tab("4B"));
    fireEvent.click(tab("Alerts1"));
    rerender(<Pestanas pestanas={v.pestanas} inicial={{ id: "alerts", porRegla: true }} pideAccion={0} paneles={paneles(v)} />);
    expect(tab("Alerts1").getAttribute("aria-selected")).toBe("true");
  });

  it("si la pestaña elegida deja de existir, cae a la inicial", () => {
    const v = ventana(4);
    const { rerender } = render(<Pestanas pestanas={v.pestanas} inicial={v.inicial} pideAccion={0} paneles={paneles(v)} />);
    fireEvent.click(tab("Job tracker"));
    const r3 = ventana(3);
    rerender(<Pestanas pestanas={r3.pestanas} inicial={r3.inicial} pideAccion={0} paneles={paneles(r3)} />);
    expect(tab("7C").getAttribute("aria-selected")).toBe("true");
  });
});

describe("BarraAcciones", () => {
  const disponible = (parche: Partial<AccionVista> = {}): AccionVista => ({
    codigo: "reschedule_job",
    etiqueta: "Reschedule",
    descripcion: "Move the job to another date or window.",
    motivo: "obligatorio",
    disponibilidad: { tipo: "disponible" },
    nota: null,
    ...parche,
  });

  const elegir = (codigo: string) => fireEvent.change(screen.getByLabelText("Action"), { target: { value: codigo } });
  const go = () => screen.getByRole("button", { name: "Go" }) as HTMLButtonElement;

  it("sin acción elegida, Go está deshabilitado y no hay panel", () => {
    render(<BarraAcciones requestId="r" version="1" acciones={[disponible()]} ejecutar={vi.fn()} />);
    expect(go().disabled).toBe(true);
    expect(screen.queryByTestId("panel-accion")).toBeNull();
  });

  it("el panel pide Reason obligatorio: Go sigue deshabilitado con vacío y con solo espacios", () => {
    render(<BarraAcciones requestId="r" version="1" acciones={[disponible()]} ejecutar={vi.fn()} />);
    elegir("reschedule_job");
    const panel = screen.getByTestId("panel-accion");
    expect(within(panel).getByRole("heading", { name: "Reschedule" })).toBeTruthy();
    expect(within(panel).getByText("Move the job to another date or window.")).toBeTruthy();
    const motivo = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(motivo.getAttribute("aria-required")).toBe("true");
    expect(screen.getByTestId("contador-motivo").textContent).toBe("0/500");
    expect(go().disabled).toBe(true);
    fireEvent.change(motivo, { target: { value: "   " } });
    expect(go().disabled).toBe(true);
    fireEvent.change(motivo, { target: { value: "Requester asked." } });
    expect(screen.getByTestId("contador-motivo").textContent).toBe("16/500");
    expect(go().disabled).toBe(false);
  });

  it("Go manda el motivo recortado y la versión que vio el operador, y el panel dice Saved", async () => {
    const ejecutar = vi.fn(async () => ({ tipo: "guardada" as const }));
    render(<BarraAcciones requestId="req-1" version="103" acciones={[disponible()]} ejecutar={ejecutar} />);
    elegir("reschedule_job");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  Requester asked.  " } });
    await act(async () => {
      fireEvent.click(go());
    });
    expect(ejecutar).toHaveBeenCalledWith({
      requestId: "req-1",
      codigo: "reschedule_job",
      motivo: "Requester asked.",
      datos: {},
      version: "103",
    });
    expect(screen.getByTestId("resultado-accion").textContent).toBe("Saved");
  });

  it("una acción sin motivo no pide Reason, y Go se habilita de una vez", () => {
    render(
      <BarraAcciones
        requestId="r"
        version="1"
        acciones={[disponible({ codigo: "approve_confirm", etiqueta: "Approve & confirm", motivo: "no" })]}
        ejecutar={vi.fn()}
      />,
    );
    elegir("approve_confirm");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(go().disabled).toBe(false);
  });

  it("el motivo opcional se muestra, no se exige", () => {
    render(<BarraAcciones requestId="r" version="1" acciones={[disponible({ motivo: "opcional" })]} ejecutar={vi.fn()} />);
    elegir("reschedule_job");
    expect(screen.getByText("Reason (optional)")).toBeTruthy();
    expect(go().disabled).toBe(false);
  });

  it("lo que no corre se ve en gris con su razón, con la opción y Go deshabilitados (spec §5.2)", () => {
    const acciones: AccionVista[] = [
      disponible({ codigo: "a", etiqueta: "Ask cleaner", motivo: "no" }),
      disponible({ codigo: "b", etiqueta: "Approve & confirm", disponibilidad: { tipo: "sin_construir" }, nota: "Not built yet", motivo: "no" }),
      disponible({ codigo: "c", etiqueta: "Reject · re-clean", disponibilidad: { tipo: "fuera_de_release" }, nota: "Not available in this release", motivo: "no" }),
      disponible({ codigo: "d", etiqueta: "Reschedule", disponibilidad: { tipo: "bloqueada", motivo: "BzzzBX unavailable" }, nota: "BzzzBX unavailable" }),
    ];
    render(<BarraAcciones requestId="r" version="1" acciones={acciones} ejecutar={vi.fn()} />);
    const opciones = screen.getAllByRole("option") as HTMLOptionElement[];
    expect(opciones.map((o) => o.textContent)).toEqual([
      "Choose an action",
      "Ask cleaner",
      "Approve & confirm — Not built yet",
      "Reject · re-clean — Not available in this release",
      "Reschedule — BzzzBX unavailable",
    ]);
    expect(opciones.map((o) => o.disabled)).toEqual([false, false, true, true, true]);
    expect(go().disabled).toBe(true);
  });

  it("si Go llega al servidor con algo que no corre, el panel dice por qué el servidor lo rechazó", async () => {
    const ejecutar = vi.fn(async () => ({ tipo: "rechazada" as const, codigo: "no_disponible", mensaje: "Not available in this release" }));
    render(
      <BarraAcciones
        requestId="r"
        version="1"
        acciones={[disponible({ codigo: "c", etiqueta: "Reject · re-clean", disponibilidad: { tipo: "fuera_de_release" }, nota: "Not available in this release", motivo: "no" })]}
        ejecutar={ejecutar}
      />,
    );
    elegir("c");
    expect(go().disabled).toBe(true); // en la interfaz, Go también está deshabilitado
    // El clic de React sobre un botón disabled no corre; el manejador sí se prueba directo: no frena por su cuenta.
    const boton = go();
    const clave = Object.keys(boton).find((k) => k.startsWith("__reactProps"))!;
    await act(async () => {
      (boton as unknown as Record<string, { onClick: () => void }>)[clave]!.onClick();
    });
    expect(ejecutar).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("resultado-accion").textContent).toBe("Not available in this release");
  });

  it("una instrucción en camino no se puede volver a lanzar hasta que cierre", async () => {
    const ejecutar = vi.fn(async () => ({ tipo: "instruccion" as const, idempotency_key: "k-1" }));
    render(<BarraAcciones requestId="r" version="1" acciones={[disponible({ motivo: "no" })]} ejecutar={ejecutar} />);
    elegir("reschedule_job");
    await act(async () => {
      fireEvent.click(go());
    });
    expect(screen.getByTestId("resultado-accion").textContent).toBe("Sending…");
    expect(go().disabled).toBe(true);
    fireEvent.click(go());
    expect(ejecutar).toHaveBeenCalledTimes(1);
  });

  it("si la Server Action falla, un mensaje genérico, sin detalles", async () => {
    const ejecutar = vi.fn(async () => {
      throw new Error("detalle técnico");
    });
    render(<BarraAcciones requestId="r" version="1" acciones={[disponible({ motivo: "no" })]} ejecutar={ejecutar} />);
    elegir("reschedule_job");
    await act(async () => {
      fireEvent.click(go());
    });
    expect(screen.getByTestId("resultado-accion").textContent).toBe("Something went wrong. Try again.");
  });

  it("Cancel cierra el panel; elegir otra acción limpia el motivo y el resultado", () => {
    render(<BarraAcciones requestId="r" version="1" acciones={[disponible(), disponible({ codigo: "x", etiqueta: "Cancel job" })]} ejecutar={vi.fn()} />);
    elegir("reschedule_job");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "algo" } });
    elegir("x");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("panel-accion")).toBeNull();
  });

  it("sin acciones (job cancelado), la lista está deshabilitada", () => {
    render(<BarraAcciones requestId="r" version="1" acciones={[]} ejecutar={vi.fn()} />);
    expect((screen.getByLabelText("Action") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByRole("option").textContent).toBe("No actions for this job");
  });

  it("con el registro real de OPR-26 ninguna acción de R3 se puede elegir", () => {
    render(<BarraAcciones requestId="r" version="1" acciones={accionesVisibles(ventana(3))} ejecutar={vi.fn()} />);
    const opciones = (screen.getAllByRole("option") as HTMLOptionElement[]).slice(1);
    expect(opciones.map((o) => o.textContent)).toEqual(["Reschedule — Not built yet", "Cancel job — Not built yet"]);
    expect(opciones.every((o) => o.disabled)).toBe(true);
  });

  it("textoDelResultado: los tres resultados", () => {
    expect(textoDelResultado({ tipo: "guardada" })).toBe("Saved");
    expect(textoDelResultado({ tipo: "instruccion", idempotency_key: "k" })).toBe("Sending…");
    expect(textoDelResultado({ tipo: "rechazada", codigo: "x", mensaje: "No." })).toBe("No.");
  });
});

describe("Encabezado", () => {
  it("muestra stage, nombre, job line, precio, dueño y una barra por operador", () => {
    render(<Encabezado ventana={ventana(3)} />);
    expect(screen.getByTestId("stage").textContent).toBe("Scheduled");
    expect(screen.getByTestId("nombre-job").textContent).toBe("Demo Lofts 7C");
    expect(screen.getByTestId("job-linea").textContent).toBe(
      "EX-00003 · Wed, Nov 25 · 10:00 AM–2:00 PM · Standard clean · Team Beta",
    );
    expect(screen.getByTestId("precio").textContent).toBe("$185.00");
    expect(screen.getByTestId("asignado").textContent).toBe("Ops Uno");
    expect(screen.getAllByTestId("carga")).toHaveLength(3);
  });

  it("Paid se ve como marca junto a Validation, y R1 se ve con — — y Unassigned", () => {
    const { unmount } = render(<Encabezado ventana={ventana(6)} />);
    expect(screen.getByTestId("stage").textContent).toBe("Validation✓");
    expect(screen.getByRole("img", { name: "Paid" })).toBeTruthy();
    unmount();
    render(<Encabezado ventana={ventana(1)} />);
    expect(screen.queryByTestId("marca-paid")).toBeNull();
    expect(screen.getByTestId("asignado").textContent).toBe("Unassigned");
    expect(screen.getByTestId("precio").textContent).toBe("— —");
    expect(screen.getByTestId("job-fecha").textContent).toBe("Not scheduled");
  });
});

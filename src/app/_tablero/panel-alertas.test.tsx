import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EsperaDeOpsrun } from "@/lib/alertas/tipos";
import { armarTablero } from "@/lib/tablero/armar";
import { filasDeLaSeed, leidosDelFalso } from "@/lib/tablero/prueba-datos";

// La ruta del navegador: al abrir una Job window cambia y el panel se cierra.
const ruta = vi.hoisted(() => ({ actual: "/" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => ruta.actual }));

import { VistaTablero } from "./vista-tablero";

afterEach(() => {
  cleanup();
  ruta.actual = "/";
});

const AHORA = new Date("2026-11-24T18:00:00Z");
const espera: EsperaDeOpsrun = {
  id: "d0000000-0000-4000-8000-0000000000a2",
  request_id: "b0000000-0000-4000-8000-0000000000a2",
  purpose: "initial",
  bzzzbx_team_id: "bx-team-0001",
  status: "asked",
  asked_at: "2026-11-24T16:10:00.000Z",
  new_service_date: null,
  new_window_start: null,
  new_window_end: null,
};

const tablero = (disponible = true) =>
  armarTablero({
    filas: filasDeLaSeed(AHORA),
    leidos: leidosDelFalso(AHORA),
    ahora: AHORA,
    zona: "UTC",
    bzzzbx: { disponible, actualizadoEn: AHORA.toISOString() },
    esperas: [espera],
    operadores: [
      { id: "0a000000-0000-4000-8000-0000000000a1", nombre: "Ops Uno" },
      { id: "0a000000-0000-4000-8000-0000000000a2", nombre: "Ops Dos" },
    ],
  });

function pintar(t = tablero()) {
  return render(<VistaTablero tablero={t} zona="UTC" sondeoMs={15_000} cursor="c0" />);
}

const icono = () => screen.getByTestId("alertas-operacion");
const abrir = () => fireEvent.click(icono());
const panel = () => screen.getByRole("dialog", { name: "Alerts" });
const filtro = (nombre: string) => within(panel()).getByRole("combobox", { name: nombre }) as HTMLSelectElement;
const filas = () => within(panel()).queryAllByTestId("panel-alerta");

describe("el ícono de Alerts de la barra (§6.1)", () => {
  it("cuenta Needs action de toda la operación, con el color del peor nivel, y anuncia que abre un diálogo", () => {
    pintar();
    expect(icono().textContent).toContain("2");
    expect(icono().getAttribute("data-nivel")).toBe("amber");
    expect(icono().getAttribute("aria-label")).toBe("Alerts, 2 open");
    expect(icono().getAttribute("aria-haspopup")).toBe("dialog");
    expect(icono().getAttribute("aria-expanded")).toBe("false");
    expect(icono().getAttribute("aria-controls")).toBe(panel2().id);
  });

  it("sin color con 0 alertas", () => {
    const sin = armarTablero({ filas: filasDeLaSeed(AHORA), leidos: { ...leidosDelFalso(AHORA), alertas: [] }, ahora: AHORA, zona: "UTC", bzzzbx: { disponible: true, actualizadoEn: null } });
    pintar(sin);
    expect(icono().getAttribute("data-nivel")).toBe("ninguna");
    expect(icono().textContent).toContain("0");
  });

  it("el primer pintado no late; una roja nueva en el siguiente refresco sí (el estado del cliente sobrevive al refresh)", () => {
    const { rerender } = pintar();
    expect(icono().getAttribute("data-pulso")).toBe("no");
    const roja = { ...leidosDelFalso(AHORA), alertas: [...leidosDelFalso(AHORA).alertas, { bzzzbx_alert_id: "bx-alert-7400", sujeto: { tipo: "request" as const, request_id: "b0000000-0000-4000-8000-0000000000a2" }, rule_id: "OPS-020", rule_version: "1", level: "red" as const, reason_text: "x", opened_at: AHORA.toISOString(), cleared_at: null }] };
    rerender(<VistaTablero tablero={armarTablero({ filas: filasDeLaSeed(AHORA), leidos: roja, ahora: AHORA, zona: "UTC", bzzzbx: { disponible: true, actualizadoEn: null } })} zona="UTC" sondeoMs={15_000} cursor="c1" />);
    expect(icono().getAttribute("data-nivel")).toBe("red");
    expect(icono().getAttribute("data-pulso")).toBe("si");
  });
});

/** El diálogo siempre está en el DOM (oculto si está cerrado) para que `aria-controls` apunte a algo. */
const panel2 = () => screen.getByTestId("panel-alertas");

describe("el panel (§6.2)", () => {
  it("abre un diálogo no modal con Needs action abierta y Waiting cerrada, cada una con su conteo", () => {
    pintar();
    expect(panel2().hidden).toBe(true);
    abrir();
    expect(icono().getAttribute("aria-expanded")).toBe("true");
    expect(panel().getAttribute("aria-modal")).toBeNull();
    expect((within(panel()).getByTestId("panel-needs-action") as HTMLDetailsElement).open).toBe(true);
    expect((within(panel()).getByTestId("panel-waiting") as HTMLDetailsElement).open).toBe(false);
    expect(within(panel()).getByTestId("panel-needs-action").textContent).toContain("Needs action (2)");
    expect(within(panel()).getByTestId("panel-waiting").textContent).toContain("Waiting (1)");
  });

  it("una fila por alerta: nivel, regla, job y su número, etapa, dueño y tiempo abierta; rojo primero y la más vieja arriba", () => {
    pintar();
    abrir();
    // Las dos son ámbar: la más vieja (la Running long de R4, de hace 10 min) arriba.
    expect(filas().map((f) => f.getAttribute("data-regla"))).toEqual(["MEC-003", "OPS-001"]);
    const [r4, r1] = filas();
    expect(within(r1!).getByTestId("panel-regla").textContent).toBe("OPS-001 Unassigned request");
    expect(within(r1!).getByTestId("panel-job").textContent).toBe("Example Tower 4B R1");
    expect(within(r1!).getByTestId("panel-etapa").textContent).toBe("Requests");
    expect(within(r1!).getByTestId("panel-asignado").textContent).toBe("Unassigned");
    expect(within(r1!).getByTestId("panel-duracion").textContent).toBe("Open 5 min");
    expect(within(r4!).getByTestId("panel-asignado").textContent).toBe("Ops Dos");
    expect(within(r4!).getByTestId("panel-etapa").textContent).toBe("In Progress");
  });

  it("Waiting: una fila por pregunta abierta, con el job, qué se espera y desde cuándo", () => {
    pintar();
    abrir();
    const fila = within(panel()).getByTestId("panel-espera");
    expect(fila.textContent).toContain("Sample Court Unit 12");
    expect(fila.textContent).toContain("Cleaner confirmation");
    expect(fila.textContent).toContain("Waiting 1 h 50 min");
    expect(fila.getAttribute("href")).toBe("/job/b0000000-0000-4000-8000-0000000000a2");
  });

  it("cada fila es un enlace a /job/[requestId] sin ?tab, y al abrirse la ventana (la ruta cambia) el panel se cierra", () => {
    const { rerender } = pintar();
    abrir();
    const r1 = filas().find((f) => f.getAttribute("data-regla") === "OPS-001");
    expect(r1!.tagName).toBe("A");
    expect(r1!.getAttribute("href")).toBe("/job/b0000000-0000-4000-8000-0000000000a1");
    expect(filas().every((f) => !f.getAttribute("href")!.includes("tab="))).toBe(true);
    // Pulsar la fila navega (Next); el panel se cierra cuando la ruta cambia, no antes.
    ruta.actual = "/job/b0000000-0000-4000-8000-0000000000a1";
    rerender(<VistaTablero tablero={tablero()} zona="UTC" sondeoMs={15_000} cursor="c0" />);
    expect(panel2().hidden).toBe(true);
    expect(icono().getAttribute("aria-expanded")).toBe("false");
    // Y al volver al tablero no se reabre solo.
    ruta.actual = "/";
    rerender(<VistaTablero tablero={tablero()} zona="UTC" sondeoMs={15_000} cursor="c0" />);
    expect(panel2().hidden).toBe(true);
  });

  it("Esc lo cierra y el foco vuelve al ícono; también ✕ y un clic fuera", () => {
    pintar();
    abrir();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(panel2().hidden).toBe(true);
    expect(document.activeElement).toBe(icono());

    abrir();
    fireEvent.click(within(panel()).getByTestId("panel-alertas-cerrar"));
    expect(panel2().hidden).toBe(true);
    expect(document.activeElement).toBe(icono());

    abrir();
    fireEvent.mouseDown(document.body);
    expect(panel2().hidden).toBe(true);

    // Un clic dentro del panel no lo cierra.
    abrir();
    fireEvent.mouseDown(within(panel()).getByRole("heading", { name: "Alerts" }));
    expect(panel2().hidden).toBe(false);
  });

  it("sigue abierto cuando el tablero se refresca y la lista se actualiza sola", () => {
    const { rerender } = pintar();
    abrir();
    const sin = armarTablero({ filas: filasDeLaSeed(AHORA), leidos: { ...leidosDelFalso(AHORA), alertas: [] }, ahora: AHORA, zona: "UTC", bzzzbx: { disponible: true, actualizadoEn: null } });
    rerender(<VistaTablero tablero={sin} zona="UTC" sondeoMs={15_000} cursor="c1" />);
    expect(panel2().hidden).toBe(false);
    expect(filas()).toHaveLength(0);
    expect(within(panel()).getByTestId("panel-sin-alertas").textContent).toBe("No alerts need action");
  });
});

describe("los filtros del panel (§6.2)", () => {
  it("Level, Rule, Stage y Assigned to, con cuántas filas quedan con cada opción", () => {
    pintar();
    abrir();
    expect([...filtro("Level").options].map((o) => o.textContent)).toEqual(["All (2)", "Red (0)", "Amber (2)"]);
    expect([...filtro("Rule").options].map((o) => o.textContent)).toEqual(["All (2)", "MEC-003 Running long (1)", "OPS-001 Unassigned request (1)"]);
    expect([...filtro("Stage").options].map((o) => o.textContent)).toEqual([
      "All (2)",
      "Requests (1)",
      "Scheduled (0)",
      "In Progress (1)",
      "Complete (0)",
      "Validation (0)",
    ]);
    expect([...filtro("Assigned to").options].map((o) => o.textContent)).toEqual(["All (2)", "Unassigned (1)", "Ops Uno (0)", "Ops Dos (1)"]);
  });

  it("filtran las filas y Waiting; los conteos de las demás opciones se recalculan", () => {
    pintar();
    abrir();
    fireEvent.change(filtro("Stage"), { target: { value: "in_progress" } });
    expect(filas().map((f) => f.getAttribute("data-regla"))).toEqual(["MEC-003"]);
    expect(within(panel()).queryAllByTestId("panel-espera")).toHaveLength(0);
    expect([...filtro("Level").options].map((o) => o.textContent)).toEqual(["All (1)", "Red (0)", "Amber (1)"]);
    // El filtro de Stage conserva sus propios conteos: lo demás está en All.
    expect([...filtro("Stage").options].map((o) => o.textContent)[1]).toBe("Requests (1)");

    fireEvent.change(filtro("Stage"), { target: { value: "all" } });
    fireEvent.change(filtro("Assigned to"), { target: { value: "0a000000-0000-4000-8000-0000000000a1" } });
    expect(filas()).toHaveLength(0);
    expect(within(panel()).getAllByTestId("panel-espera")).toHaveLength(1); // R2 es de Ops Uno
  });

  it("sin resultados: 'No alerts match these filters' y 'Clear filters' los quita", () => {
    pintar();
    abrir();
    fireEvent.change(filtro("Level"), { target: { value: "red" } });
    expect(within(panel()).getByTestId("panel-alertas-sin-coincidencias").textContent).toContain("No alerts match these filters");
    fireEvent.click(within(panel()).getByTestId("panel-alertas-limpiar"));
    expect(filas()).toHaveLength(2);
    expect(filtro("Level").value).toBe("all");
    expect(within(panel()).queryByTestId("panel-alertas-sin-coincidencias")).toBeNull();
  });

  it("los filtros viven en el estado del cliente mientras la página está abierta: no van a la URL", () => {
    window.history.replaceState(null, "", "/");
    pintar();
    abrir();
    fireEvent.change(filtro("Level"), { target: { value: "amber" } });
    expect(window.location.search).toBe("");
  });
});

describe("con BzzzBX caído (§6.2)", () => {
  it("el panel muestra lo último conocido del tablero con su aviso arriba", () => {
    pintar(tablero(false));
    abrir();
    expect(within(panel()).getByTestId("panel-alertas-franja").textContent).toBe("BzzzBX unavailable · last update 6:00 PM");
    expect(filas()).toHaveLength(2);
  });

  it("con BzzzBX arriba no hay aviso", () => {
    pintar();
    abrir();
    expect(within(panel()).queryByTestId("panel-alertas-franja")).toBeNull();
  });
});

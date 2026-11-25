import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { armarTablero } from "@/lib/tablero/armar";
import { filasDeLaSeed, leidosDelFalso } from "@/lib/tablero/prueba-datos";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { VistaTablero } from "./vista-tablero";

afterEach(cleanup);

const AHORA = new Date("2026-11-24T18:00:00Z");
const tablero = (disponible = true) =>
  armarTablero({
    filas: filasDeLaSeed(AHORA),
    leidos: leidosDelFalso(AHORA),
    ahora: AHORA,
    zona: "UTC",
    bzzzbx: { disponible, actualizadoEn: AHORA.toISOString() },
  });

const tarjeta = (numero: string) =>
  screen.getAllByTestId("tarjeta").find((t) => t.dataset.numero === numero)!;

describe("VistaTablero", () => {
  it("cinco columnas con su conteo y su conteo de alertas", () => {
    render(<VistaTablero tablero={tablero()} zona="UTC" sondeoMs={15_000} cursor="c0" />);
    const columnas = screen.getAllByTestId("columna");
    expect(columnas.map((c) => within(c).getByRole("heading").textContent)).toEqual([
      "Requests",
      "Scheduled",
      "In Progress",
      "Complete",
      "Validation",
    ]);
    expect(columnas.map((c) => within(c).getByTestId("conteo").textContent)).toEqual(["2", "1", "1", "1", "1"]);
    const alertas = within(columnas[0]!).getByTestId("alertas-columna");
    expect(alertas.textContent).toContain("1");
    expect(alertas.dataset.nivel).toBe("amber");
    expect(within(columnas[1]!).queryByTestId("alertas-columna")).toBeNull();
  });

  it("la tarjeta lleva nombre, número, estado, ciudad, tipo | servicio, flags y color", () => {
    render(<VistaTablero tablero={tablero()} zona="UTC" sondeoMs={15_000} cursor="c0" />);
    const r3 = tarjeta("EX-00003");
    expect(within(r3).getByTestId("nombre").textContent).toBe("Demo Lofts 7C");
    expect(within(r3).getByTestId("estado").textContent).toBe("Wed, Nov 25 · 10:00 AM–2:00 PM");
    expect(within(r3).getByTestId("ciudad").textContent).toBe("Sample Town");
    expect(within(r3).getByTestId("servicio").textContent).toBe("standard | Standard clean");
    expect(within(r3).getByTestId("flags").textContent).toBe("PO");
    expect(r3.dataset.color).toBe("normal");
    expect(tarjeta("EX-00004").dataset.color).toBe("borde");
    expect(tarjeta("EX-00006").dataset.color).toBe("pagada");
  });

  it("— — en lo no definido", () => {
    render(<VistaTablero tablero={tablero()} zona="UTC" sondeoMs={15_000} cursor="c0" />);
    expect(within(tarjeta("R1")).getByTestId("servicio").textContent).toBe("— — | — —");
  });

  it("las Paid van en la fila paid de Validation", () => {
    render(<VistaTablero tablero={tablero()} zona="UTC" sondeoMs={15_000} cursor="c0" />);
    const fila = screen.getByTestId("fila-paid");
    expect(within(fila).getByText("Paid (1)")).toBeTruthy();
    expect(within(fila).getByTestId("tarjeta").dataset.numero).toBe("EX-00006");
  });

  it("lo que no entra en V1.1 beta se ve en gris y no corre", () => {
    render(<VistaTablero tablero={tablero()} zona="UTC" sondeoMs={15_000} cursor="c0" />);
    for (const nombre of ["Alarms", "Anomalies", "Actions", "Observe", "Geo", "Incidents", "Activity", "Map"]) {
      const boton = screen.getByRole("button", { name: nombre });
      expect(boton.getAttribute("aria-disabled")).toBe("true");
      expect(boton.getAttribute("title")).toBe("Available in a later release");
    }
    expect(screen.getByRole("button", { name: "Rosie" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("Alerts con el conteo de la operación", () => {
    render(<VistaTablero tablero={tablero()} zona="UTC" sondeoMs={15_000} cursor="c0" />);
    expect(screen.getByTestId("alertas-operacion").textContent).toContain("1");
  });

  it("filtro de operador: Only me espera al login", () => {
    render(<VistaTablero tablero={tablero()} zona="UTC" sondeoMs={15_000} cursor="c0" />);
    const filtro = screen.getByRole("combobox", { name: "Operator filter" }) as HTMLSelectElement;
    expect(filtro.value).toBe("all");
    const soloYo = within(filtro).getByRole("option", { name: /Only me/ }) as HTMLOptionElement;
    expect(soloYo.disabled).toBe(true);
  });

  it("Live, o el aviso de BzzzBX caído con la hora", () => {
    render(<VistaTablero tablero={tablero()} zona="UTC" sondeoMs={15_000} cursor="c0" />);
    expect(screen.getByTestId("en-vivo").textContent).toBe("Live");
    cleanup();
    render(<VistaTablero tablero={tablero(false)} zona="UTC" sondeoMs={15_000} cursor="c0" />);
    expect(screen.getByTestId("en-vivo").textContent).toBe("BzzzBX unavailable · last update 6:00 PM");
  });
});

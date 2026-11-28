import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Pestana } from "@/lib/ventana/tipos";

// La Server Action y sus dependencias de servidor no corren en jsdom.
vi.mock("./acciones", () => ({ ejecutarAccion: vi.fn(), elegirActor: vi.fn() }));

import { Pestanas } from "./pestanas";

afterEach(cleanup);

const pestanas = (alertas: Partial<Pestana>): Pestana[] => [
  { id: "property", nombre: "7C", deshabilitada: false },
  { id: "alerts", nombre: "Alerts", deshabilitada: false, ...alertas },
];

const pintar = (p: Pestana[], pideAccion = 0) =>
  render(<Pestanas pestanas={p} inicial={{ id: "property", porRegla: false }} pideAccion={pideAccion} paneles={{ property: <p>propiedad</p>, alerts: <p>alertas</p> }} />);

const insignia = () => screen.queryByTestId("conteo-alertas");

describe("la insignia de la pestaña Alerts (OPR-34 §5.2)", () => {
  it("roja con el conteo de Needs action, y el nombre accesible dice el conteo y el nivel", () => {
    pintar(pestanas({ conteo: 2, idsRojos: ["r1"], insignia: { nivel: "red", conteo: 2, nombreAccesible: "Alerts, 2 need action, red" } }), 2);
    expect(insignia()!.getAttribute("data-nivel")).toBe("red");
    expect(insignia()!.textContent).toBe("2");
    expect(screen.getByRole("tab", { name: "Alerts, 2 need action, red" })).toBeTruthy();
  });

  it("ámbar con el conteo de Needs action", () => {
    pintar(pestanas({ conteo: 1, insignia: { nivel: "amber", conteo: 1, nombreAccesible: "Alerts, 1 need action, amber" } }), 1);
    expect(insignia()!.getAttribute("data-nivel")).toBe("amber");
  });

  it("gris con el conteo de Waiting si no hay Needs action", () => {
    pintar(pestanas({ conteo: 0, insignia: { nivel: "gray", conteo: 1, nombreAccesible: "Alerts, 1 waiting" } }));
    expect(insignia()!.getAttribute("data-nivel")).toBe("gray");
    expect(insignia()!.textContent).toBe("1");
    expect(screen.getByRole("tab", { name: "Alerts, 1 waiting" })).toBeTruthy();
  });

  it("sin nada, sin insignia y con el nombre de siempre", () => {
    pintar(pestanas({ conteo: 0, insignia: null }));
    expect(insignia()).toBeNull();
    expect(screen.getByRole("tab", { name: "Alerts" })).toBeTruthy();
  });

  it("el primer pintado fija la base y no late; una roja nueva en el siguiente pintado sí; una ámbar o una que ya estaba, no", () => {
    const roja = (ids: string[]) => pestanas({ conteo: ids.length, idsRojos: ids, insignia: { nivel: "red", conteo: ids.length, nombreAccesible: `Alerts, ${ids.length} need action, red` } });
    const { rerender } = pintar(roja(["r1"]), 1);
    expect(insignia()!.getAttribute("data-pulso")).toBe("no");
    const otra = (p: Pestana[]) => (
      <Pestanas pestanas={p} inicial={{ id: "property", porRegla: false }} pideAccion={1} paneles={{ property: <p>propiedad</p>, alerts: <p>alertas</p> }} />
    );
    rerender(otra(roja(["r1"])));
    expect(insignia()!.getAttribute("data-pulso")).toBe("no");
    rerender(otra(roja(["r1", "r2"])));
    expect(insignia()!.getAttribute("data-pulso")).toBe("si");
    rerender(otra(roja(["r2"])));
    expect(insignia()!.getAttribute("data-pulso")).toBe("no");
    rerender(otra(pestanas({ conteo: 2, idsRojos: ["r2"], insignia: { nivel: "red", conteo: 2, nombreAccesible: "Alerts, 2 need action, red" } })));
    expect(insignia()!.getAttribute("data-pulso")).toBe("no");
  });
});

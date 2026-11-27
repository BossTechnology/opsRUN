// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { BzzzbxNoDisponible } from "../bzzzbx/errores";
import { crearFalso } from "../bzzzbx/falso";
import type { LecturaBzzzbx } from "../bzzzbx/puertos";

import { leerNombres } from "./nombres";

const IDS = {
  job: ["bx-job-0102"],
  cleaner_team: ["bx-team-0001"],
  property: ["bx-prop-0001"],
  service: ["bx-svc-0001"],
};

describe("leerNombres", () => {
  it("lee del puerto el número del job, el nombre del cleaner, el de la propiedad y el del servicio", async () => {
    const { lectura } = crearFalso();
    const n = await leerNombres({ ids: IDS, lectura, disponible: true });
    expect(n).toEqual({
      disponible: true,
      job: { "bx-job-0102": "EX-00102" },
      cleaner_team: { "bx-team-0001": "Team Alpha" },
      property: { "bx-prop-0001": "Example Tower" },
      service: { "bx-svc-0001": "Standard clean" },
    });
  });

  it("una ida por entidad, no una por id", async () => {
    const { lectura } = crearFalso();
    const espia = vi.spyOn(lectura, "obtenerVarios");
    await leerNombres({ ids: { ...IDS, cleaner_team: ["bx-team-0001", "bx-team-0002"] }, lectura, disponible: true });
    expect(espia).toHaveBeenCalledTimes(4);
  });

  it("con BzzzBX caído (disponible false) ni llama al puerto", async () => {
    const { lectura } = crearFalso();
    const obtenerVarios = vi.spyOn(lectura, "obtenerVarios");
    const n = await leerNombres({ ids: IDS, lectura, disponible: false });
    expect(obtenerVarios).not.toHaveBeenCalled();
    expect(n.disponible).toBe(false);
    expect(n.cleaner_team).toEqual({});
  });

  it("sin nada de PINCH que nombrar no llama al puerto y no hay faltantes", async () => {
    const { lectura } = crearFalso();
    const obtenerVarios = vi.spyOn(lectura, "obtenerVarios");
    const n = await leerNombres({ ids: { job: [], cleaner_team: [], property: [], service: [] }, lectura, disponible: true });
    expect(obtenerVarios).not.toHaveBeenCalled();
    expect(n.disponible).toBe(true);
  });

  it("si el puerto falla (reconocido por nombre, venga de donde venga), no hay nombres y no se cae", async () => {
    const { lectura } = crearFalso();
    const ajeno = new Error("otra copia del módulo");
    ajeno.name = "BzzzbxNoDisponible";
    vi.spyOn(lectura, "obtenerVarios").mockRejectedValue(ajeno);
    const n = await leerNombres({ ids: IDS, lectura, disponible: true });
    expect(n.disponible).toBe(false);
  });

  it("si tarda más que el presupuesto, cuenta como caído", async () => {
    const { lectura } = crearFalso();
    const lenta: LecturaBzzzbx = { ...lectura, obtenerVarios: () => new Promise(() => {}) } as unknown as LecturaBzzzbx;
    const n = await leerNombres({ ids: IDS, lectura: lenta, disponible: true, presupuestoMs: 20 });
    expect(n.disponible).toBe(false);
  });

  it("un error inesperado también degrada a — — y deja constancia", async () => {
    const { lectura } = crearFalso();
    vi.spyOn(lectura, "obtenerVarios").mockRejectedValue(new TypeError("boom"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const n = await leerNombres({ ids: IDS, lectura, disponible: true });
    expect(n.disponible).toBe(false);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("un error de BzzzBX caído no ensucia el log", async () => {
    const { lectura } = crearFalso();
    vi.spyOn(lectura, "obtenerVarios").mockRejectedValue(new BzzzbxNoDisponible());
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await leerNombres({ ids: IDS, lectura, disponible: true });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

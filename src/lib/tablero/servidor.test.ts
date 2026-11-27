// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BzzzbxNoDisponible } from "../bzzzbx/errores";

import { lecturaOAusente, zonaDeLaOperacion } from "./servidor";

describe("servidor del tablero", () => {
  it("si BzzzBX no se puede crear, la lectura responde no disponible", async () => {
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    const lectura = lecturaOAusente(() => {
      throw new Error("La implementación real de BzzzBX no existe todavía: espera el contrato de OPR-6.");
    });
    await expect(lectura.cambiosDesde(null)).rejects.toBeInstanceOf(BzzzbxNoDisponible);
    await expect(lectura.obtenerVarios("job", [])).rejects.toBeInstanceOf(BzzzbxNoDisponible);
    expect(errores).toHaveBeenCalled();
    errores.mockRestore();
  });

  it("zona de la operación: la pedida, o UTC si falta o no es válida", () => {
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(zonaDeLaOperacion({})).toBe("UTC");
    expect(zonaDeLaOperacion({ OPSRUN_ZONA_HORARIA: "America/Bogota" })).toBe("America/Bogota");
    expect(zonaDeLaOperacion({ OPSRUN_ZONA_HORARIA: "Marte/Olympus" })).toBe("UTC");
    errores.mockRestore();
  });
});

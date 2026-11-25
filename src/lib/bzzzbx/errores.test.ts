// @vitest-environment node
/**
 * Next empaqueta por separado las rutas y las páginas: el falso (una sola
 * instancia por proceso) puede lanzar la clase de otra copia del módulo. Los
 * errores del puerto se reconocen por su nombre, no por `instanceof`.
 */
import { describe, expect, it } from "vitest";

import { BzzzbxNoDisponible, CursorCaducado, esCursorCaducado, esNoDisponible } from "./errores";

/** Lo que lanza otra copia del módulo: misma forma, otra clase. */
function deOtraCopia(nombre: string): Error {
  const e = new (class extends Error {})("de otra copia");
  e.name = nombre;
  return e;
}

describe("reconocer errores del puerto", () => {
  it("BzzzbxNoDisponible, de esta copia o de otra", () => {
    expect(esNoDisponible(new BzzzbxNoDisponible())).toBe(true);
    expect(esNoDisponible(deOtraCopia("BzzzbxNoDisponible"))).toBe(true);
    expect(esNoDisponible(new CursorCaducado())).toBe(false);
    expect(esNoDisponible(new Error("otro"))).toBe(false);
    expect(esNoDisponible("BzzzbxNoDisponible")).toBe(false);
    expect(esNoDisponible(null)).toBe(false);
  });

  it("CursorCaducado, de esta copia o de otra", () => {
    expect(esCursorCaducado(new CursorCaducado())).toBe(true);
    expect(esCursorCaducado(deOtraCopia("CursorCaducado"))).toBe(true);
    expect(esCursorCaducado(new BzzzbxNoDisponible())).toBe(false);
  });
});

// @vitest-environment node
/**
 * Las reglas de alerta y el botón de cada una (spec OPR-34 §5.3 y §10.2): toda
 * regla de `NOMBRES_DE_REGLAS` tiene su arreglo, y todo código de acción de
 * `ARREGLO_DE_REGLA` existe en el registro de acciones. Se ve fallar con un código
 * inventado. También, que la tabla de la migración (`alert_fixing_events()`) hable
 * de reglas y acciones que existen.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REGISTRO_DE_ACCIONES } from "../acciones/registro";
import { esReglaLimpiable } from "../etapas/reglas";

import { ARREGLO_DE_REGLA, arregloDe, NOMBRES_DE_REGLAS, REGLA_MENSAJE_NO_ENTREGADO, reglaConNombre, type Arreglo } from "./reglas";

/** Los códigos de acción que nombra el reparto y que el registro no tiene. */
export function codigosSinRegistro(reparto: Record<string, Arreglo>, registro = REGISTRO_DE_ACCIONES): string[] {
  const codigos = new Set(registro.map((d) => d.codigo));
  return Object.entries(reparto).flatMap(([regla, a]) => (a.tipo === "accion" && !codigos.has(a.codigo) ? [`${regla}:${a.codigo}`] : []));
}

describe("ARREGLO_DE_REGLA", () => {
  it("cada regla de NOMBRES_DE_REGLAS tiene entrada, y no sobra ninguna", () => {
    expect(Object.keys(ARREGLO_DE_REGLA).sort()).toEqual(Object.keys(NOMBRES_DE_REGLAS).sort());
  });

  it("cada código de acción existe en el registro de acciones", () => {
    expect(codigosSinRegistro(ARREGLO_DE_REGLA)).toEqual([]);
  });

  it("se ve fallar con un código inventado", () => {
    const malo: Record<string, Arreglo> = { ...ARREGLO_DE_REGLA, "OPS-001": { tipo: "accion", codigo: "assign_request", prellenado: null } };
    expect(codigosSinRegistro(malo)).toEqual(["OPS-001:assign_request"]);
  });

  it("el botón de cada regla es el del spec: acción, ninguno o Edit and resend", () => {
    expect(Object.fromEntries(Object.entries(ARREGLO_DE_REGLA).map(([regla, a]) => [regla, a.tipo === "accion" ? a.codigo : a.tipo]))).toEqual({
      "OPS-001": "assign",
      "OPS-002": "schedule",
      "OPS-010": "ninguno",
      "OPS-020": "confirm_cleaner",
      "MEC-003": "clear_alert",
      "ORG-002": "mark_oss",
      "ORG-003": "mark_oss",
      "TRN-005": "write_po",
      [REGLA_MENSAJE_NO_ENTREGADO]: "reenviar",
    });
  });

  it("Clear alert es la acción de la única regla que se puede limpiar (la lista es de la base: clearable_rules)", () => {
    const conClearAlert = Object.entries(ARREGLO_DE_REGLA).filter(([, a]) => a.tipo === "accion" && a.codigo === "clear_alert");
    expect(conClearAlert.map(([regla]) => regla)).toEqual(["MEC-003"]);
    expect(esReglaLimpiable("MEC-003")).toBe(true);
  });

  it("una regla que no conoce no trae botón ni nombre", () => {
    expect(arregloDe("XYZ-999")).toEqual({ tipo: "ninguno", texto: "" });
    expect(reglaConNombre("XYZ-999")).toBe("XYZ-999");
    expect(reglaConNombre("MEC-003")).toBe("MEC-003 Running long");
    expect(reglaConNombre(REGLA_MENSAJE_NO_ENTREGADO)).toBe("MSG-001 Message not delivered");
  });
});

describe("el reparto de la migración (alert_fixing_events)", () => {
  const sql = readFileSync(join(__dirname, "../../../supabase/migrations/20261205120000_alertas.sql"), "utf8");
  const tabla = sql.slice(sql.indexOf("from (values"), sql.indexOf(") as t (rule_id, event_type)"));
  const pares = [...tabla.matchAll(/\('([^']+)',\s*'([^']+)'\)/g)].map((m) => [m[1]!, m[2]!] as const);

  it("tiene lo de §4.1", () => {
    expect(pares.length).toBe(9);
  });

  it("solo habla de reglas que el código conoce (y la de Message not delivered es la misma constante)", () => {
    expect(pares.filter(([regla]) => !(regla in NOMBRES_DE_REGLAS))).toEqual([]);
    expect(pares.some(([regla]) => regla === REGLA_MENSAJE_NO_ENTREGADO)).toBe(true);
  });

  it("las reglas que tienen una acción con evento son las que arreglan una acción, y OPS-010 y MEC-003 no tienen ninguno", () => {
    const conEvento = new Set(pares.map(([regla]) => regla));
    expect(conEvento.has("OPS-010")).toBe(false);
    expect(conEvento.has("MEC-003")).toBe(false);
    expect([...conEvento].sort()).toEqual(["MSG-001", "ORG-002", "ORG-003", "OPS-001", "OPS-002", "OPS-020", "TRN-005"].sort());
  });
});

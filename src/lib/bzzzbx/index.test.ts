// @vitest-environment node
/**
 * La fábrica elige el falso o el real con BZZZBX_MODO (spec OPR-22 §5.1). El
 * falso nunca corre en el servidor.
 */
import { describe, expect, it } from "vitest";

import { ErrorDeConfiguracion } from "../db/entorno";

import { crearBzzzbx, modoBzzzbx, obtenerBzzzbx, problemasBzzzbx } from ".";

describe("modoBzzzbx", () => {
  it("fuera del servidor es falso por defecto", () => {
    expect(modoBzzzbx({})).toBe("falso");
  });

  it("en el servidor es real por defecto", () => {
    expect(modoBzzzbx({ OPSRUN_SERVIDOR: "1" })).toBe("real");
  });

  it("respeta el valor pedido", () => {
    expect(modoBzzzbx({ BZZZBX_MODO: "real" })).toBe("real");
    expect(modoBzzzbx({ BZZZBX_MODO: " falso " })).toBe("falso");
  });

  it("rechaza un valor desconocido", () => {
    expect(() => modoBzzzbx({ BZZZBX_MODO: "mock" })).toThrow(ErrorDeConfiguracion);
  });
});

describe("problemasBzzzbx", () => {
  it("no ve problemas fuera del servidor ni en el servidor con el real", () => {
    expect(problemasBzzzbx({ BZZZBX_MODO: "falso" })).toEqual([]);
    expect(problemasBzzzbx({ OPSRUN_SERVIDOR: "1" })).toEqual([]);
    expect(problemasBzzzbx({ OPSRUN_SERVIDOR: "1", BZZZBX_MODO: "real" })).toEqual([]);
  });

  it("en el servidor, el falso no deja arrancar", () => {
    expect(problemasBzzzbx({ OPSRUN_SERVIDOR: "1", BZZZBX_MODO: "falso" })).toEqual([
      "BZZZBX_MODO=falso no se permite en el servidor",
    ]);
  });

  it("un valor desconocido es un problema", () => {
    expect(problemasBzzzbx({ BZZZBX_MODO: "mock" })).toHaveLength(1);
  });
});

describe("crearBzzzbx", () => {
  it("con el falso da los dos puertos sobre los datos inventados", async () => {
    const { lectura, instrucciones } = crearBzzzbx({});
    expect(await lectura.obtener("job", "bx-job-0003")).not.toBeNull();
    expect(await instrucciones.estado("no-existe")).toBeNull();
  });

  it("el real todavía no existe (OPR-6)", () => {
    expect(() => crearBzzzbx({ BZZZBX_MODO: "real" })).toThrow(/OPR-6/);
  });

  it("en el servidor no crea el falso aunque se pida", () => {
    expect(() => crearBzzzbx({ OPSRUN_SERVIDOR: "1", BZZZBX_MODO: "falso" })).toThrow(ErrorDeConfiguracion);
  });
});

describe("obtenerBzzzbx", () => {
  it("devuelve siempre la misma instancia en el proceso", () => {
    const env = { BZZZBX_MODO: "falso" };
    expect(obtenerBzzzbx(env)).toBe(obtenerBzzzbx(env));
  });
});

import { describe, expect, it } from "vitest";

import { leerSalud } from "./salud";

const responde = (filas: unknown[]) => async () => filas;

describe("leerSalud", () => {
  it("da conectada con la versión del esquema", async () => {
    expect(await leerSalud(responde([{ status: "ok", schema_version: "20261124120000" }]))).toEqual({
      conectada: true,
      versionEsquema: "20261124120000",
    });
  });

  it("acepta una base sin tabla de migraciones", async () => {
    expect(await leerSalud(responde([{ status: "ok", schema_version: null }]))).toEqual({
      conectada: true,
      versionEsquema: null,
    });
  });

  it("no da por buena una respuesta vacía", async () => {
    expect((await leerSalud(responde([]))).conectada).toBe(false);
  });

  it("no da por buena una fila sin status ok", async () => {
    expect((await leerSalud(responde([{ status: "down" }]))).conectada).toBe(false);
  });

  it("devuelve el error de la base", async () => {
    const salud = await leerSalud(async () => {
      throw new Error("permission denied for schema opsrun");
    });
    expect(salud).toEqual({ conectada: false, error: "permission denied for schema opsrun" });
  });
});

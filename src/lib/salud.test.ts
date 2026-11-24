import { describe, expect, it } from "vitest";

import { type ClienteSalud, leerSalud } from "./salud";

function clienteQueResponde(data: unknown, error: { message: string } | null = null): ClienteSalud {
  return { rpc: async () => ({ data, error }) };
}

describe("leerSalud", () => {
  it("da conectada con la versión del esquema", async () => {
    const salud = await leerSalud(
      clienteQueResponde([{ status: "ok", schema_version: "20261124000000" }]),
    );
    expect(salud).toEqual({ conectada: true, versionEsquema: "20261124000000" });
  });

  it("acepta una base sin migraciones", async () => {
    const salud = await leerSalud(clienteQueResponde([{ status: "ok", schema_version: null }]));
    expect(salud).toEqual({ conectada: true, versionEsquema: null });
  });

  it("devuelve el error de Supabase", async () => {
    const salud = await leerSalud(clienteQueResponde(null, { message: "permission denied" }));
    expect(salud).toEqual({ conectada: false, error: "permission denied" });
  });

  it("no da por buena una respuesta sin status ok", async () => {
    const salud = await leerSalud(clienteQueResponde([]));
    expect(salud.conectada).toBe(false);
  });

  it("atrapa un fallo de red", async () => {
    const salud = await leerSalud({
      rpc: async () => {
        throw new Error("fetch failed");
      },
    });
    expect(salud).toEqual({ conectada: false, error: "fetch failed" });
  });
});

// @vitest-environment node
/**
 * Traducción de errores de la base en `datos-sql.ts`, sin base: dos
 * operadores que enlazan el mismo job a la vez pasan los dos el chequeo OP008
 * y el segundo choca con el `unique` (23505). Eso es `job_ya_enlazado`; otro
 * 23505 no se disfraza.
 */
import { describe, expect, it } from "vitest";

import { crearDatosDeEnlace, type Ejecutar } from "./datos-sql";
import { EnlaceInvalido } from "./enlace";

const OPERADOR = { tipo: "operador", authUserId: "5a000000-0000-4000-8000-0000000000a1" } as const;
const ENLACE = { requestId: "b0000000-0000-4000-8000-0000000000a2", bzzzbxJobId: "bx-job-0102", jobNumber: "EX-00102" };

function fallaCon(error: Record<string, string>): Ejecutar {
  return async () => {
    throw Object.assign(new Error("falla de la base"), error);
  };
}

describe("datos-sql: errores de la base", () => {
  it.each(["request_bzzzbx_job_id_key", "request_job_number_key"])(
    "un 23505 de %s al enlazar es job_ya_enlazado",
    async (constraint) => {
      const datos = crearDatosDeEnlace(fallaCon({ code: "23505", constraint }));
      const intento = datos.enlazar(ENLACE, OPERADOR);
      await expect(intento).rejects.toBeInstanceOf(EnlaceInvalido);
      await expect(intento).rejects.toMatchObject({ codigo: "job_ya_enlazado" });
    },
  );

  it("un 23505 de otra constraint no se traduce", async () => {
    const datos = crearDatosDeEnlace(fallaCon({ code: "23505", constraint: "request_r_number_key" }));
    await expect(datos.enlazar(ENLACE, OPERADOR)).rejects.toMatchObject({ code: "23505", constraint: "request_r_number_key" });
  });

  it.each([
    ["OP005", "gate_incompleto"],
    ["OP006", "request_no_encontrada"],
    ["OP007", "request_no_abierta"],
    ["OP008", "job_ya_enlazado"],
  ])("el código %s de la función es %s", async (code, codigo) => {
    const datos = crearDatosDeEnlace(fallaCon({ code }));
    await expect(datos.enlazar(ENLACE, OPERADOR)).rejects.toMatchObject({ codigo });
  });
});

describe("datos-sql: Change linked job (OPR-29)", () => {
  const CAMBIO = { requestId: ENLACE.requestId, version: "211", bzzzbxJobId: "bx-job-0112", jobNumber: "EX-00112", motivo: "PINCH replaced it." };

  it.each([
    ["OP006", "request_no_encontrada"],
    ["OP008", "job_ya_enlazado"],
    ["OP013", "cambio_concurrente"],
    ["OP019", "request_no_programada"],
    ["OP040", "con_hechos_del_job"],
    ["OP041", "mismo_job"],
    ["22023", "dato_invalido"],
  ])("el código %s de relink_observed_job es %s", async (code, codigo) => {
    const datos = crearDatosDeEnlace(fallaCon({ code }));
    await expect(datos.cambiar(CAMBIO, OPERADOR)).rejects.toMatchObject({ name: "EnlaceInvalido", codigo });
  });

  it("un 23505 del job en una carrera es job_ya_enlazado, como el enlace", async () => {
    const datos = crearDatosDeEnlace(fallaCon({ code: "23505", constraint: "request_job_number_key" }));
    await expect(datos.cambiar(CAMBIO, OPERADOR)).rejects.toMatchObject({ codigo: "job_ya_enlazado" });
  });

  it("el 42501 (sin operador) y los demás errores suben tal cual", async () => {
    const datos = crearDatosDeEnlace(fallaCon({ code: "42501" }));
    await expect(datos.cambiar(CAMBIO, OPERADOR)).rejects.toMatchObject({ code: "42501" });
  });

  it("llama a relink_observed_job como escritura del operador, con la versión y el motivo", async () => {
    const llamadas: { sql: string; params: unknown[]; opciones: unknown }[] = [];
    const ejecutar: Ejecutar = async (fn, opciones) => {
      const db = { query: async (sql: string, params: unknown[]) => (llamadas.push({ sql, params, opciones }), { rows: [] }) };
      return fn(db as never);
    };
    await crearDatosDeEnlace(ejecutar).cambiar(CAMBIO, OPERADOR);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]!.sql).toMatch(/opsrun\.relink_observed_job/);
    expect(llamadas[0]!.params).toEqual([CAMBIO.requestId, "211", "bx-job-0112", "EX-00112", "PINCH replaced it."]);
    expect(llamadas[0]!.opciones).toEqual({ escritura: true, actor: OPERADOR });
  });

  it("jobsReenlazados lee los from_bzzzbx_job_id de job_relinked, sin escribir", async () => {
    const llamadas: { sql: string; opciones: unknown }[] = [];
    const ejecutar: Ejecutar = async (fn, opciones) => {
      const db = { query: async (sql: string) => (llamadas.push({ sql, opciones }), { rows: [{ id: "bx-job-0111" }] }) };
      return fn(db as never);
    };
    const ids = await crearDatosDeEnlace(ejecutar).jobsReenlazados(ENLACE.requestId);
    expect([...ids]).toEqual(["bx-job-0111"]);
    expect(llamadas[0]!.sql).toMatch(/job_relinked/);
    expect(llamadas[0]!.opciones).toBeUndefined();
  });
});

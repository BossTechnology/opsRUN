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

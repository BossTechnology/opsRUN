// @vitest-environment node
/**
 * Lo que `datos-sql.ts` le pide a la base y cómo traduce sus errores, sin base
 * (OPR-28, spec §7): cada función SQL con sus argumentos en orden y el actor de
 * la transacción, y cada SQLSTATE de las funciones como su `RequestInvalida`.
 * Los errores se reconocen por nombre, no con `instanceof`.
 */
import { describe, expect, it, vi } from "vitest";

import type { Actor, Tx } from "@/lib/db/pool";

import { crearDatosDeRequests, type Ejecutar } from "./datos-sql";
import { esRequestInvalida, RequestInvalida } from "./tipos";

const REQUEST = "b0000000-0000-4000-8000-0000000000a8";
const OPERADOR_DESTINO = "0a000000-0000-4000-8000-0000000000a2";
const RESPUESTA = "5c000000-0000-4000-8000-0000000000c1";
const ACTOR: Actor = { tipo: "operador", authUserId: "de000000-0000-4000-8000-0000000000a1" };

/** Una base de mentira: guarda lo que se le pide y contesta con `filas`. */
function baseDeMentira(filas: unknown[] = []) {
  const consultas: { sql: string; parametros: unknown[] }[] = [];
  const opciones: { escritura?: boolean; actor?: Actor }[] = [];
  const db = {
    query: vi.fn(async (sql: string, parametros: unknown[] = []) => {
      consultas.push({ sql, parametros });
      return { rows: filas };
    }),
  } as unknown as Tx;
  const ejecutar: Ejecutar = async (fn, o) => {
    opciones.push(o ?? {});
    return fn(db);
  };
  return { ejecutar, consultas, opciones };
}

function fallaCon(error: Record<string, unknown>): Ejecutar {
  return async () => {
    throw Object.assign(new Error("falla de la base"), error);
  };
}

const sinEspacios = (sql: string) => sql.replace(/\s+/g, " ").trim();

describe("datos-sql: las llamadas a las funciones SQL", () => {
  it("asignar: assign_request con la request, el operador, la versión y el motivo, como escritura del actor", async () => {
    const { ejecutar, consultas, opciones } = baseDeMentira();
    await crearDatosDeRequests(ejecutar).asignar({ requestId: REQUEST, operatorId: OPERADOR_DESTINO, version: "108", motivo: "Weekend" }, ACTOR);
    expect(consultas).toHaveLength(1);
    expect(sinEspacios(consultas[0]!.sql)).toBe("select opsrun.assign_request($1::uuid, $2::uuid, $3::bigint, $4)");
    expect(consultas[0]!.parametros).toEqual([REQUEST, OPERADOR_DESTINO, "108", "Weekend"]);
    expect(opciones).toEqual([{ escritura: true, actor: ACTOR }]);
  });

  it("confirmarDetalles y confirmarSender devuelven el id de la confirmación", async () => {
    const { ejecutar, consultas, opciones } = baseDeMentira([{ id: "conf-1" }]);
    const datos = crearDatosDeRequests(ejecutar);
    expect(await datos.confirmarDetalles({ requestId: REQUEST, version: "9" }, ACTOR)).toBe("conf-1");
    expect(await datos.confirmarSender({ requestId: REQUEST, version: "9" }, ACTOR)).toBe("conf-1");
    expect(consultas.map((c) => sinEspacios(c.sql))).toEqual([
      "select opsrun.confirm_details($1::uuid, $2::bigint) as id",
      "select opsrun.confirm_sender($1::uuid, $2::bigint) as id",
    ]);
    expect(consultas.map((c) => c.parametros)).toEqual([
      [REQUEST, "9"],
      [REQUEST, "9"],
    ]);
    expect(opciones).toEqual([
      { escritura: true, actor: ACTOR },
      { escritura: true, actor: ACTOR },
    ]);
  });

  it("confirmarCleaner: el método como enum, la versión, la respuesta y el motivo", async () => {
    const { ejecutar, consultas } = baseDeMentira([{ id: "conf-2" }]);
    const id = await crearDatosDeRequests(ejecutar).confirmarCleaner(
      { requestId: REQUEST, metodo: "cleaner_text", cleanerConfirmationId: RESPUESTA, version: "9", motivo: null },
      ACTOR,
    );
    expect(id).toBe("conf-2");
    expect(sinEspacios(consultas[0]!.sql)).toBe(
      "select opsrun.confirm_cleaner($1::uuid, $2::opsrun.confirmation_method, $3::bigint, $4::uuid, $5) as id",
    );
    expect(consultas[0]!.parametros).toEqual([REQUEST, "cleaner_text", "9", RESPUESTA, null]);
  });

  it("no manda ningún nombre, teléfono ni valor del borrador: solo ids, método, versión y motivo", async () => {
    const { ejecutar, consultas } = baseDeMentira([{ id: "conf-3" }]);
    await crearDatosDeRequests(ejecutar).confirmarCleaner(
      { requestId: REQUEST, metodo: "phone", cleanerConfirmationId: null, version: "9", motivo: "Called" },
      ACTOR,
    );
    expect(consultas[0]!.parametros).toEqual([REQUEST, "phone", "9", null, "Called"]);
  });
});

describe("datos-sql: errores de la base", () => {
  type Datos = ReturnType<typeof crearDatosDeRequests>;
  const llamadas: Record<string, (d: Datos) => Promise<unknown>> = {
    asignar: (d) => d.asignar({ requestId: REQUEST, operatorId: OPERADOR_DESTINO, version: "1", motivo: null }, ACTOR),
    confirmarDetalles: (d) => d.confirmarDetalles({ requestId: REQUEST, version: "1" }, ACTOR),
    confirmarSender: (d) => d.confirmarSender({ requestId: REQUEST, version: "1" }, ACTOR),
    confirmarCleaner: (d) =>
      d.confirmarCleaner({ requestId: REQUEST, metodo: "phone", cleanerConfirmationId: null, version: "1", motivo: null }, ACTOR),
  };

  it.each([
    ["OP006", "request_no_encontrada"],
    ["OP007", "request_no_abierta"],
    ["OP013", "cambio_concurrente"],
    ["OP014", "operador_invalido"],
    ["OP015", "ya_es_dueno"],
    ["OP016", "faltan_datos"],
    ["OP017", "ya_confirmada"],
    ["OP018", "respuesta_invalida"],
  ])("el código %s de la función es %s, en las cuatro llamadas", async (code, codigo) => {
    for (const [nombre, llamar] of Object.entries(llamadas)) {
      const datos = crearDatosDeRequests(fallaCon({ code }));
      await expect(llamar(datos), nombre).rejects.toMatchObject({ name: "RequestInvalida", codigo });
    }
  });

  it("dos operadores que confirman a la vez: el índice único de la confirmación vigente (23505) es ya_confirmada", async () => {
    const datos = crearDatosDeRequests(fallaCon({ code: "23505", constraint: "request_confirmation_current_key" }));
    await expect(llamadas.confirmarDetalles!(datos)).rejects.toMatchObject({ codigo: "ya_confirmada" });
  });

  it("un 23505 de otra constraint no se disfraza", async () => {
    const datos = crearDatosDeRequests(fallaCon({ code: "23505", constraint: "request_r_number_key" }));
    await expect(llamadas.confirmarDetalles!(datos)).rejects.toMatchObject({ code: "23505", constraint: "request_r_number_key" });
  });

  it.each(["42501", "22023", "57014"])("%s sube tal cual: no es de la request inválida", async (code) => {
    const datos = crearDatosDeRequests(fallaCon({ code }));
    for (const llamar of Object.values(llamadas)) await expect(llamar(datos)).rejects.toMatchObject({ code });
  });

  it("los errores se reconocen por nombre: uno de otra copia del módulo vale, y uno con otro nombre no", () => {
    expect(esRequestInvalida(new RequestInvalida("ya_confirmada"))).toBe(true);
    expect(esRequestInvalida(Object.assign(new Error("x"), { name: "RequestInvalida", codigo: "ya_es_dueno" }))).toBe(true);
    expect(esRequestInvalida(Object.assign(new Error("x"), { name: "OtroError", codigo: "ya_es_dueno" }))).toBe(false);
    expect(esRequestInvalida(Object.assign(new Error("x"), { name: "RequestInvalida" }))).toBe(false);
    expect(esRequestInvalida("RequestInvalida")).toBe(false);
    expect(esRequestInvalida(null)).toBe(false);
  });
});

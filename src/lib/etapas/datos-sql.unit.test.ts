// @vitest-environment node
/**
 * Lo que `datos-sql.ts` le pide a la base y cómo traduce sus errores, sin base
 * (OPR-30 a OPR-32, spec §7.1): cada función SQL con sus argumentos en orden y el
 * actor de la transacción, y cada SQLSTATE de las funciones como su `EtapaInvalida`.
 * Los errores se reconocen por nombre, no con `instanceof`.
 */
import { describe, expect, it, vi } from "vitest";

import type { Actor, Tx } from "@/lib/db/pool";

import { crearDatosDeEtapas, type Ejecutar } from "./datos-sql";
import { esEtapaInvalida, EtapaInvalida, type CodigoEtapaInvalida } from "./tipos";

const REQUEST = "b0000000-0000-4000-8000-0000000000a4";
const ACTOR: Actor = { tipo: "operador", authUserId: "de000000-0000-4000-8000-0000000000a1" };
const ALERTA = {
  bzzzbxAlertId: "bx-alert-0006",
  ruleId: "MEC-003",
  ruleVersion: "1",
  level: "amber" as const,
  reasonText: "Running 45 min over the window.",
  openedAt: "2026-11-27T15:00:00.000Z",
};

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

const fallaCon = (error: Record<string, unknown>): Ejecutar => async () => {
  throw Object.assign(new Error("falla de la base"), error);
};

const sinEspacios = (sql: string) => sql.replace(/\s+/g, " ").trim();

describe("datos-sql de las etapas: las llamadas a las funciones SQL", () => {
  it("limpiarAlerta: clear_alert con la instantánea que leyó el servidor, el motivo y el actor; devuelve el id de la ocurrencia", async () => {
    const { ejecutar, consultas, opciones } = baseDeMentira([{ id: "oc-1" }]);
    const id = await crearDatosDeEtapas(ejecutar).limpiarAlerta({ requestId: REQUEST, version: "104", alerta: ALERTA, motivo: "Large unit." }, ACTOR);
    expect(id).toBe("oc-1");
    expect(sinEspacios(consultas[0]!.sql)).toBe(
      "select opsrun.clear_alert($1::uuid, $2::bigint, $3, $4, $5, $6::opsrun.alert_level, $7, $8::timestamptz, $9) as id",
    );
    expect(consultas[0]!.parametros).toEqual([REQUEST, "104", "bx-alert-0006", "MEC-003", "1", "amber", "Running 45 min over the window.", "2026-11-27T15:00:00.000Z", "Large unit."]);
    expect(opciones).toEqual([{ escritura: true, actor: ACTOR }]);
  });

  it("marcarOss: mark_oss con la marca como enum, la versión y el motivo", async () => {
    const { ejecutar, consultas, opciones } = baseDeMentira();
    await crearDatosDeEtapas(ejecutar).marcarOss({ requestId: REQUEST, marca: "not_oss", version: "9", motivo: null }, ACTOR);
    expect(sinEspacios(consultas[0]!.sql)).toBe("select opsrun.mark_oss($1::uuid, $2::opsrun.oss_mark, $3::bigint, $4)");
    expect(consultas[0]!.parametros).toEqual([REQUEST, "not_oss", "9", null]);
    expect(opciones).toEqual([{ escritura: true, actor: ACTOR }]);
  });

  it("aprobar: approve_job con la request y la versión", async () => {
    const { ejecutar, consultas, opciones } = baseDeMentira();
    await crearDatosDeEtapas(ejecutar).aprobar({ requestId: REQUEST, version: "9" }, ACTOR);
    expect(sinEspacios(consultas[0]!.sql)).toBe("select opsrun.approve_job($1::uuid, $2::bigint)");
    expect(consultas[0]!.parametros).toEqual([REQUEST, "9"]);
    expect(opciones).toEqual([{ escritura: true, actor: ACTOR }]);
  });

  it("capturarPo: enter_po con el PO y la versión", async () => {
    const { ejecutar, consultas } = baseDeMentira();
    await crearDatosDeEtapas(ejecutar).capturarPo({ requestId: REQUEST, poNumber: "PO-EX-0108", version: "9" }, ACTOR);
    expect(sinEspacios(consultas[0]!.sql)).toBe("select opsrun.enter_po($1::uuid, $2, $3::bigint)");
    expect(consultas[0]!.parametros).toEqual([REQUEST, "PO-EX-0108", "9"]);
  });

  it("validar: validate_job con lo que leyó el servidor (po_required y el PO de PINCH)", async () => {
    const { ejecutar, consultas } = baseDeMentira();
    await crearDatosDeEtapas(ejecutar).validar({ requestId: REQUEST, version: "9", poRequerido: true, poDelJob: null }, ACTOR);
    expect(sinEspacios(consultas[0]!.sql)).toBe("select opsrun.validate_job($1::uuid, $2::bigint, $3::boolean, $4)");
    expect(consultas[0]!.parametros).toEqual([REQUEST, "9", true, null]);
  });

  it("ninguna llamada manda nombres ni direcciones de PINCH: solo ids, versión, marca, PO y motivo", async () => {
    const { ejecutar, consultas } = baseDeMentira([{ id: "oc-1" }]);
    const datos = crearDatosDeEtapas(ejecutar);
    await datos.aprobar({ requestId: REQUEST, version: "1" }, ACTOR);
    await datos.marcarOss({ requestId: REQUEST, marca: "oss", version: "1", motivo: "Ok" }, ACTOR);
    expect(JSON.stringify(consultas.map((c) => c.parametros))).not.toMatch(/Demo|Example|Team|555/);
  });
});

describe("datos-sql de las etapas: errores de la base", () => {
  type Datos = ReturnType<typeof crearDatosDeEtapas>;
  const llamadas: Record<string, (d: Datos) => Promise<unknown>> = {
    limpiarAlerta: (d) => d.limpiarAlerta({ requestId: REQUEST, version: "1", alerta: ALERTA, motivo: "Ok" }, ACTOR),
    marcarOss: (d) => d.marcarOss({ requestId: REQUEST, marca: "oss", version: "1", motivo: null }, ACTOR),
    aprobar: (d) => d.aprobar({ requestId: REQUEST, version: "1" }, ACTOR),
    capturarPo: (d) => d.capturarPo({ requestId: REQUEST, poNumber: "PO-1", version: "1" }, ACTOR),
    validar: (d) => d.validar({ requestId: REQUEST, version: "1", poRequerido: false, poDelJob: null }, ACTOR),
  };

  it.each<[string, CodigoEtapaInvalida]>([
    ["OP006", "request_no_encontrada"],
    ["OP013", "cambio_concurrente"],
    ["OP019", "job_no_programado"],
    ["OP020", "alerta_no_limpiable"],
    ["OP021", "alerta_de_otro_job"],
    ["OP022", "alerta_ya_resuelta"],
    ["OP023", "ya_aprobado"],
    ["OP024", "sin_cambios"],
    ["OP025", "ya_validado"],
    ["OP026", "sin_aprobar"],
    ["OP027", "falta_po"],
    ["OP002", "dato_invalido"],
    ["22023", "dato_invalido"],
  ])("el código %s de la función es %s, en las cinco llamadas", async (code, codigo) => {
    for (const [nombre, llamar] of Object.entries(llamadas)) {
      const datos = crearDatosDeEtapas(fallaCon({ code }));
      await expect(llamar(datos), nombre).rejects.toMatchObject({ name: "EtapaInvalida", codigo });
    }
  });

  it.each(["42501", "57014", "23505", "23514", "XX000"])("%s sube tal cual: no es de la etapa inválida", async (code) => {
    const datos = crearDatosDeEtapas(fallaCon({ code }));
    for (const llamar of Object.values(llamadas)) await expect(llamar(datos)).rejects.toMatchObject({ code });
  });

  it("los errores se reconocen por nombre: uno de otra copia del módulo vale, y uno con otro nombre no", () => {
    expect(esEtapaInvalida(new EtapaInvalida("ya_aprobado"))).toBe(true);
    expect(esEtapaInvalida(Object.assign(new Error("x"), { name: "EtapaInvalida", codigo: "falta_po" }))).toBe(true);
    expect(esEtapaInvalida(Object.assign(new Error("x"), { name: "OtroError", codigo: "falta_po" }))).toBe(false);
    expect(esEtapaInvalida(Object.assign(new Error("x"), { name: "EtapaInvalida" }))).toBe(false);
    expect(esEtapaInvalida("EtapaInvalida")).toBe(false);
    expect(esEtapaInvalida(null)).toBe(false);
  });
});

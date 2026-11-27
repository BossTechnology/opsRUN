// @vitest-environment node
/**
 * Los ejecutores de Assign / Reassign y Confirm details, sender y cleaner
 * (OPR-28, spec §7): arman la llamada con la versión y el actor de la
 * transacción, traducen cada SQLSTATE por su código, rechazan sin llamar a la
 * base lo que viene mal formado y dejan subir lo demás. También, que pasan por
 * `ejecutarAccion` y que el registro real los tiene registrados.
 */
import { describe, expect, it, vi } from "vitest";

import { armarVentana } from "../ventana/armar";
import { CONFIRMACIONES_COMPLETAS, filaVentana, leidosVentanaDelFalso, OPERADORES_DE_PRUEBA, SIN_CONFIRMACIONES } from "../ventana/prueba-datos";
import { RequestInvalida, type CodigoRequestInvalida, type DatosDeRequests } from "../requests/tipos";

import { disponibilidadDe } from "./disponibilidad";
import { ejecutar } from "./ejecutar";
import { REGISTRO_DE_ACCIONES } from "./registro";
import {
  crearEjecutoresDeRequests,
  MENSAJE_SIN_METODO,
  MENSAJE_SIN_OPERADOR,
  MENSAJE_SIN_RESPUESTA,
  MENSAJES_DE_REQUESTS,
} from "./requests";
import type { ContextoAccion, EntradaAccion } from "./tipos";

const AHORA = new Date("2026-11-24T18:00:00Z");
const R2 = "b0000000-0000-4000-8000-0000000000a2";
const OPERADOR_DESTINO = "0a000000-0000-4000-8000-0000000000a2";
const RESPUESTA = "5c000000-0000-4000-8000-0000000000c1";
const ACTOR = { tipo: "operador", authUserId: "de000000-0000-4000-8000-0000000000a1" } as const;

function preparar() {
  const datos = {
    asignar: vi.fn(async () => {}),
    confirmarDetalles: vi.fn(async () => "conf-details"),
    confirmarSender: vi.fn(async () => "conf-sender"),
    confirmarCleaner: vi.fn(async () => "conf-cleaner"),
  } satisfies DatosDeRequests;
  const ejecutores = crearEjecutoresDeRequests(async () => datos);
  return { datos, ...ejecutores };
}

const ventanaDe = (n: number, confirmaciones = SIN_CONFIRMACIONES) =>
  armarVentana({
    fila: filaVentana(AHORA, n),
    leidos: leidosVentanaDelFalso(AHORA),
    hilos: [`bx-thread-000${n}`],
    operadores: OPERADORES_DE_PRUEBA,
    confirmaciones,
    instruccionAbierta: false,
    ahora: AHORA,
    zona: "UTC",
    bzzzbx: { disponible: true, actualizadoEn: AHORA.toISOString() },
    tab: null,
  });

const ventanaR2 = ventanaDe(2);
const ctx: ContextoAccion = { actor: ACTOR, ventana: ventanaR2 };
const entrada = (codigo: string, datos: Record<string, unknown>, motivo: string | null = null): EntradaAccion => ({
  requestId: R2,
  codigo,
  motivo,
  datos,
  version: ventanaR2.version,
});

/** Un error de la base como lo entrega `pg`: el SQLSTATE en `code`. */
const deLaBase = (code: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(`falla ${code}`), { code }, extra);

describe("assign: Assign / Reassign", () => {
  it("llama a la base con el operador, la versión, el motivo y el actor de la transacción", async () => {
    const { assign, datos } = preparar();
    expect(await assign(ctx, entrada("assign", { operator_id: OPERADOR_DESTINO }, "Covering the weekend"))).toEqual({ tipo: "guardada" });
    expect(datos.asignar).toHaveBeenCalledWith(
      { requestId: R2, operatorId: OPERADOR_DESTINO, version: ventanaR2.version, motivo: "Covering the weekend" },
      ACTOR,
    );
  });

  it("el motivo es opcional: sin él va null", async () => {
    const { assign, datos } = preparar();
    await assign(ctx, entrada("assign", { operator_id: OPERADOR_DESTINO }));
    expect(datos.asignar).toHaveBeenCalledWith(expect.objectContaining({ motivo: null }), ACTOR);
  });

  it.each([[{}], [{ operator_id: "" }], [{ operator_id: "   " }], [{ operator_id: 7 }], [{ operator_id: null }], [{ operator_id: "no-es-uuid" }]])(
    "sin un operador válido (%j) se rechaza sin llamar a la base",
    async (datosDeEntrada) => {
      const { assign, datos } = preparar();
      expect(await assign(ctx, entrada("assign", datosDeEntrada))).toEqual({
        tipo: "rechazada",
        codigo: "operador_no_elegido",
        mensaje: MENSAJE_SIN_OPERADOR,
      });
      expect(datos.asignar).not.toHaveBeenCalled();
    },
  );

  it.each<[string, CodigoRequestInvalida, string]>([
    ["OP006", "request_no_encontrada", "Job not found."],
    ["OP007", "request_no_abierta", "This request is not open anymore."],
    ["OP013", "cambio_concurrente", "This job changed. Review and try again."],
    ["OP014", "operador_invalido", "That operator is not active."],
    ["OP015", "ya_es_dueno", "That operator already owns this request."],
  ])("el SQLSTATE %s sale como %s, con el texto para el operador", async (_sqlstate, codigo, mensaje) => {
    const { assign, datos } = preparar();
    datos.asignar.mockRejectedValueOnce(new RequestInvalida(codigo));
    expect(await assign(ctx, entrada("assign", { operator_id: OPERADOR_DESTINO }))).toEqual({ tipo: "rechazada", codigo, mensaje });
    expect(MENSAJES_DE_REQUESTS[codigo]).toBe(mensaje);
  });

  it("un error de otra copia del módulo se reconoce por el nombre, no con instanceof", async () => {
    const { assign, datos } = preparar();
    datos.asignar.mockRejectedValueOnce(Object.assign(new Error("de otra copia"), { name: "RequestInvalida", codigo: "ya_es_dueno" }));
    expect(await assign(ctx, entrada("assign", { operator_id: OPERADOR_DESTINO }))).toMatchObject({ tipo: "rechazada", codigo: "ya_es_dueno" });
  });

  it("lo que no es de una request inválida sube: 42501 y la caída de la base", async () => {
    const { assign, datos } = preparar();
    datos.asignar.mockRejectedValueOnce(deLaBase("42501"));
    await expect(assign(ctx, entrada("assign", { operator_id: OPERADOR_DESTINO }))).rejects.toMatchObject({ code: "42501" });
    datos.asignar.mockRejectedValueOnce(new Error("conexión perdida"));
    await expect(assign(ctx, entrada("assign", { operator_id: OPERADOR_DESTINO }))).rejects.toThrow("conexión perdida");
  });
});

describe("confirm_details y confirm_sender", () => {
  it("confirm_details llama a la base con la versión que vio el operador y el actor", async () => {
    const { confirm_details, datos } = preparar();
    expect(await confirm_details(ctx, entrada("confirm_details", {}))).toEqual({ tipo: "guardada" });
    expect(datos.confirmarDetalles).toHaveBeenCalledWith({ requestId: R2, version: ventanaR2.version }, ACTOR);
  });

  it("confirm_sender llama a la base con la versión que vio el operador y el actor", async () => {
    const { confirm_sender, datos } = preparar();
    expect(await confirm_sender(ctx, entrada("confirm_sender", {}))).toEqual({ tipo: "guardada" });
    expect(datos.confirmarSender).toHaveBeenCalledWith({ requestId: R2, version: ventanaR2.version }, ACTOR);
  });

  it("no manda valores del navegador: lo que venga en datos no llega a la base", async () => {
    const { confirm_details, confirm_sender, datos } = preparar();
    await confirm_details(ctx, entrada("confirm_details", { bzzzbx_property_id: "bx-prop-9999", confirmed_value: { x: 1 } }));
    await confirm_sender(ctx, entrada("confirm_sender", { bzzzbx_customer_id: "bx-cust-9999" }));
    expect(JSON.stringify(datos.confirmarDetalles.mock.calls)).not.toContain("9999");
    expect(JSON.stringify(datos.confirmarSender.mock.calls)).not.toContain("9999");
  });

  it("ya_confirmada, cambio_concurrente y request_no_abierta salen con su texto", async () => {
    const { confirm_details, datos } = preparar();
    for (const [codigo, mensaje] of [
      ["ya_confirmada", "Already confirmed."],
      ["cambio_concurrente", "This job changed. Review and try again."],
      ["request_no_abierta", "This request is not open anymore."],
    ] as const) {
      datos.confirmarDetalles.mockRejectedValueOnce(new RequestInvalida(codigo));
      expect(await confirm_details(ctx, entrada("confirm_details", {}))).toEqual({ tipo: "rechazada", codigo, mensaje });
    }
  });

  it("faltan_datos dice lo que falta de los detalles, con lo que la ventana leyó", async () => {
    const { confirm_details, datos } = preparar();
    datos.confirmarDetalles.mockRejectedValueOnce(new RequestInvalida("faltan_datos"));
    const r1 = ventanaDe(1);
    expect(await confirm_details({ actor: ACTOR, ventana: r1 }, entrada("confirm_details", {}))).toEqual({
      tipo: "rechazada",
      codigo: "faltan_datos",
      mensaje: "Complete the details first: Service, Date, Window",
    });
    datos.confirmarDetalles.mockRejectedValueOnce(new RequestInvalida("faltan_datos"));
    expect(await confirm_details(ctx, entrada("confirm_details", {}))).toMatchObject({ mensaje: "Complete the details first." });
  });

  it("faltan_datos en sender dice el texto del bloqueo", async () => {
    const { confirm_sender, datos } = preparar();
    datos.confirmarSender.mockRejectedValueOnce(new RequestInvalida("faltan_datos"));
    expect(await confirm_sender(ctx, entrada("confirm_sender", {}))).toEqual({
      tipo: "rechazada",
      codigo: "faltan_datos",
      mensaje: "Choose who it is from first",
    });
  });

  it("42501 sube", async () => {
    const { confirm_sender, datos } = preparar();
    datos.confirmarSender.mockRejectedValueOnce(deLaBase("42501"));
    await expect(confirm_sender(ctx, entrada("confirm_sender", {}))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("confirm_cleaner: por teléfono o aceptando la respuesta", () => {
  it("phone: llama con el método y el motivo opcional, sin respuesta aunque venga una", async () => {
    const { confirm_cleaner, datos } = preparar();
    expect(await confirm_cleaner(ctx, entrada("confirm_cleaner", { method: "phone", cleaner_confirmation_id: RESPUESTA }, "Called and confirmed"))).toEqual({
      tipo: "guardada",
    });
    expect(datos.confirmarCleaner).toHaveBeenCalledWith(
      { requestId: R2, metodo: "phone", cleanerConfirmationId: null, version: ventanaR2.version, motivo: "Called and confirmed" },
      ACTOR,
    );
  });

  it("cleaner_text: pasa la respuesta elegida", async () => {
    const { confirm_cleaner, datos } = preparar();
    await confirm_cleaner(ctx, entrada("confirm_cleaner", { method: "cleaner_text", cleaner_confirmation_id: RESPUESTA }));
    expect(datos.confirmarCleaner).toHaveBeenCalledWith(
      { requestId: R2, metodo: "cleaner_text", cleanerConfirmationId: RESPUESTA, version: ventanaR2.version, motivo: null },
      ACTOR,
    );
  });

  it.each([[{}], [{ method: "" }], [{ method: "operator" }], [{ method: "email" }], [{ method: 3 }], [{ method: null }]])(
    "con un método que no es phone ni cleaner_text (%j) se rechaza sin llamar a la base",
    async (datosDeEntrada) => {
      const { confirm_cleaner, datos } = preparar();
      expect(await confirm_cleaner(ctx, entrada("confirm_cleaner", datosDeEntrada))).toEqual({
        tipo: "rechazada",
        codigo: "metodo_no_elegido",
        mensaje: MENSAJE_SIN_METODO,
      });
      expect(datos.confirmarCleaner).not.toHaveBeenCalled();
    },
  );

  it.each([[{}], [{ cleaner_confirmation_id: "" }], [{ cleaner_confirmation_id: 5 }], [{ cleaner_confirmation_id: "no-es-uuid" }]])(
    "cleaner_text sin una respuesta válida (%j) se rechaza sin llamar a la base",
    async (extra) => {
      const { confirm_cleaner, datos } = preparar();
      expect(await confirm_cleaner(ctx, entrada("confirm_cleaner", { method: "cleaner_text", ...extra }))).toEqual({
        tipo: "rechazada",
        codigo: "respuesta_no_elegida",
        mensaje: MENSAJE_SIN_RESPUESTA,
      });
      expect(datos.confirmarCleaner).not.toHaveBeenCalled();
    },
  );

  it("respuesta_invalida, faltan_datos y ya_confirmada salen con su texto", async () => {
    const { confirm_cleaner, datos } = preparar();
    for (const [codigo, mensaje] of [
      ["respuesta_invalida", "That reply can't confirm this cleaner."],
      ["faltan_datos", "Choose a cleaner first"],
      ["ya_confirmada", "Already confirmed."],
    ] as const) {
      datos.confirmarCleaner.mockRejectedValueOnce(new RequestInvalida(codigo));
      expect(await confirm_cleaner(ctx, entrada("confirm_cleaner", { method: "phone" }))).toEqual({ tipo: "rechazada", codigo, mensaje });
    }
  });

  it("42501 sube", async () => {
    const { confirm_cleaner, datos } = preparar();
    datos.confirmarCleaner.mockRejectedValueOnce(deLaBase("42501"));
    await expect(confirm_cleaner(ctx, entrada("confirm_cleaner", { method: "phone" }))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("los cuatro pasan por ejecutarAccion y el registro real los tiene", () => {
  const registro = (codigo: string) => REGISTRO_DE_ACCIONES.find((d) => d.codigo === codigo)!;

  it("están registrados con ejecutor, sin necesitar a BzzzBX y con la concurrencia de la request", () => {
    for (const codigo of ["assign", "confirm_details", "confirm_sender", "confirm_cleaner"]) {
      const def = registro(codigo);
      expect(def.ejecutor, codigo).toBeTypeOf("function");
      expect(def.necesitaBzzzbx, codigo).toBe(false);
      expect(def.concurrencia ?? "request", codigo).toBe("request");
      expect(def.etapas, codigo).toEqual(["requests"]);
    }
    expect(registro("assign").motivo).toBe("opcional");
    expect(registro("confirm_cleaner").motivo).toBe("opcional");
    expect(registro("confirm_details").motivo).toBe("no");
    expect(registro("confirm_sender").motivo).toBe("no");
  });

  it("en R2 con details y sender confirmados, Confirm details no corre: ejecutarAccion rechaza sin llamar al ejecutor", async () => {
    const v = ventanaDe(2, { details: true, sender: true, cleaner: false });
    expect(disponibilidadDe(registro("confirm_details"), v)).toEqual({ tipo: "bloqueada", motivo: "Already confirmed" });
    const ejecutor = vi.fn(async () => ({ tipo: "guardada" as const }));
    const registroDePrueba = REGISTRO_DE_ACCIONES.map((d) => (d.codigo === "confirm_details" ? { ...d, ejecutor } : d));
    const resultado = await ejecutar(
      { registro: registroDePrueba, leerVentana: async () => v, actor: async () => ACTOR, refrescar: async () => {} },
      { requestId: R2, codigo: "confirm_details", motivo: null, datos: {}, version: v.version },
    );
    expect(resultado).toEqual({ tipo: "rechazada", codigo: "no_disponible", mensaje: "Already confirmed" });
    expect(ejecutor).not.toHaveBeenCalled();
  });

  it("una versión vieja se rechaza por cambio concurrente antes de llamar al ejecutor", async () => {
    const v = ventanaDe(2);
    const ejecutor = vi.fn(async () => ({ tipo: "guardada" as const }));
    const registroDePrueba = REGISTRO_DE_ACCIONES.map((d) => (d.codigo === "confirm_details" ? { ...d, ejecutor } : d));
    const resultado = await ejecutar(
      { registro: registroDePrueba, leerVentana: async () => v, actor: async () => ACTOR, refrescar: async () => {} },
      { requestId: R2, codigo: "confirm_details", motivo: null, datos: {}, version: "1" },
    );
    expect(resultado).toEqual({ tipo: "rechazada", codigo: "cambio_concurrente", mensaje: "This job changed. Review and try again." });
    expect(ejecutor).not.toHaveBeenCalled();
  });

  it("un 42501 del ejecutor sale como 'Something went wrong. Try again.' y se refresca", async () => {
    const v = ventanaDe(2);
    const refrescar = vi.fn(async () => {});
    const registroDePrueba = REGISTRO_DE_ACCIONES.map((d) =>
      d.codigo === "assign" ? { ...d, ejecutor: async () => Promise.reject(deLaBase("42501")) } : d,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const resultado = await ejecutar(
      { registro: registroDePrueba, leerVentana: async () => v, actor: async () => ACTOR, refrescar },
      { requestId: R2, codigo: "assign", motivo: null, datos: { operator_id: OPERADOR_DESTINO }, version: v.version },
    );
    expect(resultado).toEqual({ tipo: "rechazada", codigo: "error", mensaje: "Something went wrong. Try again." });
    expect(refrescar).toHaveBeenCalled();
  });

  it("el motivo de Assign se recorta y va al ejecutor; el de Confirm details no existe y no llega", async () => {
    const v = ventanaDe(2);
    const vistos: Record<string, string | null> = {};
    const registroDePrueba = REGISTRO_DE_ACCIONES.map((d) =>
      d.codigo === "assign" || d.codigo === "confirm_sender"
        ? {
            ...d,
            ejecutor: async (_: ContextoAccion, e: EntradaAccion) => {
              vistos[d.codigo] = e.motivo;
              return { tipo: "guardada" as const };
            },
          }
        : d,
    );
    const deps = { registro: registroDePrueba, leerVentana: async () => v, actor: async () => ACTOR, refrescar: async () => {} };
    await ejecutar(deps, { requestId: R2, codigo: "assign", motivo: "  Covering  ", datos: { operator_id: OPERADOR_DESTINO }, version: v.version });
    await ejecutar(deps, { requestId: R2, codigo: "confirm_sender", motivo: "se ignora", datos: {}, version: v.version });
    expect(vistos).toEqual({ assign: "Covering", confirm_sender: null });
  });
});

describe("las confirmaciones de la ventana siguen siendo las del gate", () => {
  it("con las tres vigentes, ninguna de las tres Confirm corre", () => {
    const v = ventanaDe(2, CONFIRMACIONES_COMPLETAS);
    for (const codigo of ["confirm_details", "confirm_sender", "confirm_cleaner"]) {
      const def = REGISTRO_DE_ACCIONES.find((d) => d.codigo === codigo)!;
      expect(disponibilidadDe(def, v)).toEqual({ tipo: "bloqueada", motivo: "Already confirmed" });
    }
  });
});

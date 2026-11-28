// @vitest-environment node
/**
 * El ejecutor de Accept, Change y Reject (OPR-36, spec §8.3, §10.2 y §15.2): arma la llamada con la
 * versión y el actor de la transacción, traduce cada SQLSTATE por su código, rechaza sin llamar a la
 * base lo que viene sin decisión o con un valor final de forma inválida y deja subir lo demás
 * (42501 incluido). También, que pasa por `ejecutarAccion`, que no sale en la action bar y que la
 * decisión del operador corre con BzzzBX caído.
 */
import { describe, expect, it, vi } from "vitest";

import { armarIa } from "../analisis-ia/armar";
import { DecisionInvalida, MENSAJES_DE_DECISION, type CodigoDeDecisionInvalida, type DatosDeDecision } from "../analisis-ia/decidir";
import { crearDatosDeDecision } from "../analisis-ia/decidir-sql";
import { armarVentana } from "../ventana/armar";
import { CONFIRMACIONES_COMPLETAS, filaVentana, leidosVentanaDelFalso, OPERADORES_DE_PRUEBA, SIN_CONFIRMACIONES } from "../ventana/prueba-datos";

import { accionesVisibles, disponibilidadDe } from "./disponibilidad";
import { ejecutar } from "./ejecutar";
import { crearEjecutoresDeIa, MENSAJE_SIN_DECISION, MENSAJE_SIN_SUGERENCIA, MENSAJE_SIN_VALOR, MENSAJE_VALOR_INVALIDO } from "./ia";
import { REGISTRO_DE_ACCIONES } from "./registro";
import type { ContextoAccion, EntradaAccion } from "./tipos";

const AHORA = new Date("2026-11-24T18:00:00Z");
const R2 = "b0000000-0000-4000-8000-0000000000a2";
const SUG = "5a000000-0000-4000-8000-0000000000e1";
const ACTOR = { tipo: "operador", authUserId: "de000000-0000-4000-8000-0000000000a1" } as const;

function preparar() {
  const datos = { decidir: vi.fn(async () => {}) } satisfies DatosDeDecision;
  return { datos, ...crearEjecutoresDeIa(async () => datos) };
}

function ventanaConIa(opciones: { disponible?: boolean } = {}) {
  const fila = { ...filaVentana(AHORA, 2), status: "open" as const, beds: 2 };
  const ia = armarIa({
    borrador: fila,
    analisis: { id: "an-1", estado: "completed", requested_at: AHORA.toISOString(), completed_at: AHORA.toISOString() },
    sugerencias: [{ id: SUG, campo: "beds", rank: 1, valor: 3, razon: "Three bedrooms." }],
    nombres: {},
  });
  return {
    ...armarVentana({
      fila,
      leidos: leidosVentanaDelFalso(AHORA),
      hilos: ["bx-thread-0002"],
      operadores: OPERADORES_DE_PRUEBA,
      confirmaciones: SIN_CONFIRMACIONES,
      instruccionAbierta: false,
      ahora: AHORA,
      zona: "UTC",
      bzzzbx: { disponible: opciones.disponible ?? true, actualizadoEn: AHORA.toISOString() },
      tab: null,
      ia,
    }),
  };
}

const ventana = ventanaConIa();
const ctx: ContextoAccion = { actor: ACTOR, ventana };
const entrada = (datos: Record<string, unknown>, motivo: string | null = null): EntradaAccion => ({
  requestId: R2,
  codigo: "decide_ai_suggestion",
  motivo,
  datos,
  version: ventana.version,
});

const deLaBase = (code: string) => Object.assign(new Error(`falla ${code}`), { code });

describe("decide_ai_suggestion", () => {
  it("Accept llama a la base con la versión que vio el operador, el actor de la transacción y sin valor final", async () => {
    const { datos, decide_ai_suggestion } = preparar();
    expect(await decide_ai_suggestion(ctx, entrada({ suggestion_id: SUG, decision: "accepted" }, "Looks right."))).toEqual({ tipo: "guardada" });
    expect(datos.decidir).toHaveBeenCalledWith(
      { suggestionId: SUG, decision: "accepted", version: ventana.version, finalValue: null, motivo: "Looks right." },
      ACTOR,
    );
  });

  it("Change manda el valor final con la forma del campo; Reject, ninguno", async () => {
    const { datos, decide_ai_suggestion } = preparar();
    await decide_ai_suggestion(ctx, entrada({ suggestion_id: SUG, decision: "corrected", final_value: 2 }));
    await decide_ai_suggestion(ctx, entrada({ suggestion_id: SUG, decision: "rejected", final_value: 99 }));
    expect(datos.decidir).toHaveBeenNthCalledWith(1, expect.objectContaining({ decision: "corrected", finalValue: 2 }), ACTOR);
    expect(datos.decidir).toHaveBeenNthCalledWith(2, expect.objectContaining({ decision: "rejected", finalValue: null }), ACTOR);
  });

  it.each([
    ["sin sugerencia", {}, "sugerencia_no_elegida", MENSAJE_SIN_SUGERENCIA],
    ["con un id que no es uuid", { suggestion_id: "no-es-uuid", decision: "accepted" }, "sugerencia_no_elegida", MENSAJE_SIN_SUGERENCIA],
    ["sin decisión", { suggestion_id: SUG }, "decision_no_elegida", MENSAJE_SIN_DECISION],
    ["con una decisión que no existe", { suggestion_id: SUG, decision: "superseded" }, "decision_no_elegida", MENSAJE_SIN_DECISION],
    ["corrected sin valor", { suggestion_id: SUG, decision: "corrected" }, "valor_no_puesto", MENSAJE_SIN_VALOR],
    ["corrected con un valor de otra forma", { suggestion_id: SUG, decision: "corrected", final_value: "tres" }, "decision_invalida", MENSAJE_VALOR_INVALIDO],
    ["corrected con camas fuera de rango", { suggestion_id: SUG, decision: "corrected", final_value: 99 }, "decision_invalida", MENSAJE_VALOR_INVALIDO],
  ])("%s se rechaza sin llamar a la base", async (_nombre, datosDeEntrada, codigo, mensaje) => {
    const { datos, decide_ai_suggestion } = preparar();
    expect(await decide_ai_suggestion(ctx, entrada(datosDeEntrada))).toEqual({ tipo: "rechazada", codigo, mensaje });
    expect(datos.decidir).not.toHaveBeenCalled();
  });

  it.each(Object.entries(MENSAJES_DE_DECISION) as [CodigoDeDecisionInvalida, string][])("el error %s sale como su mensaje", async (codigo, mensaje) => {
    const { datos, decide_ai_suggestion } = preparar();
    datos.decidir.mockRejectedValueOnce(new DecisionInvalida(codigo));
    expect(await decide_ai_suggestion(ctx, entrada({ suggestion_id: SUG, decision: "accepted" }))).toEqual({ tipo: "rechazada", codigo, mensaje });
  });

  it("los mensajes son los de §8.3", () => {
    expect(MENSAJES_DE_DECISION).toEqual({
      request_no_encontrada: "Job not found.",
      request_no_abierta: "This request is not open anymore.",
      cambio_concurrente: "This job changed. Review and try again.",
      sugerencia_no_encontrada: "That AI suggestion is gone. Refresh and try again.",
      ya_decidida: "Someone already decided this.",
      decision_invalida: "That value can't be saved.",
    });
  });

  it("un error inesperado (42501 incluido) sube para que ejecutarAccion lo registre", async () => {
    const { datos, decide_ai_suggestion } = preparar();
    datos.decidir.mockRejectedValueOnce(deLaBase("42501"));
    await expect(decide_ai_suggestion(ctx, entrada({ suggestion_id: SUG, decision: "accepted" }))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("crearDatosDeDecision: cada SQLSTATE sale como su código", () => {
  const llamar = (code: string) => {
    const datos = crearDatosDeDecision(async () => {
      throw deLaBase(code);
    });
    return datos.decidir({ suggestionId: SUG, decision: "accepted", version: "1", finalValue: null, motivo: null }, ACTOR);
  };

  it.each([
    ["OP006", "request_no_encontrada"],
    ["OP007", "request_no_abierta"],
    ["OP013", "cambio_concurrente"],
    ["OP045", "sugerencia_no_encontrada"],
    ["OP047", "ya_decidida"],
    ["OP048", "decision_invalida"],
  ])("%s es %s", async (sqlstate, codigo) => {
    await expect(llamar(sqlstate)).rejects.toMatchObject({ name: "DecisionInvalida", codigo });
  });

  it("42501 y lo demás suben tal cual", async () => {
    await expect(llamar("42501")).rejects.toMatchObject({ code: "42501" });
    await expect(llamar("08006")).rejects.toMatchObject({ code: "08006" });
  });

  it("escribe con el actor y manda el valor final como json", async () => {
    const consultas: { sql: string; valores: unknown[]; escritura: boolean | undefined; actor: unknown }[] = [];
    const datos = crearDatosDeDecision(async (fn, opciones) =>
      fn({
        query: async (sql: string, valores: unknown[]) => {
          consultas.push({ sql, valores, escritura: opciones?.escritura, actor: opciones?.actor });
          return { rows: [] };
        },
      } as never),
    );
    await datos.decidir({ suggestionId: SUG, decision: "corrected", version: "7", finalValue: { start: "09:00", end: "12:00" }, motivo: "Called." }, ACTOR);
    expect(consultas).toEqual([
      {
        sql: expect.stringContaining("opsrun.decide_ai_suggestion"),
        valores: [SUG, "corrected", "7", '{"start":"09:00","end":"12:00"}', "Called."],
        escritura: true,
        actor: ACTOR,
      },
    ]);
  });
});

describe("en el registro y por ejecutarAccion", () => {
  const def = REGISTRO_DE_ACCIONES.find((d) => d.codigo === "decide_ai_suggestion")!;

  it("está registrada como interna, de Requests, con motivo opcional, sin necesitar BzzzBX y con la concurrencia por defecto", () => {
    expect(def).toMatchObject({ interna: true, etapas: ["requests"], enRelease: true, motivo: "opcional", necesitaBzzzbx: false });
    expect(def.concurrencia).toBeUndefined();
    expect(def.ejecutor).toBeTypeOf("function");
  });

  it("no sale en la action bar", () => {
    expect(accionesVisibles(ventana).map((a) => a.codigo)).not.toContain("decide_ai_suggestion");
  });

  it("está disponible en Requests aunque BzzzBX esté caído, y no aplica en las demás etapas", () => {
    expect(disponibilidadDe(def, ventana)).toEqual({ tipo: "disponible" });
    expect(disponibilidadDe(def, ventanaConIa({ disponible: false }))).toEqual({ tipo: "disponible" });
    const scheduled = armarVentana({
      fila: filaVentana(AHORA, 3),
      leidos: leidosVentanaDelFalso(AHORA),
      hilos: ["bx-thread-0003"],
      operadores: OPERADORES_DE_PRUEBA,
      confirmaciones: CONFIRMACIONES_COMPLETAS,
      instruccionAbierta: false,
      ahora: AHORA,
      zona: "UTC",
      bzzzbx: { disponible: true, actualizadoEn: AHORA.toISOString() },
      tab: null,
    });
    expect(disponibilidadDe(def, scheduled)).toEqual({ tipo: "no_aplica" });
  });

  it("por ejecutarAccion: una versión vieja se rechaza antes de llegar a la base, con el mensaje de OPR-28", async () => {
    const datos = { decidir: vi.fn(async () => {}) } satisfies DatosDeDecision;
    const registro = [{ ...def, ejecutor: crearEjecutoresDeIa(async () => datos).decide_ai_suggestion }];
    const deps = { registro, leerVentana: async () => ventana, actor: async () => ACTOR, refrescar: vi.fn(async () => {}) };
    const vieja = await ejecutar(deps, { ...entrada({ suggestion_id: SUG, decision: "accepted" }), version: "1" });
    expect(vieja).toEqual({ tipo: "rechazada", codigo: "cambio_concurrente", mensaje: "This job changed. Review and try again." });
    expect(datos.decidir).not.toHaveBeenCalled();
    const buena = await ejecutar(deps, entrada({ suggestion_id: SUG, decision: "accepted" }));
    expect(buena).toEqual({ tipo: "guardada" });
    expect(deps.refrescar).toHaveBeenCalledTimes(1);
  });

  it("por ejecutarAccion: sin operador (un proceso del sistema) no corre", async () => {
    const datos = { decidir: vi.fn(async () => {}) } satisfies DatosDeDecision;
    const registro = [{ ...def, ejecutor: crearEjecutoresDeIa(async () => datos).decide_ai_suggestion }];
    const deps = { registro, leerVentana: async () => ventana, actor: async () => null, refrescar: vi.fn(async () => {}) };
    expect(await ejecutar(deps, entrada({ suggestion_id: SUG, decision: "accepted" }))).toMatchObject({ tipo: "rechazada", codigo: "sin_actor" });
    expect(datos.decidir).not.toHaveBeenCalled();
  });
});

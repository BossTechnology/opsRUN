// @vitest-environment node
/**
 * Los ejecutores de la conversación (spec OPR-27 §5.3 a §5.5 y §11.1): el
 * payload lleva solo el crosswalk ID y el cuerpo, nunca una dirección ni un
 * teléfono; lo que no corre no toca la base ni el puerto; y los envíos piden su
 * entrega solo después de guardarse.
 */
import { describe, expect, it, vi } from "vitest";

import type { ContextoAccion, EntradaAccion } from "../acciones/tipos";
import { BzzzbxNoDisponible } from "../bzzzbx/errores";
import { armarVentana } from "../ventana/armar";
import { CONFIRMACIONES_COMPLETAS, filaVentana, leidosVentanaDelFalso, OPERADORES_DE_PRUEBA } from "../ventana/prueba-datos";

import { crearEjecutoresDeConversacion, type DependenciasDeEnvio } from "./ejecutores";

const AHORA = new Date("2026-11-24T18:00:00Z");
const R2 = "b0000000-0000-4000-8000-0000000000a2";
const OPERADOR = { tipo: "operador", authUserId: "de000000-0000-4000-8000-0000000000a1" } as const;
const CLAVE = "msg-0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const BORRADOR = "5a000000-0000-4000-8000-0000000000d2";

function ventana(n = 2) {
  return armarVentana({
    fila: filaVentana(AHORA, n),
    leidos: leidosVentanaDelFalso(AHORA),
    hilos: [`bx-thread-000${n}`],
    operadores: OPERADORES_DE_PRUEBA,
    confirmaciones: CONFIRMACIONES_COMPLETAS,
    instruccionAbierta: false,
    ahora: AHORA,
    zona: "UTC",
    bzzzbx: { disponible: true, actualizadoEn: AHORA.toISOString() },
    tab: null,
  });
}

const ctx = (parche: Partial<ContextoAccion> = {}): ContextoAccion => ({ actor: OPERADOR, ventana: ventana(), ...parche });
const entrada = (codigo: string, datos: Record<string, unknown>): EntradaAccion => ({ requestId: R2, codigo, motivo: null, datos, version: "102" });

type Llamada = { sql: string; parametros: unknown[] };

function montar(parche: Partial<DependenciasDeEnvio> = {}) {
  const llamadas: Llamada[] = [];
  const deps = {
    escribir: vi.fn(async (_actor, fn) => fn({ query: async (sql: string, parametros: unknown[] = []) => (llamadas.push({ sql, parametros }), { rows: [] }) } as never)),
    equipo: vi.fn(async (id: string) => ({ bzzzbx_team_id: id, name: "Team Alpha", phone: "+1 555 0111", active: true, available_dates: [] })),
    entregar: vi.fn(),
    ...parche,
  } satisfies DependenciasDeEnvio;
  return { deps, llamadas, ejecutores: crearEjecutoresDeConversacion(deps) };
}

/** Un error de Postgres tal como lo trae `pg`: con `code`. */
const errorSql = (code: string) => Object.assign(new Error("db error"), { code });

describe("add_note", () => {
  it("escribe la nota por opsrun.add_note con el actor, y devuelve guardada", async () => {
    const { deps, llamadas, ejecutores } = montar();
    const r = await ejecutores.add_note(ctx(), entrada("add_note", { body: "  Requester prefers mornings. " }));
    expect(r).toEqual({ tipo: "guardada" });
    expect(deps.escribir).toHaveBeenCalledWith(OPERADOR, expect.any(Function));
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]!.sql).toContain("opsrun.add_note");
    expect(llamadas[0]!.parametros).toEqual([R2, "Requester prefers mornings."]);
    expect(deps.entregar).not.toHaveBeenCalled();
  });

  it.each(["", "   ", "x".repeat(4001), null, 5])("un cuerpo que no sirve (%j) se rechaza sin tocar la base", async (body) => {
    const { deps, ejecutores } = montar();
    const r = await ejecutores.add_note(ctx(), entrada("add_note", { body }));
    expect(r).toMatchObject({ tipo: "rechazada", codigo: "cuerpo_invalido" });
    expect(deps.escribir).not.toHaveBeenCalled();
  });
});

describe("send_email", () => {
  const datos = { body: " Scheduled for Friday. ", idempotency_key: CLAVE };

  it("guarda el correo en el hilo del original con solo el hilo, el cuerpo y la clave; pide la entrega después", async () => {
    const { deps, llamadas, ejecutores } = montar();
    const r = await ejecutores.send_email(ctx(), entrada("send_email", datos));
    expect(r).toEqual({ tipo: "instruccion", idempotency_key: CLAVE });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]!.sql).toContain("opsrun.send_email");
    expect(llamadas[0]!.parametros).toEqual([R2, "bx-thread-0002", "Scheduled for Friday.", CLAVE, null]);
    expect(deps.entregar).toHaveBeenCalledExactlyOnceWith(CLAVE);
    // Primero se guarda, después se entrega.
    const orden = (f: unknown) => (f as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    expect(orden(deps.escribir)).toBeLessThan(orden(deps.entregar));
  });

  it("nunca manda una dirección: los parámetros de la base no traen ninguna", async () => {
    const { llamadas, ejecutores } = montar();
    await ejecutores.send_email(ctx(), entrada("send_email", datos));
    expect(JSON.stringify(llamadas)).not.toMatch(/@/);
  });

  it("con un borrador de IA, pasa su id para que la función lo decida", async () => {
    const { llamadas, ejecutores } = montar();
    await ejecutores.send_email(ctx(), entrada("send_email", { ...datos, ai_suggestion_id: BORRADOR }));
    expect(llamadas[0]!.parametros[4]).toBe(BORRADOR);
  });

  it.each([
    ["sin clave de idempotencia", { body: "Hola" }],
    ["con una clave mal formada", { body: "Hola", idempotency_key: "x y" }],
    ["con un cuerpo vacío", { body: "  ", idempotency_key: CLAVE }],
    ["con un cuerpo pasado del límite", { body: "x".repeat(10_001), idempotency_key: CLAVE }],
    ["con un borrador que no es un uuid", { body: "Hola", idempotency_key: CLAVE, ai_suggestion_id: "no" }],
  ])("%s se rechaza sin tocar la base ni pedir entrega", async (_caso, d) => {
    const { deps, ejecutores } = montar();
    const r = await ejecutores.send_email(ctx(), entrada("send_email", d));
    expect(r.tipo).toBe("rechazada");
    expect(deps.escribir).not.toHaveBeenCalled();
    expect(deps.entregar).not.toHaveBeenCalled();
  });

  it("sin hilo de correo se rechaza", async () => {
    const { deps, ejecutores } = montar();
    const sinHilo = { ...ventana(), hilos: [] };
    const r = await ejecutores.send_email(ctx({ ventana: sinHilo }), entrada("send_email", datos));
    expect(r).toMatchObject({ tipo: "rechazada", codigo: "no_disponible" });
    expect(deps.escribir).not.toHaveBeenCalled();
  });

  it.each([
    ["OP009", "hilo_invalido"],
    ["OP010", "borrador_invalido"],
    ["OP012", "clave_repetida"],
    ["OP006", "no_encontrada"],
    ["22023", "cuerpo_invalido"],
    ["42501", "sin_actor"],
  ])("el error SQL %s sale como %s y no pide entrega", async (code, esperado) => {
    const { deps, ejecutores } = montar({ escribir: vi.fn(async () => Promise.reject(errorSql(code))) });
    const r = await ejecutores.send_email(ctx(), entrada("send_email", datos));
    expect(r).toMatchObject({ tipo: "rechazada", codigo: esperado });
    expect(deps.entregar).not.toHaveBeenCalled();
  });

  it("un error desconocido se relanza para que ejecutarAccion no lo filtre al navegador", async () => {
    const { ejecutores } = montar({ escribir: vi.fn(async () => Promise.reject(new Error("connection refused"))) });
    await expect(ejecutores.send_email(ctx(), entrada("send_email", datos))).rejects.toThrow("connection refused");
  });
});

describe("send_text", () => {
  const datos = { body: "Can you confirm?", idempotency_key: CLAVE };

  it("guarda el texto con solo el equipo del job (de la ventana, no del navegador) y el cuerpo", async () => {
    const { deps, llamadas, ejecutores } = montar();
    const r = await ejecutores.send_text(ctx(), entrada("send_text", { ...datos, bzzzbx_team_id: "bx-team-9999" }));
    expect(r).toEqual({ tipo: "instruccion", idempotency_key: CLAVE });
    expect(llamadas[0]!.sql).toContain("opsrun.send_text");
    expect(llamadas[0]!.parametros).toEqual([R2, "bx-team-0001", "Can you confirm?", CLAVE, null]);
    expect(deps.equipo).toHaveBeenCalledWith("bx-team-0001");
    expect(deps.entregar).toHaveBeenCalledExactlyOnceWith(CLAVE);
    expect(JSON.stringify(llamadas)).not.toMatch(/\+1 555|@/);
  });

  it("sin cleaner se rechaza sin tocar la base", async () => {
    const { deps, ejecutores } = montar();
    const r = await ejecutores.send_text(ctx({ ventana: { ...ventana(), equipoId: null } }), entrada("send_text", datos));
    expect(r).toMatchObject({ tipo: "rechazada", codigo: "no_disponible", mensaje: "Choose a cleaner first" });
    expect(deps.equipo).not.toHaveBeenCalled();
    expect(deps.escribir).not.toHaveBeenCalled();
  });

  it("un equipo que BzzzBX no conoce se rechaza; con BzzzBX caído, también, y se reconoce por nombre", async () => {
    const desconocido = montar({ equipo: vi.fn(async () => null) });
    expect(await desconocido.ejecutores.send_text(ctx(), entrada("send_text", datos))).toMatchObject({ tipo: "rechazada", codigo: "no_disponible" });
    expect(desconocido.deps.escribir).not.toHaveBeenCalled();

    // Una clase de otra copia del módulo: solo el nombre coincide.
    class OtraCopia extends Error {
      name = "BzzzbxNoDisponible";
    }
    for (const error of [new BzzzbxNoDisponible(), new OtraCopia("caído")]) {
      const caido = montar({ equipo: vi.fn(async () => Promise.reject(error)) });
      expect(await caido.ejecutores.send_text(ctx(), entrada("send_text", datos))).toEqual({
        tipo: "rechazada",
        codigo: "no_disponible",
        mensaje: "BzzzBX unavailable",
      });
      expect(caido.deps.escribir).not.toHaveBeenCalled();
    }
  });

  it("un cuerpo pasado del límite del texto (1 600) se rechaza", async () => {
    const { deps, ejecutores } = montar();
    const r = await ejecutores.send_text(ctx(), entrada("send_text", { ...datos, body: "x".repeat(1601) }));
    expect(r).toMatchObject({ tipo: "rechazada", codigo: "cuerpo_invalido" });
    expect(deps.escribir).not.toHaveBeenCalled();
  });
});

describe("discard_ai_draft", () => {
  it("descarta el borrador por opsrun.discard_ai_draft y no pide ninguna entrega", async () => {
    const { deps, llamadas, ejecutores } = montar();
    const r = await ejecutores.discard_ai_draft(ctx(), entrada("discard_ai_draft", { ai_suggestion_id: BORRADOR }));
    expect(r).toEqual({ tipo: "guardada" });
    expect(llamadas[0]!.sql).toContain("opsrun.discard_ai_draft");
    expect(llamadas[0]!.parametros).toEqual([BORRADOR]);
    expect(deps.entregar).not.toHaveBeenCalled();
  });

  it("sin un uuid se rechaza, y un borrador que ya no sirve sale como borrador_invalido", async () => {
    const { deps, ejecutores } = montar();
    expect(await ejecutores.discard_ai_draft(ctx(), entrada("discard_ai_draft", {}))).toMatchObject({ codigo: "entrada_invalida" });
    expect(deps.escribir).not.toHaveBeenCalled();
    const roto = montar({ escribir: vi.fn(async () => Promise.reject(errorSql("OP010"))) });
    expect(await roto.ejecutores.discard_ai_draft(ctx(), entrada("discard_ai_draft", { ai_suggestion_id: BORRADOR }))).toMatchObject({ codigo: "borrador_invalido" });
  });
});

describe("guard 'nada sale solo' (a): un actor que no es un operador no escribe ni entrega", () => {
  const SISTEMA = { tipo: "sistema", proceso: "reconciliador" } as never;

  it.each([
    ["add_note", { body: "Hola" }],
    ["send_email", { body: "Hola", idempotency_key: CLAVE }],
    ["send_text", { body: "Hola", idempotency_key: CLAVE }],
    ["discard_ai_draft", { ai_suggestion_id: BORRADOR }],
  ] as const)("%s con un actor de sistema se rechaza sin llamar a la base ni al puerto", async (codigo, datos) => {
    const { deps, ejecutores } = montar();
    const r = await ejecutores[codigo](ctx({ actor: SISTEMA }), entrada(codigo, datos));
    expect(r).toMatchObject({ tipo: "rechazada", codigo: "sin_actor" });
    expect(deps.escribir).not.toHaveBeenCalled();
    expect(deps.equipo).not.toHaveBeenCalled();
    expect(deps.entregar).not.toHaveBeenCalled();
  });
});

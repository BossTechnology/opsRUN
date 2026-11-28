// @vitest-environment node
/**
 * Los envíos con plantilla (spec OPR-18 §8.3 y §10.2): `send_email` y `send_text` pasan `template_key` y
 * `template_version` a la función SQL como parámetros 6 y 7 (el payload no los lleva), comprueban en el servidor,
 * antes de tocar la base, que la plantilla es del catálogo, del modo y de la etapa, y traducen OP055 y OP056. Sin
 * plantilla, la llamada es la de antes.
 */
import { describe, expect, it, vi } from "vitest";

import type { ContextoAccion, EntradaAccion } from "../acciones/tipos";
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
const enEtapa = (etapa: string) => ctx({ ventana: { ...ventana(), etapa } as never });
const entrada = (codigo: string, datos: Record<string, unknown>): EntradaAccion => ({ requestId: R2, codigo, motivo: null, datos, version: "102" });
const errorSql = (code: string) => Object.assign(new Error("db error"), { code });

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

const CORREO = { body: "Your cleaning at Sample Court Unit 12 is scheduled for Wed, Nov 25, 9:00 AM–12:00 PM.", idempotency_key: CLAVE };
const TEXTO = { body: "New job: Sample Court Unit 12 on Wed, Nov 25, 9:00 AM–12:00 PM. Can you confirm?", idempotency_key: CLAVE };

describe("send_text y send_email con plantilla", () => {
  it("send_text pasa la clave y la versión como parámetros 6 y 7", async () => {
    const { llamadas, ejecutores, deps } = montar();
    const r = await ejecutores.send_text(ctx(), entrada("send_text", { ...TEXTO, template_key: "cleaner_confirmation_request", template_version: 1 }));
    expect(r).toEqual({ tipo: "instruccion", idempotency_key: CLAVE });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]!.sql).toMatch(/opsrun\.send_text\(\$1::uuid, \$2::text, \$3::text, \$4::text, \$5::uuid, \$6::text, \$7::integer\)/);
    expect(llamadas[0]!.parametros).toEqual([R2, "bx-team-0001", TEXTO.body, CLAVE, null, "cleaner_confirmation_request", 1]);
    expect(deps.entregar).toHaveBeenCalledExactlyOnceWith(CLAVE);
  });

  it("send_email, en Scheduled o después, igual", async () => {
    const { llamadas, ejecutores } = montar();
    const r = await ejecutores.send_email(enEtapa("scheduled"), entrada("send_email", { ...CORREO, template_key: "requester_scheduled", template_version: 1 }));
    expect(r).toEqual({ tipo: "instruccion", idempotency_key: CLAVE });
    expect(llamadas[0]!.sql).toMatch(/opsrun\.send_email\(\$1::uuid, \$2::text, \$3::text, \$4::text, \$5::uuid, \$6::text, \$7::integer\)/);
    expect(llamadas[0]!.parametros).toEqual([R2, "bx-thread-0002", CORREO.body, CLAVE, null, "requester_scheduled", 1]);
  });

  it("Done notice solo desde Validation", async () => {
    const { llamadas, ejecutores } = montar();
    const r = await ejecutores.send_email(enEtapa("validation"), entrada("send_email", { body: "The cleaning at Sample Court Unit 12 is done.", idempotency_key: CLAVE, template_key: "requester_done", template_version: 1 }));
    expect(r.tipo).toBe("instruccion");
    expect(llamadas[0]!.parametros.slice(5)).toEqual(["requester_done", 1]);
  });

  it("sin plantilla, la llamada es exactamente la de antes (cinco parámetros)", async () => {
    const { llamadas, ejecutores } = montar();
    await ejecutores.send_text(ctx(), entrada("send_text", TEXTO));
    await ejecutores.send_email(ctx(), entrada("send_email", CORREO));
    expect(llamadas.map((l) => l.parametros.length)).toEqual([5, 5]);
    expect(llamadas[0]!.sql).toContain("$5::uuid)");
    expect(llamadas[0]!.sql).not.toContain("$6");
  });

  it("un borrador de IA y una plantilla pueden ir juntos", async () => {
    const { llamadas, ejecutores } = montar();
    await ejecutores.send_text(ctx(), entrada("send_text", { ...TEXTO, ai_suggestion_id: BORRADOR, template_key: "cleaner_confirmation_request", template_version: 1 }));
    expect(llamadas[0]!.parametros.slice(4)).toEqual([BORRADOR, "cleaner_confirmation_request", 1]);
  });

  it("la plantilla no viaja en lo que el ejecutor manda a la base más que como los dos parámetros: ni la clave ni la versión van en el cuerpo", async () => {
    const { llamadas, ejecutores } = montar();
    await ejecutores.send_text(ctx(), entrada("send_text", { ...TEXTO, template_key: "cleaner_confirmation_request", template_version: 1 }));
    expect(llamadas[0]!.parametros[2]).toBe(TEXTO.body);
    expect(String(llamadas[0]!.parametros[2])).not.toMatch(/cleaner_confirmation_request/);
  });
});

describe("lo que no corre no toca la base ni el puerto (el picker no es la defensa)", () => {
  it.each([
    ["otro modo (un correo en send_text)", "send_text", "requests", "requester_scheduled"],
    ["otro modo (un texto en send_email)", "send_email", "scheduled", "cleaner_confirmation_request"],
    ["otra etapa (confirmation request ya en Scheduled)", "send_text", "scheduled", "cleaner_confirmation_request"],
    ["otra etapa (reschedule en Requests)", "send_text", "requests", "reschedule_request"],
    ["otra etapa (Done notice antes de Validation)", "send_email", "in_progress", "requester_done"],
    ["otra etapa (Scheduled notice en Requests)", "send_email", "requests", "requester_scheduled"],
    ["una de cancelación (no está en el Composer)", "send_text", "scheduled", "cancellation_cleaner"],
    ["una de cancelación del requester", "send_email", "scheduled", "cancellation_requester"],
    ["con el job cancelado", "send_email", "cancelled", "requester_scheduled"],
    ["una clave que no es del catálogo", "send_text", "requests", "otra_cosa"],
    ["una clave de Object.prototype", "send_email", "validation", "constructor"],
  ] as const)("%s → plantilla_no_disponible", async (_caso, codigo, etapa, clave) => {
    const { deps, ejecutores } = montar();
    const cuerpo = codigo === "send_text" ? TEXTO : CORREO;
    const r = await ejecutores[codigo](enEtapa(etapa), entrada(codigo, { ...cuerpo, template_key: clave, template_version: 1 }));
    expect(r).toEqual({ tipo: "rechazada", codigo: "plantilla_no_disponible", mensaje: "That template is not available here." });
    expect(deps.escribir).not.toHaveBeenCalled();
    expect(deps.equipo).not.toHaveBeenCalled();
    expect(deps.entregar).not.toHaveBeenCalled();
  });

  it.each([
    ["una clave sin versión", { template_key: "cleaner_confirmation_request" }],
    ["una versión que no es un entero", { template_key: "cleaner_confirmation_request", template_version: "1" }],
    ["una versión 0", { template_key: "cleaner_confirmation_request", template_version: 0 }],
    ["una versión fraccionaria", { template_key: "cleaner_confirmation_request", template_version: 1.5 }],
    ["una clave que no es texto", { template_key: 5, template_version: 1 }],
  ])("%s se rechaza como plantilla no disponible", async (_caso, extra) => {
    const { deps, ejecutores } = montar();
    const r = await ejecutores.send_text(ctx(), entrada("send_text", { ...TEXTO, ...extra }));
    expect(r).toMatchObject({ tipo: "rechazada", codigo: "plantilla_no_disponible" });
    expect(deps.escribir).not.toHaveBeenCalled();
    expect(deps.equipo).not.toHaveBeenCalled();
  });

  it("una versión sin clave es una entrada inválida", async () => {
    const { deps, ejecutores } = montar();
    const r = await ejecutores.send_text(ctx(), entrada("send_text", { ...TEXTO, template_version: 1 }));
    expect(r).toMatchObject({ tipo: "rechazada", codigo: "entrada_invalida" });
    expect(deps.escribir).not.toHaveBeenCalled();
  });

  it("un actor de sistema con plantilla tampoco escribe ni entrega (nada sale solo)", async () => {
    const { deps, ejecutores } = montar();
    const SISTEMA = { tipo: "sistema", proceso: "reconciliador" } as never;
    const r = await ejecutores.send_text(ctx({ actor: SISTEMA }), entrada("send_text", { ...TEXTO, template_key: "cleaner_confirmation_request", template_version: 1 }));
    expect(r).toMatchObject({ codigo: "sin_actor" });
    expect(deps.escribir).not.toHaveBeenCalled();
    expect(deps.entregar).not.toHaveBeenCalled();
  });
});

describe("los errores de la base", () => {
  it.each([
    ["OP055", "plantilla_invalida", "That template is not available here."],
    ["OP056", "faltan_datos", "Fill in the highlighted fields before sending."],
  ])("%s sale como %s y no pide entrega", async (code, esperado, mensaje) => {
    const texto = montar({ escribir: vi.fn(async () => Promise.reject(errorSql(code))) });
    const r = await texto.ejecutores.send_text(ctx(), entrada("send_text", { ...TEXTO, template_key: "cleaner_confirmation_request", template_version: 1 }));
    expect(r).toEqual({ tipo: "rechazada", codigo: esperado, mensaje });
    expect(texto.deps.entregar).not.toHaveBeenCalled();

    const correo = montar({ escribir: vi.fn(async () => Promise.reject(errorSql(code))) });
    const c = await correo.ejecutores.send_email(enEtapa("scheduled"), entrada("send_email", { ...CORREO, template_key: "requester_scheduled", template_version: 1 }));
    expect(c).toEqual({ tipo: "rechazada", codigo: esperado, mensaje });
    expect(correo.deps.entregar).not.toHaveBeenCalled();
  });
});

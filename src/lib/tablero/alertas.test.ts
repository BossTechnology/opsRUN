// @vitest-environment node
/**
 * El tablero y Alerts (OPR-34, spec §3.2, §6.1 y §7): los conteos de la barra, de
 * cada columna y de cada tarjeta son los de `alertasDeLaRequest`, también con una
 * alerta de mensaje; el tablero relee por id las ocurrencias abiertas con mensaje;
 * y arma lo que lista el panel de la barra.
 */
import { describe, expect, it } from "vitest";

import { alertasDeLaRequest } from "../alertas/armar";
import type { EsperaDeOpsrun } from "../alertas/tipos";
import { crearFalso, RelojManual } from "../bzzzbx/falso";
import type { AlertResult, Message } from "../bzzzbx/tipos";

import { armarTablero } from "./armar";
import { leerTablero, type MemoriaTablero } from "./leer";
import { filasDeLaSeed, leidosDelFalso } from "./prueba-datos";
import type { Leidos, Tablero } from "./tipos";

const AHORA = new Date("2026-11-24T18:00:00Z");
const R2 = "b0000000-0000-4000-8000-0000000000a2";

const mensajeFallido: Message = {
  bzzzbx_message_id: "bx-msg-0201",
  bzzzbx_thread_id: "bx-thread-0002",
  channel: "text",
  direction: "outbound",
  from: "opsrun",
  to: ["+1 555 0111"],
  subject: null,
  body: "Hello",
  sent_at: "2026-11-24T17:00:00.000Z",
  delivery: "failed",
};

const alertaDeMensaje: AlertResult = {
  bzzzbx_alert_id: "bx-alert-0201",
  sujeto: { tipo: "message", bzzzbx_message_id: "bx-msg-0201" },
  rule_id: "MSG-001",
  rule_version: "1",
  level: "red",
  reason_text: "Text not delivered.",
  opened_at: "2026-11-24T17:05:00.000Z",
  cleared_at: null,
};

const espera: EsperaDeOpsrun = {
  id: "d0000000-0000-4000-8000-0000000000a2",
  request_id: R2,
  purpose: "initial",
  bzzzbx_team_id: "bx-team-0001",
  status: "asked",
  asked_at: "2026-11-24T16:10:00.000Z",
  new_service_date: null,
  new_window_start: null,
  new_window_end: null,
};

function leidosConMensaje(): Leidos {
  const l = leidosDelFalso(AHORA);
  return { ...l, mensajes: [...l.mensajes, mensajeFallido], alertas: [...l.alertas, alertaDeMensaje] };
}

function armar(leidos: Leidos, extra: { esperas?: EsperaDeOpsrun[]; operadores?: { id: string; nombre: string }[] } = {}): Tablero {
  return armarTablero({
    filas: filasDeLaSeed(AHORA),
    leidos,
    ahora: AHORA,
    zona: "UTC",
    bzzzbx: { disponible: true, actualizadoEn: AHORA.toISOString() },
    ...extra,
  });
}

const tarjeta = (t: Tablero, numero: string) => t.columnas.flatMap((c) => [...c.tarjetas, ...c.pagadas]).find((x) => x.numero === numero)!;

describe("armarTablero: los conteos son los de alertasDeLaRequest", () => {
  it("una alerta de mensaje de un hilo de la request cuenta en la tarjeta, en su columna y en la barra", () => {
    const antes = armar(leidosDelFalso(AHORA));
    const t = armar(leidosConMensaje());
    expect(antes.alertasAbiertas.total).toBe(2);
    expect(tarjeta(t, "R2").alertas).toEqual({ total: 1, nivel: "red" });
    expect(t.columnas[0]!.alertas).toEqual({ total: 2, nivel: "red" });
    expect(t.alertasAbiertas).toEqual({ total: 3, nivel: "red" });
  });

  it("cada tarjeta, cada columna y la barra suman lo mismo que alertasDeLaRequest, request por request", () => {
    const leidos = leidosConMensaje();
    const filas = filasDeLaSeed(AHORA);
    const t = armar(leidos);
    let total = 0;
    for (const fila of filas) {
      const esperadas = alertasDeLaRequest({
        fila,
        alertas: leidos.alertas,
        hilos: fila.bzzzbx_thread_id ? [fila.bzzzbx_thread_id] : [],
        mensajes: leidos.mensajes,
      });
      total += esperadas.length;
      const numero = fila.job_number ?? `R${fila.r_number}`;
      expect(tarjeta(t, numero).alertas.total, numero).toBe(esperadas.length);
    }
    expect(t.alertasAbiertas.total).toBe(total);
    expect(t.panelAlertas.filas).toHaveLength(total);
  });

  it("una alerta que opsRUN ya resolvió, de cualquier forma, no cuenta: ni en la barra, ni en el panel", () => {
    const leidos = leidosDelFalso(AHORA);
    const filas = filasDeLaSeed(AHORA).map((f) => (f.r_number === 1 ? { ...f, alertas_limpiadas: ["bx-alert-0001"] } : f));
    const t = armarTablero({ filas, leidos, ahora: AHORA, zona: "UTC", bzzzbx: { disponible: true, actualizadoEn: null } });
    expect(t.alertasAbiertas.total).toBe(1);
    expect(t.panelAlertas.filas.map((f) => f.id)).toEqual(["bx-alert-0006"]);
  });

  it("una alerta de mensaje que opsRUN tiene abierta cuenta aunque el mensaje no esté en el hilo leído", () => {
    const leidos = leidosDelFalso(AHORA);
    const sinHilo: Leidos = { ...leidos, alertas: [...leidos.alertas, alertaDeMensaje] };
    const filas = filasDeLaSeed(AHORA).map((f) => (f.id === R2 ? { ...f, alertas_de_mensaje: ["bx-alert-0201"] } : f));
    const t = armarTablero({ filas, leidos: sinHilo, ahora: AHORA, zona: "UTC", bzzzbx: { disponible: true, actualizadoEn: null } });
    expect(tarjeta(t, "R2").alertas.total).toBe(1);
  });
});

describe("armarTablero: lo que lista el panel de la barra (§6.2)", () => {
  it("una fila por alerta abierta, con el job, su etapa, su dueño y cuánto lleva abierta", () => {
    const t = armar(leidosDelFalso(AHORA), { operadores: [{ id: "op-1", nombre: "Ops Uno" }] });
    expect(t.panelAlertas.filas.map((f) => ({ id: f.id, regla: f.regla, numero: f.numero, etapa: f.etapa, asignado: f.asignadoNombre, duracion: f.duracion }))).toEqual([
      { id: "bx-alert-0001", regla: "OPS-001", numero: "R1", etapa: "requests", asignado: null, duracion: "Open 5 min" },
      { id: "bx-alert-0006", regla: "MEC-003", numero: "EX-00004", etapa: "in_progress", asignado: "Ops Dos", duracion: "Open 10 min" },
    ]);
    expect(t.panelAlertas.filas[0]).toMatchObject({ requestId: "b0000000-0000-4000-8000-0000000000a1", job: "Example Tower 4B", nombreRegla: "OPS-001 Unassigned request", etapaTitulo: "Requests" });
    expect(t.panelAlertas.operadores).toEqual([{ id: "op-1", nombre: "Ops Uno" }]);
  });

  it("Waiting: una fila por pregunta abierta al cleaner, con el job, qué se espera y desde cuándo", () => {
    const t = armar(leidosDelFalso(AHORA), { esperas: [espera] });
    expect(t.panelAlertas.esperas).toEqual([
      {
        id: espera.id,
        requestId: R2,
        job: "Sample Court Unit 12",
        numero: "R2",
        etapa: "requests",
        etapaTitulo: "Requests",
        asignadoId: "0a000000-0000-4000-8000-0000000000a1",
        asignadoNombre: "Ops Uno",
        que: "Cleaner confirmation",
        desde: "Waiting 1 h 50 min",
      },
    ]);
  });

  it("los ids rojos de Needs action de toda la operación, para el pulso de la barra", () => {
    expect(armar(leidosConMensaje()).idsRojos).toEqual(["bx-alert-0201"]);
    expect(armar(leidosDelFalso(AHORA)).idsRojos).toEqual([]);
  });

  it("sin esperas ni operadores el panel trae solo las alertas", () => {
    const t = armar(leidosDelFalso(AHORA));
    expect(t.panelAlertas.esperas).toEqual([]);
    expect(t.panelAlertas.operadores).toEqual([]);
  });
});

describe("leerTablero: las alertas de mensaje se releen por id (P-3)", () => {
  function preparar(alertasDeMensaje: string[]) {
    const falso = crearFalso({ reloj: new RelojManual(AHORA) });
    falso.lectura.poner("message", mensajeFallido);
    falso.lectura.poner("alert_result", alertaDeMensaje);
    const memoria: MemoriaTablero = { leidos: null, en: null };
    const filas = filasDeLaSeed(AHORA).map((f) => (f.id === R2 ? { ...f, alertas_de_mensaje: alertasDeMensaje } : f));
    const pedidos: string[][] = [];
    const original = falso.lectura.obtenerVarios.bind(falso.lectura);
    falso.lectura.obtenerVarios = (async (entidad: string, ids: string[]) => {
      if (entidad === "alert_result") pedidos.push(ids);
      return original(entidad as never, ids);
    }) as typeof falso.lectura.obtenerVarios;
    return { pedidos, leer: () => leerTablero({ filas, lectura: falso.lectura, ahora: AHORA, zona: "UTC", memoria }) };
  }

  it("con una ocurrencia abierta con mensaje, la pide por id y cuenta", async () => {
    const { pedidos, leer } = preparar(["bx-alert-0201"]);
    const t = await leer();
    expect(pedidos).toEqual([["bx-alert-0201"]]);
    expect(t.alertasAbiertas.total).toBe(3);
  });

  it("sin ocurrencias con mensaje no pide nada por id, y la alerta de mensaje todavía no cuenta (el registrador la ve en una vuelta, §3.2)", async () => {
    const { pedidos, leer } = preparar([]);
    const t = await leer();
    expect(pedidos).toEqual([]);
    expect(t.alertasAbiertas.total).toBe(2);
  });

  it("pasa lo de opsRUN para el panel: las esperas y los operadores", async () => {
    const falso = crearFalso({ reloj: new RelojManual(AHORA) });
    const t = await leerTablero({
      filas: filasDeLaSeed(AHORA),
      lectura: falso.lectura,
      ahora: AHORA,
      zona: "UTC",
      memoria: { leidos: null, en: null },
      esperas: [espera],
      operadores: [{ id: "op-1", nombre: "Ops Uno" }],
    });
    expect(t.panelAlertas.esperas).toHaveLength(1);
    expect(t.panelAlertas.operadores).toEqual([{ id: "op-1", nombre: "Ops Uno" }]);
  });
});

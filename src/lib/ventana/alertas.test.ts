// @vitest-environment node
/**
 * La ventana y Alerts (OPR-34, spec §3.3, §5.2 y §5.4): "pide acción" es
 * exactamente Needs action; Waiting no abre la ventana en Alerts pero da la
 * insignia gris; lo que opsRUN ya resolvió, de cualquier forma, no pide acción.
 */
import { describe, expect, it } from "vitest";

import type { AlertResult } from "../bzzzbx/tipos";

import { armarVentana, type EntradaVentana } from "./armar";
import {
  CONFIRMACIONES_COMPLETAS,
  filaVentana,
  leidosVentanaDelFalso,
  OPERADORES_DE_PRUEBA,
  SIN_CONFIRMACIONES,
} from "./prueba-datos";

const AHORA = new Date("2026-11-24T18:00:00Z");

function entrada(n: number, parche: Partial<EntradaVentana> = {}): EntradaVentana {
  return {
    fila: filaVentana(AHORA, n),
    leidos: leidosVentanaDelFalso(AHORA),
    hilos: [`bx-thread-000${n}`],
    operadores: OPERADORES_DE_PRUEBA,
    confirmaciones: n === 1 ? SIN_CONFIRMACIONES : CONFIRMACIONES_COMPLETAS,
    instruccionAbierta: false,
    ahora: AHORA,
    zona: "UTC",
    bzzzbx: { disponible: true, actualizadoEn: AHORA.toISOString() },
    tab: null,
    ...parche,
  };
}

const ventana = (n: number, parche: Partial<EntradaVentana> = {}) => armarVentana(entrada(n, parche));
const pestanaAlertas = (v: ReturnType<typeof ventana>) => v.pestanas.find((p) => p.id === "alerts")!;

const espera = {
  id: "d0000000-0000-4000-8000-0000000000a2",
  request_id: "b0000000-0000-4000-8000-0000000000a2",
  purpose: "initial" as const,
  bzzzbx_team_id: "bx-team-0001",
  status: "asked" as const,
  asked_at: "2026-11-24T16:10:00.000Z",
  new_service_date: null,
  new_window_start: null,
  new_window_end: null,
};

const roja = (id: string, sujeto: AlertResult["sujeto"], parche: Partial<AlertResult> = {}): AlertResult => ({
  bzzzbx_alert_id: id,
  sujeto,
  rule_id: "OPS-020",
  rule_version: "1",
  level: "red",
  reason_text: "x",
  opened_at: "2026-11-24T17:00:00Z",
  cleared_at: null,
  ...parche,
});

describe("armarVentana: Alerts (OPR-34)", () => {
  it("'pide acción' es exactamente Needs action: R1 abre en Alerts con insignia ámbar con 1", () => {
    const v = ventana(1);
    expect(v.inicial).toEqual({ id: "alerts", porRegla: true });
    expect(pestanaAlertas(v)).toMatchObject({
      conteo: 1,
      insignia: { nivel: "amber", conteo: 1, nombreAccesible: "Alerts, 1 need action, amber" },
      idsRojos: [],
    });
  });

  it("Waiting no abre la ventana en Alerts: R2 con su pregunta abierta abre en la propiedad, con insignia gris con 1 (P-4 y P-5)", () => {
    const v = ventana(2, { esperas: [espera] });
    expect(v.inicial).toEqual({ id: "property", porRegla: false });
    expect(pestanaAlertas(v)).toMatchObject({ conteo: 0, insignia: { nivel: "gray", conteo: 1, nombreAccesible: "Alerts, 1 waiting" } });
  });

  it("sin alertas y sin Waiting no hay insignia, y abre en la propiedad", () => {
    const v = ventana(3);
    expect(pestanaAlertas(v).insignia).toBeNull();
    expect(v.inicial).toEqual({ id: "property", porRegla: false });
  });

  it("con Needs action y Waiting, la insignia es la de Needs action (roja si alguna es roja) y trae los ids rojos para el pulso", () => {
    const e = entrada(2, { esperas: [espera] });
    e.leidos = { ...e.leidos, alertas: [...e.leidos.alertas, roja("bx-alert-7100", { tipo: "request", request_id: e.fila.id })] };
    const v = armarVentana(e);
    expect(pestanaAlertas(v)).toMatchObject({
      insignia: { nivel: "red", conteo: 1, nombreAccesible: "Alerts, 1 need action, red" },
      idsRojos: ["bx-alert-7100"],
    });
    expect(v.inicial).toEqual({ id: "alerts", porRegla: true });
  });

  it("una alerta que opsRUN ya resolvió, de cualquier forma, no pide acción aunque Signal Maker la siga dando abierta", () => {
    // `alertas_limpiadas` trae los `bzzzbx_alert_id` de toda ocurrencia resuelta (auto_cleared, fixed_by_action o
    // cleared_by_operator), no solo las de Clear alert.
    const e = entrada(1);
    e.fila = { ...e.fila, alertas_limpiadas: ["bx-alert-0001"] };
    const v = armarVentana(e);
    expect(v.alertasLeidas).toEqual([]);
    expect(v.inicial).toEqual({ id: "property", porRegla: false });
    expect(pestanaAlertas(v).insignia).toBeNull();
  });

  it("una alerta de mensaje cuenta si el mensaje es de un hilo de la request, o si opsRUN la tiene abierta con ese mensaje", () => {
    const e = entrada(2);
    e.leidos = {
      ...e.leidos,
      mensajes: [
        ...e.leidos.mensajes,
        { ...e.leidos.mensajes[0]!, bzzzbx_message_id: "bx-msg-0299", bzzzbx_thread_id: "bx-thread-0002", direction: "outbound" as const, delivery: "failed" as const },
      ],
      alertas: [
        ...e.leidos.alertas,
        roja("bx-alert-7200", { tipo: "message", bzzzbx_message_id: "bx-msg-0299" }),
        roja("bx-alert-7201", { tipo: "message", bzzzbx_message_id: "bx-msg-ajeno" }),
        roja("bx-alert-7202", { tipo: "message", bzzzbx_message_id: "bx-msg-otro-hilo" }),
      ],
    };
    expect(armarVentana(e).alertasLeidas.map((a) => a.bzzzbx_alert_id)).toEqual(["bx-alert-7200"]);
    e.fila = { ...e.fila, alertas_de_mensaje: ["bx-alert-7202"] };
    expect(armarVentana(e).alertasLeidas.map((a) => a.bzzzbx_alert_id)).toEqual(["bx-alert-7200", "bx-alert-7202"]);
  });
});

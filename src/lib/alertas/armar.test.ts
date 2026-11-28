// @vitest-environment node
/**
 * El modelo puro de Alerts (spec OPR-34 §3.2, §3.3, §5 y §6): qué alertas son de
 * una request, las tres secciones de la pestaña, la insignia y el panel de la barra.
 */
import { describe, expect, it } from "vitest";

import type { AlertResult } from "../bzzzbx/tipos";

import {
  alertasDeLaRequest,
  armarAlertas,
  armarPanelAlertas,
  insigniaDe,
  mensajesDeLasAlertas,
  type EntradaDeAlertasDeLaRequest,
} from "./armar";
import { REGLA_MENSAJE_NO_ENTREGADO } from "./reglas";
import { SIN_FILTROS, type EsperaDeOpsrun, type FilaDelPanel, type MensajeDeAlerta, type OcurrenciaDeOpsrun, type PanelAlertas } from "./tipos";

const AHORA = new Date("2026-11-27T16:00:00Z");
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
const R1 = "b0000000-0000-4000-8000-0000000000a1";
const R2 = "b0000000-0000-4000-8000-0000000000a2";

function alerta(id: string, parche: Partial<AlertResult> = {}): AlertResult {
  return {
    bzzzbx_alert_id: id,
    sujeto: { tipo: "request", request_id: R1 },
    rule_id: "OPS-001",
    rule_version: "1",
    level: "amber",
    reason_text: "Unassigned for 15 min.",
    opened_at: hace(65),
    cleared_at: null,
    ...parche,
  };
}

function ocurrencia(id: string, parche: Partial<OcurrenciaDeOpsrun> = {}): OcurrenciaDeOpsrun {
  return {
    bzzzbx_alert_id: id,
    request_id: R1,
    rule_id: "OPS-010",
    level: "red",
    reason_text: "Not started by 1:00 PM.",
    bzzzbx_message_id: null,
    opened_at: hace(180),
    resolved_at: hace(120),
    resolution: "auto_cleared",
    resolved_by_nombre: null,
    resolution_reason: null,
    fixing_label: null,
    ...parche,
  };
}

function espera(id: string, parche: Partial<EsperaDeOpsrun> = {}): EsperaDeOpsrun {
  return {
    id,
    request_id: R2,
    purpose: "initial",
    bzzzbx_team_id: "bx-team-0001",
    status: "asked",
    asked_at: hace(130),
    new_service_date: null,
    new_window_start: null,
    new_window_end: null,
    ...parche,
  };
}

const base = (parche: Partial<EntradaDeAlertasDeLaRequest> = {}): EntradaDeAlertasDeLaRequest => ({
  fila: { id: R1, bzzzbx_job_id: "bx-job-0001", alertas_limpiadas: [], alertas_de_mensaje: [] },
  alertas: [],
  ...parche,
});

describe("alertasDeLaRequest (§3.2)", () => {
  it("entran las de sujeto request, job y mensaje; no las de otra request ni las cerradas", () => {
    const entrada = base({
      alertas: [
        alerta("a-request"),
        alerta("a-job", { sujeto: { tipo: "job", bzzzbx_job_id: "bx-job-0001" } }),
        alerta("a-otra-request", { sujeto: { tipo: "request", request_id: R2 } }),
        alerta("a-otro-job", { sujeto: { tipo: "job", bzzzbx_job_id: "bx-job-0002" } }),
        alerta("a-cerrada", { cleared_at: hace(1) }),
      ],
    });
    expect(alertasDeLaRequest(entrada).map((a) => a.bzzzbx_alert_id)).toEqual(["a-job", "a-request"]);
  });

  it("una de sujeto mensaje entra por request_message, por el hilo de la request o por la ocurrencia abierta", () => {
    const mensaje = (id: string) => alerta(`a-${id}`, { sujeto: { tipo: "message", bzzzbx_message_id: id }, rule_id: REGLA_MENSAJE_NO_ENTREGADO });
    const entrada = base({
      fila: { id: R1, bzzzbx_job_id: null, alertas_limpiadas: [], alertas_de_mensaje: ["a-m-ocurrencia"] },
      alertas: [mensaje("m-vinculado"), mensaje("m-hilo"), mensaje("m-ajeno"), alerta("a-m-ocurrencia", { sujeto: { tipo: "message", bzzzbx_message_id: "m-x" } })],
      mensajesDeLaRequest: ["m-vinculado"],
      hilos: ["hilo-1"],
      mensajes: [
        { bzzzbx_message_id: "m-hilo", bzzzbx_thread_id: "hilo-1" },
        { bzzzbx_message_id: "m-ajeno", bzzzbx_thread_id: "hilo-9" },
      ],
    });
    expect(alertasDeLaRequest(entrada).map((a) => a.bzzzbx_alert_id)).toEqual(["a-m-hilo", "a-m-ocurrencia", "a-m-vinculado"]);
  });

  it("sin request no entra: un mensaje que no es de ningún hilo de la request no cuenta", () => {
    const a = alerta("a-suelta", { sujeto: { tipo: "message", bzzzbx_message_id: "m-suelto" } });
    expect(alertasDeLaRequest(base({ alertas: [a] }))).toEqual([]);
  });

  it("descuenta lo que opsRUN ya tiene resuelto, de cualquier forma, aunque BzzzBX la dé abierta (P-7)", () => {
    const entrada = base({
      fila: { id: R1, bzzzbx_job_id: null, alertas_limpiadas: ["a-limpiada", "a-arreglada"], alertas_de_mensaje: [] },
      alertas: [alerta("a-limpiada"), alerta("a-arreglada"), alerta("a-abierta")],
    });
    expect(alertasDeLaRequest(entrada).map((a) => a.bzzzbx_alert_id)).toEqual(["a-abierta"]);
  });

  it("las ordena por apertura y por id, siempre igual (el tablero y la ventana ven lo mismo)", () => {
    const entrada = base({ alertas: [alerta("b", { opened_at: hace(10) }), alerta("c", { opened_at: hace(30) }), alerta("a", { opened_at: hace(30) })] });
    expect(alertasDeLaRequest(entrada).map((a) => a.bzzzbx_alert_id)).toEqual(["a", "c", "b"]);
  });
});

describe("insigniaDe (§5.2)", () => {
  it("roja con el conteo de Needs action si alguna es roja", () => {
    expect(insigniaDe([{ level: "amber" }, { level: "red" }], 3)).toEqual({ nivel: "red", conteo: 2, nombreAccesible: "Alerts, 2 need action, red" });
  });
  it("ámbar si solo hay ámbar", () => {
    expect(insigniaDe([{ level: "amber" }], 0)).toEqual({ nivel: "amber", conteo: 1, nombreAccesible: "Alerts, 1 need action, amber" });
  });
  it("gris con el conteo de Waiting si Needs action está vacía (P-4)", () => {
    expect(insigniaDe([], 2)).toEqual({ nivel: "gray", conteo: 2, nombreAccesible: "Alerts, 2 waiting" });
  });
  it("sin nada, sin insignia", () => {
    expect(insigniaDe([], 0)).toBeNull();
  });
});

describe("armarAlertas: las tres secciones (§5.1)", () => {
  const entrada = {
    abiertas: [
      alerta("a-ambar-vieja", { opened_at: hace(200), level: "amber" }),
      alerta("a-roja-nueva", { opened_at: hace(10), level: "red", rule_id: "MEC-003", reason_text: "Running long 5h 18m vs 3h 0m expected" }),
      alerta("a-roja-vieja", { opened_at: hace(65), level: "red", rule_id: "TRN-005", reason_text: "Customer requires a PO." }),
    ],
    ocurrencias: [
      ocurrencia("a-resuelta-1", { resolved_at: hace(60), opened_at: hace(125) }),
      ocurrencia("a-resuelta-2", { resolved_at: hace(20), opened_at: hace(300), rule_id: "OPS-001", level: "amber", resolution: "fixed_by_action", resolved_by_nombre: "Ops Uno", fixing_label: "Assigned" }),
      ocurrencia("a-resuelta-3", { resolved_at: hace(5), opened_at: hace(30), rule_id: "MEC-003", level: "amber", resolution: "cleared_by_operator", resolved_by_nombre: "Ops Dos", resolution_reason: "Large unit, cleaner called ahead." }),
      // Abierta en opsRUN: no es Resolved.
      ocurrencia("a-roja-nueva", { resolved_at: null, resolution: null, rule_id: "MEC-003", level: "red", opened_at: hace(10) }),
    ],
    esperas: [espera("e-2", { asked_at: hace(30) }), espera("e-1", { asked_at: hace(130), status: "replied" })],
    equipos: { "bx-team-0001": "Team Alpha" },
    ahora: AHORA,
    zona: "America/New_York",
  };

  it("Needs action: rojo primero y después la más vieja arriba, con regla, motivo vivo, tiempo abierta y botón", () => {
    const v = armarAlertas(entrada);
    expect(v.needsAction.map((f) => f.id)).toEqual(["a-roja-vieja", "a-roja-nueva", "a-ambar-vieja"]);
    const mec = v.needsAction.find((f) => f.id === "a-roja-nueva")!;
    expect(mec).toMatchObject({
      regla: "MEC-003",
      nombreRegla: "MEC-003 Running long",
      nivel: "red",
      motivo: "Running long 5h 18m vs 3h 0m expected",
      duracion: "Open 10 min",
      abiertaTexto: "Opened Nov 27, 10:50 AM",
      abiertaIso: hace(10),
      boton: { tipo: "accion", codigo: "clear_alert", prellenado: { bzzzbx_alert_id: "a-roja-nueva" } },
    });
    expect(v.needsAction.find((f) => f.id === "a-roja-vieja")!.duracion).toBe("Open 1 h 5 min");
  });

  it("Waiting: por asked_at, con qué se espera, a quién y desde cuándo", () => {
    const v = armarAlertas(entrada);
    expect(v.waiting).toEqual([
      { id: "e-1", que: "Cleaner confirmation", aQuien: "Team Alpha", estado: "Reply received", desde: "Waiting 2 h 10 min" },
      { id: "e-2", que: "Cleaner confirmation", aQuien: "Team Alpha", estado: "Asked", desde: "Waiting 30 min" },
    ]);
  });

  it("Waiting de un Reschedule dice lo propuesto, y el cleaner sin nombre es — —", () => {
    const v = armarAlertas({
      ...entrada,
      equipos: {},
      esperas: [espera("e-r", { purpose: "reschedule", new_service_date: "2026-12-02", new_window_start: "10:00", new_window_end: "14:00" })],
    });
    expect(v.waiting[0]).toMatchObject({ que: "Reschedule · Wed, Dec 2 · 10:00 AM–2:00 PM", aQuien: "— —" });
  });

  it("Resolved: la más reciente arriba, con abierta y resuelta, tiempo abierta, quién y cómo", () => {
    const v = armarAlertas(entrada);
    expect(v.resolved.map((f) => f.id)).toEqual(["a-resuelta-3", "a-resuelta-2", "a-resuelta-1"]);
    const [clearAlert, arreglada, auto] = v.resolved;
    expect(auto).toMatchObject({
      nombreRegla: "OPS-010 Delayed",
      nivel: "red",
      motivo: "Not started by 1:00 PM.",
      abiertaYResuelta: "Opened Nov 27, 8:55 AM · Resolved 10:00 AM",
      duracion: "Open 1 h 5 min",
      quien: "Cleared automatically",
      razon: null,
    });
    expect(arreglada).toMatchObject({ quien: "Fixed by Ops Uno · Assigned", razon: null });
    expect(clearAlert).toMatchObject({ quien: "Cleared by Ops Dos", razon: "Reason: Large unit, cleaner called ahead." });
  });

  it("una resuelta de otro día lleva la fecha de la resolución", () => {
    const v = armarAlertas({ ...entrada, abiertas: [], esperas: [], ocurrencias: [ocurrencia("a-vieja", { opened_at: "2026-11-25T14:00:00Z", resolved_at: "2026-11-26T15:30:00Z" })] });
    expect(v.resolved[0]!.abiertaYResuelta).toBe("Opened Nov 25, 9:00 AM · Resolved Nov 26, 10:30 AM");
    expect(v.resolved[0]!.duracion).toBe("Open 1 d 1 h");
  });

  it("repeticiones: más de una ocurrencia de la misma regla en la request, contando la abierta", () => {
    const v = armarAlertas({
      ...entrada,
      abiertas: [alerta("a-de-nuevo", { rule_id: "OPS-010", level: "red" })],
      ocurrencias: [ocurrencia("a-r1"), ocurrencia("a-r2")],
      esperas: [],
    });
    expect(v.needsAction[0]!.repeticiones).toBe(3);
    expect(v.resolved.map((f) => f.repeticiones)).toEqual([3, 3]);
    const unica = armarAlertas({ ...entrada, abiertas: [alerta("a-sola")], ocurrencias: [ocurrencia("a-otra-regla")], esperas: [] });
    expect(unica.needsAction[0]!.repeticiones).toBeNull();
    expect(unica.resolved[0]!.repeticiones).toBeNull();
  });

  it("una abierta que ya está en alert_occurrence no se cuenta dos veces", () => {
    const v = armarAlertas({
      ...entrada,
      abiertas: [alerta("a-x", { rule_id: "OPS-010" })],
      ocurrencias: [ocurrencia("a-x", { resolved_at: null, resolution: null }), ocurrencia("a-y")],
      esperas: [],
    });
    expect(v.needsAction[0]!.repeticiones).toBe(2);
  });

  it("insignia y ids rojos para el pulso", () => {
    const v = armarAlertas(entrada);
    expect(v.insignia).toEqual({ nivel: "red", conteo: 3, nombreAccesible: "Alerts, 3 need action, red" });
    expect(v.idsRojos.sort()).toEqual(["a-roja-nueva", "a-roja-vieja"]);
    const soloEspera = armarAlertas({ ...entrada, abiertas: [] });
    expect(soloEspera.insignia).toEqual({ nivel: "gray", conteo: 2, nombreAccesible: "Alerts, 2 waiting" });
    expect(soloEspera.idsRojos).toEqual([]);
  });

  it("sin nada: secciones vacías y sin insignia", () => {
    const v = armarAlertas({ ...entrada, abiertas: [], ocurrencias: [], esperas: [] });
    expect(v).toMatchObject({ needsAction: [], waiting: [], resolved: [], insignia: null, idsRojos: [], zona: "America/New_York" });
  });
});

describe("el botón de cada alerta (§5.3)", () => {
  const boton = (a: AlertResult) => armarAlertas({ abiertas: [a], ocurrencias: [], esperas: [], equipos: {}, ahora: AHORA, zona: "UTC" }).needsAction[0]!.boton;

  it("cada regla abre su acción, prellenada", () => {
    expect(boton(alerta("x", { rule_id: "OPS-001" }))).toEqual({ tipo: "accion", codigo: "assign", prellenado: { asignarme: true } });
    expect(boton(alerta("x", { rule_id: "OPS-002" }))).toEqual({ tipo: "accion", codigo: "schedule", prellenado: null });
    expect(boton(alerta("x", { rule_id: "OPS-020" }))).toEqual({ tipo: "accion", codigo: "confirm_cleaner", prellenado: null });
    expect(boton(alerta("x1", { rule_id: "MEC-003" }))).toEqual({ tipo: "accion", codigo: "clear_alert", prellenado: { bzzzbx_alert_id: "x1" } });
    expect(boton(alerta("x", { rule_id: "ORG-002" }))).toEqual({ tipo: "accion", codigo: "mark_oss", prellenado: null });
    expect(boton(alerta("x", { rule_id: "ORG-003" }))).toEqual({ tipo: "accion", codigo: "mark_oss", prellenado: null });
    expect(boton(alerta("x", { rule_id: "TRN-005" }))).toEqual({ tipo: "accion", codigo: "write_po", prellenado: null });
  });

  it("OPS-010 no tiene botón: Clears at check-in", () => {
    expect(boton(alerta("x", { rule_id: "OPS-010" }))).toEqual({ tipo: "texto", texto: "Clears at check-in" });
  });

  describe("Message not delivered (OPR-19 §6.2 y §6.3)", () => {
    const a = alerta("x", { rule_id: REGLA_MENSAJE_NO_ENTREGADO, sujeto: { tipo: "message", bzzzbx_message_id: "bx-msg-0201" } });
    const fila = (mensaje?: MensajeDeAlerta, abierta: AlertResult = a) =>
      armarAlertas({ abiertas: [abierta], ocurrencias: [], esperas: [], equipos: {}, mensajes: mensaje ? { "bx-msg-0201": mensaje } : {}, ahora: AHORA, zona: "UTC" }).needsAction[0]!;

    it("lleva el foco al mensaje y hereda la disponibilidad del modo de su canal", () => {
      const f = fila({ encontrado: true, destinatario: "contact.one@example.test", modo: { disponible: true } });
      expect(f.boton).toEqual({ tipo: "reenviar", mensajeId: "bx-msg-0201", estado: { disponible: true } });
    });

    it.each(["BzzzBX unavailable", "Job cancelled", "No email thread for this request", "Choose a cleaner first"])("con el modo apagado (%s) el botón queda en gris con el mismo motivo", (razon) => {
      const f = fila({ encontrado: true, destinatario: "x", modo: { disponible: false, razon } });
      expect(f.boton).toEqual({ tipo: "reenviar", mensajeId: "bx-msg-0201", estado: { disponible: false, razon } });
    });

    it("si BzzzBX no conoce el mensaje, en gris con 'Message not found in BzzzBX'", () => {
      const f = fila({ encontrado: false, destinatario: null, modo: { disponible: true } });
      expect(f.boton).toMatchObject({ estado: { disponible: false, razon: "Message not found in BzzzBX" } });
    });

    it("sin lectura del mensaje, en gris con 'BzzzBX unavailable' y el destinatario se ve — —", () => {
      const f = fila(undefined);
      expect(f.boton).toMatchObject({ estado: { disponible: false, razon: "BzzzBX unavailable" } });
      expect(f.destinatario).toBe("To: — —");
    });

    it("la fila trae el destinatario y el arreglo, y las demás reglas no", () => {
      const f = fila({ encontrado: true, destinatario: "Team Alpha · +1 555 0111", modo: { disponible: true } });
      expect(f.destinatario).toBe("To: Team Alpha · +1 555 0111");
      expect(f.arreglo).toBe("Check the address or number and resend.");
      const otra = armarAlertas({ abiertas: [alerta("y", { rule_id: "OPS-001" })], ocurrencias: [], esperas: [], equipos: {}, ahora: AHORA, zona: "UTC" }).needsAction[0]!;
      expect(otra.destinatario).toBeNull();
      expect(otra.arreglo).toBeNull();
    });
  });

  it("una regla que no conoce no trae botón", () => {
    expect(boton(alerta("x", { rule_id: "XYZ-999" }))).toEqual({ tipo: "texto", texto: "" });
  });
});

describe("el panel de la barra (§6)", () => {
  const fila = (id: string, parche: Partial<FilaDelPanel> = {}): FilaDelPanel => ({
    id,
    requestId: R1,
    nivel: "amber",
    regla: "OPS-001",
    nombreRegla: "OPS-001 Unassigned request",
    job: "Example Tower 4B",
    numero: "R1",
    etapa: "requests",
    etapaTitulo: "Requests",
    asignadoId: null,
    asignadoNombre: null,
    abiertaIso: hace(45),
    duracion: "Open 45 min",
    ...parche,
  });
  const panel: PanelAlertas = {
    filas: [
      fila("a1"),
      fila("a2", { nivel: "red", regla: "OPS-010", nombreRegla: "OPS-010 Delayed", etapa: "scheduled", etapaTitulo: "Scheduled", asignadoId: "op-1", asignadoNombre: "Ops Uno", numero: "EX-00003" }),
      fila("a3", { nivel: "red", regla: "MEC-003", nombreRegla: "MEC-003 Running long", etapa: "in_progress", etapaTitulo: "In Progress", asignadoId: "op-2", asignadoNombre: "Ops Dos", numero: "EX-00004" }),
      fila("a4", { regla: "OPS-001", etapa: "requests", asignadoId: "op-1", asignadoNombre: "Ops Uno", numero: "R8" }),
    ],
    esperas: [
      { id: "e1", requestId: R2, job: "Sample Court 12", numero: "R2", etapa: "requests", etapaTitulo: "Requests", asignadoId: "op-1", asignadoNombre: "Ops Uno", que: "Cleaner confirmation", desde: "Waiting 2 h" },
    ],
    operadores: [
      { id: "op-1", nombre: "Ops Uno" },
      { id: "op-2", nombre: "Ops Dos" },
    ],
  };

  it("sin filtros, todas las filas de toda la operación y la espera", () => {
    const v = armarPanelAlertas(panel, SIN_FILTROS);
    expect(v.filas.map((f) => f.id)).toEqual(["a2", "a3", "a1", "a4"]);
    expect(v.esperas.map((e) => e.id)).toEqual(["e1"]);
    expect(v.sinCoincidencias).toBe(false);
  });

  it("las ordena como la pestaña: rojo primero y la más vieja arriba", () => {
    const v = armarPanelAlertas({ ...panel, filas: [fila("n", { abiertaIso: hace(5) }), fila("v", { abiertaIso: hace(500) }), fila("r", { nivel: "red", abiertaIso: hace(1) })] }, SIN_FILTROS);
    expect(v.filas.map((f) => f.id)).toEqual(["r", "v", "n"]);
  });

  it("cada filtro reduce la lista, y los combinados se aplican a la vez", () => {
    expect(armarPanelAlertas(panel, { ...SIN_FILTROS, nivel: "red" }).filas.map((f) => f.id)).toEqual(["a2", "a3"]);
    expect(armarPanelAlertas(panel, { ...SIN_FILTROS, regla: "OPS-001" }).filas.map((f) => f.id)).toEqual(["a1", "a4"]);
    expect(armarPanelAlertas(panel, { ...SIN_FILTROS, etapa: "scheduled" }).filas.map((f) => f.id)).toEqual(["a2"]);
    expect(armarPanelAlertas(panel, { ...SIN_FILTROS, asignado: "unassigned" }).filas.map((f) => f.id)).toEqual(["a1"]);
    expect(armarPanelAlertas(panel, { ...SIN_FILTROS, asignado: "op-1" }).filas.map((f) => f.id)).toEqual(["a2", "a4"]);
    expect(armarPanelAlertas(panel, { nivel: "amber", regla: "OPS-001", etapa: "requests", asignado: "op-1" }).filas.map((f) => f.id)).toEqual(["a4"]);
  });

  it("los filtros también filtran Waiting: por etapa y operador sí; por nivel o regla, no hay qué mostrar", () => {
    expect(armarPanelAlertas(panel, { ...SIN_FILTROS, etapa: "scheduled" }).esperas).toEqual([]);
    expect(armarPanelAlertas(panel, { ...SIN_FILTROS, asignado: "op-1" }).esperas.map((e) => e.id)).toEqual(["e1"]);
    expect(armarPanelAlertas(panel, { ...SIN_FILTROS, asignado: "op-2" }).esperas).toEqual([]);
    expect(armarPanelAlertas(panel, { ...SIN_FILTROS, nivel: "red" }).esperas).toEqual([]);
    expect(armarPanelAlertas(panel, { ...SIN_FILTROS, regla: "OPS-001" }).esperas).toEqual([]);
  });

  it("cada opción trae cuántas filas quedan con ella, con los demás filtros puestos", () => {
    const v = armarPanelAlertas(panel, SIN_FILTROS);
    expect(v.opciones.nivel).toEqual([
      { valor: "all", texto: "All", conteo: 4 },
      { valor: "red", texto: "Red", conteo: 2 },
      { valor: "amber", texto: "Amber", conteo: 2 },
    ]);
    expect(v.opciones.regla).toEqual([
      { valor: "all", texto: "All", conteo: 4 },
      { valor: "MEC-003", texto: "MEC-003 Running long", conteo: 1 },
      { valor: "OPS-001", texto: "OPS-001 Unassigned request", conteo: 2 },
      { valor: "OPS-010", texto: "OPS-010 Delayed", conteo: 1 },
    ]);
    expect(v.opciones.etapa.map((o) => [o.valor, o.conteo])).toEqual([
      ["all", 4],
      ["requests", 2],
      ["scheduled", 1],
      ["in_progress", 1],
      ["complete", 0],
      ["validation", 0],
    ]);
    expect(v.opciones.asignado).toEqual([
      { valor: "all", texto: "All", conteo: 4 },
      { valor: "unassigned", texto: "Unassigned", conteo: 1 },
      { valor: "op-1", texto: "Ops Uno", conteo: 2 },
      { valor: "op-2", texto: "Ops Dos", conteo: 1 },
    ]);

    // Con Level = Red, los conteos de las demás dimensiones se recalculan; los de Level no cambian.
    const rojas = armarPanelAlertas(panel, { ...SIN_FILTROS, nivel: "red" });
    expect(rojas.opciones.nivel.map((o) => o.conteo)).toEqual([4, 2, 2]);
    expect(rojas.opciones.etapa.map((o) => o.conteo)).toEqual([2, 0, 1, 1, 0, 0]);
    expect(rojas.opciones.regla.map((o) => o.conteo)).toEqual([2, 1, 0, 1]);
  });

  it("sin coincidencias: lo dice, y sin alertas en la operación no es un filtro que sobra", () => {
    expect(armarPanelAlertas(panel, { ...SIN_FILTROS, etapa: "validation" })).toMatchObject({ filas: [], sinCoincidencias: true });
    expect(armarPanelAlertas({ ...panel, filas: [], esperas: [] }, SIN_FILTROS)).toMatchObject({ filas: [], sinCoincidencias: false });
  });
});

describe("mensajesDeLasAlertas: lo que la conversación dice de los mensajes de las alertas (OPR-19 §6.2 y §6.3)", () => {
  const delMensaje = (id: string) => alerta(`a-${id}`, { rule_id: REGLA_MENSAJE_NO_ENTREGADO, sujeto: { tipo: "message", bzzzbx_message_id: id } });
  const modos = {
    customer: { disponible: true } as const,
    cleaner: { disponible: false, razon: "Choose a cleaner first" } as const,
    note: { disponible: true } as const,
  };
  const entrada = (id: string, tipo: "email" | "text", destinatario: string | null) => ({ id: `msg:${id}`, tipo, destinatario });
  const conversacion = (entradas: ReturnType<typeof entrada>[], disponible = true) =>
    ({ entradas, modos, bzzzbx: { disponible, actualizadoEn: null } }) as unknown as Parameters<typeof mensajesDeLasAlertas>[1];

  it("el correo usa el modo Customer y el texto el Cleaner, con su destinatario", () => {
    const c = conversacion([entrada("m1", "email", "contact.one@example.test"), entrada("m2", "text", "Team Alpha · +1 555 0111")]);
    expect(mensajesDeLasAlertas([delMensaje("m1"), delMensaje("m2")], c)).toEqual({
      m1: { encontrado: true, destinatario: "contact.one@example.test", modo: { disponible: true } },
      m2: { encontrado: true, destinatario: "Team Alpha · +1 555 0111", modo: { disponible: false, razon: "Choose a cleaner first" } },
    });
  });

  it("un mensaje que el hilo no tiene, con BzzzBX respondiendo, no se encontró; con BzzzBX caído no se declara", () => {
    expect(mensajesDeLasAlertas([delMensaje("m9")], conversacion([]))).toEqual({
      m9: { encontrado: false, destinatario: null, modo: { disponible: false, razon: "Message not found in BzzzBX" } },
    });
    expect(mensajesDeLasAlertas([delMensaje("m9")], conversacion([], false))).toMatchObject({ m9: { encontrado: true, destinatario: null } });
  });

  it("solo mira las alertas de mensaje de esta regla, y sin conversación no da nada", () => {
    expect(mensajesDeLasAlertas([alerta("x")], conversacion([]))).toEqual({});
    expect(mensajesDeLasAlertas([delMensaje("m1")], null)).toEqual({});
  });
});

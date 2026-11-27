// @vitest-environment node
import { describe, expect, it } from "vitest";

import { SIN_VALOR } from "../tablero/tipos";

import { armarVentana, type EntradaVentana } from "./armar";
import {
  CONFIRMACIONES_COMPLETAS,
  filaVentana,
  leidosVentanaDelFalso,
  OPERADORES_DE_PRUEBA,
  SIN_CONFIRMACIONES,
} from "./prueba-datos";
import { LEIDOS_VENTANA_VACIOS } from "./tipos";

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
const ids = (v: ReturnType<typeof ventana>) => v.pestanas.map((p) => p.id);

describe("armarVentana: encabezado (§3)", () => {
  it("R3 Scheduled: stage, propiedad y espacio, job line, precio y dueño", () => {
    const { encabezado, etapa, version } = ventana(3);
    expect(etapa).toBe("scheduled");
    expect(version).toBe("103");
    expect(encabezado.stage).toEqual({ etapa: "scheduled", texto: "Scheduled", pagada: false });
    expect(encabezado.nombre).toBe("Demo Lofts 7C");
    expect(encabezado.linea).toEqual({
      numero: "EX-00003",
      fecha: "Wed, Nov 25 · 10:00 AM–2:00 PM",
      servicio: "Standard clean",
      cleaner: "Team Beta",
    });
    expect(encabezado.precio).toBe("$185.00");
    expect(encabezado.asignado).toEqual({ operadorId: "0a000000-0000-4000-8000-0000000000a1", nombre: "Ops Uno" });
  });

  it("R6 Validation y Paid: stage Validation con la marca de pagada", () => {
    expect(ventana(6).encabezado.stage).toEqual({ etapa: "validation", texto: "Validation", pagada: true });
  });

  it("R1 sin datos: — — en lo que falta, Unassigned y Not scheduled", () => {
    const { encabezado, etapa } = ventana(1);
    expect(etapa).toBe("requests");
    expect(encabezado.stage.texto).toBe("Requests");
    expect(encabezado.nombre).toBe("Example Tower 4B");
    expect(encabezado.linea).toEqual({ numero: "R1", fecha: "Not scheduled", servicio: SIN_VALOR, cleaner: SIN_VALOR });
    expect(encabezado.precio).toBe(SIN_VALOR);
    expect(encabezado.asignado).toEqual({ operadorId: null, nombre: "Unassigned" });
  });

  it("en Requests la job line sale del borrador; desde Scheduled, del job", () => {
    const r2 = ventana(2).encabezado.linea;
    expect(r2.numero).toBe("R2");
    expect(r2.fecha).toMatch(/^\w{3}, \w{3} \d{1,2} · 9:00 AM–12:00 PM$/);
    expect(r2.cleaner).toBe("Team Alpha");
    const e = entrada(3);
    e.fila = { ...e.fila, service_date: "2026-12-30", bzzzbx_team_id: "bx-team-0001" };
    expect(armarVentana(e).encabezado.linea).toMatchObject({ fecha: "Wed, Nov 25 · 10:00 AM–2:00 PM", cleaner: "Team Beta" });
  });

  it("el precio es solo lectura del Job del puerto: — — si no viene, y una moneda desconocida no rompe", () => {
    const sinPrecio = entrada(3);
    sinPrecio.leidos = { ...sinPrecio.leidos, jobs: sinPrecio.leidos.jobs.map((j) => ({ ...j, price: null })) };
    expect(armarVentana(sinPrecio).encabezado.precio).toBe(SIN_VALOR);
    const sinCampo = entrada(3);
    sinCampo.leidos = {
      ...sinCampo.leidos,
      jobs: sinCampo.leidos.jobs.map((j) => {
        const sinPrecio = { ...j };
        delete sinPrecio.price;
        return sinPrecio;
      }),
    };
    expect(armarVentana(sinCampo).encabezado.precio).toBe(SIN_VALOR);
    const rara = entrada(3);
    rara.leidos = { ...rara.leidos, jobs: rara.leidos.jobs.map((j) => ({ ...j, price: { amount_cents: 1250, currency: "xx" } })) };
    expect(armarVentana(rara).encabezado.precio).toBe("12.50 xx");
  });

  it("carga de cada operador activo, relativa al que más tiene", () => {
    expect(ventana(3).encabezado.cargas).toEqual([
      { id: "0a000000-0000-4000-8000-0000000000a1", nombre: "Ops Uno", abiertas: 2, proporcion: 0.5 },
      { id: "0a000000-0000-4000-8000-0000000000a2", nombre: "Ops Dos", abiertas: 4, proporcion: 1 },
      { id: "0a000000-0000-4000-8000-0000000000b1", nombre: "Finance Uno", abiertas: 0, proporcion: 0 },
    ]);
    const todosEnCero = ventana(3, { operadores: OPERADORES_DE_PRUEBA.map((o) => ({ ...o, abiertas: 0 })) });
    expect(todosEnCero.encabezado.cargas.map((c) => c.proporcion)).toEqual([0, 0, 0]);
  });
});

describe("armarVentana: job cancelado (§6.3, S-3)", () => {
  it("abre con stage Cancelled y sin ser de ninguna etapa", () => {
    const e = entrada(3);
    e.leidos = { ...e.leidos, jobs: e.leidos.jobs.map((j) => (j.bzzzbx_job_id === "bx-job-0003" ? { ...j, status: "cancelled" } : j)) };
    const v = armarVentana(e);
    expect(v.etapa).toBe("cancelled");
    expect(v.encabezado.stage).toEqual({ etapa: "cancelled", texto: "Cancelled", pagada: false });
    expect(v.encabezado.nombre).toBe("Demo Lofts 7C");
    expect(ids(v)).toEqual(["property", "audit", "dollar", "people", "alerts"]);
  });
});

describe("armarVentana: pestañas (§4)", () => {
  it("nombre de la pestaña de la propiedad: el espacio, la unidad, la propiedad o Property", () => {
    expect(ventana(2).pestanas[0]).toMatchObject({ id: "property", nombre: "Unit 12" });
    expect(ventana(3).pestanas[0]!.nombre).toBe("7C");
    expect(ventana(1).pestanas[0]!.nombre).toBe("4B");
    expect(ventana(4).pestanas[0]!.nombre).toBe("Placeholder House");
    const sinPropiedad = entrada(1);
    sinPropiedad.fila = { ...sinPropiedad.fila, bzzzbx_property_id: null, unit: null };
    expect(armarVentana(sinPropiedad).pestanas[0]!.nombre).toBe("Property");
  });

  it.each([
    [2, ["property", "dollar", "people", "alerts"]],
    [3, ["property", "audit", "dollar", "people", "alerts"]],
    [4, ["property", "audit", "tracker", "dollar", "people", "alerts"]],
    [5, ["property", "audit", "tracker", "dollar", "people", "alerts"]],
    [6, ["property", "audit", "tracker", "billing", "dollar", "people", "alerts"]],
  ])("R%i: las que tocan, en orden, con Alerts al final", (n, esperadas) => {
    expect(ids(ventana(n))).toEqual(esperadas);
  });

  it("$ y People se ven pero no se seleccionan, con su título", () => {
    const { pestanas } = ventana(3);
    for (const id of ["dollar", "people"]) {
      expect(pestanas.find((p) => p.id === id)).toMatchObject({ deshabilitada: true, titulo: "Not available in this release" });
    }
    expect(pestanas.filter((p) => p.deshabilitada).map((p) => p.id)).toEqual(["dollar", "people"]);
    expect(pestanas.find((p) => p.id === "dollar")!.nombre).toBe("$");
    expect(pestanas.find((p) => p.id === "people")!.nombre).toBe("People");
  });

  it("Alerts lleva el conteo de las que piden acción", () => {
    expect(ventana(1).pestanas.at(-1)).toMatchObject({ id: "alerts", nombre: "Alerts", conteo: 1 });
    expect(ventana(3).pestanas.at(-1)!.conteo).toBe(0);
  });
});

describe("armarVentana: pestaña inicial (§4.2)", () => {
  it("un ?tab= válido para la etapa manda", () => {
    expect(ventana(3, { tab: "audit" }).inicial).toEqual({ id: "audit", porRegla: false });
    expect(ventana(1, { tab: "property" }).inicial).toEqual({ id: "property", porRegla: false });
    expect(ventana(3, { tab: "alerts" }).inicial).toEqual({ id: "alerts", porRegla: false });
  });

  it("sin tab, Alerts si alguna alerta pide acción (regla 2)", () => {
    expect(ventana(1).inicial).toEqual({ id: "alerts", porRegla: true });
  });

  it("si no, la pestaña de la propiedad", () => {
    expect(ventana(3).inicial).toEqual({ id: "property", porRegla: false });
  });

  it("un tab de una pestaña que no toca, deshabilitada o desconocida cae a la regla", () => {
    expect(ventana(2, { tab: "audit" }).inicial).toEqual({ id: "property", porRegla: false });
    expect(ventana(3, { tab: "billing" }).inicial).toEqual({ id: "property", porRegla: false });
    expect(ventana(3, { tab: "dollar" }).inicial).toEqual({ id: "property", porRegla: false });
    expect(ventana(3, { tab: "people" }).inicial).toEqual({ id: "property", porRegla: false });
    expect(ventana(1, { tab: "nada" }).inicial).toEqual({ id: "alerts", porRegla: true });
  });
});

describe("armarVentana: alertas (S-8)", () => {
  it("lista las abiertas de la request, del job y de los mensajes de su hilo; las cerradas no", () => {
    const e = entrada(3);
    e.leidos = {
      ...e.leidos,
      alertas: [
        ...e.leidos.alertas,
        { bzzzbx_alert_id: "bx-alert-9001", sujeto: { tipo: "job", bzzzbx_job_id: "bx-job-0003" }, rule_id: "OPS-010", rule_version: "1", level: "red", reason_text: "Not started by 1:00 PM.", opened_at: "2026-11-24T17:00:00Z", cleared_at: null },
        { bzzzbx_alert_id: "bx-alert-9002", sujeto: { tipo: "message", bzzzbx_message_id: "bx-msg-0003" }, rule_id: "COM-001", rule_version: "1", level: "amber", reason_text: "Unanswered message.", opened_at: "2026-11-24T17:30:00Z", cleared_at: null },
        { bzzzbx_alert_id: "bx-alert-9003", sujeto: { tipo: "message", bzzzbx_message_id: "bx-msg-0002" }, rule_id: "COM-001", rule_version: "1", level: "amber", reason_text: "De otra request.", opened_at: "2026-11-24T17:30:00Z", cleared_at: null },
      ],
    };
    const v = armarVentana(e);
    expect(v.alertas.map((a) => a.id)).toEqual(["bx-alert-9001", "bx-alert-9002"]);
    expect(v.alertas[0]).toEqual({ id: "bx-alert-9001", regla: "OPS-010", nivel: "red", razon: "Not started by 1:00 PM.", pideAccion: true });
    expect(v.pestanas.at(-1)!.conteo).toBe(2);
    expect(v.inicial).toEqual({ id: "alerts", porRegla: true });
  });

  it("R4: la alerta ya resuelta no pide acción", () => {
    expect(ventana(4).alertas).toEqual([]);
  });
});

describe("armarVentana: pestaña de la propiedad, de solo lectura (§4.3)", () => {
  it("R2: cliente, contacto, propiedad, espacio, servicio, fecha y ventana, cleaner, PO y notas", () => {
    const campos = Object.fromEntries(ventana(2).propiedad.campos.map((c) => [c.clave, c.valor]));
    expect(campos).toMatchObject({
      customer: "Example Property Group",
      contact: "Contact One · contact.one@example.test",
      property: "Sample Court",
      space: "Unit 12",
      service: "Standard clean",
      cleaner: "Team Alpha",
      po: SIN_VALOR,
      access: "Key at the front desk.",
    });
    expect(campos.date).toMatch(/9:00 AM–12:00 PM$/);
  });

  it("R1: — — en lo que falta y nada marcado como no encontrado", () => {
    const { campos } = ventana(1).propiedad;
    expect(campos.find((c) => c.clave === "customer")).toMatchObject({ valor: SIN_VALOR, noEncontrado: false });
    expect(campos.find((c) => c.clave === "access")!.valor).toBe(SIN_VALOR);
    expect(campos.every((c) => !c.noEncontrado)).toBe(true);
  });

  it("BzzzBX responde pero no conoce una entidad: — — y Not found in BzzzBX", () => {
    const e = entrada(2);
    e.leidos = { ...e.leidos, properties: [], contactos: [] };
    const { campos } = armarVentana(e).propiedad;
    expect(campos.find((c) => c.clave === "property")).toMatchObject({ valor: SIN_VALOR, noEncontrado: true });
    expect(campos.find((c) => c.clave === "contact")).toMatchObject({ valor: SIN_VALOR, noEncontrado: true });
    expect(campos.find((c) => c.clave === "customer")!.noEncontrado).toBe(false);
  });

  it("BzzzBX caído sin datos: — — en lo de BzzzBX, sin decir que no lo encontró", () => {
    const v = ventana(3, { leidos: LEIDOS_VENTANA_VACIOS, bzzzbx: { disponible: false, actualizadoEn: null } });
    expect(v.bzzzbx).toEqual({ disponible: false, actualizadoEn: null });
    expect(v.encabezado.nombre).toBe(SIN_VALOR);
    expect(v.encabezado.linea.numero).toBe("EX-00003");
    expect(v.encabezado.precio).toBe(SIN_VALOR);
    expect(v.pestanas[0]!.nombre).toBe("7C");
    expect(v.propiedad.campos.every((c) => !c.noEncontrado)).toBe(true);
    // Lo de opsRUN sigue visible.
    expect(v.encabezado.asignado.nombre).toBe("Ops Uno");
    expect(v.gate.dueno).toBe(true);
  });
});

describe("armarVentana: lo que usan las acciones y las ranuras", () => {
  it("gate de Schedule, hilos y datos de los bloqueos", () => {
    const v = ventana(2, { confirmaciones: { details: true, sender: true, cleaner: false } });
    expect(v.gate).toEqual({ dueno: true, details: true, sender: true, cleaner: false });
    expect(v.hilos).toEqual(["bx-thread-0002"]);
    expect(v.datos).toEqual({ tienePropiedad: true, poRequerido: false, tienePo: false });
    expect(ventana(1).gate.dueno).toBe(false);
    expect(ventana(1).datos.tienePropiedad).toBe(true);
    expect(ventana(3).datos.tienePo).toBe(true);
    expect(ventana(6).datos).toEqual({ tienePropiedad: true, poRequerido: true, tienePo: true });
  });

  it("instrucción abierta y zona pasan tal cual", () => {
    const v = ventana(3, { instruccionAbierta: true, zona: "America/Bogota" });
    expect(v.instruccionAbierta).toBe(true);
    expect(v.zona).toBe("America/Bogota");
    expect(v.requestId).toBe("b0000000-0000-4000-8000-0000000000a3");
  });
});

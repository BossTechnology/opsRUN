import { describe, expect, it } from "vitest";

import { armarTablero, ORDEN_DE_REQUESTS } from "./armar";
import { filasDeLaSeed, leidosDelFalso } from "./prueba-datos";
import { LEIDOS_VACIOS, SIN_VALOR, type Etapa, type Leidos, type Tablero } from "./tipos";

const AHORA = new Date("2026-11-24T18:00:00Z");
const ZONA = "UTC";

function armar(leidos: Leidos = leidosDelFalso(AHORA), filas = filasDeLaSeed(AHORA)): Tablero {
  return armarTablero({ filas, leidos, ahora: AHORA, zona: ZONA, bzzzbx: { disponible: true, actualizadoEn: AHORA.toISOString() } });
}

const columna = (t: Tablero, etapa: Etapa) => t.columnas.find((c) => c.etapa === etapa)!;
const tarjeta = (t: Tablero, numero: string) =>
  t.columnas.flatMap((c) => [...c.tarjetas, ...c.pagadas]).find((x) => x.numero === numero)!;

describe("armarTablero", () => {
  it("cinco columnas en orden", () => {
    expect(armar().columnas.map((c) => c.titulo)).toEqual([
      "Requests",
      "Scheduled",
      "In Progress",
      "Complete",
      "Validation",
    ]);
  });

  it("Requests: la más antigua arriba, por la constante ORDEN_DE_REQUESTS (OPR-15, P-8)", () => {
    expect(ORDEN_DE_REQUESTS).toBe("mas_antigua_arriba");
    const t = armar();
    const horas = columna(t, "requests").tarjetas.map((x) => filasDeLaSeed(AHORA).find((f) => `R${f.r_number}` === x.numero)!.received_at);
    expect(horas).toEqual([...horas].sort());
  });

  it("cada request en su etapa (OPR-20 §5)", () => {
    const t = armar();
    expect(columna(t, "requests").tarjetas.map((x) => x.numero)).toEqual(["R2", "R1"]);
    expect(columna(t, "scheduled").tarjetas.map((x) => x.numero)).toEqual(["EX-00003"]);
    expect(columna(t, "in_progress").tarjetas.map((x) => x.numero)).toEqual(["EX-00004"]);
    expect(columna(t, "complete").tarjetas.map((x) => x.numero)).toEqual(["EX-00005"]);
    expect(columna(t, "validation").tarjetas).toEqual([]);
    expect(columna(t, "validation").pagadas.map((x) => x.numero)).toEqual(["EX-00006"]);
  });

  it("un job con completed en el Job Tracker pasa a Complete", () => {
    const leidos = leidosDelFalso(AHORA);
    leidos.eventos.push({ bzzzbx_event_id: "bx-evt-9", bzzzbx_job_id: "bx-job-0004", kind: "completed", occurred_at: AHORA.toISOString() });
    expect(columna(armar(leidos), "complete").tarjetas.map((x) => x.numero)).toEqual(["EX-00005", "EX-00004"]);
  });

  it("un job cancelado no aparece", () => {
    const leidos = leidosDelFalso(AHORA);
    leidos.jobs = leidos.jobs.map((j) => (j.bzzzbx_job_id === "bx-job-0003" ? { ...j, status: "cancelled" } : j));
    const t = armar(leidos);
    expect(columna(t, "scheduled").tarjetas).toEqual([]);
  });

  it("nombre, ciudad, tipo y servicio", () => {
    const r2 = tarjeta(armar(), "R2");
    expect(r2.nombre).toBe("Sample Court Unit 12");
    expect(r2.ciudad).toBe("Example City");
    expect(r2.tipo).toBe("standard");
    expect(r2.servicio).toBe("Standard clean");
    expect(tarjeta(armar(), "EX-00003").nombre).toBe("Demo Lofts 7C");
  });

  it("lo que no está definido se ve — —", () => {
    const r1 = tarjeta(armar(), "R1");
    expect(r1.nombre).toBe("Example Tower 4B");
    expect(r1.tipo).toBe(SIN_VALOR);
    expect(r1.servicio).toBe(SIN_VALOR);
    const sinPropiedad = armar(LEIDOS_VACIOS);
    expect(tarjeta(sinPropiedad, "R1").nombre).toBe(SIN_VALOR);
    expect(tarjeta(sinPropiedad, "R1").ciudad).toBe(SIN_VALOR);
  });

  it("estado bajo el número según la etapa", () => {
    const t = armar();
    expect(tarjeta(t, "R1").estado).toEqual({ tipo: "recibida", texto: "5:40 PM" });
    expect(tarjeta(t, "EX-00003").estado).toEqual({ tipo: "programada", texto: "Wed, Nov 25 · 10:00 AM–2:00 PM" });
    expect(tarjeta(t, "EX-00004").estado).toEqual({ tipo: "en_curso", texto: "Checked in 5:00 PM" });
    expect(tarjeta(t, "EX-00005").estado).toEqual({ tipo: "terminada", texto: "Ended Nov 23, 10:00 PM" });
    expect(tarjeta(t, "EX-00006").estado).toEqual({ tipo: "paid", texto: "Paid Nov 23" });
  });

  it("Delayed cuando hay una OPS-010 abierta en Scheduled", () => {
    const leidos = leidosDelFalso(AHORA);
    leidos.alertas.push({
      bzzzbx_alert_id: "bx-alert-9", sujeto: { tipo: "job", bzzzbx_job_id: "bx-job-0003" }, rule_id: "OPS-010",
      rule_version: "1", level: "red", reason_text: "x", opened_at: AHORA.toISOString(), cleared_at: null,
    });
    expect(tarjeta(armar(leidos), "EX-00003").estado).toEqual({ tipo: "delayed", texto: "Delayed" });
  });

  it("colores: verde pagada, borde rojo at risk, oscura sin dueño", () => {
    const t = armar();
    expect(tarjeta(t, "EX-00006").color).toBe("pagada");
    expect(tarjeta(t, "EX-00004").color).toBe("borde");
    expect(tarjeta(t, "R1").color).toBe("borde"); // alerta ámbar abierta gana a sin dueño
    expect(tarjeta(t, "R2").color).toBe("normal");
    expect(tarjeta(t, "EX-00003").color).toBe("normal");
  });

  it("oscura si no tiene dueño ni alertas; sombreada si breached o alerta roja", () => {
    const leidos = leidosDelFalso(AHORA);
    leidos.alertas = leidos.alertas.filter((a) => a.bzzzbx_alert_id !== "bx-alert-0001");
    leidos.salud = leidos.salud.map((s) => (s.bzzzbx_job_id === "bx-job-0003" ? { ...s, status: "breached" } : s));
    const t = armar(leidos);
    expect(tarjeta(t, "R1").color).toBe("sin_dueno");
    expect(tarjeta(t, "EX-00003").color).toBe("sombreada");
  });

  it("flags PO, PO missing y OSS", () => {
    const t = armar();
    expect(tarjeta(t, "EX-00003").flags).toEqual(["PO"]);
    expect(tarjeta(t, "EX-00005").flags).toEqual(["OSS"]);
    expect(tarjeta(t, "EX-00006").flags).toEqual(["PO"]);
    const leidos = leidosDelFalso(AHORA);
    leidos.jobs = leidos.jobs.map((j) => (j.bzzzbx_job_id === "bx-job-0006" ? { ...j, po_number: null } : j));
    expect(tarjeta(armar(leidos), "EX-00006").flags).toEqual(["PO missing"]);
  });

  it("chat cuando hay un mensaje entrante después del original", () => {
    expect(tarjeta(armar(), "R2").chat).toBe(false);
    const leidos = leidosDelFalso(AHORA);
    leidos.mensajes.push({
      bzzzbx_message_id: "bx-msg-9", bzzzbx_thread_id: "bx-thread-0002", channel: "email", direction: "inbound",
      from: "contact.one@example.test", to: [], subject: null, body: "Any update?", sent_at: AHORA.toISOString(), delivery: "delivered",
    });
    expect(tarjeta(armar(leidos), "R2").chat).toBe(true);
  });

  it("dueño con iniciales", () => {
    expect(tarjeta(armar(), "R2").dueno).toEqual({ id: "0a000000-0000-4000-8000-0000000000a1", nombre: "Ops Uno", iniciales: "OU" });
    expect(tarjeta(armar(), "R1").dueno).toBeNull();
  });

  it("conteos de alertas abiertas por tarjeta, columna y operación", () => {
    const t = armar();
    expect(tarjeta(t, "R1").alertas).toEqual({ total: 1, nivel: "amber" });
    expect(columna(t, "requests").alertas).toEqual({ total: 1, nivel: "amber" });
    // La Delayed ya se limpió; R4 tiene abierta una Running long (OPR-30, P-14).
    expect(columna(t, "in_progress").alertas).toEqual({ total: 1, nivel: "amber" });
    expect(tarjeta(t, "EX-00004").alertas).toEqual({ total: 1, nivel: "amber" });
    expect(t.alertasAbiertas).toEqual({ total: 2, nivel: "amber" });
  });

  it("una alerta roja pone la columna en rojo", () => {
    const leidos = leidosDelFalso(AHORA);
    leidos.alertas.push({
      bzzzbx_alert_id: "bx-alert-9", sujeto: { tipo: "request", request_id: "b0000000-0000-4000-8000-0000000000a2" },
      rule_id: "OPS-002", rule_version: "1", level: "red", reason_text: "x", opened_at: AHORA.toISOString(), cleared_at: null,
    });
    const t = armar(leidos);
    expect(columna(t, "requests").alertas).toEqual({ total: 2, nivel: "red" });
    expect(t.alertasAbiertas).toEqual({ total: 3, nivel: "red" });
  });

  it("lleva el estado de BzzzBX", () => {
    expect(armar().bzzzbx.disponible).toBe(true);
  });
});

describe("armarTablero: las etapas (OPR-30 a OPR-32)", () => {
  it("una alerta limpiada en opsRUN no cuenta en la tarjeta, en la columna ni en Alerts, aunque BzzzBX la dé abierta (P-7)", () => {
    const filas = filasDeLaSeed(AHORA).map((f) => (f.bzzzbx_job_id === "bx-job-0004" ? { ...f, alertas_limpiadas: ["bx-alert-0006"] } : f));
    const t = armar(leidosDelFalso(AHORA), filas);
    expect(tarjeta(t, "EX-00004").alertas).toEqual({ total: 0, nivel: null });
    expect(columna(t, "in_progress").alertas).toEqual({ total: 0, nivel: null });
    expect(t.alertasAbiertas).toEqual({ total: 1, nivel: "amber" }); // solo la OPS-001 de R1
  });

  it("una alerta limpiada de una request no descuenta la de otra", () => {
    const filas = filasDeLaSeed(AHORA).map((f) => (f.bzzzbx_job_id === "bx-job-0003" ? { ...f, alertas_limpiadas: ["bx-alert-0006"] } : f));
    expect(tarjeta(armar(leidosDelFalso(AHORA), filas), "EX-00004").alertas.total).toBe(1);
  });

  it("el flag PO usa el PO vigente: el capturado en opsRUN, el del job o el del borrador; PO missing si no hay ninguno", () => {
    const filas = filasDeLaSeed(AHORA);
    const t = armar(leidosDelFalso(AHORA), filas);
    expect(tarjeta(t, "EX-00006").flags).toContain("PO"); // el job de PINCH trae PO
    expect(tarjeta(t, "EX-00003").flags).toContain("PO");
    // El job de R6 pierde su PO en PINCH y el cliente lo exige: PO missing... hasta que el operador lo captura en opsRUN.
    const leidos = leidosDelFalso(AHORA);
    leidos.jobs = leidos.jobs.map((j) => (j.bzzzbx_job_id === "bx-job-0006" ? { ...j, po_number: null } : j));
    expect(tarjeta(armar(leidos, filas), "EX-00006").flags).toContain("PO missing");
    const capturado = filas.map((f) => (f.bzzzbx_job_id === "bx-job-0006" ? { ...f, entered_po_number: "PO-OPSRUN" } : f));
    const flags = tarjeta(armar(leidos, capturado), "EX-00006").flags;
    expect(flags).toContain("PO");
    expect(flags).not.toContain("PO missing");
    // El borrador también cuenta.
    const borrador = filas.map((f) => (f.bzzzbx_job_id === "bx-job-0006" ? { ...f, po_number: "PO-DRAFT" } : f));
    expect(tarjeta(armar(leidos, borrador), "EX-00006").flags).toContain("PO");
  });

  it("Validation: 'Approved <día>' aprobada, 'Validated <día>' validada y sin pagar, 'Paid <día>' pagada", () => {
    const filas = filasDeLaSeed(AHORA);
    const leidos = leidosDelFalso(AHORA);
    // R6 de la seed: validada y pagada.
    expect(tarjeta(armar(leidos, filas), "EX-00006").estado).toMatchObject({ tipo: "paid", texto: expect.stringMatching(/^Paid Nov \d+$/) });
    // Sin pagar: queda "Validated".
    const sinPagar = { ...leidos, pagos: leidos.pagos.map((p) => (p.bzzzbx_job_id === "bx-job-0006" ? { ...p, paid: false, paid_at: null } : p)) };
    const validada = tarjeta(armar(sinPagar, filas), "EX-00006");
    expect(validada.estado.tipo).toBe("validada");
    expect(validada.estado.texto).toBe("Validated Nov 21");
    expect(validada.color).not.toBe("pagada");
    // Sin validar y sin pagar: "Approved".
    const sinValidar = filas.map((f) => (f.bzzzbx_job_id === "bx-job-0006" ? { ...f, validated_at: null } : f));
    expect(tarjeta(armar(sinPagar, sinValidar), "EX-00006").estado).toEqual({ tipo: "aprobada", texto: "Approved Nov 20" });
  });

  it("validar no mueve la tarjeta de columna ni de color: sigue en Validation", () => {
    const filas = filasDeLaSeed(AHORA);
    const leidos = leidosDelFalso(AHORA);
    const sinPagar = { ...leidos, pagos: leidos.pagos.map((p) => (p.bzzzbx_job_id === "bx-job-0006" ? { ...p, paid: false, paid_at: null } : p)) };
    const t = armar(sinPagar, filas);
    expect(columna(t, "validation").tarjetas.map((x) => x.numero)).toEqual(["EX-00006"]);
  });
});

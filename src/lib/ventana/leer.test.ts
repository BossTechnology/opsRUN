// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { BzzzbxNoDisponible } from "../bzzzbx/errores";
import { crearFalso } from "../bzzzbx/falso";
import type { LecturaBzzzbx } from "../bzzzbx/puertos";

import { leerVentanaDeBzzzbx, PRESUPUESTO_BZZZBX_MS, type MemoriaVentana } from "./leer";
import { filaVentana } from "./prueba-datos";
import { LEIDOS_VENTANA_VACIOS } from "./tipos";

const AHORA = new Date("2026-11-24T18:00:00Z");
const memoriaVacia = (): MemoriaVentana => new Map();

describe("leerVentanaDeBzzzbx", () => {
  it("lee de una vez lo del tablero más el contacto, el cleaner y las alertas de los mensajes del hilo", async () => {
    const { lectura } = crearFalso(); // sus fechas salen de su reloj; aquí solo importan los ids
    const fila = filaVentana(new Date(), 3);
    const memoria = memoriaVacia();
    const r = await leerVentanaDeBzzzbx({ fila, hilos: ["bx-thread-0003"], lectura, ahora: AHORA, memoria });
    expect(r.bzzzbx).toEqual({ disponible: true, actualizadoEn: AHORA.toISOString() });
    expect(r.leidos.jobs.map((j) => j.bzzzbx_job_id)).toEqual(["bx-job-0003"]);
    expect(r.leidos.jobs[0]!.price).toEqual({ amount_cents: 18_500, currency: "USD" });
    expect(r.leidos.contactos.map((c) => c.bzzzbx_contact_id)).toEqual(["bx-cont-0001"]);
    expect(r.leidos.equipos.map((t) => t.bzzzbx_team_id)).toEqual(["bx-team-0002"]);
    expect(r.leidos.properties.map((p) => p.bzzzbx_property_id)).toEqual(["bx-prop-0003"]);
    expect(r.leidos.mensajes.map((m) => m.bzzzbx_message_id)).toEqual(["bx-msg-0003"]);
    expect(memoria.get(fila.id)?.en).toBe(AHORA.toISOString());
  });

  it("incluye las alertas de un mensaje del hilo y no repite las de la request", async () => {
    const falso = crearFalso();
    falso.lectura.poner("alert_result", {
      bzzzbx_alert_id: "bx-alert-9002",
      sujeto: { tipo: "message", bzzzbx_message_id: "bx-msg-0001" },
      rule_id: "COM-001",
      rule_version: "1",
      level: "amber",
      reason_text: "Unanswered message.",
      opened_at: AHORA.toISOString(),
      cleared_at: null,
    });
    const fila = filaVentana(new Date(), 1);
    const r = await leerVentanaDeBzzzbx({ fila, hilos: ["bx-thread-0001"], lectura: falso.lectura, ahora: AHORA, memoria: memoriaVacia() });
    expect(r.leidos.alertas.map((a) => a.bzzzbx_alert_id).sort()).toEqual(["bx-alert-0001", "bx-alert-9002"]);
  });

  it("una entidad que BzzzBX no conoce no rompe: simplemente no viene", async () => {
    const { lectura } = crearFalso();
    const fila = { ...filaVentana(new Date(), 2), bzzzbx_contact_id: "bx-cont-9999", bzzzbx_team_id: "bx-team-9999" };
    const r = await leerVentanaDeBzzzbx({ fila, hilos: [], lectura, ahora: AHORA, memoria: memoriaVacia() });
    expect(r.bzzzbx.disponible).toBe(true);
    expect(r.leidos.contactos).toEqual([]);
    expect(r.leidos.equipos).toEqual([]);
  });

  it("con BzzzBX caído usa lo último leído de ESA request y lo avisa", async () => {
    const falso = crearFalso();
    const fila = filaVentana(new Date(), 3);
    const memoria = memoriaVacia();
    const ok = await leerVentanaDeBzzzbx({ fila, hilos: ["bx-thread-0003"], lectura: falso.lectura, ahora: AHORA, memoria });
    falso.lectura.noDisponible(true);
    const despues = new Date(AHORA.getTime() + 60_000);
    const caido = await leerVentanaDeBzzzbx({ fila, hilos: ["bx-thread-0003"], lectura: falso.lectura, ahora: despues, memoria });
    expect(caido.bzzzbx).toEqual({ disponible: false, actualizadoEn: AHORA.toISOString() });
    expect(caido.leidos).toEqual(ok.leidos);
    // Otra request que nunca se leyó: sin datos.
    const otra = await leerVentanaDeBzzzbx({ fila: filaVentana(new Date(), 4), hilos: [], lectura: falso.lectura, ahora: despues, memoria });
    expect(otra).toEqual({ leidos: LEIDOS_VENTANA_VACIOS, bzzzbx: { disponible: false, actualizadoEn: null } });
  });

  it("pasado el presupuesto de 1,5 s cuenta como caído, sin esperar a que BzzzBX responda", async () => {
    expect(PRESUPUESTO_BZZZBX_MS).toBe(1500);
    const colgada = new Promise<never>(() => {});
    const lectura = {
      obtener: () => colgada,
      obtenerVarios: () => colgada,
      listarPor: () => colgada,
      buscarJobs: () => colgada,
      cambiosDesde: () => colgada,
    } as unknown as LecturaBzzzbx;
    const inicio = Date.now();
    const r = await leerVentanaDeBzzzbx({
      fila: filaVentana(new Date(), 3),
      hilos: ["bx-thread-0003"],
      lectura,
      ahora: AHORA,
      memoria: memoriaVacia(),
      presupuestoMs: 30,
    });
    expect(Date.now() - inicio).toBeLessThan(1000);
    expect(r.bzzzbx).toEqual({ disponible: false, actualizadoEn: null });
  });

  it("un error que no es de disponibilidad sube (no se disfraza de BzzzBX caído)", async () => {
    const lectura = {
      obtener: vi.fn().mockRejectedValue(new Error("bug")),
      obtenerVarios: vi.fn().mockRejectedValue(new Error("bug")),
      listarPor: vi.fn().mockRejectedValue(new Error("bug")),
    } as unknown as LecturaBzzzbx;
    await expect(
      leerVentanaDeBzzzbx({ fila: filaVentana(new Date(), 3), hilos: [], lectura, ahora: AHORA, memoria: memoriaVacia() }),
    ).rejects.toThrow("bug");
  });

  it("reconoce BzzzBX caído por nombre, también el de otra copia del módulo", async () => {
    const deOtraCopia = new (class extends Error {})("caído");
    deOtraCopia.name = "BzzzbxNoDisponible";
    const lectura = {
      obtener: () => Promise.reject(deOtraCopia),
      obtenerVarios: () => Promise.reject(deOtraCopia),
      listarPor: () => Promise.reject(deOtraCopia),
    } as unknown as LecturaBzzzbx;
    const r = await leerVentanaDeBzzzbx({ fila: filaVentana(new Date(), 3), hilos: [], lectura, ahora: AHORA, memoria: memoriaVacia() });
    expect(r.bzzzbx.disponible).toBe(false);
    expect(new BzzzbxNoDisponible()).toBeInstanceOf(Error);
  });
});

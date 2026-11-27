// @vitest-environment node
/**
 * Las acciones de la conversación en el registro de OPR-26 (spec OPR-27 §5.3 y
 * §6): internas, sin chequeo de concurrencia (P-6), y con la disponibilidad de
 * cada modo calculada en el servidor con los datos del momento.
 */
import { describe, expect, it } from "vitest";

import { accionesVisibles, disponibilidadDe } from "../acciones/disponibilidad";
import { REGISTRO_DE_ACCIONES } from "../acciones/registro";
import { armarVentana } from "../ventana/armar";
import { CONFIRMACIONES_COMPLETAS, filaVentana, leidosVentanaDelFalso, OPERADORES_DE_PRUEBA } from "../ventana/prueba-datos";

const AHORA = new Date("2026-11-24T18:00:00Z");
const CODIGOS = ["add_note", "send_email", "send_text", "discard_ai_draft"];
const def = (codigo: string) => REGISTRO_DE_ACCIONES.find((d) => d.codigo === codigo)!;

function ventana(n: number, parche: { disponible?: boolean; hilos?: string[]; instruccionAbierta?: boolean; cancelado?: boolean } = {}) {
  const leidos = leidosVentanaDelFalso(AHORA);
  if (parche.cancelado) leidos.jobs = leidos.jobs.map((j) => (j.bzzzbx_job_id === `bx-job-000${n}` ? { ...j, status: "cancelled" as const } : j));
  return armarVentana({
    fila: filaVentana(AHORA, n),
    leidos,
    hilos: parche.hilos ?? [`bx-thread-000${n}`],
    operadores: OPERADORES_DE_PRUEBA,
    confirmaciones: CONFIRMACIONES_COMPLETAS,
    instruccionAbierta: parche.instruccionAbierta ?? false,
    ahora: AHORA,
    zona: "UTC",
    bzzzbx: { disponible: parche.disponible ?? true, actualizadoEn: AHORA.toISOString() },
    tab: null,
  });
}

describe("registro de acciones: la conversación (OPR-27, P-6)", () => {
  it("las cuatro están, son internas y no comparan la versión de la request", () => {
    for (const codigo of CODIGOS) {
      expect(def(codigo), codigo).toMatchObject({ interna: true, concurrencia: "ninguna", enRelease: true, motivo: "no" });
      expect(def(codigo).ejecutor, codigo).toBeTypeOf("function");
    }
  });

  it("ninguna sale en la action bar", () => {
    const visibles = accionesVisibles(ventana(2)).map((a) => a.codigo);
    for (const codigo of CODIGOS) expect(visibles).not.toContain(codigo);
  });

  it("el resto del registro conserva el chequeo de concurrencia por defecto", () => {
    expect(REGISTRO_DE_ACCIONES.filter((d) => !CODIGOS.includes(d.codigo)).every((d) => d.concurrencia === undefined)).toBe(true);
  });

  it("en R2 (Requests, con hilo y cleaner) las cuatro corren, también con una instrucción abierta", () => {
    for (const abierta of [false, true]) {
      for (const codigo of CODIGOS) {
        expect(disponibilidadDe(def(codigo), ventana(2, { instruccionAbierta: abierta })), `${codigo} abierta=${abierta}`).toEqual({ tipo: "disponible" });
      }
    }
  });

  it("con BzzzBX caído, los envíos se bloquean y la nota y el descarte siguen", () => {
    const v = ventana(2, { disponible: false });
    expect(disponibilidadDe(def("send_email"), v)).toEqual({ tipo: "bloqueada", motivo: "BzzzBX unavailable" });
    expect(disponibilidadDe(def("send_text"), v)).toEqual({ tipo: "bloqueada", motivo: "BzzzBX unavailable" });
    expect(disponibilidadDe(def("add_note"), v)).toEqual({ tipo: "disponible" });
    expect(disponibilidadDe(def("discard_ai_draft"), v)).toEqual({ tipo: "disponible" });
  });

  it("sin hilo de correo, solo send_email se bloquea; sin cleaner, solo send_text", () => {
    expect(disponibilidadDe(def("send_email"), ventana(2, { hilos: [] }))).toEqual({
      tipo: "bloqueada",
      motivo: "No email thread for this request",
    });
    expect(disponibilidadDe(def("send_text"), ventana(2, { hilos: [] }))).toEqual({ tipo: "disponible" });
    // R1 (Requests, sin cleaner elegido).
    expect(disponibilidadDe(def("send_text"), ventana(1))).toEqual({ tipo: "bloqueada", motivo: "Choose a cleaner first" });
    expect(disponibilidadDe(def("send_email"), ventana(1))).toEqual({ tipo: "disponible" });
  });

  it("desde Scheduled el cleaner es el del job", () => {
    const v = ventana(3);
    expect(v.equipoId).toBe("bx-team-0002");
    expect(disponibilidadDe(def("send_text"), v)).toEqual({ tipo: "disponible" });
  });

  it("con el job cancelado ninguna aplica", () => {
    const v = ventana(3, { cancelado: true });
    expect(v.etapa).toBe("cancelled");
    for (const codigo of CODIGOS) expect(disponibilidadDe(def(codigo), v), codigo).toEqual({ tipo: "no_aplica" });
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";

import { armarVentana } from "../ventana/armar";
import {
  CONFIRMACIONES_COMPLETAS,
  filaVentana,
  leidosVentanaDelFalso,
  OPERADORES_DE_PRUEBA,
  SIN_CONFIRMACIONES,
} from "../ventana/prueba-datos";
import type { VentanaJob } from "../ventana/tipos";

import { accionesVisibles, disponibilidadDe, nota } from "./disponibilidad";
import { BZZZBX_NO_DISPONIBLE, FUERA_DE_RELEASE, NO_CONSTRUIDA } from "./disponibilidad";
import type { DefinicionAccion } from "./tipos";

const AHORA = new Date("2026-11-24T18:00:00Z");

function ventana(n: number, parche: { disponible?: boolean; instruccionAbierta?: boolean; sinConfirmar?: boolean } = {}): VentanaJob {
  return armarVentana({
    fila: filaVentana(AHORA, n),
    leidos: leidosVentanaDelFalso(AHORA),
    hilos: [`bx-thread-000${n}`],
    operadores: OPERADORES_DE_PRUEBA,
    confirmaciones: n === 1 || parche.sinConfirmar ? SIN_CONFIRMACIONES : CONFIRMACIONES_COMPLETAS,
    instruccionAbierta: parche.instruccionAbierta ?? false,
    ahora: AHORA,
    zona: "UTC",
    bzzzbx: { disponible: parche.disponible ?? true, actualizadoEn: AHORA.toISOString() },
    tab: null,
  });
}

const ejecutor: NonNullable<DefinicionAccion["ejecutor"]> = async () => ({ tipo: "guardada" });

const def = (parche: Partial<DefinicionAccion> = {}): DefinicionAccion => ({
  codigo: "prueba",
  etiqueta: "Prueba",
  descripcion: "Una acción de prueba.",
  etapas: ["scheduled"],
  enRelease: true,
  motivo: "no",
  necesitaBzzzbx: false,
  ejecutor,
  ...parche,
});

describe("disponibilidad: los cinco valores (§5.2)", () => {
  it("disponible: es de la etapa, está en el release, tiene ejecutor y nada la bloquea", () => {
    expect(disponibilidadDe(def(), ventana(3))).toEqual({ tipo: "disponible" });
  });

  it("no_aplica: no es de la etapa del job", () => {
    expect(disponibilidadDe(def({ etapas: ["complete"] }), ventana(3))).toEqual({ tipo: "no_aplica" });
  });

  it("no_aplica en un job cancelado, sea cual sea la acción", () => {
    const cancelada = { ...ventana(3), etapa: "cancelled" as const };
    expect(disponibilidadDe(def(), cancelada)).toEqual({ tipo: "no_aplica" });
    expect(disponibilidadDe(def({ enRelease: false }), cancelada)).toEqual({ tipo: "no_aplica" });
  });

  it("fuera_de_release: es de la etapa pero no entra en V1.1 beta", () => {
    expect(disponibilidadDe(def({ enRelease: false }), ventana(3))).toEqual({ tipo: "fuera_de_release" });
  });

  it("sin_construir: entra en V1.1 beta pero su tarjeta aún no registró el ejecutor (P-4)", () => {
    expect(disponibilidadDe(def({ ejecutor: undefined }), ventana(3))).toEqual({ tipo: "sin_construir" });
  });

  it("bloqueada: con el motivo propio de la acción", () => {
    expect(disponibilidadDe(def({ bloqueo: () => "Add PO" }), ventana(3))).toEqual({ tipo: "bloqueada", motivo: "Add PO" });
    expect(disponibilidadDe(def({ bloqueo: () => null }), ventana(3))).toEqual({ tipo: "disponible" });
  });
});

describe("disponibilidad: BzzzBX caído e instrucción en curso", () => {
  it("BzzzBX caído bloquea solo las que lo necesitan (S-13)", () => {
    const caido = ventana(3, { disponible: false });
    expect(disponibilidadDe(def({ necesitaBzzzbx: true }), caido)).toEqual({ tipo: "bloqueada", motivo: BZZZBX_NO_DISPONIBLE });
    expect(disponibilidadDe(def({ necesitaBzzzbx: false }), caido)).toEqual({ tipo: "disponible" });
  });

  it("una instrucción abierta bloquea las que mandan instrucción hasta que cierre", () => {
    const enCurso = ventana(3, { instruccionAbierta: true });
    expect(disponibilidadDe(def({ necesitaBzzzbx: true }), enCurso)).toEqual({ tipo: "bloqueada", motivo: "Instruction in progress" });
    expect(disponibilidadDe(def({ necesitaBzzzbx: false }), enCurso)).toEqual({ tipo: "disponible" });
  });

  it("el orden: no_aplica, fuera_de_release, bloqueada y al final sin_construir", () => {
    const caido = ventana(3, { disponible: false });
    const sinEjecutor = def({ ejecutor: undefined, necesitaBzzzbx: true });
    expect(disponibilidadDe(sinEjecutor, caido)).toEqual({ tipo: "bloqueada", motivo: BZZZBX_NO_DISPONIBLE });
    expect(disponibilidadDe({ ...sinEjecutor, enRelease: false }, caido)).toEqual({ tipo: "fuera_de_release" });
    expect(disponibilidadDe({ ...sinEjecutor, enRelease: false, etapas: ["complete"] }, caido)).toEqual({ tipo: "no_aplica" });
  });
});

describe("disponibilidad: el texto en gris", () => {
  it("cada valor dice lo suyo", () => {
    expect(nota({ tipo: "disponible" })).toBeNull();
    expect(nota({ tipo: "no_aplica" })).toBeNull();
    expect(nota({ tipo: "sin_construir" })).toBe(NO_CONSTRUIDA);
    expect(nota({ tipo: "fuera_de_release" })).toBe(FUERA_DE_RELEASE);
    expect(nota({ tipo: "bloqueada", motivo: "Add PO" })).toBe("Add PO");
    expect(NO_CONSTRUIDA).toBe("Not built yet");
    expect(FUERA_DE_RELEASE).toBe("Not available in this release");
  });
});

describe("accionesVisibles con el registro real (§5.3)", () => {
  const etiquetas = (n: number, parche?: Parameters<typeof ventana>[1]) =>
    accionesVisibles(ventana(n, parche)).map((a) => a.etiqueta);

  it("Requests: las suyas y ninguna de otra etapa; la interna del enlace no sale", () => {
    expect(etiquetas(2)).toEqual([
      "Assign / Reassign",
      "Confirm details",
      "Confirm sender",
      "Confirm cleaner",
      "Ask cleaner",
      "Schedule",
    ]);
  });

  it("Scheduled, In Progress, Complete y Validation", () => {
    expect(etiquetas(3)).toEqual(["Reschedule", "Cancel job"]);
    expect(etiquetas(4)).toEqual(["Clear alert", "End manually"]);
    expect(etiquetas(5)).toEqual(["Approve & confirm", "Mark as OSS / Not OSS", "Reject · re-clean"]);
    expect(etiquetas(6)).toEqual(["Enter PO", "Validate"]);
  });

  it("en OPR-26 ninguna corre: las de V1.1 beta salen Not built yet y Reject · re-clean fuera del release", () => {
    for (const n of [2, 3, 4, 5, 6]) {
      for (const accion of accionesVisibles(ventana(n))) {
        expect(accion.disponibilidad.tipo, `${accion.etiqueta} en R${n}`).not.toBe("disponible");
      }
    }
    const complete = accionesVisibles(ventana(5));
    expect(complete.find((a) => a.etiqueta === "Reject · re-clean")).toMatchObject({
      disponibilidad: { tipo: "fuera_de_release" },
      nota: "Not available in this release",
    });
    expect(complete.find((a) => a.etiqueta === "Approve & confirm")).toMatchObject({
      disponibilidad: { tipo: "sin_construir" },
      nota: "Not built yet",
    });
  });

  it("BzzzBX caído: las que lo necesitan dicen BzzzBX unavailable; las que no, Not built yet", () => {
    const acciones = accionesVisibles(ventana(3, { disponible: false }));
    expect(acciones.map((a) => [a.etiqueta, a.nota])).toEqual([
      ["Reschedule", "BzzzBX unavailable"],
      ["Cancel job", "BzzzBX unavailable"],
    ]);
    const requests = accionesVisibles(ventana(2, { disponible: false }));
    expect(requests.find((a) => a.etiqueta === "Assign / Reassign")!.nota).toBe("Not built yet");
    expect(requests.find((a) => a.etiqueta === "Ask cleaner")!.nota).toBe("BzzzBX unavailable");
  });

  it("un job cancelado no tiene acciones", () => {
    const cancelada = { ...ventana(3), etapa: "cancelled" as const };
    expect(accionesVisibles(cancelada)).toEqual([]);
  });

  it("bloqueos por dato que falta (§6.2)", () => {
    const r1 = accionesVisibles(ventana(1));
    expect(r1.find((a) => a.codigo === "schedule")!.nota).toBe("Confirm who it is from first");
    const sinPropiedad = { ...ventana(1), datos: { tienePropiedad: false, poRequerido: false, tienePo: false } };
    expect(accionesVisibles(sinPropiedad).find((a) => a.codigo === "schedule")!.nota).toBe("Choose a property first");
    expect(accionesVisibles(sinPropiedad).find((a) => a.codigo === "ask_cleaner")!.nota).toBe("Choose a property first");
    const sinPo = { ...ventana(6), datos: { tienePropiedad: true, poRequerido: true, tienePo: false } };
    expect(accionesVisibles(sinPo).find((a) => a.codigo === "record_validation")!.nota).toBe("Add PO");
    expect(accionesVisibles(ventana(6)).find((a) => a.codigo === "record_validation")!.nota).toBe("Not built yet");
  });

  it("el motivo de cada acción sale del registro", () => {
    const porCodigo = (n: number) => Object.fromEntries(accionesVisibles(ventana(n)).map((a) => [a.codigo, a.motivo]));
    expect(porCodigo(3)).toEqual({ reschedule_job: "obligatorio", cancel_job: "obligatorio" });
    expect(porCodigo(4)).toEqual({ clear_alert: "obligatorio", end_job_manually: "obligatorio" });
    expect(porCodigo(2).schedule).toBe("no");
  });
});

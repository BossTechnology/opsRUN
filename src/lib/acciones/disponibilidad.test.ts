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
import type { FilaVentana, VentanaJob } from "../ventana/tipos";

import { accionesVisibles, disponibilidadDe, nota } from "./disponibilidad";
import { BZZZBX_NO_DISPONIBLE, FASE_B, FUERA_DE_RELEASE, NO_CONSTRUIDA } from "./disponibilidad";
import type { DefinicionAccion } from "./tipos";

const AHORA = new Date("2026-11-24T18:00:00Z");

function ventana(
  n: number,
  parche: { disponible?: boolean; instruccionAbierta?: boolean; sinConfirmar?: boolean; fila?: Partial<FilaVentana> } = {},
): VentanaJob {
  return armarVentana({
    fila: { ...filaVentana(AHORA, n), ...parche.fila },
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

  it("solo corren las que ya tienen ejecutor (Requests de OPR-28 y las etapas de OPR-30 a OPR-32); Reject · re-clean está fuera del release y Reschedule, Cancel job y End manually son de la Fase B", () => {
    const conEjecutor = [
      "schedule", "assign", "confirm_details", "confirm_sender", "confirm_cleaner",
      "clear_alert", "mark_oss", "approve_confirm", "write_po", "record_validation",
    ];
    for (const n of [2, 3, 4, 5, 6]) {
      for (const accion of accionesVisibles(ventana(n, { fila: { validated_at: null, validated_by_nombre: null } }))) {
        if (conEjecutor.includes(accion.codigo)) continue;
        expect(accion.disponibilidad.tipo, `${accion.etiqueta} en R${n}`).not.toBe("disponible");
      }
    }
    expect(accionesVisibles(ventana(2)).find((a) => a.codigo === "schedule")!.disponibilidad).toEqual({ tipo: "disponible" });
    const complete = accionesVisibles(ventana(5));
    expect(complete.find((a) => a.etiqueta === "Reject · re-clean")).toMatchObject({
      disponibilidad: { tipo: "fuera_de_release" },
      nota: "Not available in this release",
    });
    expect(complete.find((a) => a.etiqueta === "Approve & confirm")).toMatchObject({ disponibilidad: { tipo: "disponible" }, nota: null });
  });

  it("Fase B (OPR-30, P-10): Reschedule, Cancel job y End manually salen fuera_de_release con 'Available when actions are switched on', con o sin BzzzBX", () => {
    for (const disponible of [true, false]) {
      for (const [n, etiqueta] of [[3, "Reschedule"], [3, "Cancel job"], [4, "End manually"]] as const) {
        const accion = accionesVisibles(ventana(n, { disponible })).find((a) => a.etiqueta === etiqueta)!;
        expect(accion.disponibilidad, `${etiqueta} con BzzzBX ${disponible}`).toEqual({ tipo: "fuera_de_release", fase: "b" });
        expect(accion.nota).toBe(FASE_B);
      }
    }
    expect(FASE_B).toBe("Available when actions are switched on");
  });

  it("BzzzBX caído: las que lo necesitan dicen BzzzBX unavailable; las que no, siguen disponibles", () => {
    const acciones = accionesVisibles(ventana(3, { disponible: false }));
    // Reschedule y Cancel job son de la Fase B: eso manda sobre BzzzBX caído.
    expect(acciones.map((a) => [a.etiqueta, a.nota])).toEqual([
      ["Reschedule", "Available when actions are switched on"],
      ["Cancel job", "Available when actions are switched on"],
    ]);
    const requests = accionesVisibles(ventana(2, { disponible: false }));
    // Assign y Confirm solo escriben una decisión en opsRUN: siguen disponibles sin BzzzBX (S-13).
    expect(requests.find((a) => a.etiqueta === "Assign / Reassign")!.disponibilidad).toEqual({ tipo: "disponible" });
    expect(requests.find((a) => a.etiqueta === "Ask cleaner")!.nota).toBe("BzzzBX unavailable");
  });

  it("un job cancelado no tiene acciones", () => {
    const cancelada = { ...ventana(3), etapa: "cancelled" as const };
    expect(accionesVisibles(cancelada)).toEqual([]);
  });

  it("bloqueos por dato que falta (§6.2)", () => {
    const r1 = accionesVisibles(ventana(1));
    expect(r1.find((a) => a.codigo === "schedule")!.nota).toBe("Confirm who it is from first");
    const sinPropiedad = { ...ventana(1), datos: { ...ventana(1).datos, tienePropiedad: false, poRequerido: false, tienePo: false } };
    expect(accionesVisibles(sinPropiedad).find((a) => a.codigo === "schedule")!.nota).toBe("Choose a property first");
    expect(accionesVisibles(sinPropiedad).find((a) => a.codigo === "ask_cleaner")!.nota).toBe("Choose a property first");
    const r6 = ventana(6, { fila: { validated_at: null, validated_by_nombre: null } });
    const sinPo = { ...r6, datos: { ...r6.datos, tienePropiedad: true, poRequerido: true, tienePo: false, poVigente: null } };
    expect(accionesVisibles(sinPo).find((a) => a.codigo === "record_validation")!.nota).toBe("Add PO");
    expect(accionesVisibles(r6).find((a) => a.codigo === "record_validation")!.disponibilidad).toEqual({ tipo: "disponible" });
  });

  it("el motivo de cada acción sale del registro", () => {
    const porCodigo = (n: number) => Object.fromEntries(accionesVisibles(ventana(n)).map((a) => [a.codigo, a.motivo]));
    expect(porCodigo(3)).toEqual({ reschedule_job: "obligatorio", cancel_job: "obligatorio" });
    expect(porCodigo(4)).toEqual({ clear_alert: "obligatorio", end_job_manually: "obligatorio" });
    // OPR-31: el motivo de Mark as OSS es opcional; Approve, Enter PO y Validate no lo piden.
    expect(porCodigo(5)).toMatchObject({ approve_confirm: "no", mark_oss: "opcional" });
    expect(porCodigo(6)).toEqual({ write_po: "no", record_validation: "no" });
    expect(porCodigo(2).schedule).toBe("no");
    // OPR-28, P-1 y P-6: el motivo de asignar y el del cleaner es opcional; details y sender no lo piden.
    expect(porCodigo(2)).toMatchObject({
      assign: "opcional",
      confirm_details: "no",
      confirm_sender: "no",
      confirm_cleaner: "opcional",
    });
  });
});

describe("las etapas (OPR-30 a OPR-32, spec §7.1)", () => {
  const codigo = (v: VentanaJob, c: string) => accionesVisibles(v).find((a) => a.codigo === c)!;
  const sinValidar = { validated_at: null, validated_by_nombre: null } as const;
  const sinPo = (v: VentanaJob): VentanaJob => ({ ...v, datos: { ...v.datos, poRequerido: true, tienePo: false, poVigente: null } });

  it("Clear alert: disponible con una alerta limpiable abierta (R4); 'No alert to clear' sin ella", () => {
    expect(codigo(ventana(4), "clear_alert").disponibilidad).toEqual({ tipo: "disponible" });
    const sinAlerta = ventana(4, { fila: { alertas_limpiadas: ["bx-alert-0006"] } });
    expect(codigo(sinAlerta, "clear_alert").disponibilidad).toEqual({ tipo: "bloqueada", motivo: "No alert to clear" });
    // Una alerta abierta de otra regla no se puede limpiar con Clear alert.
    const soloOtraRegla = { ...ventana(4), datos: { ...ventana(4).datos, alertasLimpiables: [] } };
    expect(codigo(soloOtraRegla, "clear_alert").nota).toBe("No alert to clear");
  });

  it("Clear alert necesita BzzzBX (vuelve a leer la alerta): caído, BzzzBX unavailable (P-5)", () => {
    expect(codigo(ventana(4, { disponible: false }), "clear_alert").disponibilidad).toEqual({ tipo: "bloqueada", motivo: BZZZBX_NO_DISPONIBLE });
  });

  it("Approve & confirm y Mark as OSS corren en Complete, también con BzzzBX caído o una instrucción abierta", () => {
    for (const parche of [{}, { disponible: false }, { instruccionAbierta: true }]) {
      const v = ventana(5, parche);
      expect(codigo(v, "approve_confirm").disponibilidad, JSON.stringify(parche)).toEqual({ tipo: "disponible" });
      expect(codigo(v, "mark_oss").disponibilidad, JSON.stringify(parche)).toEqual({ tipo: "disponible" });
    }
  });

  it("Enter PO corre en Validation con BzzzBX caído; con el job validado, 'Already validated'", () => {
    expect(codigo(ventana(6, { fila: sinValidar, disponible: false }), "write_po").disponibilidad).toEqual({ tipo: "disponible" });
    expect(codigo(ventana(6), "write_po").disponibilidad).toEqual({ tipo: "bloqueada", motivo: "Already validated" });
  });

  it("Validate: 'Already validated' primero, después 'Add PO', y sin BzzzBX 'BzzzBX unavailable'", () => {
    const r6 = ventana(6, { fila: sinValidar });
    expect(codigo(r6, "record_validation").disponibilidad).toEqual({ tipo: "disponible" });
    expect(codigo(ventana(6), "record_validation").nota).toBe("Already validated");
    expect(codigo(sinPo(r6), "record_validation").nota).toBe("Add PO");
    // Con las dos cosas a la vez manda "Already validated".
    expect(codigo(sinPo(ventana(6)), "record_validation").nota).toBe("Already validated");
    // Sin BzzzBX no se puede saber si el cliente exige PO: manda BzzzBX unavailable.
    expect(codigo(ventana(6, { fila: sinValidar, disponible: false }), "record_validation").nota).toBe("BzzzBX unavailable");
  });

  it("cualquiera de las tres fuentes de PO desbloquea Validate (P-2)", () => {
    const base = ventana(6, { fila: sinValidar });
    for (const fuente of ["opsrun", "pinch", "draft"] as const) {
      const v = { ...base, datos: { ...base.datos, poRequerido: true, tienePo: true, poVigente: { valor: "PO-1", fuente } } };
      expect(codigo(v, "record_validation").disponibilidad, fuente).toEqual({ tipo: "disponible" });
    }
  });
});

describe("Assign y Confirm (OPR-28, spec §4 y §7)", () => {
  const codigo = (v: VentanaJob, c: string) => accionesVisibles(v).find((a) => a.codigo === c)!;
  const con = (v: VentanaJob, parche: Partial<VentanaJob>) => ({ ...v, ...parche });
  const sinConfirmar = (n: number) => ventana(n, { sinConfirmar: true });

  it("las cuatro son de Requests: en Scheduled y después no aplican", () => {
    for (const n of [3, 4, 5, 6]) {
      const codigos = accionesVisibles(ventana(n)).map((a) => a.codigo);
      for (const c of ["assign", "confirm_details", "confirm_sender", "confirm_cleaner"]) expect(codigos).not.toContain(c);
    }
  });

  it("Assign corre en una request sin dueño y en una con dueño, sin bloqueo", () => {
    expect(codigo(ventana(1), "assign").disponibilidad).toEqual({ tipo: "disponible" });
    expect(codigo(ventana(2), "assign").disponibilidad).toEqual({ tipo: "disponible" });
  });

  it("con BzzzBX caído o una instrucción abierta, las cuatro siguen disponibles: no son instrucciones (S-13)", () => {
    for (const parche of [{ disponible: false }, { instruccionAbierta: true }]) {
      const v = ventana(2, { ...parche, sinConfirmar: true });
      for (const c of ["assign", "confirm_details", "confirm_sender", "confirm_cleaner"]) {
        expect(codigo(v, c).disponibilidad, `${c} con ${JSON.stringify(parche)}`).toEqual({ tipo: "disponible" });
      }
    }
  });

  it("Confirm details: Already confirmed primero, después lo que falta", () => {
    expect(codigo(ventana(2), "confirm_details").disponibilidad).toEqual({ tipo: "bloqueada", motivo: "Already confirmed" });
    const r1 = sinConfirmar(1);
    expect(codigo(r1, "confirm_details").disponibilidad).toEqual({
      tipo: "bloqueada",
      motivo: "Complete the details first: Service, Date, Window",
    });
    // Con una confirmación vigente y datos que faltan, manda "Already confirmed".
    const ambas = con(r1, { gate: { ...r1.gate, details: true } });
    expect(codigo(ambas, "confirm_details").nota).toBe("Already confirmed");
    expect(codigo(sinConfirmar(2), "confirm_details").disponibilidad).toEqual({ tipo: "disponible" });
  });

  it("Confirm sender: Already confirmed primero, después 'Choose who it is from first'", () => {
    expect(codigo(ventana(2), "confirm_sender").nota).toBe("Already confirmed");
    expect(codigo(sinConfirmar(1), "confirm_sender").nota).toBe("Choose who it is from first");
    const ambas = con(sinConfirmar(1), { gate: { dueno: false, details: false, sender: true, cleaner: false } });
    expect(codigo(ambas, "confirm_sender").nota).toBe("Already confirmed");
    expect(codigo(sinConfirmar(2), "confirm_sender").disponibilidad).toEqual({ tipo: "disponible" });
  });

  it("Confirm cleaner: Already confirmed primero, después 'Choose a cleaner first'", () => {
    expect(codigo(ventana(2), "confirm_cleaner").nota).toBe("Already confirmed");
    expect(codigo(sinConfirmar(1), "confirm_cleaner").nota).toBe("Choose a cleaner first");
    const ambas = con(sinConfirmar(1), { gate: { dueno: false, details: false, sender: false, cleaner: true } });
    expect(codigo(ambas, "confirm_cleaner").nota).toBe("Already confirmed");
    expect(codigo(sinConfirmar(2), "confirm_cleaner").disponibilidad).toEqual({ tipo: "disponible" });
  });

  it("el bloqueo de Schedule no cambia", () => {
    expect(codigo(sinConfirmar(2), "schedule").nota).toBe("Confirm who it is from first");
  });
});

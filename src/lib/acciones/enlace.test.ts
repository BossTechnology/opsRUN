// @vitest-environment node
/**
 * Los ejecutores del enlace de la Fase A (OPR-28): `schedule` y
 * `reject_job_link`, contra el falso de BzzzBX y unos datos de opsRUN en
 * memoria. También, que pasan por `ejecutarAccion` y que el registro real los
 * tiene registrados.
 */
import { describe, expect, it, vi } from "vitest";

import { BzzzbxNoDisponible } from "../bzzzbx/errores";
import { crearFalso } from "../bzzzbx/falso";
import type { DatosDeEnlace } from "../fase-a/enlace";
import { armarVentana } from "../ventana/armar";
import { CONFIRMACIONES_COMPLETAS, filaVentana, leidosVentanaDelFalso, OPERADORES_DE_PRUEBA } from "../ventana/prueba-datos";

import { disponibilidadDe } from "./disponibilidad";
import { crearEjecutoresDeEnlace, MENSAJE_BZZZBX_CAIDO, MENSAJE_SIN_JOB, MENSAJES_DE_ENLACE } from "./enlace";
import { ejecutar } from "./ejecutar";
import { REGISTRO_DE_ACCIONES } from "./registro";
import type { ContextoAccion, DefinicionAccion, EntradaAccion } from "./tipos";

const AHORA = new Date("2026-11-24T18:00:00Z");
const R7 = "b0000000-0000-4000-8000-0000000000a7";
const ACTOR = { tipo: "operador", authUserId: "de000000-0000-4000-8000-0000000000a1" } as const;

function preparar() {
  const falso = crearFalso();
  const datos = {
    leerRequest: vi.fn(async () => null),
    jobsEnlazadosAOtra: vi.fn(async () => new Set<string>()),
    jobsRechazados: vi.fn(async () => new Set<string>()),
    enlazar: vi.fn(async () => {}),
    rechazar: vi.fn(async () => {}),
  } satisfies DatosDeEnlace;
  const ejecutores = crearEjecutoresDeEnlace(async () => ({ lectura: falso.lectura, datos }));
  return { falso, datos, ...ejecutores };
}

const ventanaR2 = armarVentana({
  fila: filaVentana(AHORA, 2),
  leidos: leidosVentanaDelFalso(AHORA),
  hilos: ["bx-thread-0002"],
  operadores: OPERADORES_DE_PRUEBA,
  confirmaciones: CONFIRMACIONES_COMPLETAS,
  instruccionAbierta: false,
  ahora: AHORA,
  zona: "UTC",
  bzzzbx: { disponible: true, actualizadoEn: AHORA.toISOString() },
  tab: null,
});

const ctx: ContextoAccion = { actor: ACTOR, ventana: ventanaR2 };
const entrada = (codigo: string, datos: Record<string, unknown>, motivo: string | null = null): EntradaAccion => ({
  requestId: R7,
  codigo,
  motivo,
  datos,
  version: ventanaR2.version,
});

/** Un error que llega de otra copia del módulo: `instanceof` no lo reconoce, el nombre sí. */
function deOtraCopia(nombre: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(nombre), { name: nombre }, extra);
}

describe("schedule: confirmar el enlace", () => {
  it("relee el job, toma su job number y lo enlaza con el actor de la transacción", async () => {
    const { schedule, datos } = preparar();
    expect(await schedule(ctx, entrada("schedule", { bzzzbx_job_id: "bx-job-0107" }))).toEqual({ tipo: "guardada" });
    expect(datos.enlazar).toHaveBeenCalledWith({ requestId: R7, bzzzbxJobId: "bx-job-0107", jobNumber: "EX-00107" }, ACTOR);
  });

  it.each([[{}], [{ bzzzbx_job_id: "" }], [{ bzzzbx_job_id: "   " }], [{ bzzzbx_job_id: 7 }]])(
    "sin un job elegido (%j) no llama a la base ni a BzzzBX",
    async (datosDeEntrada) => {
      const { schedule, datos, falso } = preparar();
      const leer = vi.spyOn(falso.lectura, "obtener");
      expect(await schedule(ctx, entrada("schedule", datosDeEntrada))).toEqual({
        tipo: "rechazada",
        codigo: "job_no_elegido",
        mensaje: MENSAJE_SIN_JOB,
      });
      expect(leer).not.toHaveBeenCalled();
      expect(datos.enlazar).not.toHaveBeenCalled();
    },
  );

  it("un job que BzzzBX no conoce no se enlaza", async () => {
    const { schedule, datos } = preparar();
    expect(await schedule(ctx, entrada("schedule", { bzzzbx_job_id: "bx-job-no-existe" }))).toEqual({
      tipo: "rechazada",
      codigo: "job_no_encontrado",
      mensaje: MENSAJES_DE_ENLACE.job_no_encontrado,
    });
    expect(datos.enlazar).not.toHaveBeenCalled();
  });

  it("un job cancelado no se enlaza", async () => {
    const { schedule, datos } = preparar();
    expect(await schedule(ctx, entrada("schedule", { bzzzbx_job_id: "bx-job-0104" }))).toMatchObject({
      tipo: "rechazada",
      codigo: "job_cancelado",
    });
    expect(datos.enlazar).not.toHaveBeenCalled();
  });

  it.each(["gate_incompleto", "job_ya_enlazado", "request_no_abierta", "request_no_encontrada"] as const)(
    "%s de la función SQL llega al panel como mensaje, reconocido por nombre y no por instanceof",
    async (codigo) => {
      const { schedule, datos } = preparar();
      datos.enlazar.mockRejectedValueOnce(deOtraCopia("EnlaceInvalido", { codigo }));
      expect(await schedule(ctx, entrada("schedule", { bzzzbx_job_id: "bx-job-0107" }))).toEqual({
        tipo: "rechazada",
        codigo,
        mensaje: MENSAJES_DE_ENLACE[codigo],
      });
    },
  );

  it("BzzzBX caído al releer el job es un resultado, reconocido por nombre", async () => {
    const { schedule, datos, falso } = preparar();
    vi.spyOn(falso.lectura, "obtener").mockRejectedValueOnce(deOtraCopia("BzzzbxNoDisponible"));
    expect(await schedule(ctx, entrada("schedule", { bzzzbx_job_id: "bx-job-0107" }))).toEqual({
      tipo: "rechazada",
      codigo: "bzzzbx_no_disponible",
      mensaje: MENSAJE_BZZZBX_CAIDO,
    });
    expect(datos.enlazar).not.toHaveBeenCalled();
  });

  it("lo que no es del operador sube, para que ejecutarAccion lo registre sin detalles hacia el navegador", async () => {
    const { schedule, datos } = preparar();
    datos.enlazar.mockRejectedValueOnce(new Error("connection reset"));
    await expect(schedule(ctx, entrada("schedule", { bzzzbx_job_id: "bx-job-0107" }))).rejects.toThrow("connection reset");
    // Un Error cualquiera que se llame parecido pero no traiga código tampoco se confunde.
    datos.enlazar.mockRejectedValueOnce(deOtraCopia("EnlaceInvalido"));
    await expect(schedule(ctx, entrada("schedule", { bzzzbx_job_id: "bx-job-0107" }))).rejects.toThrow();
  });
});

describe("reject_job_link: rechazar un candidato", () => {
  it("registra el rechazo con el motivo recortado y sin tocar BzzzBX", async () => {
    const { reject_job_link, datos, falso } = preparar();
    const leer = vi.spyOn(falso.lectura, "obtener");
    expect(await reject_job_link(ctx, entrada("reject_job_link", { bzzzbx_job_id: "bx-job-0107" }, "  Wrong building  "))).toEqual({
      tipo: "guardada",
    });
    expect(datos.rechazar).toHaveBeenCalledWith({ requestId: R7, bzzzbxJobId: "bx-job-0107", motivo: "Wrong building" }, ACTOR);
    expect(leer).not.toHaveBeenCalled();
  });

  it("el motivo es opcional", async () => {
    const { reject_job_link, datos } = preparar();
    await reject_job_link(ctx, entrada("reject_job_link", { bzzzbx_job_id: "bx-job-0107" }));
    expect(datos.rechazar).toHaveBeenCalledWith({ requestId: R7, bzzzbxJobId: "bx-job-0107", motivo: null }, ACTOR);
  });

  it("sin un job elegido no llama a la base", async () => {
    const { reject_job_link, datos } = preparar();
    expect(await reject_job_link(ctx, entrada("reject_job_link", {}))).toMatchObject({ tipo: "rechazada", codigo: "job_no_elegido" });
    expect(datos.rechazar).not.toHaveBeenCalled();
  });

  it("request_no_abierta de la función SQL llega como mensaje", async () => {
    const { reject_job_link, datos } = preparar();
    datos.rechazar.mockRejectedValueOnce(deOtraCopia("EnlaceInvalido", { codigo: "request_no_abierta" }));
    expect(await reject_job_link(ctx, entrada("reject_job_link", { bzzzbx_job_id: "bx-job-0107" }))).toMatchObject({
      tipo: "rechazada",
      codigo: "request_no_abierta",
    });
  });
});

describe("el registro real", () => {
  const def = (codigo: string): DefinicionAccion => REGISTRO_DE_ACCIONES.find((d) => d.codigo === codigo)!;

  it("schedule y reject_job_link tienen ejecutor, igual que Assign y Confirm (OPR-28, requests.test.ts)", () => {
    for (const codigo of ["schedule", "reject_job_link", "assign", "confirm_details", "confirm_sender", "confirm_cleaner"]) {
      expect(def(codigo).ejecutor, codigo).toBeTypeOf("function");
    }
  });

  it("schedule está disponible en una request con propiedad y remitente confirmado, y se bloquea sin BzzzBX", () => {
    expect(disponibilidadDe(def("schedule"), ventanaR2)).toEqual({ tipo: "disponible" });
    const caido = { ...ventanaR2, bzzzbx: { disponible: false, actualizadoEn: null } };
    expect(disponibilidadDe(def("schedule"), caido)).toEqual({ tipo: "bloqueada", motivo: "BzzzBX unavailable" });
    // El rechazo solo escribe en opsRUN: sigue disponible con BzzzBX caído (S-13).
    expect(disponibilidadDe(def("reject_job_link"), caido)).toEqual({ tipo: "disponible" });
  });

  it("schedule no está disponible fuera de Requests", () => {
    const programada = { ...ventanaR2, etapa: "scheduled" as const };
    expect(disponibilidadDe(def("schedule"), programada)).toEqual({ tipo: "no_aplica" });
    expect(disponibilidadDe(def("reject_job_link"), programada)).toEqual({ tipo: "no_aplica" });
  });

  it("por ejecutarAccion: confirmar con BzzzBX caído se rechaza antes del ejecutor, y rechazar corre con su actor", async () => {
    const ejecutorSchedule = vi.fn(async () => ({ tipo: "guardada" as const }));
    const ejecutorRechazo = vi.fn(async () => ({ tipo: "guardada" as const }));
    const registro = REGISTRO_DE_ACCIONES.map((d) =>
      d.codigo === "schedule" ? { ...d, ejecutor: ejecutorSchedule } : d.codigo === "reject_job_link" ? { ...d, ejecutor: ejecutorRechazo } : d,
    );
    const caido = { ...ventanaR2, bzzzbx: { disponible: false, actualizadoEn: null } };
    const deps = (v: typeof ventanaR2) => ({
      registro,
      leerVentana: async () => v,
      actor: async () => ACTOR,
      refrescar: vi.fn(async () => {}),
    });

    const sinBzzzbx = await ejecutar(deps(caido), entrada("schedule", { bzzzbx_job_id: "bx-job-0107" }));
    expect(sinBzzzbx).toMatchObject({ tipo: "rechazada", codigo: "no_disponible", mensaje: "BzzzBX unavailable" });
    expect(ejecutorSchedule).not.toHaveBeenCalled();

    const conBzzzbx = deps(ventanaR2);
    expect(await ejecutar(conBzzzbx, entrada("reject_job_link", { bzzzbx_job_id: "bx-job-0107" }, "No"))).toEqual({ tipo: "guardada" });
    expect(ejecutorRechazo).toHaveBeenCalledOnce();
    expect(conBzzzbx.refrescar).toHaveBeenCalledOnce();
  });
});

describe("BzzzbxNoDisponible de la clase real también se reconoce", () => {
  it("por nombre, sin importar de qué copia venga", async () => {
    const { schedule, falso } = preparar();
    vi.spyOn(falso.lectura, "obtener").mockRejectedValueOnce(new BzzzbxNoDisponible());
    expect(await schedule(ctx, entrada("schedule", { bzzzbx_job_id: "bx-job-0107" }))).toMatchObject({
      codigo: "bzzzbx_no_disponible",
    });
  });
});

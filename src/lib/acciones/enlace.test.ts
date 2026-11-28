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
    jobsReenlazados: vi.fn(async () => new Set<string>()),
    enlazar: vi.fn(async () => {}),
    rechazar: vi.fn(async () => {}),
    cambiar: vi.fn(async () => {}),
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

describe("relink_job: Change linked job (OPR-29)", () => {
  const R11 = "b0000000-0000-4000-8000-000000000a11";
  const conRequest = () => {
    const base = preparar();
    base.datos.leerRequest.mockResolvedValue({
      id: R11,
      status: "scheduled",
      bzzzbx_job_id: "bx-job-0103",
      change_seq: "211",
      received_at: AHORA.toISOString(),
      bzzzbx_customer_id: "bx-cust-0001",
      bzzzbx_property_id: "bx-prop-0002",
      service_date: "2026-11-26",
      window_start: null,
      window_end: null,
      bzzzbx_team_id: null,
    } as never);
    return base;
  };
  const entradaRelink = (datos: Record<string, unknown>, motivo: string | null = "PINCH replaced the job.") => ({
    ...entrada("relink_job", datos, motivo),
    requestId: R11,
    version: "211",
  });

  it("cambia el enlace con el actor de la transacción, la versión y el motivo", async () => {
    const { relink_job, datos } = conRequest();
    expect(await relink_job(ctx, entradaRelink({ bzzzbx_job_id: "bx-job-0102" }))).toEqual({ tipo: "guardada" });
    expect(datos.cambiar).toHaveBeenCalledWith(
      { requestId: R11, version: "211", bzzzbxJobId: "bx-job-0102", jobNumber: "EX-00102", motivo: "PINCH replaced the job." },
      ACTOR,
    );
  });

  it.each([[{}], [{ bzzzbx_job_id: "" }], [{ bzzzbx_job_id: 7 }]])("sin un job elegido (%j) no llama a la base ni a BzzzBX", async (datosDeEntrada) => {
    const { relink_job, datos, falso } = conRequest();
    const leer = vi.spyOn(falso.lectura, "obtener");
    expect(await relink_job(ctx, entradaRelink(datosDeEntrada))).toEqual({ tipo: "rechazada", codigo: "job_no_elegido", mensaje: MENSAJE_SIN_JOB });
    expect(datos.cambiar).not.toHaveBeenCalled();
    expect(leer).not.toHaveBeenCalled();
  });

  it("sin motivo no llama a la base", async () => {
    const { relink_job, datos } = conRequest();
    expect(await relink_job(ctx, entradaRelink({ bzzzbx_job_id: "bx-job-0102" }, null))).toMatchObject({ tipo: "rechazada", codigo: "motivo_requerido" });
    expect(datos.cambiar).not.toHaveBeenCalled();
  });

  it("cada error del operador sale como su rechazada, con su mensaje", async () => {
    for (const codigo of ["con_hechos_del_job", "mismo_job", "cambio_concurrente", "job_ya_enlazado", "request_no_programada"] as const) {
      const { relink_job, datos } = conRequest();
      datos.cambiar.mockRejectedValueOnce(deOtraCopia("EnlaceInvalido", { codigo }));
      expect(await relink_job(ctx, entradaRelink({ bzzzbx_job_id: "bx-job-0102" })), codigo).toEqual({
        tipo: "rechazada",
        codigo,
        mensaje: MENSAJES_DE_ENLACE[codigo],
      });
    }
  });

  it("con BzzzBX caído a mitad de la acción dice BzzzBX unavailable y no escribe", async () => {
    const { relink_job, datos, falso } = conRequest();
    vi.spyOn(falso.lectura, "obtener").mockRejectedValue(deOtraCopia("BzzzbxNoDisponible"));
    expect(await relink_job(ctx, entradaRelink({ bzzzbx_job_id: "bx-job-0102" }))).toEqual({
      tipo: "rechazada",
      codigo: "bzzzbx_no_disponible",
      mensaje: MENSAJE_BZZZBX_CAIDO,
    });
    expect(datos.cambiar).not.toHaveBeenCalled();
  });

  it("un 42501 (sin operador) sube: ejecutarAccion lo registra", async () => {
    const { relink_job, datos } = conRequest();
    datos.cambiar.mockRejectedValueOnce(Object.assign(new Error("sin operador"), { code: "42501" }));
    await expect(relink_job(ctx, entradaRelink({ bzzzbx_job_id: "bx-job-0102" }))).rejects.toMatchObject({ code: "42501" });
  });

  it("el registro real la tiene registrada: Scheduled y con el job cancelado, motivo obligatorio, necesita BzzzBX", () => {
    const def = REGISTRO_DE_ACCIONES.find((d) => d.codigo === "relink_job")!;
    expect(def).toMatchObject({ etiqueta: "Change linked job", etapas: ["scheduled"], conJobCancelado: true, motivo: "obligatorio", necesitaBzzzbx: true });
    expect(def.faseB).toBeUndefined();
    expect(def.ejecutor).toBeTypeOf("function");
  });

  it("pasa por ejecutarAccion: sin motivo no llega al ejecutor, y sin candidatos ni siquiera se elige", async () => {
    const llamado = vi.fn();
    const conCandidato = {
      ...ventanaR2,
      etapa: "scheduled" as const,
      datos: {
        ...ventanaR2.datos,
        candidatosDeCambio: [
          { bzzzbxJobId: "bx-job-0102", jobNumber: "EX-00102", fecha: "Nov 28", cleaner: "— —", coincide: ["misma_propiedad" as const], sugerido: false },
        ],
      },
    };
    const def = { ...REGISTRO_DE_ACCIONES.find((d) => d.codigo === "relink_job")!, ejecutor: llamado };
    const deps = (v: typeof conCandidato) => ({
      registro: [def],
      leerVentana: vi.fn(async () => v),
      actor: vi.fn(async () => ACTOR),
      refrescar: vi.fn(async () => {}),
    });
    const sinMotivo = await ejecutar(deps(conCandidato), { requestId: R11, codigo: "relink_job", motivo: "  ", datos: { bzzzbx_job_id: "bx-job-0102" }, version: conCandidato.version });
    expect(sinMotivo).toMatchObject({ tipo: "rechazada", codigo: "motivo_requerido" });
    const sinCandidatos = await ejecutar(deps({ ...conCandidato, datos: { ...conCandidato.datos, candidatosDeCambio: [] } }), {
      requestId: R11,
      codigo: "relink_job",
      motivo: "Because.",
      datos: { bzzzbx_job_id: "bx-job-0102" },
      version: conCandidato.version,
    });
    expect(sinCandidatos).toMatchObject({ tipo: "rechazada", codigo: "no_disponible", mensaje: "No other job to link" });
    expect(llamado).not.toHaveBeenCalled();
  });
});

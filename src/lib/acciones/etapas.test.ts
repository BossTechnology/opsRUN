// @vitest-environment node
/**
 * Los ejecutores de Clear alert, Mark as OSS, Approve & confirm, Enter PO y
 * Validate (OPR-30 a OPR-32, spec §7.1): arman la llamada con la versión, el
 * actor y lo leído de BzzzBX, traducen cada SQLSTATE por su código, rechazan sin
 * llamar a la base lo que viene mal formado, lo que BzzzBX ya no confirma y lo
 * que no se puede limpiar, y dejan subir lo demás. También, que pasan por
 * `ejecutarAccion` y que End manually, Reschedule y Cancel job (Fase B) nunca
 * corren.
 */
import { describe, expect, it, vi } from "vitest";

import { crearFalso, RelojManual } from "../bzzzbx/falso";
import type { Falso } from "../bzzzbx/falso";
import { EtapaInvalida, type CodigoEtapaInvalida, type DatosDeEtapas } from "../etapas/tipos";
import { armarVentana } from "../ventana/armar";
import {
  CONFIRMACIONES_COMPLETAS,
  filaVentana,
  leidosVentanaDelFalso,
  OPERADORES_DE_PRUEBA,
} from "../ventana/prueba-datos";
import type { FilaVentana, VentanaJob } from "../ventana/tipos";

import { ejecutar } from "./ejecutar";
import { crearEjecutoresDeEtapas, MENSAJE_SIN_ALERTA, MENSAJE_SIN_MARCA, MENSAJES_DE_ETAPAS } from "./etapas";
import { REGISTRO_DE_ACCIONES } from "./registro";
import type { ContextoAccion, EntradaAccion } from "./tipos";

const AHORA = new Date("2026-11-24T18:00:00Z");
const R = (n: number) => `b0000000-0000-4000-8000-0000000000a${n}`;
const ACTOR = { tipo: "operador", authUserId: "de000000-0000-4000-8000-0000000000a1" } as const;

function preparar() {
  const falso: Falso = crearFalso({ reloj: new RelojManual(AHORA) });
  const datos = {
    limpiarAlerta: vi.fn<DatosDeEtapas["limpiarAlerta"]>(async () => "ocurrencia-1"),
    marcarOss: vi.fn<DatosDeEtapas["marcarOss"]>(async () => {}),
    aprobar: vi.fn<DatosDeEtapas["aprobar"]>(async () => {}),
    capturarPo: vi.fn<DatosDeEtapas["capturarPo"]>(async () => {}),
    validar: vi.fn<DatosDeEtapas["validar"]>(async () => {}),
  } satisfies DatosDeEtapas;
  const obtener = vi.spyOn(falso.lectura, "obtener");
  const ejecutores = crearEjecutoresDeEtapas(async () => ({ datos, lectura: falso.lectura }));
  return { falso, datos, obtener, ...ejecutores };
}

function ventanaDe(n: number, fila: Partial<FilaVentana> = {}, disponible = true): VentanaJob {
  return armarVentana({
    fila: { ...filaVentana(AHORA, n), ...fila },
    leidos: leidosVentanaDelFalso(AHORA),
    hilos: [`bx-thread-000${n}`],
    operadores: OPERADORES_DE_PRUEBA,
    confirmaciones: CONFIRMACIONES_COMPLETAS,
    instruccionAbierta: false,
    ahora: AHORA,
    zona: "UTC",
    bzzzbx: { disponible, actualizadoEn: AHORA.toISOString() },
    tab: null,
  });
}

const entrada = (n: number, codigo: string, datos: Record<string, unknown> = {}, motivo: string | null = null): EntradaAccion => ({
  requestId: R(n),
  codigo,
  motivo,
  datos,
  version: String(100 + n),
});
const ctx = (n: number, fila: Partial<FilaVentana> = {}): ContextoAccion => ({ actor: ACTOR, ventana: ventanaDe(n, fila) });

/** Un error de la base como lo entrega `pg`: el SQLSTATE en `code`. */
const deLaBase = (code: string) => Object.assign(new Error(`falla ${code}`), { code });

describe("clear_alert", () => {
  it("vuelve a leer la alerta en BzzzBX y llama a la base con su instantánea, el motivo, la versión y el actor", async () => {
    const { clear_alert, datos, obtener } = preparar();
    expect(await clear_alert(ctx(4), entrada(4, "clear_alert", { bzzzbx_alert_id: "bx-alert-0006" }, "Large unit, called ahead."))).toEqual({
      tipo: "guardada",
    });
    expect(obtener).toHaveBeenCalledWith("alert_result", "bx-alert-0006");
    expect(datos.limpiarAlerta).toHaveBeenCalledTimes(1);
    expect(datos.limpiarAlerta).toHaveBeenCalledWith(
      {
        requestId: R(4),
        version: "104",
        motivo: "Large unit, called ahead.",
        alerta: {
          bzzzbxAlertId: "bx-alert-0006",
          ruleId: "MEC-003",
          ruleVersion: "1",
          level: "amber",
          reasonText: "Running 45 min over the window.",
          openedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        },
      },
      ACTOR,
    );
  });

  it("la instantánea sale de BzzzBX, no del navegador: lo que el navegador mande de más se ignora", async () => {
    const { clear_alert, datos } = preparar();
    await clear_alert(
      ctx(4),
      entrada(4, "clear_alert", { bzzzbx_alert_id: "bx-alert-0006", rule_id: "OPS-001", level: "red", reason_text: "otra" }, "Ok"),
    );
    expect(datos.limpiarAlerta.mock.calls[0]![0].alerta).toMatchObject({ ruleId: "MEC-003", level: "amber", reasonText: "Running 45 min over the window." });
  });

  it("una alerta ya cerrada en BzzzBX se rechaza sin llamar a la base", async () => {
    const { clear_alert, datos, falso } = preparar();
    falso.lectura.cambiar("alert_result", "bx-alert-0006", { cleared_at: AHORA.toISOString() });
    expect(await clear_alert(ctx(4), entrada(4, "clear_alert", { bzzzbx_alert_id: "bx-alert-0006" }, "Ok"))).toEqual({
      tipo: "rechazada",
      codigo: "alerta_ya_resuelta",
      mensaje: MENSAJES_DE_ETAPAS.alerta_ya_resuelta,
    });
    expect(datos.limpiarAlerta).not.toHaveBeenCalled();
  });

  it.each([
    ["una alerta de otro job", "bx-alert-0004"],
    ["una alerta de otra request", "bx-alert-0001"],
    ["una alerta que BzzzBX no conoce", "bx-alert-9999"],
  ])("%s se rechaza sin llamar a la base", async (_caso, id) => {
    const { clear_alert, datos } = preparar();
    expect(await clear_alert(ctx(4), entrada(4, "clear_alert", { bzzzbx_alert_id: id }, "Ok"))).toMatchObject({
      tipo: "rechazada",
      codigo: "alerta_de_otro_job",
      mensaje: "That alert is not from this job.",
    });
    expect(datos.limpiarAlerta).not.toHaveBeenCalled();
  });

  it("una regla que no se limpia (OPS-010 del job) se rechaza sin llamar a la base", async () => {
    const { clear_alert, datos, falso } = preparar();
    falso.lectura.poner("alert_result", {
      bzzzbx_alert_id: "bx-alert-7001",
      sujeto: { tipo: "job", bzzzbx_job_id: "bx-job-0004" },
      rule_id: "OPS-010",
      rule_version: "1",
      level: "red",
      reason_text: "Not started by 1:00 PM.",
      opened_at: AHORA.toISOString(),
      cleared_at: null,
    });
    expect(await clear_alert(ctx(4), entrada(4, "clear_alert", { bzzzbx_alert_id: "bx-alert-7001" }, "Ok"))).toMatchObject({
      tipo: "rechazada",
      codigo: "alerta_no_limpiable",
      mensaje: "This alert can't be cleared here.",
    });
    expect(datos.limpiarAlerta).not.toHaveBeenCalled();
  });

  it.each([
    ["sin alerta", {}],
    ["con la alerta en blanco", { bzzzbx_alert_id: "   " }],
    ["con una alerta que no es texto", { bzzzbx_alert_id: 5 }],
    ["con un id desmedido", { bzzzbx_alert_id: "x".repeat(201) }],
  ])("%s: 'Choose an alert first.' y no lee ni escribe nada", async (_caso, datosEntrada) => {
    const { clear_alert, datos, obtener } = preparar();
    expect(await clear_alert(ctx(4), entrada(4, "clear_alert", datosEntrada, "Ok"))).toEqual({
      tipo: "rechazada",
      codigo: "alerta_no_elegida",
      mensaje: MENSAJE_SIN_ALERTA,
    });
    expect(obtener).not.toHaveBeenCalled();
    expect(datos.limpiarAlerta).not.toHaveBeenCalled();
  });

  it("con BzzzBX caído a mitad de la acción no se escribe nada", async () => {
    const { clear_alert, datos, falso } = preparar();
    falso.lectura.noDisponible(true);
    expect(await clear_alert(ctx(4), entrada(4, "clear_alert", { bzzzbx_alert_id: "bx-alert-0006" }, "Ok"))).toEqual({
      tipo: "rechazada",
      codigo: "bzzzbx_no_disponible",
      mensaje: "BzzzBX unavailable",
    });
    expect(datos.limpiarAlerta).not.toHaveBeenCalled();
  });

  it("la base puede rechazar lo que BzzzBX dejó pasar: OP021 y OP022 salen como su mensaje", async () => {
    for (const [codigo, esperado] of [
      ["alerta_de_otro_job", "That alert is not from this job."],
      ["alerta_ya_resuelta", "This alert is already resolved."],
      ["alerta_no_limpiable", "This alert can't be cleared here."],
    ] as const) {
      const { clear_alert, datos } = preparar();
      datos.limpiarAlerta.mockRejectedValueOnce(new EtapaInvalida(codigo));
      expect(await clear_alert(ctx(4), entrada(4, "clear_alert", { bzzzbx_alert_id: "bx-alert-0006" }, "Ok"))).toMatchObject({
        tipo: "rechazada",
        codigo,
        mensaje: esperado,
      });
    }
  });
});

describe("mark_oss", () => {
  it.each([["oss"], ["not_oss"]] as const)("pasa %s, el motivo opcional, la versión y el actor", async (marca) => {
    const { mark_oss, datos } = preparar();
    expect(await mark_oss(ctx(5), entrada(5, "mark_oss", { mark: marca }, "Photos were fine"))).toEqual({ tipo: "guardada" });
    expect(datos.marcarOss).toHaveBeenCalledWith({ requestId: R(5), marca, version: "105", motivo: "Photos were fine" }, ACTOR);
  });

  it("el motivo es opcional", async () => {
    const { mark_oss, datos } = preparar();
    await mark_oss(ctx(5), entrada(5, "mark_oss", { mark: "not_oss" }));
    expect(datos.marcarOss.mock.calls[0]![0].motivo).toBeNull();
  });

  it.each([
    ["sin marca", {}],
    ["una marca desconocida", { mark: "maybe" }],
    ["una marca que no es texto", { mark: true }],
    ["la marca en otro caso", { mark: "OSS" }],
  ])("%s: 'Choose OSS or Not OSS first.' sin llamar a la base", async (_caso, datosEntrada) => {
    const { mark_oss, datos } = preparar();
    expect(await mark_oss(ctx(5), entrada(5, "mark_oss", datosEntrada))).toEqual({
      tipo: "rechazada",
      codigo: "marca_no_elegida",
      mensaje: MENSAJE_SIN_MARCA,
    });
    expect(datos.marcarOss).not.toHaveBeenCalled();
  });
});

describe("approve_confirm", () => {
  it("llama a la base con la versión y el actor, sin motivo ni otros datos", async () => {
    const { approve_confirm, datos } = preparar();
    expect(await approve_confirm(ctx(5), entrada(5, "approve_confirm", { lo_que_sea: 1 }))).toEqual({ tipo: "guardada" });
    expect(datos.aprobar).toHaveBeenCalledWith({ requestId: R(5), version: "105" }, ACTOR);
  });

  it("no consulta a BzzzBX: corre con BzzzBX caído (S-13)", async () => {
    const { approve_confirm, datos, falso, obtener } = preparar();
    falso.lectura.noDisponible(true);
    expect(await approve_confirm(ctx(5), entrada(5, "approve_confirm"))).toEqual({ tipo: "guardada" });
    expect(obtener).not.toHaveBeenCalled();
    expect(datos.aprobar).toHaveBeenCalledTimes(1);
  });
});

describe("write_po", () => {
  it("recorta el PO y llama a la base con la versión y el actor", async () => {
    const { write_po, datos } = preparar();
    expect(await write_po(ctx(6), entrada(6, "write_po", { po_number: "  PO-EX-0108  " }))).toEqual({ tipo: "guardada" });
    expect(datos.capturarPo).toHaveBeenCalledWith({ requestId: R(6), poNumber: "PO-EX-0108", version: "106" }, ACTOR);
  });

  it("acepta 64 caracteres", async () => {
    const { write_po, datos } = preparar();
    await write_po(ctx(6), entrada(6, "write_po", { po_number: "x".repeat(64) }));
    expect(datos.capturarPo).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["vacío", ""],
    ["solo espacios", "   "],
    ["más de 64 caracteres", "x".repeat(65)],
    ["un número", 12345],
    ["nulo", null],
    ["ausente", undefined],
  ])("un PO %s se rechaza sin llamar a la base", async (_caso, po) => {
    const { write_po, datos } = preparar();
    expect(await write_po(ctx(6), entrada(6, "write_po", { po_number: po }))).toEqual({
      tipo: "rechazada",
      codigo: "dato_invalido",
      mensaje: "Check the value and try again.",
    });
    expect(datos.capturarPo).not.toHaveBeenCalled();
  });

  it("corre con BzzzBX caído: no lee nada de BzzzBX (P-4)", async () => {
    const { write_po, falso, obtener } = preparar();
    falso.lectura.noDisponible(true);
    expect(await write_po(ctx(6), entrada(6, "write_po", { po_number: "PO-1" }))).toEqual({ tipo: "guardada" });
    expect(obtener).not.toHaveBeenCalled();
  });
});

describe("record_validation", () => {
  it("vuelve a leer el job y el cliente en BzzzBX y se los pasa a la base (po_required y el PO de PINCH)", async () => {
    const { record_validation, datos, obtener } = preparar();
    // R6: su cliente exige PO y el job de PINCH trae uno.
    expect(await record_validation(ctx(6, { validated_at: null }), entrada(6, "record_validation"))).toEqual({ tipo: "guardada" });
    expect(obtener).toHaveBeenCalledWith("job", "bx-job-0006");
    expect(obtener).toHaveBeenCalledWith("customer", "bx-cust-0003");
    expect(datos.validar).toHaveBeenCalledWith({ requestId: R(6), version: "106", poRequerido: true, poDelJob: "PO-EX-0006" }, ACTOR);
  });

  it("un cliente que no exige PO pasa po_required false", async () => {
    const { record_validation, datos } = preparar();
    // R4 usa el cliente bx-cust-0002; el ejecutor lee el job y el cliente de BzzzBX, no de la ventana.
    await record_validation(ctx(4), entrada(4, "record_validation"));
    expect(datos.validar).toHaveBeenCalledWith({ requestId: R(4), version: "104", poRequerido: false, poDelJob: null }, ACTOR);
  });

  it("lo que dice el navegador sobre el PO no cuenta", async () => {
    const { record_validation, datos } = preparar();
    await record_validation(ctx(6), entrada(6, "record_validation", { po_required: false, po_number: "otro", job_po_number: "otro" }));
    expect(datos.validar.mock.calls[0]![0]).toMatchObject({ poRequerido: true, poDelJob: "PO-EX-0006" });
  });

  it("sin job en la request: job_no_programado, sin leer ni escribir", async () => {
    const { record_validation, datos, obtener } = preparar();
    const sinJob = { ...ctx(2), ventana: ventanaDe(2) };
    expect(await record_validation(sinJob, entrada(2, "record_validation"))).toMatchObject({ tipo: "rechazada", codigo: "job_no_programado" });
    expect(obtener).not.toHaveBeenCalled();
    expect(datos.validar).not.toHaveBeenCalled();
  });

  it("BzzzBX no conoce el job o el cliente: no se valida (no se sabe si exige PO)", async () => {
    const { record_validation, datos, falso } = preparar();
    // El job de la request ya no existe en BzzzBX.
    const huerfano = ctx(6);
    huerfano.ventana = { ...huerfano.ventana, datos: { ...huerfano.ventana.datos, bzzzbxJobId: "bx-job-9999" } };
    expect(await record_validation(huerfano, entrada(6, "record_validation"))).toMatchObject({ tipo: "rechazada", codigo: "job_no_encontrado" });
    // El job existe pero su cliente no.
    falso.lectura.cambiar("job", "bx-job-0006", { bzzzbx_customer_id: "bx-cust-9999" });
    expect(await record_validation(ctx(6), entrada(6, "record_validation"))).toMatchObject({
      tipo: "rechazada",
      codigo: "cliente_no_encontrado",
    });
    expect(datos.validar).not.toHaveBeenCalled();
  });

  it("con BzzzBX caído a mitad de la acción no se escribe nada", async () => {
    const { record_validation, datos, falso } = preparar();
    falso.lectura.noDisponible(true);
    expect(await record_validation(ctx(6), entrada(6, "record_validation"))).toEqual({
      tipo: "rechazada",
      codigo: "bzzzbx_no_disponible",
      mensaje: "BzzzBX unavailable",
    });
    expect(datos.validar).not.toHaveBeenCalled();
  });
});

describe("errores de la base", () => {
  const ejecutoresYLlamadas = () => {
    const p = preparar();
    return {
      p,
      llamadas: {
        clear_alert: () => p.clear_alert(ctx(4), entrada(4, "clear_alert", { bzzzbx_alert_id: "bx-alert-0006" }, "Ok")),
        mark_oss: () => p.mark_oss(ctx(5), entrada(5, "mark_oss", { mark: "oss" })),
        approve_confirm: () => p.approve_confirm(ctx(5), entrada(5, "approve_confirm")),
        write_po: () => p.write_po(ctx(6), entrada(6, "write_po", { po_number: "PO-1" })),
        record_validation: () => p.record_validation(ctx(6), entrada(6, "record_validation")),
      } as Record<string, () => Promise<unknown>>,
      falla: (error: unknown) => {
        p.datos.limpiarAlerta.mockRejectedValue(error);
        p.datos.marcarOss.mockRejectedValue(error);
        p.datos.aprobar.mockRejectedValue(error);
        p.datos.capturarPo.mockRejectedValue(error);
        p.datos.validar.mockRejectedValue(error);
      },
    };
  };

  it.each(Object.entries(MENSAJES_DE_ETAPAS) as [CodigoEtapaInvalida, string][])(
    "%s sale como su mensaje, en las cinco acciones",
    async (codigo, mensaje) => {
      const { llamadas, falla } = ejecutoresYLlamadas();
      falla(new EtapaInvalida(codigo));
      for (const [nombre, llamar] of Object.entries(llamadas)) {
        expect(await llamar(), nombre).toEqual({ tipo: "rechazada", codigo, mensaje });
      }
    },
  );

  it("los mensajes son los del spec §7.1", () => {
    expect(MENSAJES_DE_ETAPAS).toEqual({
      request_no_encontrada: "Job not found.",
      cambio_concurrente: "This job changed. Review and try again.",
      job_no_programado: "This request has no job yet.",
      alerta_no_limpiable: "This alert can't be cleared here.",
      alerta_de_otro_job: "That alert is not from this job.",
      alerta_ya_resuelta: "This alert is already resolved.",
      ya_aprobado: "This job is already approved.",
      sin_cambios: "Nothing to change.",
      ya_validado: "This job is already validated.",
      sin_aprobar: "Approve the job first.",
      falta_po: "Add PO",
      dato_invalido: "Check the value and try again.",
    });
  });

  it("42501 y cualquier otro error suben tal cual: ejecutarAccion los registra", async () => {
    for (const code of ["42501", "57014", "23505"]) {
      const { llamadas, falla } = ejecutoresYLlamadas();
      falla(deLaBase(code));
      for (const [nombre, llamar] of Object.entries(llamadas)) {
        await expect(llamar(), `${nombre} ${code}`).rejects.toMatchObject({ code });
      }
    }
  });
});

describe("ejecutarAccion con el registro real", () => {
  const deps = (ventana: VentanaJob) => ({
    registro: REGISTRO_DE_ACCIONES,
    leerVentana: vi.fn(async () => ventana),
    actor: vi.fn(async () => ACTOR),
    refrescar: vi.fn(async () => {}),
  });

  it("las cinco acciones de las etapas tienen ejecutor", () => {
    for (const codigo of ["clear_alert", "mark_oss", "approve_confirm", "write_po", "record_validation"]) {
      expect(REGISTRO_DE_ACCIONES.find((d) => d.codigo === codigo)?.ejecutor, codigo).toBeTypeOf("function");
    }
  });

  it.each([
    ["end_job_manually", 4],
    ["reschedule_job", 3],
    ["cancel_job", 3],
  ])("%s es de la Fase B: se rechaza sin llamar a nada, aunque se mande a mano", async (codigo, n) => {
    const d = deps(ventanaDe(n));
    const r = await ejecutar(d, { requestId: R(n), codigo, motivo: "Because", datos: {}, version: String(100 + n) });
    expect(r).toEqual({ tipo: "rechazada", codigo: "no_disponible", mensaje: "Available when actions are switched on" });
    expect(d.actor).not.toHaveBeenCalled();
    expect(d.refrescar).not.toHaveBeenCalled();
    expect(REGISTRO_DE_ACCIONES.find((x) => x.codigo === codigo)?.ejecutor, `${codigo} no tiene ejecutor`).toBeUndefined();
  });

  it("Clear alert exige el motivo antes de llegar al ejecutor", async () => {
    const d = deps(ventanaDe(4));
    for (const motivo of [null, "", "   "]) {
      const r = await ejecutar(d, { requestId: R(4), codigo: "clear_alert", motivo, datos: { bzzzbx_alert_id: "bx-alert-0006" }, version: "104" });
      expect(r).toMatchObject({ tipo: "rechazada", codigo: "motivo_requerido" });
    }
    expect(d.actor).not.toHaveBeenCalled();
  });

  it("Clear alert con BzzzBX caído y Validate sin 'Add PO' no corren; forzar el botón no ayuda", async () => {
    const caido = deps(ventanaDe(4, {}, false));
    expect(
      await ejecutar(caido, { requestId: R(4), codigo: "clear_alert", motivo: "Ok", datos: { bzzzbx_alert_id: "bx-alert-0006" }, version: "104" }),
    ).toMatchObject({ tipo: "rechazada", codigo: "no_disponible", mensaje: "BzzzBX unavailable" });
    const r6 = ventanaDe(6, { validated_at: null });
    const sinPo = { ...r6, datos: { ...r6.datos, poRequerido: true, tienePo: false, poVigente: null } };
    const sin = deps(sinPo);
    expect(await ejecutar(sin, { requestId: R(6), codigo: "record_validation", motivo: null, datos: {}, version: "106" })).toMatchObject({
      tipo: "rechazada",
      codigo: "no_disponible",
      mensaje: "Add PO",
    });
    expect(sin.actor).not.toHaveBeenCalled();
  });

  it("una versión vieja se rechaza antes de llegar al ejecutor", async () => {
    const d = deps(ventanaDe(5));
    const r = await ejecutar(d, { requestId: R(5), codigo: "approve_confirm", motivo: null, datos: {}, version: "1" });
    expect(r).toMatchObject({ tipo: "rechazada", codigo: "cambio_concurrente", mensaje: "This job changed. Review and try again." });
    expect(d.actor).not.toHaveBeenCalled();
  });
});

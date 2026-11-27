// @vitest-environment node
/**
 * El despacho mínimo de instrucciones (spec OPR-27 §7 y §11.1): acuse →
 * `record_instruction_delivery`; BzzzBX caído → sigue `pending` y el reintento
 * usa la misma clave; rechazo → `failed`; cada resultado → su estado; repetir la
 * reconciliación no escribe dos veces; y el despacho no crea instrucciones.
 */
import { describe, expect, it, vi } from "vitest";

import { InstruccionRechazada } from "../bzzzbx/errores";
import { crearFalso, RelojManual } from "../bzzzbx/falso";
import type { InstruccionesBzzzbx } from "../bzzzbx/puertos";
import type { Resultado } from "../bzzzbx/tipos";

import {
  cierreDe,
  entregarPorClave,
  reconciliarInstrucciones,
  type CierreDeInstruccion,
  type DatosDeDespacho,
  type InstruccionAbierta,
} from "./despacho";

const R2 = "b0000000-0000-4000-8000-0000000000a2";
const OPERADOR = "0a000000-0000-4000-8000-0000000000a1";

const correo = (clave: string, parche: Partial<InstruccionAbierta> = {}): InstruccionAbierta => ({
  idempotency_key: clave,
  type: "send_email",
  payload: { bzzzbx_thread_id: "bx-thread-0002", body: "Scheduled for Friday." },
  status: "pending",
  request_id: R2,
  actor_operator_id: OPERADOR,
  ...parche,
});

/** Una base en memoria con la semántica de las funciones SQL: idempotentes y solo hacia adelante. */
function baseEnMemoria(filas: InstruccionAbierta[]) {
  const porClave = new Map(filas.map((f) => [f.idempotency_key, { ...f }]));
  const cerradas = new Map<string, CierreDeInstruccion>();
  const escrituras: string[] = [];
  const datos: DatosDeDespacho = {
    abiertas: vi.fn(async () => [...porClave.values()].filter((f) => f.status === "pending" || f.status === "sent")),
    abierta: vi.fn(async (k) => {
      const f = porClave.get(k);
      return f && (f.status === "pending" || f.status === "sent") ? { ...f } : null;
    }),
    registrarEntrega: vi.fn(async (k) => {
      const f = porClave.get(k)!;
      if (f.status !== "pending") return;
      f.status = "sent";
      escrituras.push(`entrega:${k}`);
    }),
    resolver: vi.fn(async (c) => {
      const f = porClave.get(c.idempotency_key)!;
      const ya = cerradas.get(c.idempotency_key);
      if (ya && ya.status === c.status) return;
      if (c.status === "sent") {
        if (f.status === "pending") f.status = "sent";
        escrituras.push(`resolver:${c.idempotency_key}:sent`);
        return;
      }
      cerradas.set(c.idempotency_key, c);
      (f as { status: string }).status = c.status;
      escrituras.push(`resolver:${c.idempotency_key}:${c.status}`);
    }),
  };
  return { datos, porClave, cerradas, escrituras };
}

function falsoManual() {
  const reloj = new RelojManual(new Date("2030-03-10T15:00:00Z"));
  const falso = crearFalso({ reloj });
  const pasos = (n: number) => reloj.adelantar(falso.instrucciones.pasoMs * n);
  return { falso, pasos };
}

describe("entregarPorClave", () => {
  it("con el acuse de BzzzBX escribe record_instruction_delivery y la instrucción queda sent", async () => {
    const { falso } = falsoManual();
    const base = baseEnMemoria([correo("k1")]);
    const r = await entregarPorClave({ instrucciones: falso.instrucciones, datos: base.datos }, "k1");
    expect(r).toBe("entregada");
    expect(base.datos.registrarEntrega).toHaveBeenCalledWith("k1", expect.stringMatching(/^bx-ref-/));
    expect(base.porClave.get("k1")!.status).toBe("sent");
    // BzzzBX recibió la instrucción tal como estaba guardada: crosswalk ID y cuerpo, el operador como actor.
    expect(await falso.instrucciones.estado("k1")).toMatchObject({ estado: "en_curso" });
  });

  it("entrega lo que hay en la base, con la misma clave, el tipo y el payload", async () => {
    const entregar = vi.fn(async (i) => ({ idempotency_key: i.idempotency_key, bzzzbx_reference: "bx-ref-1", aceptada_en: "2030-03-10T15:00:00Z" }));
    const instrucciones = { entregar, estado: vi.fn(), resultadosDesde: vi.fn() } as unknown as InstruccionesBzzzbx;
    const base = baseEnMemoria([correo("k2")]);
    await entregarPorClave({ instrucciones, datos: base.datos }, "k2");
    expect(entregar).toHaveBeenCalledExactlyOnceWith({
      idempotency_key: "k2",
      tipo: "send_email",
      payload: { bzzzbx_thread_id: "bx-thread-0002", body: "Scheduled for Friday." },
      actor: { tipo: "operator", operator_id: OPERADOR },
      sujeto: { request_id: R2 },
    });
  });

  it("con BzzzBX caído queda pending, sin escribir nada, y el reintento usa la misma clave", async () => {
    const { falso } = falsoManual();
    const base = baseEnMemoria([correo("k3")]);
    falso.lectura.noDisponible(true);
    const deps = { instrucciones: falso.instrucciones, datos: base.datos };
    expect(await entregarPorClave(deps, "k3")).toBe("pendiente");
    expect(base.porClave.get("k3")!.status).toBe("pending");
    expect(base.escrituras).toEqual([]);

    falso.lectura.noDisponible(false);
    const resumen = await reconciliarInstrucciones(deps);
    expect(resumen).toMatchObject({ revisadas: 1, entregadas: 1 });
    expect(base.porClave.get("k3")!.status).toBe("sent");
    expect(await falso.instrucciones.estado("k3")).not.toBeNull();
  });

  it("si BzzzBX rechaza la instrucción, queda failed con su código y su mensaje", async () => {
    const instrucciones = {
      entregar: vi.fn(async () => Promise.reject(new InstruccionRechazada("invalid_payload", "Unknown thread."))),
      estado: vi.fn(),
      resultadosDesde: vi.fn(),
    } as unknown as InstruccionesBzzzbx;
    const base = baseEnMemoria([correo("k4")]);
    expect(await entregarPorClave({ instrucciones, datos: base.datos }, "k4")).toBe("rechazada");
    expect(base.cerradas.get("k4")).toMatchObject({ status: "failed", error_code: "invalid_payload", error_message: "Unknown thread." });
  });

  it("los errores se reconocen por nombre, no por instanceof", async () => {
    class OtraCopiaNoDisponible extends Error {
      name = "BzzzbxNoDisponible";
    }
    class OtraCopiaRechazo extends Error {
      name = "InstruccionRechazada";
      error_code = "forced";
      error_message = "Forced";
    }
    const base = baseEnMemoria([correo("k5"), correo("k6")]);
    const caido = { entregar: vi.fn(async () => Promise.reject(new OtraCopiaNoDisponible())), estado: vi.fn(), resultadosDesde: vi.fn() } as unknown as InstruccionesBzzzbx;
    expect(await entregarPorClave({ instrucciones: caido, datos: base.datos }, "k5")).toBe("pendiente");
    const rechazo = { entregar: vi.fn(async () => Promise.reject(new OtraCopiaRechazo())), estado: vi.fn(), resultadosDesde: vi.fn() } as unknown as InstruccionesBzzzbx;
    expect(await entregarPorClave({ instrucciones: rechazo, datos: base.datos }, "k6")).toBe("rechazada");
    expect(base.cerradas.get("k6")).toMatchObject({ status: "failed", error_code: "forced" });
  });

  it("una instrucción que ya se entregó, o que no existe, no se vuelve a entregar", async () => {
    const { falso } = falsoManual();
    const base = baseEnMemoria([correo("k7", { status: "sent" })]);
    const entregar = vi.spyOn(falso.instrucciones, "entregar");
    expect(await entregarPorClave({ instrucciones: falso.instrucciones, datos: base.datos }, "k7")).toBe("no_abierta");
    expect(await entregarPorClave({ instrucciones: falso.instrucciones, datos: base.datos }, "no-existe")).toBe("no_abierta");
    expect(entregar).not.toHaveBeenCalled();
  });
});

describe("cierreDe: cada resultado de BzzzBX, su estado (OPR-22 §4.3)", () => {
  const abierta = correo("k8", { status: "sent" });
  const casos: [string, Resultado, Partial<CierreDeInstruccion> | null][] = [
    ["confirmada", { idempotency_key: "k8", estado: "confirmada", bzzzbx_reference: "bx-ref-1", datos: { bzzzbx_message_id: "bx-msg-9001" } }, { status: "confirmed", bzzzbx_reference: "bx-ref-1", bzzzbx_message_id: "bx-msg-9001" }],
    ["confirmada sin ID de mensaje", { idempotency_key: "k8", estado: "confirmada", bzzzbx_reference: "bx-ref-1" }, { status: "confirmed", bzzzbx_message_id: null }],
    ["fallida", { idempotency_key: "k8", estado: "fallida", error_code: "forced_error", error_message: "Forced error (stand-in)." }, { status: "failed", error_code: "forced_error", error_message: "Forced error (stand-in)." }],
    ["sin_confirmar", { idempotency_key: "k8", estado: "sin_confirmar", motivo: "The result was not observed in the source." }, { status: "timed_out", error_message: "The result was not observed in the source." }],
    ["en curso, ya despachada, con la base en sent", { idempotency_key: "k8", estado: "en_curso", paso: "executed" }, null],
  ];
  it.each(casos)("%s", (_nombre, resultado, esperado) => {
    const c = cierreDe(abierta, resultado);
    if (esperado === null) expect(c).toBeNull();
    else expect(c).toMatchObject({ idempotency_key: "k8", ...esperado });
  });

  it("en curso con paso dispatched o posterior y la base todavía en pending pasa a sent; antes de dispatched, no", () => {
    const pendiente = correo("k9", { status: "pending" });
    expect(cierreDe(pendiente, { idempotency_key: "k9", estado: "en_curso", paso: "dispatched" })).toMatchObject({ status: "sent" });
    expect(cierreDe(pendiente, { idempotency_key: "k9", estado: "en_curso", paso: "observed" })).toMatchObject({ status: "sent" });
    expect(cierreDe(pendiente, { idempotency_key: "k9", estado: "en_curso", paso: "authorized" })).toBeNull();
  });
});

describe("reconciliarInstrucciones", () => {
  it("lleva un envío de punta a punta con el falso: pending → sent → confirmed, con el ID del mensaje", async () => {
    const { falso, pasos } = falsoManual();
    const base = baseEnMemoria([correo("k10")]);
    const deps = { instrucciones: falso.instrucciones, datos: base.datos };

    await reconciliarInstrucciones(deps);
    expect(base.porClave.get("k10")!.status).toBe("sent");

    pasos(10);
    const resumen = await reconciliarInstrucciones(deps);
    expect(resumen.cerradas).toBe(1);
    expect(base.cerradas.get("k10")).toMatchObject({ status: "confirmed", bzzzbx_message_id: expect.stringMatching(/^bx-msg-/) });
  });

  it("repetir la reconciliación no escribe dos veces", async () => {
    const { falso, pasos } = falsoManual();
    const base = baseEnMemoria([correo("k11")]);
    const deps = { instrucciones: falso.instrucciones, datos: base.datos };
    await reconciliarInstrucciones(deps);
    pasos(10);
    await reconciliarInstrucciones(deps);
    const antes = [...base.escrituras];
    const resumen = await reconciliarInstrucciones(deps);
    await reconciliarInstrucciones(deps);
    expect(base.escrituras).toEqual(antes);
    expect(resumen.revisadas).toBe(0);
  });

  it("un fallo de BzzzBX al ejecutar cierra failed con su mensaje; sin_confirmar cierra timed_out", async () => {
    const { falso, pasos } = falsoManual();
    falso.instrucciones.forzarError({ tipo: "send_email", cuando: "al_ejecutar" });
    falso.instrucciones.forzarError({ tipo: "send_text", cuando: "sin_confirmar" });
    const base = baseEnMemoria([
      correo("k12"),
      correo("k13", { type: "send_text", payload: { bzzzbx_team_id: "bx-team-0001", body: "Ready?" } }),
    ]);
    const deps = { instrucciones: falso.instrucciones, datos: base.datos };
    await reconciliarInstrucciones(deps);
    pasos(10);
    await reconciliarInstrucciones(deps);
    expect(base.cerradas.get("k12")).toMatchObject({ status: "failed", error_code: "forced_error", error_message: "Forced error (stand-in)." });
    expect(base.cerradas.get("k13")).toMatchObject({ status: "timed_out" });
  });

  it("si BzzzBX cae a medias se detiene sin tocar nada más y lo retoma después", async () => {
    const { falso, pasos } = falsoManual();
    const base = baseEnMemoria([correo("k14"), correo("k15")]);
    const deps = { instrucciones: falso.instrucciones, datos: base.datos };
    await reconciliarInstrucciones(deps);
    pasos(10);
    falso.lectura.noDisponible(true);
    const resumen = await reconciliarInstrucciones(deps);
    expect(resumen.bzzzbxCaido).toBe(true);
    expect(base.cerradas.size).toBe(0);
    falso.lectura.noDisponible(false);
    await reconciliarInstrucciones(deps);
    expect(base.cerradas.size).toBe(2);
  });

  it("un error en una instrucción no frena a las demás", async () => {
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    const { falso, pasos } = falsoManual();
    const base = baseEnMemoria([correo("k16"), correo("k17")]);
    const deps = { instrucciones: falso.instrucciones, datos: base.datos };
    await reconciliarInstrucciones(deps);
    pasos(10);
    const original = base.datos.resolver;
    base.datos.resolver = vi.fn(async (c) => {
      if (c.idempotency_key === "k16") throw new Error("falló la base");
      return original(c);
    });
    await reconciliarInstrucciones(deps);
    expect(base.cerradas.has("k17")).toBe(true);
    errores.mockRestore();
  });
});

describe("guard 'nada sale solo' (b): el despacho no crea instrucciones", () => {
  it("con una base sin send_* abiertas, reconciliar no llama a entregar ni escribe nada", async () => {
    const vacia = baseEnMemoria([]);
    const entregar = vi.fn();
    const instrucciones = { entregar, estado: vi.fn(async () => null), resultadosDesde: vi.fn() } as unknown as InstruccionesBzzzbx;
    const resumen = await reconciliarInstrucciones({ instrucciones, datos: vacia.datos });
    expect(resumen).toEqual({ revisadas: 0, entregadas: 0, cerradas: 0, bzzzbxCaido: false });
    expect(entregar).not.toHaveBeenCalled();
    expect(vacia.escrituras).toEqual([]);
  });

  it("el despacho solo entrega lo que ya está en la base: ninguna función suya inserta una instrucción", async () => {
    const { falso } = falsoManual();
    const entregar = vi.spyOn(falso.instrucciones, "entregar");
    const base = baseEnMemoria([]);
    await entregarPorClave({ instrucciones: falso.instrucciones, datos: base.datos }, "inventada");
    expect(entregar).not.toHaveBeenCalled();
    // El contrato de datos del despacho no tiene ninguna operación de crear.
    expect(Object.keys(base.datos).sort()).toEqual(["abierta", "abiertas", "registrarEntrega", "resolver"]);
  });
});

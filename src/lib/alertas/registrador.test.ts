// @vitest-environment node
/**
 * El registrador de alertas (spec OPR-34 §4 y §10.2): una alerta nueva llama una
 * vez a `upsert_alert_occurrence`; sin request no escribe nada; el arranque y un
 * cursor caducado hacen una pasada completa; BzzzBX caído no escribe ni avanza el
 * cursor; `OP035` se salta y sigue. La cadencia y la vuelta única son del ciclo
 * (`tarea.test.ts`); que escriba como actor de sistema, `datos-sql.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";

import { crearFalso, RelojManual } from "../bzzzbx/falso";

import {
  PLAZO_DE_REINTENTO_MS,
  crearRegistrador,
  type AlertaARegistrar,
  type DatosDelRegistrador,
  type DependenciasDelRegistrador,
} from "./registrador";

const R = (n: number) => `b0000000-0000-4000-8000-0000000000a${n}`;

/** Las requests de la seed con su job, como las vería la base. */
const REQUESTS = [
  { id: R(1), bzzzbx_job_id: null },
  { id: R(2), bzzzbx_job_id: null },
  { id: R(3), bzzzbx_job_id: "bx-job-0003" },
  { id: R(4), bzzzbx_job_id: "bx-job-0004" },
  { id: R(5), bzzzbx_job_id: "bx-job-0005" },
  { id: R(6), bzzzbx_job_id: "bx-job-0006" },
  { id: R(8), bzzzbx_job_id: null },
];

function preparar(
  opciones: { abiertasEnOpsrun?: string[]; falla?: (a: AlertaARegistrar) => unknown; salientesActivos?: string[]; mensajesVinculados?: Map<string, string> } = {},
) {
  const falso = crearFalso({ reloj: new RelojManual(new Date("2026-11-27T15:00:00Z")) });
  const registradas: AlertaARegistrar[] = [];
  const registrar = vi.fn(async (a: AlertaARegistrar) => {
    const error = opciones.falla?.(a);
    if (error) throw error;
    registradas.push(a);
    return `ocurrencia-${a.bzzzbx_alert_id}`;
  });
  const datos: DatosDelRegistrador = {
    requestsActivas: vi.fn(async () => REQUESTS),
    // Los hilos de la seed: el del correo original de cada request (`bx-thread-000N`).
    hilosActivos: vi.fn(async () => REQUESTS.map((r) => `bx-thread-000${r.id.slice(-1)}`)),
    mensajesSalientesActivos: vi.fn(async () => opciones.salientesActivos ?? ["bx-msg-0102"]),
    alertasAbiertas: vi.fn(async () => opciones.abiertasEnOpsrun ?? []),
    requestsExistentes: vi.fn(async (ids: string[]) => new Set(ids.filter((id) => REQUESTS.some((r) => r.id === id)))),
    requestsDeJobs: vi.fn(async (jobs: string[]) => new Map(REQUESTS.filter((r) => r.bzzzbx_job_id && jobs.includes(r.bzzzbx_job_id)).map((r) => [r.bzzzbx_job_id!, r.id]))),
    // R2 tiene vinculado su texto saliente y un hilo propio.
    requestsDeMensajes: vi.fn(async (ids: string[]) => new Map(ids.filter((id) => id === "bx-msg-0102" || opciones.mensajesVinculados?.has(id)).map((id) => [id, opciones.mensajesVinculados?.get(id) ?? R(2)]))),
    requestsDeHilos: vi.fn(async (hilos: string[]) => new Map(hilos.filter((h) => h === "bx-thread-0002").map((h) => [h, R(2)]))),
    registrar,
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  let reloj = Date.parse("2026-11-27T15:00:00Z");
  const deps = vi.fn((): DependenciasDelRegistrador => ({ lectura: falso.lectura, datos, log, ahora: () => reloj }));
  const pasar = (ms: number) => void (reloj += ms);
  return { falso, datos, registrar, registradas, deps, log, pasar, registrador: crearRegistrador(deps) };
}

const mensaje = (id: string, hilo: string | null = null) =>
  ({
    bzzzbx_message_id: id,
    bzzzbx_thread_id: hilo,
    channel: "text" as const,
    direction: "outbound" as const,
    from: "opsrun",
    to: ["+1 555 0111"],
    subject: null,
    body: "Hola",
    sent_at: "2026-11-27T15:00:00.000Z",
    // No "failed": el falso abriría por su cuenta la alerta de ese mensaje (OPR-19, P-4) y estas pruebas ponen la suya.
    delivery: "sent" as const,
  });

const alertaNueva = (id: string, parche: Record<string, unknown> = {}) => ({
  bzzzbx_alert_id: id,
  sujeto: { tipo: "request" as const, request_id: R(2) },
  rule_id: "OPS-001",
  rule_version: "1",
  level: "amber" as const,
  reason_text: "Unassigned for 15 min.",
  opened_at: "2026-11-27T14:55:00.000Z",
  cleared_at: null,
  ...parche,
});

describe("registrador de alertas: la pasada completa del arranque", () => {
  it("al arrancar lee por sujeto las requests activas y registra cada alerta una vez, con su request", async () => {
    const { registrador, registrar, registradas, falso } = preparar();
    const r = await registrador.vuelta();
    expect(r).toEqual({ estado: "ok", completa: true, leidas: 7, registradas: 7, saltadas: 0 });
    expect(registrar).toHaveBeenCalledTimes(7);
    const porId = Object.fromEntries(registradas.map((a) => [a.bzzzbx_alert_id, a]));
    expect(porId["bx-alert-0001"]).toMatchObject({ request_id: R(1), rule_id: "OPS-001", level: "amber", cleared_at: null, bzzzbx_message_id: null });
    expect(porId["bx-alert-0002"]).toMatchObject({ request_id: R(4), rule_id: "OPS-010", level: "red" });
    expect(porId["bx-alert-0002"]!.cleared_at).not.toBeNull();
    expect(porId["bx-alert-0009"]).toMatchObject({ request_id: R(4), rule_id: "OPS-010" });
    expect(porId["bx-alert-0003"]).toMatchObject({ request_id: R(6), rule_id: "TRN-005" });
    expect(porId["bx-alert-0005"]).toMatchObject({ request_id: R(8) });
    expect(registrador.cursor).not.toBeNull();
    // Después del arranque, sin cambios no hay nada que anotar.
    registrar.mockClear();
    expect(await registrador.vuelta()).toEqual({ estado: "ok", completa: false, leidas: 0, registradas: 0, saltadas: 0 });
    expect(registrar).not.toHaveBeenCalled();
    void falso;
  });

  it("también relee por id las ocurrencias abiertas en opsRUN, aunque su sujeto ya no esté entre los de las requests activas", async () => {
    const { registrador, registradas, falso } = preparar({ abiertasEnOpsrun: ["bx-alert-9000"] });
    falso.lectura.poner("alert_result", { ...alertaNueva("bx-alert-9000"), sujeto: { tipo: "request", request_id: R(7) } });
    // R7 no está entre las activas: la leerá por id; y como es de una request que existe aquí no, se salta.
    const r = await registrador.vuelta();
    expect(r).toMatchObject({ estado: "ok", completa: true, saltadas: 1 });
    expect(registradas.map((a) => a.bzzzbx_alert_id)).not.toContain("bx-alert-9000");
  });
});

describe("registrador de alertas: lo que cambia después", () => {
  it("una alerta nueva de BzzzBX llama una vez a upsert_alert_occurrence con lo que BzzzBX dijo", async () => {
    const { registrador, registrar, registradas, falso } = preparar();
    await registrador.vuelta();
    registrar.mockClear();
    registradas.length = 0;
    falso.lectura.poner("alert_result", alertaNueva("bx-alert-9001", { rule_id: "OPS-002", level: "red", reason_text: "Open for 2 days." }));
    const r = await registrador.vuelta();
    expect(r).toMatchObject({ estado: "ok", completa: false, leidas: 1, registradas: 1 });
    expect(registrar).toHaveBeenCalledTimes(1);
    expect(registradas[0]).toEqual({
      bzzzbx_alert_id: "bx-alert-9001",
      request_id: R(2),
      rule_id: "OPS-002",
      rule_version: "1",
      level: "red",
      reason_text: "Open for 2 days.",
      bzzzbx_message_id: null,
      opened_at: "2026-11-27T14:55:00.000Z",
      cleared_at: null,
    });
  });

  it("cuando BzzzBX la cierra o le cambia el nivel, la vuelve a llamar con el estado nuevo", async () => {
    const { registrador, registradas, falso } = preparar();
    await registrador.vuelta();
    registradas.length = 0;
    falso.lectura.cambiar("alert_result", "bx-alert-0001", { level: "red" });
    await registrador.vuelta();
    expect(registradas.map((a) => [a.bzzzbx_alert_id, a.level, a.cleared_at])).toEqual([["bx-alert-0001", "red", null]]);
    registradas.length = 0;
    falso.lectura.cambiar("alert_result", "bx-alert-0001", { cleared_at: "2026-11-27T15:10:00.000Z" });
    await registrador.vuelta();
    expect(registradas.map((a) => [a.bzzzbx_alert_id, a.cleared_at])).toEqual([["bx-alert-0001", "2026-11-27T15:10:00.000Z"]]);
  });

  it("un cambio que no es de una alerta no llama a nadie", async () => {
    const { registrador, registrar, falso } = preparar();
    await registrador.vuelta();
    registrar.mockClear();
    falso.lectura.cambiar("job", "bx-job-0003", { po_number: "PO-X" });
    expect(await registrador.vuelta()).toMatchObject({ leidas: 0, registradas: 0 });
    expect(registrar).not.toHaveBeenCalled();
  });

  it("una alerta de un job: su request sale del job", async () => {
    const { registrador, registradas, falso } = preparar();
    await registrador.vuelta();
    registradas.length = 0;
    falso.lectura.poner("alert_result", alertaNueva("bx-alert-9002", { sujeto: { tipo: "job", bzzzbx_job_id: "bx-job-0003" }, rule_id: "OPS-010", level: "red" }));
    await registrador.vuelta();
    expect(registradas).toHaveLength(1);
    expect(registradas[0]).toMatchObject({ request_id: R(3), rule_id: "OPS-010" });
  });

  it("una alerta de un mensaje: por el mensaje vinculado o por el hilo de la request, con su bzzzbx_message_id", async () => {
    const { registrador, registradas, falso } = preparar();
    await registrador.vuelta();
    registradas.length = 0;
    falso.lectura.poner("message", mensaje("bx-msg-0201", "bx-thread-0002"));
    falso.lectura.poner("alert_result", alertaNueva("bx-alert-9003", { sujeto: { tipo: "message", bzzzbx_message_id: "bx-msg-0102" }, rule_id: "MSG-001", level: "red" }));
    falso.lectura.poner("alert_result", alertaNueva("bx-alert-9004", { sujeto: { tipo: "message", bzzzbx_message_id: "bx-msg-0201" }, rule_id: "MSG-001", level: "red" }));
    await registrador.vuelta();
    expect(registradas.map((a) => [a.bzzzbx_alert_id, a.request_id, a.bzzzbx_message_id])).toEqual([
      ["bx-alert-9003", R(2), "bx-msg-0102"],
      ["bx-alert-9004", R(2), "bx-msg-0201"],
    ]);
  });

  it("la pasada completa también ve la alerta de un mensaje que abrió mientras el cursor estaba caducado (o antes de arrancar)", async () => {
    const { registrador, registradas, falso } = preparar();
    falso.lectura.poner("message", mensaje("bx-msg-0202", "bx-thread-0002"));
    falso.lectura.poner("alert_result", alertaNueva("bx-alert-9005", { sujeto: { tipo: "message", bzzzbx_message_id: "bx-msg-0202" }, rule_id: "MSG-001", level: "red" }));
    // Sin cursor, no hay cambio que la anuncie: solo la lee la pasada por los mensajes de los hilos.
    expect(registrador.cursor).toBeNull();
    await registrador.vuelta();
    expect(registradas.map((a) => [a.bzzzbx_alert_id, a.request_id, a.bzzzbx_message_id])).toContainEqual(["bx-alert-9005", R(2), "bx-msg-0202"]);
  });

  it("sin request no escribe nada y avisa una sola vez (§3.2, S-3)", async () => {
    const { registrador, registrar, registradas, falso, log } = preparar();
    await registrador.vuelta();
    registrar.mockClear();
    registradas.length = 0;
    falso.lectura.poner("alert_result", alertaNueva("bx-alert-9010", { sujeto: { tipo: "job", bzzzbx_job_id: "bx-job-9999" } }));
    falso.lectura.poner("alert_result", alertaNueva("bx-alert-9011", { sujeto: { tipo: "request", request_id: "b0000000-0000-4000-8000-0000000000ff" } }));
    falso.lectura.poner("message", mensaje("bx-msg-0299", "bx-thread-9999"));
    falso.lectura.poner("alert_result", alertaNueva("bx-alert-9012", { sujeto: { tipo: "message", bzzzbx_message_id: "bx-msg-0299" } }));
    falso.lectura.poner("alert_result", alertaNueva("bx-alert-9013", { sujeto: { tipo: "message", bzzzbx_message_id: "bx-msg-desconocido" } }));
    const r = await registrador.vuelta();
    expect(r).toMatchObject({ estado: "ok", leidas: 4, registradas: 0, saltadas: 4 });
    expect(registrar).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(4);
    // Cambia otra vez: ya está avisada.
    falso.lectura.cambiar("alert_result", "bx-alert-9010", { level: "red" });
    await registrador.vuelta();
    expect(log.warn).toHaveBeenCalledTimes(4);
    expect(registrar).not.toHaveBeenCalled();
  });
});

describe("registrador de alertas: cursor, BzzzBX caído y errores", () => {
  it("un cursor caducado deja el cursor en null y la vuelta siguiente hace otra pasada completa", async () => {
    const { registrador, registrar, falso } = preparar();
    await registrador.vuelta();
    falso.lectura.reconstruir();
    expect(await registrador.vuelta()).toEqual({ estado: "cursor_caducado" });
    expect(registrador.cursor).toBeNull();
    registrar.mockClear();
    const r = await registrador.vuelta();
    expect(r).toMatchObject({ estado: "ok", completa: true, leidas: 7 });
    expect(registrar).toHaveBeenCalledTimes(7);
    expect(registrador.cursor).not.toBeNull();
  });

  it("con BzzzBX caído no escribe y no avanza el cursor: ni al arrancar ni después", async () => {
    const { registrador, registrar, falso, log } = preparar();
    falso.lectura.noDisponible(true);
    expect(await registrador.vuelta()).toEqual({ estado: "no_disponible" });
    expect(registrador.cursor).toBeNull();
    expect(registrar).not.toHaveBeenCalled();
    falso.lectura.noDisponible(false);
    await registrador.vuelta();
    const cursor = registrador.cursor;
    expect(cursor).not.toBeNull();
    falso.lectura.poner("alert_result", alertaNueva("bx-alert-9020"));
    falso.lectura.noDisponible(true);
    registrar.mockClear();
    await registrador.vuelta();
    await registrador.vuelta();
    expect(registrador.cursor).toBe(cursor);
    expect(registrar).not.toHaveBeenCalled();
    // Avisa una vez al caer y una al volver, y la alerta que cambió mientras tanto se anota.
    expect(log.warn).toHaveBeenCalledTimes(2);
    falso.lectura.noDisponible(false);
    await registrador.vuelta();
    expect(registrar).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("volvió"));
  });

  it("OP035 (y 22023 y OP036) se salta con log y sigue con las demás", async () => {
    const { registrador, registradas, registrar, log } = preparar({
      falla: (a) => (a.bzzzbx_alert_id === "bx-alert-0002" ? Object.assign(new Error("otra request"), { code: "OP035" }) : null),
    });
    const r = await registrador.vuelta();
    expect(r).toMatchObject({ estado: "ok", registradas: 6, saltadas: 1 });
    expect(registrar).toHaveBeenCalledTimes(7);
    expect(registradas.map((a) => a.bzzzbx_alert_id)).not.toContain("bx-alert-0002");
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("bx-alert-0002"));
    expect(registrador.cursor).not.toBeNull();
  });

  it("cualquier otro error corta la pasada, no avanza el cursor y se reintenta", async () => {
    let fallar = true;
    const { registrador, registrar, falso } = preparar({
      falla: (a) => (fallar && a.bzzzbx_alert_id === "bx-alert-0003" ? Object.assign(new Error("se cayó la base"), { code: "08006" }) : null),
    });
    await expect(registrador.vuelta()).rejects.toThrow("se cayó la base");
    expect(registrador.cursor).toBeNull();
    fallar = false;
    registrar.mockClear();
    const r = await registrador.vuelta();
    expect(r).toMatchObject({ estado: "ok", completa: true, registradas: 7 });
    // Una vez en marcha, un fallo no pierde lo que cambió.
    falso.lectura.poner("alert_result", alertaNueva("bx-alert-9030"));
    fallar = true;
    const original = registrar.getMockImplementation()!;
    registrar.mockImplementationOnce(async () => {
      throw Object.assign(new Error("de nuevo"), { code: "08006" });
    });
    const cursor = registrador.cursor;
    await expect(registrador.vuelta()).rejects.toThrow("de nuevo");
    expect(registrador.cursor).toBe(cursor);
    registrar.mockImplementation(original);
    fallar = false;
    expect(await registrador.vuelta()).toMatchObject({ estado: "ok", registradas: 1 });
  });

  it("pide las dependencias en cada vuelta (el stand-in se reemplaza al reiniciarlo)", async () => {
    const { registrador, deps } = preparar();
    await registrador.vuelta();
    await registrador.vuelta();
    expect(deps).toHaveBeenCalledTimes(2);
  });

  it("nunca lee de BzzzBX en paralelo sobre la base: las lecturas de opsRUN van de una en una", async () => {
    const { registrador, datos } = preparar();
    let enCurso = 0;
    let maximo = 0;
    for (const nombre of ["requestsActivas", "hilosActivos", "alertasAbiertas", "requestsExistentes", "requestsDeJobs", "requestsDeMensajes", "requestsDeHilos", "registrar"] as const) {
      const original = datos[nombre] as (...args: unknown[]) => Promise<unknown>;
      (datos as unknown as Record<string, unknown>)[nombre] = async (...args: unknown[]) => {
        enCurso += 1;
        maximo = Math.max(maximo, enCurso);
        await new Promise((resolver) => setTimeout(resolver, 1));
        try {
          return await original(...args);
        } finally {
          enCurso -= 1;
        }
      };
    }
    await registrador.vuelta();
    expect(maximo).toBe(1);
  });
});

describe("registrador de alertas: una alerta de mensaje que todavía no lleva a una request (OPR-19, P-5)", () => {
  /** Un texto de otro job que opsRUN todavía no vinculó: el falso abre su alerta al fallar, antes de que exista su `request_message`. */
  const textoSinVincular = (falso: ReturnType<typeof preparar>["falso"], id = "bx-msg-0300") => {
    falso.lectura.poner("message", { ...mensaje(id), delivery: "sent" });
    falso.lectura.cambiar("message", id, { delivery: "failed", delivery_detail: "Invalid number." });
  };

  it("se reintenta en las vueltas siguientes y se escribe una sola vez cuando aparece el vínculo", async () => {
    const vinculos = new Map<string, string>();
    const { registrador, registrar, registradas, falso, pasar, log } = preparar({ mensajesVinculados: vinculos });
    await registrador.vuelta();
    registrar.mockClear();
    registradas.length = 0;

    textoSinVincular(falso);
    expect(await registrador.vuelta()).toMatchObject({ estado: "ok", registradas: 0, saltadas: 1 });
    pasar(15_000);
    expect(await registrador.vuelta()).toMatchObject({ estado: "ok", registradas: 0, saltadas: 1 });
    expect(registrar).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);

    // La reconciliación crea el vínculo (el cambio de alerta ya pasó: solo el reintento la puede ver).
    vinculos.set("bx-msg-0300", R(2));
    pasar(15_000);
    expect(await registrador.vuelta()).toMatchObject({ estado: "ok", registradas: 1, saltadas: 0 });
    expect(registradas.map((a) => [a.bzzzbx_alert_id, a.request_id, a.bzzzbx_message_id])).toEqual([["bx-alert-msg-0300", R(2), "bx-msg-0300"]]);

    // Una vez escrita, no se reintenta más.
    pasar(15_000);
    expect(await registrador.vuelta()).toMatchObject({ registradas: 0, saltadas: 0, leidas: 0 });
    expect(registrar).toHaveBeenCalledTimes(1);
  });

  it("pasado el plazo se suelta con log y no se vuelve a leer", async () => {
    const { registrador, registrar, falso, pasar, log } = preparar();
    await registrador.vuelta();
    registrar.mockClear();
    textoSinVincular(falso);
    await registrador.vuelta();
    pasar(PLAZO_DE_REINTENTO_MS - 1);
    expect(await registrador.vuelta()).toMatchObject({ saltadas: 1 });
    pasar(1);
    expect(await registrador.vuelta()).toMatchObject({ saltadas: 1 });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("se suelta"));
    pasar(15_000);
    expect(await registrador.vuelta()).toMatchObject({ leidas: 0, saltadas: 0 });
    expect(registrar).not.toHaveBeenCalled();
  });

  it("una alerta de un job o de una request sin request no se reintenta: solo las de mensaje", async () => {
    const { registrador, falso, pasar } = preparar();
    await registrador.vuelta();
    falso.lectura.poner("alert_result", alertaNueva("bx-alert-9020", { sujeto: { tipo: "job", bzzzbx_job_id: "bx-job-9999" } }));
    expect(await registrador.vuelta()).toMatchObject({ saltadas: 1 });
    pasar(15_000);
    expect(await registrador.vuelta()).toMatchObject({ leidas: 0, saltadas: 0 });
  });

  it("con BzzzBX caído no se pierde la espera: al volver sigue reintentando", async () => {
    const vinculos = new Map<string, string>();
    const { registrador, registradas, falso, pasar } = preparar({ mensajesVinculados: vinculos });
    await registrador.vuelta();
    textoSinVincular(falso);
    await registrador.vuelta();
    falso.lectura.noDisponible(true);
    pasar(15_000);
    expect(await registrador.vuelta()).toEqual({ estado: "no_disponible" });
    falso.lectura.noDisponible(false);
    vinculos.set("bx-msg-0300", R(2));
    pasar(15_000);
    expect(await registrador.vuelta()).toMatchObject({ registradas: 1 });
    expect(registradas.at(-1)).toMatchObject({ bzzzbx_alert_id: "bx-alert-msg-0300" });
  });
});

describe("registrador de alertas: la pasada completa mira los salientes que fallaron (OPR-19, P-5)", () => {
  it("encuentra la alerta de un texto saliente fallido de una request activa, aunque no tenga hilo ni cambio que la anuncie", async () => {
    const { registrador, registradas, falso } = preparar();
    // Antes de arrancar: opsRUN estaba parado cuando el texto de R2 falló y la alerta abrió.
    falso.lectura.cambiar("message", "bx-msg-0102", { delivery: "failed", delivery_detail: "Invalid number." });
    expect(registrador.cursor).toBeNull();
    await registrador.vuelta();
    expect(registradas.map((a) => [a.bzzzbx_alert_id, a.request_id, a.bzzzbx_message_id])).toContainEqual(["bx-alert-msg-0102", R(2), "bx-msg-0102"]);
  });

  it("solo mira los salientes que no llegaron: uno entregado no se consulta por sujeto mensaje", async () => {
    const { registrador, falso } = preparar();
    const listar = vi.spyOn(falso.lectura, "listarPor");
    await registrador.vuelta();
    const porMensaje = listar.mock.calls.filter(([entidad, filtro]) => entidad === "alert_result" && (filtro as { sujeto: { tipo: string } }).sujeto.tipo === "message");
    // Los de los hilos de la seed (bx-msg-0001 a 0009 por hilo) sí; el texto entregado de R2 (bx-msg-0102), no.
    expect(porMensaje.some(([, filtro]) => JSON.stringify(filtro).includes("bx-msg-0102"))).toBe(false);
  });
});

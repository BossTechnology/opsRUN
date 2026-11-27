// @vitest-environment node
/**
 * La entrada de correo (spec OPR-15 §9.2): la lógica de la vuelta sobre el
 * falso de BzzzBX y unos datos en memoria que se comportan como la función SQL
 * (la base de verdad se prueba en pgTAP y en `datos-sql.test.ts`).
 */
import { describe, expect, it, vi } from "vitest";

import { BzzzbxNoDisponible, CursorCaducado } from "../bzzzbx/errores";
import { crearFalso, RelojManual } from "../bzzzbx/falso";
import type { LecturaBzzzbx } from "../bzzzbx/puertos";
import type { Message } from "../bzzzbx/tipos";

import { crearEntrada, MARGEN_DE_RECUPERACION_MS, type CorreoEntrante, type DatosDeEntrada, type Resultado } from "./entrada";

const registro = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

function correo(id: string, parche: Partial<Message> = {}): Message {
  return {
    bzzzbx_message_id: `bx-msg-${id}`,
    bzzzbx_thread_id: `bx-thread-${id}`,
    channel: "email",
    direction: "inbound",
    from: "new.requester@example.test",
    to: ["requests@example.test"],
    subject: "Cleaning request",
    body: "Please clean the unit.",
    sent_at: "2030-01-15T14:00:00.000Z",
    delivery: "delivered",
    ...parche,
  };
}

/** Datos en memoria con la semántica de la función SQL: duplicate, linked, created. */
function datosEnMemoria(opciones: { marca?: string | null } = {}) {
  const llamadas: CorreoEntrante[] = [];
  const vistos = new Map<string, string>();
  const hilos = new Map<string, string>();
  let n = 0;
  const falla: { error: unknown } = { error: null };
  const datos: DatosDeEntrada = {
    marcaDeAgua: vi.fn(async () => opciones.marca ?? null),
    ingerir: vi.fn(async (c) => {
      llamadas.push(c);
      if (falla.error) throw falla.error;
      const ya = vistos.get(c.bzzzbx_message_id);
      if (ya) return { request_id: ya, outcome: "duplicate" as Resultado };
      const delHilo = c.bzzzbx_thread_id ? hilos.get(c.bzzzbx_thread_id) : undefined;
      if (delHilo) {
        vistos.set(c.bzzzbx_message_id, delHilo);
        return { request_id: delHilo, outcome: "linked" as Resultado };
      }
      const id = `req-${++n}`;
      vistos.set(c.bzzzbx_message_id, id);
      if (c.bzzzbx_thread_id) hilos.set(c.bzzzbx_thread_id, id);
      return { request_id: id, outcome: "created" as Resultado };
    }),
  };
  return { datos, llamadas, falla, requests: () => new Set(vistos.values()).size };
}

function montar(opciones: { marca?: string | null; alCrear?: (id: string) => void } = {}) {
  const reloj = new RelojManual();
  const falso = crearFalso({ reloj });
  const base = datosEnMemoria(opciones);
  const log = registro();
  const entrada = crearEntrada({ lectura: falso.lectura, datos: base.datos, alCrearRequest: opciones.alCrear, log });
  return { reloj, falso, ...base, entrada, log };
}

/** Pone un correo en el origen y adelanta la hora. */
function llega(falso: ReturnType<typeof crearFalso>, m: Message) {
  falso.lectura.poner("message", m);
}

describe("crearEntrada().vuelta()", () => {
  it("la primera vuelta toma el cursor de ahora y, sin requests en la base, no recupera nada (P-5)", async () => {
    const { entrada, falso, datos, llamadas } = montar({ marca: null });
    const buscar = vi.spyOn(falso.lectura, "buscarMensajes");
    expect(await entrada.vuelta()).toMatchObject({ estado: "ok", creadas: 0 });
    expect(buscar).not.toHaveBeenCalled();
    expect(datos.marcaDeAgua).toHaveBeenCalledTimes(1);
    expect(llamadas).toEqual([]);
    expect(entrada.cursor).not.toBeNull();
  });

  it("un correo entrante nuevo llama a la función una vez, con solo mensaje, hilo y hora", async () => {
    const { entrada, falso, llamadas } = montar();
    await entrada.vuelta();
    llega(falso, correo("n1"));
    expect(await entrada.vuelta()).toMatchObject({ estado: "ok", creadas: 1 });
    expect(llamadas).toEqual([
      { bzzzbx_message_id: "bx-msg-n1", bzzzbx_thread_id: "bx-thread-n1", received_at: "2030-01-15T14:00:00.000Z" },
    ]);
  });

  it("nada de PINCH viaja a la base: los parámetros son exactamente mensaje, hilo y hora", async () => {
    const { entrada, falso, llamadas } = montar();
    await entrada.vuelta();
    llega(falso, correo("n2", { from: "secreto@example.test", subject: "Asunto privado", body: "Cuerpo privado" }));
    await entrada.vuelta();
    expect(llamadas).toHaveLength(1);
    expect(Object.keys(llamadas[0]!).sort()).toEqual(["bzzzbx_message_id", "bzzzbx_thread_id", "received_at"]);
    expect(JSON.stringify(llamadas)).not.toMatch(/secreto|privado|from|subject|body/);
  });

  it("un correo saliente, un texto y un cambio de otra entidad no llaman a la función", async () => {
    const { entrada, falso, llamadas } = montar();
    await entrada.vuelta();
    llega(falso, correo("s1", { direction: "outbound" }));
    llega(falso, correo("t1", { channel: "text", bzzzbx_thread_id: null }));
    falso.lectura.cambiar("job_health", "bx-job-0003", { status: "breached" });
    expect(await entrada.vuelta()).toMatchObject({ estado: "ok", creadas: 0 });
    expect(llamadas).toEqual([]);
  });

  it("procesa por hora y, a igual hora, por ID: el original antes que sus respuestas", async () => {
    const { entrada, falso, llamadas } = montar();
    await entrada.vuelta();
    llega(falso, correo("z", { bzzzbx_message_id: "bx-msg-b", bzzzbx_thread_id: "bx-thread-h", sent_at: "2030-01-15T14:05:00.000Z" }));
    llega(falso, correo("z", { bzzzbx_message_id: "bx-msg-c", bzzzbx_thread_id: "bx-thread-h", sent_at: "2030-01-15T14:05:00.000Z" }));
    llega(falso, correo("z", { bzzzbx_message_id: "bx-msg-a", bzzzbx_thread_id: "bx-thread-h", sent_at: "2030-01-15T14:00:00.000Z" }));
    await entrada.vuelta();
    expect(llamadas.map((c) => c.bzzzbx_message_id)).toEqual(["bx-msg-a", "bx-msg-b", "bx-msg-c"]);
  });

  it("una respuesta en un hilo que ya es de una request se vincula; no hay otra request", async () => {
    const { entrada, falso, requests } = montar();
    await entrada.vuelta();
    llega(falso, correo("h1"));
    llega(falso, correo("h1r", { bzzzbx_thread_id: "bx-thread-h1", sent_at: "2030-01-15T14:10:00.000Z" }));
    expect(await entrada.vuelta()).toMatchObject({ creadas: 1, vinculadas: 1 });
    expect(requests()).toBe(1);
  });

  it("un cambio de versión de un mensaje ya vinculado vuelve a pasar y sale duplicate", async () => {
    const { entrada, falso } = montar();
    await entrada.vuelta();
    llega(falso, correo("v1"));
    await entrada.vuelta();
    falso.lectura.cambiar("message", "bx-msg-v1", { delivery: "sent" });
    expect(await entrada.vuelta()).toMatchObject({ creadas: 0, duplicadas: 1 });
  });

  it("el cursor avanza solo si todo salió bien: con un fallo de la base, la vuelta siguiente reintenta", async () => {
    const { entrada, falso, falla, llamadas, requests } = montar();
    await entrada.vuelta();
    const antes = entrada.cursor;
    llega(falso, correo("f1"));
    falla.error = new Error("la base no responde");
    await expect(entrada.vuelta()).rejects.toThrow("la base no responde");
    expect(entrada.cursor).toBe(antes);
    falla.error = null;
    expect(await entrada.vuelta()).toMatchObject({ creadas: 1 });
    expect(requests()).toBe(1);
    expect(llamadas.map((c) => c.bzzzbx_message_id)).toEqual(["bx-msg-f1", "bx-msg-f1"]);
    expect(entrada.cursor).not.toBe(antes);
  });

  it.each([
    ["22023", "argumento inválido"],
    ["OP030", "hilo ambiguo"],
  ])("un mensaje que la base rechaza siempre (%s) se registra y se salta, y el cursor avanza", async (code) => {
    const { entrada, falso, datos, log } = montar();
    await entrada.vuelta();
    const antes = entrada.cursor;
    llega(falso, correo("x1"));
    llega(falso, correo("x2", { sent_at: "2030-01-15T14:01:00.000Z" }));
    const original = datos.ingerir;
    datos.ingerir = vi.fn(async (c) => {
      if (c.bzzzbx_message_id === "bx-msg-x1") throw Object.assign(new Error("rechazado"), { code });
      return original(c);
    });
    expect(await entrada.vuelta()).toMatchObject({ estado: "ok", saltadas: 1, creadas: 1 });
    expect(log.error.mock.calls.flat().join(" ")).toContain("bx-msg-x1");
    expect(log.error.mock.calls.flat().join(" ")).toContain(code);
    expect(entrada.cursor).not.toBe(antes);
  });

  it("cualquier otro código de la base no se salta: el cursor se queda", async () => {
    const { entrada, falso, falla } = montar();
    await entrada.vuelta();
    const antes = entrada.cursor;
    llega(falso, correo("y1"));
    falla.error = Object.assign(new Error("se cayó"), { code: "57P01" });
    await expect(entrada.vuelta()).rejects.toThrow("se cayó");
    expect(entrada.cursor).toBe(antes);
  });

  it("un mensaje que el puerto ya no conoce se ignora", async () => {
    const { entrada, falso, llamadas } = montar();
    await entrada.vuelta();
    llega(falso, correo("g1"));
    vi.spyOn(falso.lectura, "obtenerVarios").mockResolvedValueOnce([]);
    expect(await entrada.vuelta()).toMatchObject({ estado: "ok", creadas: 0 });
    expect(llamadas).toEqual([]);
  });

  it("BzzzBX caído no toca el cursor ni la base, avisa una vez al caer y una al volver", async () => {
    const { entrada, falso, datos, log } = montar();
    await entrada.vuelta();
    const antes = entrada.cursor;
    const llamadasAntes = vi.mocked(datos.ingerir).mock.calls.length;
    falso.lectura.noDisponible(true);
    llega(falso, correo("d1"));
    for (let i = 0; i < 4; i++) expect(await entrada.vuelta()).toEqual({ estado: "no_disponible" });
    expect(entrada.cursor).toBe(antes);
    expect(vi.mocked(datos.ingerir).mock.calls.length).toBe(llamadasAntes);
    expect(log.warn).toHaveBeenCalledTimes(1);

    falso.lectura.noDisponible(false);
    expect(await entrada.vuelta()).toMatchObject({ estado: "ok", creadas: 1 });
    expect(log.info.mock.calls.flat().join(" ")).toContain("volvió");
    expect(log.info.mock.calls.filter((c) => String(c[0]).includes("volvió"))).toHaveLength(1);
  });

  it("alCrearRequest se llama solo con created, con la request, y después de la base", async () => {
    const orden: string[] = [];
    const alCrear = vi.fn((id: string) => {
      orden.push(`enganche:${id}`);
    });
    const { entrada, falso, datos } = montar({ alCrear });
    const original = datos.ingerir;
    datos.ingerir = vi.fn(async (c) => {
      const r = await original(c);
      orden.push(`base:${c.bzzzbx_message_id}:${r.outcome}`);
      return r;
    });
    await entrada.vuelta();
    llega(falso, correo("a1"));
    llega(falso, correo("a1r", { bzzzbx_thread_id: "bx-thread-a1", sent_at: "2030-01-15T14:10:00.000Z" }));
    await entrada.vuelta();
    expect(alCrear).toHaveBeenCalledTimes(1);
    expect(orden).toEqual(["base:bx-msg-a1:created", "enganche:req-1", "base:bx-msg-a1r:linked"]);
  });

  it("si alCrearRequest falla, la entrada sigue y avanza el cursor", async () => {
    const { entrada, falso, log } = montar({
      alCrear: () => {
        throw new Error("sin IA");
      },
    });
    await entrada.vuelta();
    const antes = entrada.cursor;
    llega(falso, correo("e1"));
    expect(await entrada.vuelta()).toMatchObject({ estado: "ok", creadas: 1 });
    expect(entrada.cursor).not.toBe(antes);
    expect(log.error.mock.calls.flat().join(" ")).toContain("sin IA");
  });
});

describe("la recuperación (§4.3)", () => {
  const MARCA = "2030-01-20T12:00:00.000Z";

  it("sin cursor pide cambiosDesde(null) ANTES de buscarMensajes, desde la marca menos 24 h", async () => {
    const { entrada, falso } = montar({ marca: MARCA });
    const orden: string[] = [];
    const cambios = falso.lectura.cambiosDesde.bind(falso.lectura);
    const buscar = falso.lectura.buscarMensajes.bind(falso.lectura);
    vi.spyOn(falso.lectura, "cambiosDesde").mockImplementation((c) => (orden.push(`cambiosDesde(${c})`), cambios(c)));
    vi.spyOn(falso.lectura, "buscarMensajes").mockImplementation((f) => (orden.push(`buscar(${f.desde})`), buscar(f)));
    await entrada.vuelta();
    expect(orden).toEqual([
      "cambiosDesde(null)",
      `buscar(${new Date(Date.parse(MARCA) - MARGEN_DE_RECUPERACION_MS).toISOString()})`,
    ]);
  });

  it("recupera lo que llegó mientras no se miraba y la base deduplica lo ya vinculado", async () => {
    const { entrada, falso, llamadas, requests } = montar({ marca: MARCA });
    llega(falso, correo("r0", { sent_at: "2030-01-18T10:00:00.000Z" })); // fuera del margen
    llega(falso, correo("r1", { sent_at: "2030-01-20T11:00:00.000Z" }));
    llega(falso, correo("r2", { sent_at: "2030-01-20T13:00:00.000Z" }));
    expect(await entrada.vuelta()).toMatchObject({ estado: "ok", creadas: 2 });
    expect(llamadas.map((c) => c.bzzzbx_message_id)).toEqual(["bx-msg-r1", "bx-msg-r2"]);
    expect(requests()).toBe(2);
  });

  it("pagina con despuesDe hasta que hay_mas es false", async () => {
    const { entrada, falso, llamadas } = montar({ marca: MARCA });
    for (let i = 0; i < 205; i++) {
      const id = String(i).padStart(3, "0");
      llega(falso, correo(`p${id}`, { sent_at: `2030-01-20T13:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z` }));
    }
    const buscar = vi.spyOn(falso.lectura, "buscarMensajes");
    await entrada.vuelta();
    expect(buscar).toHaveBeenCalledTimes(2);
    expect(buscar.mock.calls[0]![0].despuesDe).toBeUndefined();
    expect(buscar.mock.calls[1]![0].despuesDe).toBe("bx-msg-p199");
    expect(llamadas.map((c) => c.bzzzbx_message_id).filter((id) => id.startsWith("bx-msg-p"))).toHaveLength(205);
  });

  it("si la recuperación falla, no deja cursor: la vuelta siguiente la repite", async () => {
    const { entrada, falso, falla, llamadas } = montar({ marca: MARCA });
    llega(falso, correo("q1", { sent_at: "2030-01-20T13:00:00.000Z" }));
    falla.error = new Error("la base no responde");
    await expect(entrada.vuelta()).rejects.toThrow();
    expect(entrada.cursor).toBeNull();
    falla.error = null;
    expect(await entrada.vuelta()).toMatchObject({ creadas: 1 });
    expect(entrada.cursor).not.toBeNull();
    expect(llamadas).toHaveLength(2);
  });

  it("con BzzzBX caído durante la recuperación sigue sin cursor hasta completarla", async () => {
    const { entrada, falso } = montar({ marca: MARCA });
    falso.lectura.noDisponible(true);
    expect(await entrada.vuelta()).toEqual({ estado: "no_disponible" });
    expect(entrada.cursor).toBeNull();
    falso.lectura.noDisponible(false);
    expect((await entrada.vuelta()).estado).toBe("ok");
    expect(entrada.cursor).not.toBeNull();
  });

  it("CursorCaducado deja el cursor en null y la vuelta siguiente recupera", async () => {
    const { entrada, falso, llamadas } = montar({ marca: MARCA });
    await entrada.vuelta();
    const buscar = vi.spyOn(falso.lectura, "buscarMensajes");
    llega(falso, correo("c1", { sent_at: "2030-01-20T13:30:00.000Z" }));
    falso.lectura.reconstruir();
    expect(await entrada.vuelta()).toEqual({ estado: "cursor_caducado" });
    expect(entrada.cursor).toBeNull();
    expect(buscar).not.toHaveBeenCalled();
    expect(await entrada.vuelta()).toMatchObject({ estado: "ok", creadas: 1 });
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(llamadas.map((c) => c.bzzzbx_message_id)).toContain("bx-msg-c1");
  });

  it("un hay_mas que no avanza no se queda dando vueltas", async () => {
    const { datos } = montar({ marca: MARCA });
    const lectura = {
      cambiosDesde: async () => ({ cambios: [], cursor: "c" as never, hay_mas: false }),
      buscarMensajes: async () => ({ mensajes: [], hay_mas: true }),
    } as unknown as LecturaBzzzbx;
    const entrada = crearEntrada({ lectura, datos, log: registro() });
    await expect(entrada.vuelta()).rejects.toThrow(/no avanza/);
  });
});

describe("errores por nombre, no por instanceof", () => {
  it("reconoce un BzzzbxNoDisponible y un CursorCaducado de otra copia del módulo", async () => {
    const otraCopia = (nombre: string) => {
      const e = new Error("x");
      e.name = nombre;
      return e;
    };
    const lectura = {
      cambiosDesde: vi.fn().mockRejectedValueOnce(otraCopia("BzzzbxNoDisponible")).mockRejectedValueOnce(otraCopia("CursorCaducado")),
    } as unknown as LecturaBzzzbx;
    const entrada = crearEntrada({ lectura, datos: datosEnMemoria().datos, log: registro() });
    expect(await entrada.vuelta()).toEqual({ estado: "no_disponible" });
    expect(await entrada.vuelta()).toEqual({ estado: "cursor_caducado" });
    // Y las clases reales también.
    expect(new BzzzbxNoDisponible().name).toBe("BzzzbxNoDisponible");
    expect(new CursorCaducado().name).toBe("CursorCaducado");
  });
});

// @vitest-environment node
/**
 * La vuelta de la tarea `analisis_ia` (spec OPR-36 §9 y §15.2) con un puerto de IA, unos
 * datos y un reloj de prueba. Y el guard "nada de PINCH viaja" (§14.3): a BzzzBX solo salen
 * la clave, el ID del mensaje original, el del hilo y los campos; a la base, solo las
 * propuestas con las claves de §4.1.
 */
import { describe, expect, it, vi } from "vitest";

import { BzzzbxNoDisponible, IaLimitada, IaRechazada } from "../bzzzbx/errores";
import { crearFalso, RelojManual } from "../bzzzbx/falso";
import type { IaBzzzbx } from "../bzzzbx/puertos";
import type { PedidoDeAnalisis, ResultadoDeAnalisis } from "../bzzzbx/tipos-ia";

import {
  crearAnalisis,
  LIMITE_DEL_ANALISIS_MS,
  POR_VUELTA,
  type CierreDeAnalisis,
  type DatosDeAnalisis,
  type PendienteDeAnalisis,
} from "./analisis";

const AHORA = new Date("2030-01-15T15:00:00.000Z");

const pendiente = (n: number, haceMs = 1000): PendienteDeAnalisis => ({
  id: `an-${n}`,
  request_id: `rq-${n}`,
  requested_at: new Date(AHORA.getTime() - haceMs).toISOString(),
  bzzzbx_message_id: `bx-msg-${n}`,
  bzzzbx_thread_id: `bx-thread-${n}`,
});

const listo = (propuestas: unknown[] = [{ campo: "unit", rank: 1, valor: "4B", motivo: "x" }], modelo: string | null = "example-model"): ResultadoDeAnalisis =>
  ({ estado: "listo", modelo, propuestas, terminado_at: AHORA.toISOString() }) as ResultadoDeAnalisis;

type Montaje = {
  datos: DatosDeAnalisis & { llamadas: string[]; cierres: CierreDeAnalisis[] };
  ia: IaBzzzbx & { pedidos: PedidoDeAnalisis[]; resultados: Map<string, ResultadoDeAnalisis | null> };
  log: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
};

function montar(opciones: {
  barrido?: string[];
  pendientes?: PendienteDeAnalisis[];
  iniciar?: (id: string) => Promise<string | null>;
  registrar?: (c: CierreDeAnalisis) => Promise<"recorded" | "duplicate">;
  pedir?: (p: PedidoDeAnalisis) => Promise<void>;
  resultado?: (clave: string) => Promise<ResultadoDeAnalisis | null>;
} = {}): Montaje {
  const llamadas: string[] = [];
  const cierres: CierreDeAnalisis[] = [];
  const datos = {
    llamadas,
    cierres,
    iniciar: async (id: string) => {
      llamadas.push(`iniciar:${id}`);
      return opciones.iniciar ? opciones.iniciar(id) : `an-de-${id}`;
    },
    candidatasDelBarrido: async (limite: number) => {
      llamadas.push(`barrido:${limite}`);
      return (opciones.barrido ?? []).slice(0, limite);
    },
    pendientes: async (limite: number) => (opciones.pendientes ?? []).slice(0, limite),
    registrar: async (c: CierreDeAnalisis) => {
      cierres.push(c);
      return opciones.registrar ? opciones.registrar(c) : "recorded";
    },
  };
  const resultados = new Map<string, ResultadoDeAnalisis | null>();
  const pedidos: PedidoDeAnalisis[] = [];
  const ia = {
    pedidos,
    resultados,
    pedirAnalisis: async (p: PedidoDeAnalisis) => {
      if (opciones.pedir) await opciones.pedir(p);
      pedidos.push(p);
      return { recibido_at: AHORA.toISOString() };
    },
    resultadoDeAnalisis: async (clave: string) => (opciones.resultado ? opciones.resultado(clave) : (resultados.get(clave) ?? null)),
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { datos, ia, log };
}

const analisisDe = (m: Montaje) => crearAnalisis({ ia: m.ia, datos: m.datos, reloj: () => AHORA, log: m.log });

describe("crearAnalisis().vuelta(): empezar", () => {
  it("abre el análisis de las despertadas primero y del barrido después, sin repetir, hasta 20", async () => {
    const m = montar({ barrido: ["rq-b", "rq-a", "rq-c"] });
    const a = analisisDe(m);
    a.despertar("rq-a");
    a.despertar("rq-z");
    const r = await a.vuelta();
    expect(m.datos.llamadas.filter((l) => l.startsWith("iniciar:"))).toEqual(["iniciar:rq-a", "iniciar:rq-z", "iniciar:rq-b", "iniciar:rq-c"]);
    expect(r.iniciados).toBe(4);
  });

  it("el tope de 20 por vuelta: las despertadas de más esperan a la vuelta siguiente y el barrido pide solo lo que cabe", async () => {
    const m = montar();
    const a = analisisDe(m);
    for (let i = 0; i < 25; i++) a.despertar(`rq-${i}`);
    await a.vuelta();
    expect(m.datos.llamadas.filter((l) => l.startsWith("iniciar:"))).toHaveLength(POR_VUELTA);
    expect(m.datos.llamadas.some((l) => l.startsWith("barrido:"))).toBe(false);
    m.datos.llamadas.length = 0;
    await a.vuelta();
    expect(m.datos.llamadas.filter((l) => l.startsWith("iniciar:"))).toHaveLength(5);
    expect(m.datos.llamadas).toContain(`barrido:${POR_VUELTA - 5}`);
  });

  it("si la base dice que no toca (null), no cuenta", async () => {
    const m = montar({ barrido: ["rq-1"], iniciar: async () => null });
    expect((await analisisDe(m).vuelta()).iniciados).toBe(0);
  });

  it("un error de la base en una request no frena a las otras", async () => {
    const m = montar({
      barrido: ["rq-1", "rq-2", "rq-3"],
      iniciar: async (id) => {
        if (id === "rq-2") throw Object.assign(new Error("se cayó"), { code: "08006" });
        return `an-${id}`;
      },
    });
    const r = await analisisDe(m).vuelta();
    expect(r.iniciados).toBe(2);
    expect(m.log.error).toHaveBeenCalledWith(expect.stringContaining("rq-2"), "se cayó");
  });

  it("un error del barrido o de los pendientes se registra y la vuelta sigue", async () => {
    const m = montar();
    m.datos.candidatasDelBarrido = async () => {
      throw new Error("barrido roto");
    };
    m.datos.pendientes = async () => {
      throw new Error("pendientes rotos");
    };
    await expect(analisisDe(m).vuelta()).resolves.toMatchObject({ estado: "ok" });
    expect(m.log.error).toHaveBeenCalledTimes(2);
  });

  it("despertar solo anota: no llama a la base ni a BzzzBX", () => {
    const m = montar();
    analisisDe(m).despertar("rq-1");
    expect(m.datos.llamadas).toEqual([]);
    expect(m.ia.pedidos).toEqual([]);
  });
});

describe("crearAnalisis().vuelta(): seguir los pendientes", () => {
  it("BzzzBX no conoce la clave: se pide con la misma clave y solo con IDs", async () => {
    const m = montar({ pendientes: [pendiente(1)] });
    const r = await analisisDe(m).vuelta();
    expect(r.pedidos).toBe(1);
    expect(m.ia.pedidos).toEqual([
      {
        clave: "an-1",
        bzzzbx_message_id: "bx-msg-1",
        bzzzbx_thread_id: "bx-thread-1",
        campos: ["property", "space", "unit", "beds", "service", "service_date", "time_window", "access_notes", "po_number", "sender", "multiple_jobs"],
      },
    ]);
  });

  it("en curso antes del límite se deja; pasado el límite, timed_out", async () => {
    const m = montar({
      pendientes: [pendiente(1, LIMITE_DEL_ANALISIS_MS - 1), pendiente(2, LIMITE_DEL_ANALISIS_MS)],
      resultado: async () => ({ estado: "en_curso" }),
    });
    const r = await analisisDe(m).vuelta();
    expect(m.datos.cierres).toEqual([{ analisisId: "an-2", estado: "timed_out", modelo: null, propuestas: [], errorCode: null, definitivo: false }]);
    expect(r.vencidos).toBe(1);
  });

  it("si BzzzBX no conoce la clave y ya venció, termina timed_out sin volver a pedir", async () => {
    const m = montar({ pendientes: [pendiente(1, LIMITE_DEL_ANALISIS_MS + 5000)] });
    await analisisDe(m).vuelta();
    expect(m.ia.pedidos).toEqual([]);
    expect(m.datos.cierres[0]).toMatchObject({ analisisId: "an-1", estado: "timed_out" });
  });

  it("un resultado listo y válido se guarda completed, con el modelo y las propuestas con las claves de §4.1", async () => {
    const m = montar({
      pendientes: [pendiente(1)],
      resultado: async () =>
        listo([
          { campo: "sender", rank: 1, valor: { bzzzbx_customer_id: "bx-cust-0001" }, motivo: "La firma" },
          { campo: "unit", rank: 1, valor: "4B", motivo: null },
        ]),
    });
    const r = await analisisDe(m).vuelta();
    expect(r.completados).toBe(1);
    expect(m.datos.cierres).toEqual([
      {
        analisisId: "an-1",
        estado: "completed",
        modelo: "example-model",
        errorCode: null,
        definitivo: false,
        propuestas: [
          { field: "sender", rank: 1, value: { bzzzbx_customer_id: "bx-cust-0001", bzzzbx_contact_id: null }, reason: "La firma" },
          { field: "unit", rank: 1, value: "4B", reason: null },
        ],
      },
    ]);
    // §14.3: lo que baja a la base son exactamente estas claves, nada más.
    for (const p of m.datos.cierres[0]!.propuestas) expect(Object.keys(p).sort()).toEqual(["field", "rank", "reason", "value"]);
  });

  it("un resultado con una propuesta inválida se descarta entero: failed invalid_result, y el log dice el campo y no el valor", async () => {
    const m = montar({
      pendientes: [pendiente(1)],
      resultado: async () =>
        listo([
          { campo: "unit", rank: 1, valor: "4B", motivo: null },
          { campo: "beds", rank: 1, valor: "Maria Ejemplo escribió tres", motivo: null },
        ]),
    });
    const r = await analisisDe(m).vuelta();
    expect(r.fallidos).toBe(1);
    expect(m.datos.cierres).toEqual([{ analisisId: "an-1", estado: "failed", modelo: null, propuestas: [], errorCode: "invalid_result", definitivo: false }]);
    const texto = m.log.error.mock.calls.flat().join(" ");
    expect(texto).toContain("beds");
    expect(texto).not.toContain("Maria Ejemplo");
  });

  it("un campo que no se pidió también descarta el resultado", async () => {
    const m = montar({ pendientes: [pendiente(1)], resultado: async () => listo([{ campo: "cleaner_team", rank: 1, valor: "bx-team-0001", motivo: null }]) });
    await analisisDe(m).vuelta();
    expect(m.datos.cierres[0]).toMatchObject({ estado: "failed", errorCode: "invalid_result" });
  });

  it("fallido: failed con el error_code de BzzzBX", async () => {
    const m = montar({
      pendientes: [pendiente(1)],
      resultado: async () => ({ estado: "fallido", error_code: "model_error", terminado_at: AHORA.toISOString() }),
    });
    await analisisDe(m).vuelta();
    expect(m.datos.cierres).toEqual([{ analisisId: "an-1", estado: "failed", modelo: null, propuestas: [], errorCode: "model_error", definitivo: false }]);
  });

  it("IaRechazada no definitiva y definitiva: failed con su código, y la base se entera de si es definitiva", async () => {
    const m = montar({
      pendientes: [pendiente(1), pendiente(2)],
      pedir: async (p) => {
        throw p.clave === "an-1" ? new IaRechazada("unsupported_field") : new IaRechazada("message_unknown", true);
      },
    });
    await analisisDe(m).vuelta();
    expect(m.datos.cierres).toEqual([
      { analisisId: "an-1", estado: "failed", modelo: null, propuestas: [], errorCode: "unsupported_field", definitivo: false },
      { analisisId: "an-2", estado: "failed", modelo: null, propuestas: [], errorCode: "message_unknown", definitivo: true },
    ]);
  });

  it("IaLimitada no cuenta como fallo: sigue pending y no se pide más en esa vuelta", async () => {
    const m = montar({
      pendientes: [pendiente(1), pendiente(2)],
      pedir: async () => {
        throw new IaLimitada(5000);
      },
    });
    const r = await analisisDe(m).vuelta();
    expect(m.datos.cierres).toEqual([]);
    expect(r.fallidos).toBe(0);
  });

  it("IaLimitada durante más que el límite termina timed_out", async () => {
    const m = montar({
      pendientes: [pendiente(1, LIMITE_DEL_ANALISIS_MS + 1)],
      resultado: async () => {
        throw new IaLimitada();
      },
    });
    await analisisDe(m).vuelta();
    expect(m.datos.cierres[0]).toMatchObject({ analisisId: "an-1", estado: "timed_out" });
  });

  it("BzzzBX caído corta la vuelta y avisa una vez por caída; lo vencido igual termina a tiempo", async () => {
    const m = montar({
      pendientes: [pendiente(1), pendiente(2, LIMITE_DEL_ANALISIS_MS + 10_000), pendiente(3)],
      resultado: async () => {
        throw new BzzzbxNoDisponible();
      },
    });
    const a = analisisDe(m);
    const r1 = await a.vuelta();
    await a.vuelta();
    expect(r1.estado).toBe("no_disponible");
    expect(m.log.warn).toHaveBeenCalledTimes(1);
    // Solo la primera llamada tocó el puerto: las siguientes ya no lo intentan.
    expect(m.ia.pedidos).toEqual([]);
    expect(m.datos.cierres.map((c) => c.analisisId)).toEqual(["an-2", "an-2"]);
    expect(m.datos.cierres.every((c) => c.estado === "timed_out")).toBe(true);
  });

  it("al volver BzzzBX avisa una vez", async () => {
    let caido = true;
    const m = montar({
      pendientes: [pendiente(1)],
      resultado: async () => {
        if (caido) throw new BzzzbxNoDisponible();
        return { estado: "en_curso" };
      },
    });
    const a = analisisDe(m);
    await a.vuelta();
    caido = false;
    await a.vuelta();
    await a.vuelta();
    expect(m.log.info).toHaveBeenCalledTimes(1);
    expect(m.log.info).toHaveBeenCalledWith(expect.stringContaining("volvió"));
  });

  it("un error de la base al cerrar uno no frena a los otros y se reintenta en la vuelta siguiente", async () => {
    let falla = true;
    const m = montar({
      pendientes: [pendiente(1), pendiente(2)],
      resultado: async () => listo(),
      registrar: async (c) => {
        if (c.analisisId === "an-1" && falla) throw Object.assign(new Error("OP045"), { code: "OP045" });
        return "recorded";
      },
    });
    const a = analisisDe(m);
    const r = await a.vuelta();
    expect(r.completados).toBe(1);
    expect(m.log.error).toHaveBeenCalledWith(expect.stringContaining("OP045"), "OP045");
    falla = false;
    expect((await a.vuelta()).completados).toBe(2);
  });

  it("un error inesperado del puerto en uno se registra y sigue con los otros", async () => {
    const m = montar({
      pendientes: [pendiente(1), pendiente(2)],
      resultado: async (clave) => {
        if (clave === "an-1") throw new Error("respuesta rara");
        return listo();
      },
    });
    const r = await analisisDe(m).vuelta();
    expect(r.completados).toBe(1);
    expect(m.log.error).toHaveBeenCalledWith(expect.stringContaining("an-1"), "respuesta rara");
  });

  it("pide las dependencias en cada vuelta, no las de cuando se creó", async () => {
    const primero = montar({ pendientes: [pendiente(1)] });
    const segundo = montar({ pendientes: [pendiente(2)] });
    let actual = primero;
    const a = crearAnalisis(() => ({ ia: actual.ia, datos: actual.datos, reloj: () => AHORA, log: actual.log }));
    await a.vuelta();
    actual = segundo;
    await a.vuelta();
    expect(primero.ia.pedidos.map((p) => p.clave)).toEqual(["an-1"]);
    expect(segundo.ia.pedidos.map((p) => p.clave)).toEqual(["an-2"]);
  });
});

describe("§14.3: nada de PINCH viaja", () => {
  it("al puerto de IA solo salen la clave, el mensaje original, el hilo y los campos", async () => {
    const m = montar({ pendientes: [pendiente(1)] });
    await analisisDe(m).vuelta();
    expect(Object.keys(m.ia.pedidos[0]!).sort()).toEqual(["bzzzbx_message_id", "bzzzbx_thread_id", "campos", "clave"]);
  });

  it("la tarea no tiene puerto de lectura: sus dependencias son solo la IA y los datos", () => {
    const m = montar();
    const deps = { ia: m.ia, datos: m.datos, reloj: () => AHORA, log: m.log };
    expect(Object.keys(deps).sort()).toEqual(["datos", "ia", "log", "reloj"]);
  });

  it("de punta a punta con el falso: el original de la seed no se analiza, uno con guion sí", async () => {
    const reloj = new RelojManual();
    const falso = crearFalso({ reloj });
    falso.ia.ponerGuion("bx-msg-0001", "normal");
    const cierres: CierreDeAnalisis[] = [];
    const datos: DatosDeAnalisis = {
      iniciar: async () => null,
      candidatasDelBarrido: async () => [],
      pendientes: async () => [
        { id: "an-a", request_id: "rq-a", requested_at: reloj.ahora().toISOString(), bzzzbx_message_id: "bx-msg-0001", bzzzbx_thread_id: "bx-thread-0001" },
        { id: "an-b", request_id: "rq-b", requested_at: reloj.ahora().toISOString(), bzzzbx_message_id: "bx-msg-0002", bzzzbx_thread_id: "bx-thread-0002" },
      ],
      registrar: async (c) => {
        cierres.push(c);
        return "recorded";
      },
    };
    const a = crearAnalisis({ ia: falso.ia, datos, reloj: () => reloj.ahora(), log: { info() {}, warn() {}, error() {} } });
    await a.vuelta();
    // El de la seed sin guion: rechazado como desconocido y definitivo.
    expect(cierres).toEqual([{ analisisId: "an-b", estado: "failed", modelo: null, propuestas: [], errorCode: "message_unknown", definitivo: true }]);
    reloj.adelantar(2000);
    await a.vuelta();
    expect(cierres[1]).toMatchObject({ analisisId: "an-a", estado: "completed", modelo: "example-model" });
    expect(cierres[1]!.propuestas.map((p) => p.field)).toContain("property");
  });
});

// @vitest-environment node
/**
 * El falso del puerto de IA y sus controles (spec OPR-36 §13): los guiones, la idempotencia
 * por clave, los errores reconocidos por nombre y los controles de `/api/falso`.
 */
import { describe, expect, it } from "vitest";

import { validarPropuestas } from "../../analisis-ia/forma";
import { BzzzbxNoDisponible, esIaLimitada, esIaRechazada, esNoDisponible, IaLimitada, IaRechazada } from "../errores";
import { CAMPOS_DE_IA, type PedidoDeAnalisis } from "../tipos-ia";

import { aplicarControl } from "./control";
import { crearFalso, RelojManual, type Falso } from "./index";

const pedido = (clave: string, mensaje: string, campos: PedidoDeAnalisis["campos"] = [...CAMPOS_DE_IA]): PedidoDeAnalisis => ({
  clave,
  bzzzbx_message_id: mensaje,
  bzzzbx_thread_id: "bx-thread-x",
  campos,
});

function conReloj(): { falso: Falso; reloj: RelojManual } {
  const reloj = new RelojManual();
  return { falso: crearFalso({ reloj }), reloj };
}

describe("IaFalsa", () => {
  it("sin guion rechaza el mensaje como desconocido y definitivo: los correos de la seed no se analizan por accidente", async () => {
    const { falso } = conReloj();
    const error = await falso.ia.pedirAnalisis(pedido("k1", "bx-msg-0001")).catch((e) => e);
    expect(esIaRechazada(error)).toBe(true);
    expect(error).toMatchObject({ error_code: "message_unknown", definitivo: true });
    expect(await falso.ia.resultadoDeAnalisis("k1")).toBeNull();
  });

  it("normal: en curso, y a los 2 s propuestas con la forma de §4.1 y las alternativas de la propiedad", async () => {
    const { falso, reloj } = conReloj();
    falso.ia.ponerGuion("bx-msg-n", "normal");
    await falso.ia.pedirAnalisis(pedido("k2", "bx-msg-n"));
    expect(await falso.ia.resultadoDeAnalisis("k2")).toEqual({ estado: "en_curso" });
    reloj.adelantar(1999);
    expect(await falso.ia.resultadoDeAnalisis("k2")).toEqual({ estado: "en_curso" });
    reloj.adelantar(1);
    const r = await falso.ia.resultadoDeAnalisis("k2");
    expect(r?.estado).toBe("listo");
    if (r?.estado !== "listo") return;
    expect(r.modelo).toBe("example-model");
    expect(validarPropuestas(r.propuestas, CAMPOS_DE_IA)).toMatchObject({ ok: true });
    const propiedad = r.propuestas.filter((p) => p.campo === "property");
    expect(propiedad.map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(r.propuestas.some((p) => p.campo === "multiple_jobs")).toBe(false);
  });

  it("solo propone los campos pedidos", async () => {
    const { falso, reloj } = conReloj();
    falso.ia.ponerGuion("bx-msg-s", "normal");
    await falso.ia.pedirAnalisis(pedido("k3", "bx-msg-s", ["unit", "beds"]));
    reloj.adelantar(2000);
    const r = await falso.ia.resultadoDeAnalisis("k3");
    if (r?.estado !== "listo") throw new Error("no terminó");
    expect(r.propuestas.map((p) => p.campo).sort()).toEqual(["beds", "unit"]);
  });

  it("es idempotente por clave y un resultado terminado no cambia aunque cambie el guion", async () => {
    const { falso, reloj } = conReloj();
    falso.ia.ponerGuion("bx-msg-i", "normal");
    const primero = await falso.ia.pedirAnalisis(pedido("k4", "bx-msg-i"));
    reloj.adelantar(5000);
    expect(await falso.ia.pedirAnalisis(pedido("k4", "bx-msg-i"))).toEqual(primero);
    const r1 = await falso.ia.resultadoDeAnalisis("k4");
    falso.ia.ponerGuion("bx-msg-i", "falla");
    expect(await falso.ia.resultadoDeAnalisis("k4")).toBe(r1);
  });

  it("lenta: sigue en curso hasta que `terminar` la libera, y entonces tarda lo de normal", async () => {
    const { falso, reloj } = conReloj();
    falso.ia.ponerGuion("bx-msg-l", "lenta");
    await falso.ia.pedirAnalisis(pedido("k5", "bx-msg-l"));
    reloj.adelantar(10 * 60_000);
    expect(await falso.ia.resultadoDeAnalisis("k5")).toEqual({ estado: "en_curso" });
    expect(falso.ia.terminar("bx-msg-l")).toBe(1);
    expect(falso.ia.terminar("bx-msg-l")).toBe(0);
    expect(await falso.ia.resultadoDeAnalisis("k5")).toEqual({ estado: "en_curso" });
    reloj.adelantar(2000);
    expect((await falso.ia.resultadoDeAnalisis("k5"))?.estado).toBe("listo");
  });

  it("falla: a los 2 s `fallido` con model_error", async () => {
    const { falso, reloj } = conReloj();
    falso.ia.ponerGuion("bx-msg-f", "falla");
    await falso.ia.pedirAnalisis(pedido("k6", "bx-msg-f"));
    reloj.adelantar(2000);
    expect(await falso.ia.resultadoDeAnalisis("k6")).toMatchObject({ estado: "fallido", error_code: "model_error" });
  });

  it("varios: normal más multiple_jobs con dos", async () => {
    const { falso, reloj } = conReloj();
    falso.ia.ponerGuion("bx-msg-v", "varios");
    await falso.ia.pedirAnalisis(pedido("k7", "bx-msg-v"));
    reloj.adelantar(2000);
    const r = await falso.ia.resultadoDeAnalisis("k7");
    if (r?.estado !== "listo") throw new Error("no terminó");
    expect(r.propuestas.find((p) => p.campo === "multiple_jobs")?.valor).toEqual({ count: 2 });
    expect(validarPropuestas(r.propuestas, CAMPOS_DE_IA)).toMatchObject({ ok: true });
  });

  it("invalida: una propuesta con forma mala, que forma.ts descarta", async () => {
    const { falso, reloj } = conReloj();
    falso.ia.ponerGuion("bx-msg-x", "invalida");
    await falso.ia.pedirAnalisis(pedido("k8", "bx-msg-x"));
    reloj.adelantar(2000);
    const r = await falso.ia.resultadoDeAnalisis("k8");
    if (r?.estado !== "listo") throw new Error("no terminó");
    expect(validarPropuestas(r.propuestas, CAMPOS_DE_IA)).toMatchObject({ ok: false, campo: "beds", motivo: "forma" });
  });

  it("limitada: el primer pedido lanza IaLimitada; el siguiente sale como normal", async () => {
    const { falso, reloj } = conReloj();
    falso.ia.ponerGuion("bx-msg-m", "limitada");
    const error = await falso.ia.pedirAnalisis(pedido("k9", "bx-msg-m")).catch((e) => e);
    expect(esIaLimitada(error)).toBe(true);
    expect(await falso.ia.resultadoDeAnalisis("k9")).toBeNull();
    await falso.ia.pedirAnalisis(pedido("k9", "bx-msg-m"));
    reloj.adelantar(2000);
    expect((await falso.ia.resultadoDeAnalisis("k9"))?.estado).toBe("listo");
  });

  it("sin servicio lanza BzzzbxNoDisponible en las dos llamadas, sin tocar la lectura", async () => {
    const { falso } = conReloj();
    falso.ia.ponerGuion("bx-msg-d", "normal");
    falso.ia.noDisponible(true);
    expect(esNoDisponible(await falso.ia.pedirAnalisis(pedido("k10", "bx-msg-d")).catch((e) => e))).toBe(true);
    expect(esNoDisponible(await falso.ia.resultadoDeAnalisis("k10").catch((e) => e))).toBe(true);
    expect(await falso.lectura.obtener("job", "bx-job-0003")).not.toBeNull();
    falso.ia.noDisponible(false);
    await falso.ia.pedirAnalisis(pedido("k10", "bx-msg-d"));
  });

  it("el falso nuevo no recuerda lo del anterior (reiniciarFalso)", async () => {
    const { falso } = conReloj();
    falso.ia.ponerGuion("bx-msg-r", "normal");
    await falso.ia.pedirAnalisis(pedido("k11", "bx-msg-r"));
    expect(await crearFalso().ia.resultadoDeAnalisis("k11")).toBeNull();
  });
});

describe("errores de la IA, reconocidos por nombre", () => {
  it("reconocen el error de otra copia del módulo (mismo patrón que errores.test.ts)", () => {
    const rechazada = Object.assign(new Error("IA rechazada"), { name: "IaRechazada" });
    const limitada = Object.assign(new Error("limitada"), { name: "IaLimitada" });
    expect(esIaRechazada(rechazada)).toBe(true);
    expect(esIaLimitada(limitada)).toBe(true);
    expect(esIaRechazada(limitada)).toBe(false);
    expect(esIaLimitada(new IaRechazada("x"))).toBe(false);
    expect(esIaLimitada(new IaLimitada())).toBe(true);
    expect(esIaRechazada(new BzzzbxNoDisponible())).toBe(false);
    expect(esIaRechazada("IaRechazada")).toBe(false);
  });

  it("IaRechazada no es definitiva por defecto (S-8)", () => {
    expect(new IaRechazada("unsupported_field")).toMatchObject({ error_code: "unsupported_field", definitivo: false });
  });
});

describe("controles de la IA en /api/falso", () => {
  it("correo_nuevo sin `ia` deja el guion normal; con `ia` el que se pidió; y devuelve los IDs", async () => {
    const { falso, reloj } = conReloj();
    const normal = aplicarControl(falso, { accion: "correo_nuevo" });
    const lenta = aplicarControl(falso, { accion: "correo_nuevo", ia: "lenta" });
    expect(normal).toMatchObject({ ok: true });
    expect(lenta).toMatchObject({ ok: true });
    if (!normal.ok || !lenta.ok) return;
    expect(normal.bzzzbx_message_id).toBeTruthy();
    await falso.ia.pedirAnalisis(pedido("c1", normal.bzzzbx_message_id!, ["unit"]));
    await falso.ia.pedirAnalisis(pedido("c2", lenta.bzzzbx_message_id!, ["unit"]));
    reloj.adelantar(60_000);
    expect((await falso.ia.resultadoDeAnalisis("c1"))?.estado).toBe("listo");
    expect((await falso.ia.resultadoDeAnalisis("c2"))?.estado).toBe("en_curso");
  });

  it("correo_nuevo sigue creando el mensaje en la lectura y rechaza un guion que no existe", async () => {
    const { falso } = conReloj();
    const r = aplicarControl(falso, { accion: "correo_nuevo" });
    if (!r.ok) throw new Error("falló");
    expect(await falso.lectura.obtener("message", r.bzzzbx_message_id!)).not.toBeNull();
    expect(aplicarControl(falso, { accion: "correo_nuevo", ia: "rapida" })).toMatchObject({ ok: false });
    expect(aplicarControl(falso, { accion: "correo_nuevo", respuesta_a: "" })).toMatchObject({ ok: false });
  });

  it("ia_no_disponible apaga y enciende solo la IA", async () => {
    const { falso } = conReloj();
    expect(aplicarControl(falso, { accion: "ia_no_disponible", valor: true })).toEqual({ ok: true });
    expect(falso.ia.disponible).toBe(false);
    expect(falso.lectura.disponible).toBe(true);
    expect(aplicarControl(falso, { accion: "ia_no_disponible", valor: false })).toEqual({ ok: true });
    expect(falso.ia.disponible).toBe(true);
    expect(aplicarControl(falso, { accion: "ia_no_disponible", valor: "si" })).toMatchObject({ ok: false });
  });

  it("ia_terminar libera una lenta; sin ID es un error", async () => {
    const { falso, reloj } = conReloj();
    const c = aplicarControl(falso, { accion: "correo_nuevo", ia: "lenta" });
    if (!c.ok) throw new Error("falló");
    await falso.ia.pedirAnalisis(pedido("c3", c.bzzzbx_message_id!, ["unit"]));
    expect(aplicarControl(falso, { accion: "ia_terminar", bzzzbx_message_id: c.bzzzbx_message_id })).toEqual({ ok: true, liberados: 1 });
    reloj.adelantar(2000);
    expect((await falso.ia.resultadoDeAnalisis("c3"))?.estado).toBe("listo");
    expect(aplicarControl(falso, { accion: "ia_terminar" })).toMatchObject({ ok: false });
  });
});

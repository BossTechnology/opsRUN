// @vitest-environment node
/**
 * La entrega de los salientes en el falso (spec OPR-19 §9 y §10.2): el control
 * `forzar_entrega` (bien y mal formado), el envío que pasa de `sent` a la entrega
 * pedida un paso después sin romper la confirmación de la instrucción, y la alerta
 * Message not delivered que el falso abre una sola vez (P-4) y no cierra.
 */
import { describe, expect, it } from "vitest";

import { REGLA_MENSAJE_NO_ENTREGADO } from "../../alertas/reglas";
import type { Cursor, Instruccion } from "../tipos";

import { aplicarControl } from "./control";
import { crearFalso, RelojManual, type Falso } from "./index";

const OPERADOR = { tipo: "operator", operator_id: "0a000000-0000-4000-8000-0000000000a1" } as const;

function preparar() {
  const reloj = new RelojManual(new Date("2026-11-27T15:00:00Z"));
  const falso = crearFalso({ reloj });
  return { falso, reloj };
}

const texto = (clave: string): Instruccion => ({
  idempotency_key: clave,
  tipo: "send_text",
  payload: { bzzzbx_team_id: "bx-team-0001", body: "Can you confirm?" },
  actor: OPERADOR,
  sujeto: { bzzzbx_job_id: "bx-job-0003" },
});
const correo = (clave: string): Instruccion => ({
  idempotency_key: clave,
  tipo: "send_email",
  payload: { bzzzbx_thread_id: "bx-thread-0002", body: "We can do Friday." },
  actor: OPERADOR,
  sujeto: { bzzzbx_job_id: "bx-job-0003" },
});

/** Adelanta el reloj de a un paso hasta que la instrucción cierra; devuelve su resultado. */
async function cerrar(falso: Falso, clave: string) {
  for (let i = 0; i < 20; i++) {
    const r = await falso.instrucciones.estado(clave);
    if (r && r.estado !== "en_curso") return r;
    (falso.reloj as RelojManual).adelantar(falso.instrucciones.pasoMs);
  }
  throw new Error("no cerró");
}
/** Adelanta el reloj hasta que el envío se observa (aparece su mensaje), sin leer por el puerto: así se ve en `sent`. */
async function hastaObservar(falso: Falso, clave: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    await falso.instrucciones.estado(clave);
    const m = falso.lectura.todos("message").find((x) => /^bx-msg-9\d+$/.test(x.bzzzbx_message_id));
    if (m) return m.bzzzbx_message_id;
    (falso.reloj as RelojManual).adelantar(falso.instrucciones.pasoMs);
  }
  throw new Error("no se observó");
}
const paso = (f: Falso) => (f.reloj as RelojManual).adelantar(f.instrucciones.pasoMs);
const alertasMsg = (f: Falso) => f.lectura.todos("alert_result").filter((a) => a.sujeto.tipo === "message");

describe("control forzar_entrega", () => {
  it("acepta un pedido bien formado", () => {
    const { falso } = preparar();
    expect(aplicarControl(falso, { accion: "forzar_entrega", tipo: "send_text", delivery: "failed", delivery_detail: "Invalid number." })).toEqual({ ok: true });
    expect(aplicarControl(falso, { accion: "forzar_entrega", tipo: "send_email", delivery: "bounced" })).toEqual({ ok: true });
  });

  it.each([
    ["sin tipo", { delivery: "failed" }],
    ["con un tipo que no envía", { tipo: "cancel_job", delivery: "failed" }],
    ["con una entrega que no es de fallo", { tipo: "send_text", delivery: "delivered" }],
    ["sin entrega", { tipo: "send_text" }],
    ["con un texto que rebota", { tipo: "send_text", delivery: "bounced" }],
    ["con un detalle que no es texto", { tipo: "send_email", delivery: "bounced", delivery_detail: 5 }],
  ])("rechaza un pedido mal formado: %s", (_caso, resto) => {
    const { falso } = preparar();
    const r = aplicarControl(falso, { accion: "forzar_entrega", ...resto });
    expect(r.ok).toBe(false);
  });
});

describe("envío con entrega forzada", () => {
  it.each([
    ["send_text", "failed", "Invalid number.", texto, "text"],
    ["send_email", "bounced", "Mailbox does not exist.", correo, "email"],
  ] as const)("%s: se observa como sent, un paso después pasa a %s con su motivo, y la instrucción se confirma", async (tipo, delivery, detalle, armar, canal) => {
    const { falso } = preparar();
    aplicarControl(falso, { accion: "forzar_entrega", tipo, delivery, delivery_detail: detalle });
    await falso.instrucciones.entregar(armar("k1"));
    const { cursor } = await falso.lectura.cambiosDesde(null);
    const id = await hastaObservar(falso, "k1");

    // En el paso en que se observa, todavía es sent y no hay alerta.
    const visto = await falso.lectura.obtener("message", id);
    expect(visto).toMatchObject({ channel: canal, direction: "outbound", delivery: "sent" });
    expect(alertasMsg(falso)).toHaveLength(0);

    paso(falso);
    // La instrucción se confirma igual: el envío salió y fue el proveedor quien no lo entregó.
    expect((await cerrar(falso, "k1")).estado).toBe("confirmada");
    const despues = await falso.lectura.obtener("message", id);
    expect(despues).toMatchObject({ delivery, delivery_detail: detalle });
    // El cambio se ve en cambiosDesde (así lo ven el registrador y el sondeo).
    const lote = await falso.lectura.cambiosDesde(cursor as Cursor);
    expect(lote.cambios.filter((c) => c.entidad === "message" && c.id === id).length).toBeGreaterThanOrEqual(2);
  });

  it("la alerta abre una sola vez sobre ese mensaje, roja, con la regla y un motivo inventado, y se ve en cambiosDesde", async () => {
    const { falso } = preparar();
    const { cursor } = await falso.lectura.cambiosDesde(null);
    aplicarControl(falso, { accion: "forzar_entrega", tipo: "send_text", delivery: "failed", delivery_detail: "Invalid number." });
    await falso.instrucciones.entregar(texto("k2"));
    const id = ((await cerrar(falso, "k2")) as { datos?: { bzzzbx_message_id: string } }).datos!.bzzzbx_message_id;
    paso(falso);
    await falso.lectura.obtener("message", id); // la lectura pone al día

    expect(alertasMsg(falso)).toHaveLength(1);
    const [alerta] = alertasMsg(falso);
    expect(alerta).toMatchObject({
      sujeto: { tipo: "message", bzzzbx_message_id: id },
      rule_id: REGLA_MENSAJE_NO_ENTREGADO,
      level: "red",
      cleared_at: null,
      reason_text: "Text to Team Alpha failed: Invalid number.",
    });
    // Leer más veces no abre otra, ni la cierra.
    paso(falso);
    await falso.lectura.cambiosDesde(null);
    expect(alertasMsg(falso)).toHaveLength(1);
    const lote = await falso.lectura.cambiosDesde(cursor as Cursor);
    expect(lote.cambios.filter((c) => c.entidad === "alert_result")).toHaveLength(1);
  });

  it("la entrega forzada es del próximo envío de ese tipo, una sola vez", async () => {
    const { falso } = preparar();
    aplicarControl(falso, { accion: "forzar_entrega", tipo: "send_text", delivery: "failed" });
    await falso.instrucciones.entregar(correo("c1"));
    await falso.instrucciones.entregar(texto("t1"));
    await falso.instrucciones.entregar(texto("t2"));
    for (const k of ["c1", "t1", "t2"]) await cerrar(falso, k);
    paso(falso);
    await falso.lectura.cambiosDesde(null); // la lectura pone al día
    const salientes = falso.lectura.todos("message").filter((m) => /^bx-msg-9\d+$/.test(m.bzzzbx_message_id) && m.channel === "text");
    expect(salientes.map((m) => m.delivery)).toEqual(expect.arrayContaining(["failed", "sent"]));
    expect(salientes.filter((m) => m.delivery === "failed")).toHaveLength(1);
    const correoSaliente = (await falso.lectura.listarPor("message", { bzzzbx_thread_id: "bx-thread-0002" })).find((m) => m.direction === "outbound");
    expect(correoSaliente?.delivery).toBe("sent");
  });

  it("un mensaje que se entrega no abre nada", async () => {
    const { falso } = preparar();
    await falso.instrucciones.entregar(texto("k3"));
    const id = ((await cerrar(falso, "k3")) as { datos?: { bzzzbx_message_id: string } }).datos!.bzzzbx_message_id;
    falso.lectura.cambiar("message", id, { delivery: "delivered" });
    paso(falso);
    await falso.lectura.cambiosDesde(null);
    expect(alertasMsg(falso)).toHaveLength(0);
  });

  it("una instrucción que BzzzBX rechaza no crea mensaje ni alerta, y no gasta la entrega forzada", async () => {
    const { falso } = preparar();
    aplicarControl(falso, { accion: "forzar_entrega", tipo: "send_text", delivery: "failed" });
    const antes = falso.lectura.todos("message").length;
    await expect(falso.instrucciones.entregar({ ...texto("k4"), payload: { bzzzbx_team_id: "bx-team-9999", body: "x" } })).rejects.toThrow();
    paso(falso);
    await falso.lectura.cambiosDesde(null);
    expect(falso.lectura.todos("message")).toHaveLength(antes);
    expect(alertasMsg(falso)).toHaveLength(0);
    // La entrega forzada sigue esperando al próximo envío bueno.
    await falso.instrucciones.entregar(texto("k5"));
    const id = ((await cerrar(falso, "k5")) as { datos?: { bzzzbx_message_id: string } }).datos!.bzzzbx_message_id;
    paso(falso);
    expect((await falso.lectura.obtener("message", id))?.delivery).toBe("failed");
  });
});

describe("la alerta Message not delivered en el falso (P-4)", () => {
  it("un saliente que pasa a bounced por un cambio del origen abre la alerta una sola vez y no la cierra", async () => {
    const { falso } = preparar();
    falso.lectura.poner("message", {
      bzzzbx_message_id: "bx-msg-019a",
      bzzzbx_thread_id: "bx-thread-0002",
      channel: "email",
      direction: "outbound",
      from: "requests@example.test",
      to: ["contact.one@example.test"],
      subject: "Re: Clean for Sample Court unit 12",
      body: "Hello.",
      sent_at: "2026-11-27T15:00:00.000Z",
      delivery: "sent",
    });
    expect(alertasMsg(falso)).toHaveLength(0);
    falso.lectura.cambiar("message", "bx-msg-019a", { delivery: "bounced", delivery_detail: "Mailbox does not exist." });
    falso.lectura.cambiar("message", "bx-msg-019a", { body: "Hello again." });
    expect(alertasMsg(falso)).toHaveLength(1);
    expect(alertasMsg(falso)[0]).toMatchObject({
      sujeto: { tipo: "message", bzzzbx_message_id: "bx-msg-019a" },
      reason_text: "Email to contact.one@example.test bounced: Mailbox does not exist.",
      cleared_at: null,
    });
  });

  it("un entrante que falla, o un saliente delivered, no abren nada; y la seed arranca sin alertas de mensaje", () => {
    const { falso } = preparar();
    expect(alertasMsg(falso)).toHaveLength(0);
    falso.lectura.cambiar("message", "bx-msg-0102", { delivery: "delivered" });
    falso.lectura.cambiar("message", "bx-msg-0001", { delivery: "failed" });
    expect(alertasMsg(falso)).toHaveLength(0);
  });
});

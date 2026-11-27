// @vitest-environment node
/**
 * El hilo de la conversación (spec OPR-27 §4 y §11.1): las cuatro fuentes, sin
 * duplicados, el original primero, el orden por hora, `data-tipo` y lado, cada
 * fila de §4.3, el duplicado breve de S-3 y el mensaje vinculado desconocido.
 */
import { describe, expect, it } from "vitest";

import type { Message } from "../bzzzbx/tipos";

import { armarHilo, MENSAJE_NO_ENCONTRADO, type EntradaDeArmarHilo } from "./armar-hilo";
import type { EnvioDeOpsrun, NotaDeOpsrun, Vinculo } from "./tipos";

const AHORA = new Date("2026-11-24T18:00:00Z");
const MIN = 60_000;
const hace = (min: number) => new Date(AHORA.getTime() - min * MIN).toISOString();

const original: Message = {
  bzzzbx_message_id: "bx-msg-0002",
  bzzzbx_thread_id: "bx-thread-0002",
  channel: "email",
  direction: "inbound",
  from: "contact.one@example.test",
  to: ["requests@example.test"],
  subject: "Clean for Sample Court unit 12",
  body: "Clean for Sample Court unit 12. Please let us know the window.",
  sent_at: hace(180),
  delivery: "delivered",
};
const texto: Message = {
  bzzzbx_message_id: "bx-msg-0102",
  bzzzbx_thread_id: null,
  channel: "text",
  direction: "outbound",
  from: "opsrun",
  to: ["+1 555 0111"],
  subject: null,
  body: "New job: Sample Court Unit 12. Can you confirm?",
  sent_at: hace(110),
  delivery: "delivered",
};
const respuesta: Message = {
  bzzzbx_message_id: "bx-msg-8001",
  bzzzbx_thread_id: "bx-thread-0002",
  channel: "email",
  direction: "inbound",
  from: "contact.one@example.test",
  to: ["requests@example.test"],
  subject: "Re: Clean for Sample Court unit 12",
  body: "Any update?",
  sent_at: hace(5),
  delivery: "delivered",
};

const vinculoOriginal: Vinculo = {
  bzzzbx_message_id: "bx-msg-0002",
  bzzzbx_thread_id: "bx-thread-0002",
  channel: "email",
  direction: "inbound",
  is_original: true,
  instruction_id: null,
  linked_at: hace(180),
};
const vinculoTexto: Vinculo = {
  bzzzbx_message_id: "bx-msg-0102",
  bzzzbx_thread_id: null,
  channel: "text",
  direction: "outbound",
  is_original: false,
  instruction_id: "c0000000-0000-4000-8000-0000000000a2",
  linked_at: hace(110),
};
const nota: NotaDeOpsrun = {
  id: "n1",
  body: "Requester prefers mornings.",
  created_at: hace(100),
  author_operator_id: "0a000000-0000-4000-8000-0000000000a1",
};
const OPERADORES = [{ id: "0a000000-0000-4000-8000-0000000000a1", nombre: "Ops Uno" }];

const envio = (parche: Partial<EnvioDeOpsrun> = {}): EnvioDeOpsrun => ({
  id: "i1",
  tipo: "send_email",
  status: "pending",
  body: "We can do Friday.",
  bzzzbx_thread_id: "bx-thread-0002",
  bzzzbx_team_id: null,
  error_message: null,
  created_at: hace(1),
  actor_operator_id: "0a000000-0000-4000-8000-0000000000a1",
  tieneMensaje: false,
  ...parche,
});

function hilo(parche: Partial<EntradaDeArmarHilo> = {}) {
  return armarHilo({
    vinculos: [vinculoOriginal, vinculoTexto],
    mensajes: [original, texto],
    instrucciones: [],
    notas: [nota],
    operadores: OPERADORES,
    ahora: AHORA,
    zona: "UTC",
    ...parche,
  });
}
const ids = (h: ReturnType<typeof hilo>) => h.entradas.map((e) => e.id);

describe("armarHilo: las cuatro fuentes", () => {
  it("R2 de la seed: el original, el texto al cleaner y la nota, en ese orden, con su tipo y su estado", () => {
    const { entradas } = hilo();
    expect(entradas.map((e) => [e.tipo, e.etiqueta, e.estado?.texto])).toEqual([
      ["original", "Original request", "Received"],
      ["text", "Text", "Delivered"],
      ["note", "Internal note", "Internal · not sent"],
    ]);
    expect(entradas.map((e) => e.direccion)).toEqual(["inbound", "outbound", "internal"]);
    expect(entradas[0]).toMatchObject({ contraparte: "contact.one@example.test", asunto: "Clean for Sample Court unit 12" });
    expect(entradas[1]).toMatchObject({ contraparte: "+1 555 0111", asunto: null, cuerpo: texto.body });
    expect(entradas[2]).toMatchObject({ contraparte: "Ops Uno", cuerpo: "Requester prefers mornings." });
  });

  it("un texto muestra el nombre del equipo cuando se sabe de quién es el teléfono, y el teléfono si no", () => {
    expect(hilo({ equiposPorTelefono: { "+1 555 0111": "Team Alpha" } }).entradas[1]!.contraparte).toBe("Team Alpha");
    expect(hilo({ equiposPorTelefono: { "+1 555 0112": "Team Beta" } }).entradas[1]!.contraparte).toBe("+1 555 0111");
  });

  it("la hora sale en la zona de la operación", () => {
    expect(hilo().entradas[0]!.hora).toBe("3:00 PM");
    expect(hilo({ zona: "America/New_York" }).entradas[0]!.hora).toBe("10:00 AM");
    expect(hilo().entradas[2]!.hora).toBe("4:20 PM");
  });

  it("un mensaje de un hilo de la request que nadie vinculó aparece (P-7), como Received", () => {
    const h = hilo({ mensajes: [original, texto, respuesta] });
    expect(ids(h)).toContain("msg:bx-msg-8001");
    expect(h.entradas.find((e) => e.id === "msg:bx-msg-8001")).toMatchObject({ tipo: "email", direccion: "inbound", estado: { texto: "Received" } });
  });

  it("un texto entrante sin hilo y sin vínculo no aparece: no hay de qué request es", () => {
    const suelto: Message = { ...texto, bzzzbx_message_id: "bx-msg-8002", direction: "inbound", from: "+1 555 0111", to: ["opsrun"] };
    expect(ids(hilo({ mensajes: [original, texto, suelto] }))).not.toContain("msg:bx-msg-8002");
  });

  it("un mensaje de un hilo ajeno no aparece", () => {
    const ajeno: Message = { ...respuesta, bzzzbx_message_id: "bx-msg-8003", bzzzbx_thread_id: "bx-thread-0001" };
    expect(ids(hilo({ mensajes: [original, texto, ajeno] }))).not.toContain("msg:bx-msg-8003");
  });

  it("un mensaje aparece una sola vez aunque llegue por el vínculo y por el hilo", () => {
    const h = hilo({ mensajes: [original, original, texto, respuesta, respuesta] });
    expect(ids(h).filter((i) => i === "msg:bx-msg-0002")).toHaveLength(1);
    expect(ids(h).filter((i) => i === "msg:bx-msg-8001")).toHaveLength(1);
  });

  it("el original va primero aunque otra hora sea anterior; el resto, por hora", () => {
    const antes = { ...nota, id: "n0", created_at: hace(500), body: "Older note." };
    const h = hilo({ notas: [nota, antes], mensajes: [original, texto, respuesta] });
    expect(ids(h)).toEqual(["msg:bx-msg-0002", "note:n0", "msg:bx-msg-0102", "note:n1", "msg:bx-msg-8001"]);
    expect(h.entradas[0]!.tipo).toBe("original");
    const resto = h.entradas.slice(1).map((e) => Date.parse(e.instante));
    expect(resto).toEqual([...resto].sort((a, b) => a - b));
    expect(ids(h).indexOf("note:n0")).toBeLessThan(ids(h).indexOf("msg:bx-msg-0102"));
  });
});

describe("armarHilo: el estado de entrega (§4.3)", () => {
  const saliente = (delivery: Message["delivery"]): Message => ({
    ...respuesta,
    bzzzbx_message_id: `bx-msg-s-${delivery}`,
    direction: "outbound",
    from: "requests@example.test",
    to: ["contact.one@example.test"],
    delivery,
  });

  it.each([
    ["queued", "Queued", "normal"],
    ["sent", "Sent", "normal"],
    ["delivered", "Delivered", "normal"],
    ["failed", "Not delivered", "error"],
  ] as const)("un mensaje saliente %s se ve %s", (delivery, texto, tono) => {
    const m = saliente(delivery);
    const v: Vinculo = { ...vinculoTexto, bzzzbx_message_id: m.bzzzbx_message_id, bzzzbx_thread_id: "bx-thread-0002", channel: "email" };
    const h = hilo({ vinculos: [vinculoOriginal, v], mensajes: [original, m] });
    expect(h.entradas.find((e) => e.id === `msg:${m.bzzzbx_message_id}`)!.estado).toEqual({ texto, tono });
  });

  it.each([
    ["pending", "Sending…", "normal"],
    ["sent", "Sent", "normal"],
    ["timed_out", "Couldn't confirm", "normal"],
  ] as const)("un envío %s sin mensaje se ve %s, con el cuerpo que escribió el operador", (status, estado, tono) => {
    const h = hilo({ instrucciones: [envio({ status })] });
    const e = h.entradas.find((x) => x.id === "ins:i1")!;
    expect(e).toMatchObject({ tipo: "email", direccion: "outbound", cuerpo: "We can do Friday.", estado: { texto: estado, tono } });
    expect(e.reenviar).toBeNull();
  });

  it("un envío fallido se ve en rojo con su error y ofrece Edit and resend en el mismo modo", () => {
    const h = hilo({ instrucciones: [envio({ status: "failed", error_message: "Forced error (stand-in)." })] });
    const e = h.entradas.find((x) => x.id === "ins:i1")!;
    expect(e.estado).toEqual({ texto: "Failed · Forced error (stand-in).", tono: "error" });
    expect(e.reenviar).toEqual({ modo: "customer", cuerpo: "We can do Friday." });
    const t = hilo({ instrucciones: [envio({ id: "i2", tipo: "send_text", status: "failed", body: "Ready?", bzzzbx_thread_id: null, bzzzbx_team_id: "bx-team-0001" })] });
    expect(t.entradas.find((x) => x.id === "ins:i2")).toMatchObject({ tipo: "text", reenviar: { modo: "cleaner", cuerpo: "Ready?" } });
  });

  it("un envío que ya tiene su mensaje se ve como el mensaje, no como la instrucción", () => {
    const m = saliente("sent");
    const v: Vinculo = { ...vinculoTexto, bzzzbx_message_id: m.bzzzbx_message_id, bzzzbx_thread_id: "bx-thread-0002", channel: "email", instruction_id: "i1" };
    const h = hilo({ vinculos: [vinculoOriginal, v], mensajes: [original, { ...m, body: "We can do Friday." }], instrucciones: [envio({ status: "confirmed", tieneMensaje: true })] });
    expect(ids(h)).toContain(`msg:${m.bzzzbx_message_id}`);
    expect(ids(h)).not.toContain("ins:i1");
  });
});

describe("armarHilo: el duplicado breve (S-3)", () => {
  const observado: Message = {
    ...respuesta,
    bzzzbx_message_id: "bx-msg-9001",
    direction: "outbound",
    from: "requests@example.test",
    to: ["contact.one@example.test"],
    subject: "Re: Clean for Sample Court unit 12",
    body: "We can do Friday.",
    delivery: "sent",
  };

  it.each(["pending", "sent"] as const)("el mensaje saliente sin vincular se oculta con un envío %s con el mismo hilo y cuerpo: una sola burbuja", (status) => {
    const h = hilo({ mensajes: [original, texto, observado], instrucciones: [envio({ status })] });
    expect(ids(h)).toContain("ins:i1");
    expect(ids(h)).not.toContain("msg:bx-msg-9001");
  });

  it("sin envío abierto, el mensaje observado se ve", () => {
    expect(ids(hilo({ mensajes: [original, texto, observado] }))).toContain("msg:bx-msg-9001");
    expect(ids(hilo({ mensajes: [original, texto, observado], instrucciones: [envio({ status: "failed" })] }))).toContain("msg:bx-msg-9001");
  });

  it("con otro cuerpo, otro hilo o un texto, no se oculta", () => {
    expect(ids(hilo({ mensajes: [original, texto, observado], instrucciones: [envio({ body: "Another body." })] }))).toContain("msg:bx-msg-9001");
    expect(ids(hilo({ mensajes: [original, texto, observado], instrucciones: [envio({ bzzzbx_thread_id: "bx-thread-0007" })] }))).toContain("msg:bx-msg-9001");
    expect(ids(hilo({ mensajes: [original, texto, observado], instrucciones: [envio({ tipo: "send_text", bzzzbx_thread_id: null })] }))).toContain("msg:bx-msg-9001");
  });

  it("el cuerpo se compara sin espacios de más", () => {
    const h = hilo({ mensajes: [original, texto, { ...observado, body: "We can do Friday.\n" }], instrucciones: [envio()] });
    expect(ids(h)).not.toContain("msg:bx-msg-9001");
  });
});

describe("armarHilo: lo que BzzzBX no trae", () => {
  it("un mensaje vinculado que BzzzBX no conoce se ve 'Message not found in BzzzBX' en su lugar", () => {
    const h = hilo({ mensajes: [original] });
    const e = h.entradas.find((x) => x.id === "link:bx-msg-0102")!;
    expect(e).toMatchObject({ tipo: "text", noEncontrado: true, cuerpo: null, estado: null });
    expect(MENSAJE_NO_ENCONTRADO).toBe("Message not found in BzzzBX");
  });

  it("con BzzzBX caído y lo último leído, lo que falta no se declara desconocido", () => {
    const h = hilo({ mensajes: [original], lectura: "recordado" });
    expect(ids(h)).not.toContain("link:bx-msg-0102");
    expect(h.mensajesNoDisponibles).toBe(false);
  });

  it("con BzzzBX caído y nada leído, se ven las notas y los envíos y se avisa 'Messages unavailable'", () => {
    const h = hilo({ mensajes: [], lectura: "ninguno", instrucciones: [envio()] });
    expect(ids(h)).toEqual(expect.arrayContaining(["note:n1", "ins:i1"]));
    expect(ids(h).filter((i) => i.startsWith("msg:") || i.startsWith("link:"))).toEqual([]);
    expect(h.mensajesNoDisponibles).toBe(true);
  });

  it("los cuerpos son texto plano: el HTML no se interpreta ni se quita, se queda como texto", () => {
    const sucio: Message = { ...original, body: "<script>alert(1)</script> Hi" };
    expect(hilo({ mensajes: [sucio, texto] }).entradas[0]!.cuerpo).toBe("<script>alert(1)</script> Hi");
  });
});

// @vitest-environment node
/**
 * Lo del falso que el contrato no puede probar: el tope de `buscarMensajes` y
 * el control `correo_nuevo` (spec OPR-15 §9.2 y §10.3).
 */
import { describe, expect, it } from "vitest";

import { BzzzbxNoDisponible, CursorCaducado } from "../errores";
import { BUSCAR_MENSAJES_MAX, type Message } from "../tipos";

import { aplicarControl } from "./control";
import { crearFalso, RelojManual } from ".";

const correo = (n: number, sent_at: string): Message => ({
  bzzzbx_message_id: `bx-msg-m${String(n).padStart(4, "0")}`,
  bzzzbx_thread_id: `bx-thread-m${n}`,
  channel: "email",
  direction: "inbound",
  from: "someone@example.test",
  to: ["requests@example.test"],
  subject: "Hello",
  body: "Hello",
  sent_at,
  delivery: "delivered",
});

describe("buscarMensajes del falso", () => {
  it("topa en 200, dice hay_mas y la página siguiente trae el resto", async () => {
    const { lectura } = crearFalso();
    for (let i = 0; i < BUSCAR_MENSAJES_MAX + 5; i++) lectura.poner("message", correo(i, "2031-01-01T00:00:00.000Z"));
    const primera = await lectura.buscarMensajes({ channel: "email", direction: "inbound", desde: "2031-01-01T00:00:00Z" });
    expect(primera.mensajes).toHaveLength(BUSCAR_MENSAJES_MAX);
    expect(primera.hay_mas).toBe(true);
    // A igual hora, ordena por ID: la página siguiente sigue en el 200.º.
    const segunda = await lectura.buscarMensajes({
      channel: "email",
      direction: "inbound",
      desde: "2031-01-01T00:00:00Z",
      despuesDe: primera.mensajes.at(-1)!.bzzzbx_message_id,
    });
    expect(segunda.mensajes.map((m) => m.bzzzbx_message_id)).toEqual(
      Array.from({ length: 5 }, (_, i) => `bx-msg-m${String(BUSCAR_MENSAJES_MAX + i).padStart(4, "0")}`),
    );
    expect(segunda.hay_mas).toBe(false);
  });

  it("con BzzzBX caído lanza BzzzbxNoDisponible", async () => {
    const { lectura } = crearFalso();
    lectura.noDisponible(true);
    await expect(lectura.buscarMensajes({ channel: "email", direction: "inbound", desde: "2031-01-01T00:00:00Z" })).rejects.toBeInstanceOf(
      BzzzbxNoDisponible,
    );
  });
});

describe("control correo_nuevo", () => {
  it("pone un correo entrante inventado en un hilo nuevo, con su cambio, y la respuesta trae los ids", async () => {
    const falso = crearFalso({ reloj: new RelojManual(new Date("2030-02-01T10:00:00Z")) });
    const { cursor } = await falso.lectura.cambiosDesde(null);
    const r = aplicarControl(falso, { accion: "correo_nuevo" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bzzzbx_message_id).toMatch(/^bx-msg-9-/);
    expect(r.bzzzbx_thread_id).toMatch(/^bx-thread-9-/);

    const m = await falso.lectura.obtener("message", r.bzzzbx_message_id!);
    expect(m).toMatchObject({
      channel: "email",
      direction: "inbound",
      bzzzbx_thread_id: r.bzzzbx_thread_id,
      from: "new.requester@example.test",
      to: ["requests@example.test"],
      sent_at: "2030-02-01T10:00:00.000Z",
    });
    const lote = await falso.lectura.cambiosDesde(cursor);
    expect(lote.cambios.map((c) => [c.entidad, c.id])).toEqual([["message", r.bzzzbx_message_id]]);
  });

  it("con respuesta_a deja el correo en ese hilo", () => {
    const falso = crearFalso();
    const r = aplicarControl(falso, { accion: "correo_nuevo", respuesta_a: "bx-thread-0001" });
    expect(r).toMatchObject({ ok: true, bzzzbx_thread_id: "bx-thread-0001" });
  });

  it("cada correo tiene ids propios, también tras reiniciar el falso", () => {
    const a = aplicarControl(crearFalso(), { accion: "correo_nuevo" });
    const b = aplicarControl(crearFalso(), { accion: "correo_nuevo" });
    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true });
    if (a.ok && b.ok) {
      expect(a.bzzzbx_message_id).not.toBe(b.bzzzbx_message_id);
      expect(a.bzzzbx_thread_id).not.toBe(b.bzzzbx_thread_id);
    }
  });

  it("no choca con los ids de la seed", () => {
    const falso = crearFalso();
    const r = aplicarControl(falso, { accion: "correo_nuevo" });
    if (!r.ok) throw new Error("no se creó");
    expect(falso.lectura.todos("message").filter((m) => m.bzzzbx_message_id === r.bzzzbx_message_id)).toHaveLength(1);
  });

  it("rechaza una respuesta_a vacía o que no es texto", () => {
    const falso = crearFalso();
    expect(aplicarControl(falso, { accion: "correo_nuevo", respuesta_a: "" })).toMatchObject({ ok: false });
    expect(aplicarControl(falso, { accion: "correo_nuevo", respuesta_a: 7 })).toMatchObject({ ok: false });
  });
});

describe("cursores entre falsos", () => {
  it("el cursor de un falso caduca siempre en otro nuevo, aunque esté en la misma posición (reiniciar)", async () => {
    const a = crearFalso();
    const { cursor } = await a.lectura.cambiosDesde(null);
    const b = crearFalso();
    await expect(b.lectura.cambiosDesde(cursor)).rejects.toBeInstanceOf(CursorCaducado);
  });
});

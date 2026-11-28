/**
 * El control `forzar_entrega` del falso (spec OPR-19 §9), en su propio módulo:
 * `control.ts` solo lo registra. `{ accion: "forzar_entrega", tipo, delivery,
 * delivery_detail? }`: el próximo envío de ese tipo se observa como hoy y un paso
 * del reloj después pasa a la entrega pedida. `bounced` solo para un correo (S-2).
 */
import type { Falso } from "./index";

type Resultado = { ok: true } | { ok: false; error: string };

export function aplicarForzarEntrega(falso: Falso, pedido: Record<string, unknown>): Resultado {
  const { tipo, delivery, delivery_detail } = pedido;
  if (tipo !== "send_email" && tipo !== "send_text") return { ok: false, error: "forzar_entrega: tipo debe ser send_email o send_text" };
  if (delivery !== "failed" && delivery !== "bounced") return { ok: false, error: "forzar_entrega: delivery debe ser failed o bounced" };
  if (delivery === "bounced" && tipo === "send_text") return { ok: false, error: "forzar_entrega: un texto no rebota; usa failed" };
  if (delivery_detail !== undefined && delivery_detail !== null && typeof delivery_detail !== "string") {
    return { ok: false, error: "forzar_entrega: delivery_detail debe ser texto" };
  }
  falso.entrega.forzar({ tipo, delivery, ...(delivery_detail ? { delivery_detail } : {}) });
  return { ok: true };
}

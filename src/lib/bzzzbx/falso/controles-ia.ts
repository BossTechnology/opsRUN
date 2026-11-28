/**
 * Controles del falso de la capa de IA que los E2E piden por HTTP (spec OPR-36 §13):
 *  - `correo_nuevo` gana `ia?: Guion` (por defecto `normal`) y fija el guion de su mensaje;
 *  - `{ accion: "ia_no_disponible", valor }` deja la IA sin servicio sin tocar la lectura;
 *  - `{ accion: "ia_terminar", bzzzbx_message_id }` libera una `lenta`.
 * `aplicarControlDeIa` devuelve null si el pedido no es de la IA: `control.ts` sigue con los suyos.
 * Responden 404 sin falso o en el servidor, como los demás (la ruta lo decide).
 */
import { GUIONES, type Guion } from "./ia-falsa";

import type { Falso } from "./index";

type Resultado =
  | { ok: true; bzzzbx_message_id?: string; bzzzbx_thread_id?: string; liberados?: number }
  | { ok: false; error: string };

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const esGuion = (v: unknown): v is Guion => typeof v === "string" && (GUIONES as readonly string[]).includes(v);

export function aplicarControlDeIa(falso: Falso, pedido: unknown): Resultado | null {
  if (!esObjeto(pedido)) return null;
  switch (pedido.accion) {
    case "correo_nuevo": {
      if (pedido.respuesta_a !== undefined && (typeof pedido.respuesta_a !== "string" || pedido.respuesta_a.trim() === "")) {
        return { ok: false, error: "acción desconocida o mal formada" };
      }
      if (pedido.ia !== undefined && !esGuion(pedido.ia)) return { ok: false, error: "acción desconocida o mal formada" };
      const correo = falso.lectura.correoNuevo(pedido.respuesta_a as string | undefined);
      falso.ia.ponerGuion(correo.bzzzbx_message_id, (pedido.ia as Guion | undefined) ?? "normal");
      return { ok: true, ...correo };
    }
    case "ia_no_disponible":
      if (typeof pedido.valor !== "boolean") return { ok: false, error: "acción desconocida o mal formada" };
      falso.ia.noDisponible(pedido.valor);
      return { ok: true };
    case "ia_terminar":
      if (typeof pedido.bzzzbx_message_id !== "string" || pedido.bzzzbx_message_id === "") {
        return { ok: false, error: "acción desconocida o mal formada" };
      }
      return { ok: true, liberados: falso.ia.terminar(pedido.bzzzbx_message_id) };
    default:
      return null;
  }
}

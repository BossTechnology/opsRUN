/**
 * Controles del falso que los E2E piden por HTTP (spec OPR-25, P-7): simulan
 * un cambio en el origen o a BzzzBX caído. La ruta que los expone
 * (`/api/falso`) responde 404 si no hay falso, y en el servidor nunca lo hay.
 */
import { ENTIDADES, type Entidad, type Entidades } from "../tipos";

import type { Falso } from "./index";

type Resultado = { ok: true } | { ok: false; error: string };

const esEntidad = (v: unknown): v is Entidad => typeof v === "string" && (ENTIDADES as string[]).includes(v);
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function aplicarControl(falso: Falso, pedido: unknown): Resultado {
  if (!esObjeto(pedido)) return { ok: false, error: "pedido inválido" };
  try {
    switch (pedido.accion) {
      case "cambiar":
        if (!esEntidad(pedido.entidad) || typeof pedido.id !== "string" || !esObjeto(pedido.parche)) break;
        falso.lectura.cambiar(pedido.entidad, pedido.id, pedido.parche as Partial<Entidades[Entidad]>);
        return { ok: true };
      case "poner":
        if (!esEntidad(pedido.entidad) || !esObjeto(pedido.valor)) break;
        falso.lectura.poner(pedido.entidad, pedido.valor as Entidades[Entidad]);
        return { ok: true };
      case "no_disponible":
        if (typeof pedido.valor !== "boolean") break;
        falso.lectura.noDisponible(pedido.valor);
        return { ok: true };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: false, error: "acción desconocida o mal formada" };
}

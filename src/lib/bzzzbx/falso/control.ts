/**
 * Controles del falso que los E2E piden por HTTP (spec OPR-25, P-7): simulan
 * un cambio en el origen, a BzzzBX caído o un error en la próxima instrucción. La ruta que los expone
 * (`/api/falso`) responde 404 si no hay falso, y en el servidor nunca lo hay.
 */
import { ENTIDADES, TIPOS_INSTRUCCION, type Entidad, type Entidades, type TipoInstruccion } from "../tipos";

import { VALORES_DE_CUANDO, type CuandoFalla } from "./instrucciones-falsas";

import type { Falso } from "./index";

type Resultado = { ok: true } | { ok: false; error: string };

const esEntidad = (v: unknown): v is Entidad => typeof v === "string" && (ENTIDADES as string[]).includes(v);
const esTipo = (v: unknown): v is TipoInstruccion => typeof v === "string" && (TIPOS_INSTRUCCION as readonly string[]).includes(v);
const esCuando = (v: unknown): v is CuandoFalla => typeof v === "string" && (VALORES_DE_CUANDO as readonly string[]).includes(v);
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
      case "forzar_error":
        // La instrucción la escribe el servidor: un E2E no puede poner __forzar_error en su payload.
        if (!esTipo(pedido.tipo) || !esCuando(pedido.cuando)) break;
        if (pedido.error_message !== undefined && typeof pedido.error_message !== "string") break;
        falso.instrucciones.forzarError({
          tipo: pedido.tipo,
          cuando: pedido.cuando,
          ...(pedido.error_message ? { error_message: pedido.error_message } : {}),
        });
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

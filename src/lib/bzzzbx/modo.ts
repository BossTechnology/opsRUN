/**
 * Qué implementación de BzzzBX usa el proceso (spec OPR-22 §5.1, supuesto
 * S-12). `BZZZBX_MODO` = `falso` | `real`:
 * - fuera del servidor (local, CI) el valor por defecto es `falso`;
 * - en el servidor (OPSRUN_SERVIDOR=1) es `real`, y `falso` no deja arrancar:
 *   el stand-in nunca corre en staging ni en producción.
 *
 * Sin dependencias del falso, para que la comprobación de arranque no lo cargue.
 */
import { enServidor, ErrorDeConfiguracion } from "../db/entorno";

export type ModoBzzzbx = "falso" | "real";

type Entorno = Record<string, string | undefined>;

export function modoBzzzbx(env: Entorno = process.env): ModoBzzzbx {
  const valor = env.BZZZBX_MODO?.trim();
  if (!valor) return enServidor(env) ? "real" : "falso";
  if (valor !== "falso" && valor !== "real") {
    throw new ErrorDeConfiguracion("BZZZBX_MODO debe ser falso o real");
  }
  return valor;
}

/** Problemas de configuración de BzzzBX, por nombre. Vacío: puede arrancar. */
export function problemasBzzzbx(env: Entorno = process.env): string[] {
  let modo: ModoBzzzbx;
  try {
    modo = modoBzzzbx(env);
  } catch (e) {
    return [e instanceof Error ? e.message : String(e)];
  }
  if (modo === "falso" && enServidor(env)) return ["BZZZBX_MODO=falso no se permite en el servidor"];
  return [];
}

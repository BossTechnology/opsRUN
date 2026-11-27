import "server-only";

/**
 * La entrega de instrucciones (spec OPR-27 §7) con las dependencias reales de
 * `reconciliacion.ts`: el puerto de instrucciones de BzzzBX que elige
 * `BZZZBX_MODO` y los datos de opsRUN por SQL como `opsrun_app`.
 *
 * `entregarEnvio` corre al final del ejecutor de un `send_*`. La reconciliación
 * de los envíos abiertos es una tarea del ciclo de fondo (`reconciliacion.ts`),
 * no de una lectura.
 */
import { entregarPorClave } from "./despacho";
import { dependenciasDeDespacho } from "./reconciliacion";

/** Entrega una instrucción recién guardada. Nunca lanza: si falla, queda `pending` y la reconciliación la reintenta. */
export async function entregarEnvio(idempotencyKey: string): Promise<void> {
  try {
    await entregarPorClave(dependenciasDeDespacho(), idempotencyKey);
  } catch (e) {
    console.error("[opsRUN] despacho: no se pudo entregar:", e instanceof Error ? e.message : e);
  }
}

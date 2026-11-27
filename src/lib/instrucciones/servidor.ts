import "server-only";

/**
 * El despacho de instrucciones con sus dependencias reales (spec OPR-27 §7): el
 * puerto de instrucciones de BzzzBX que elige `BZZZBX_MODO` y los datos de
 * opsRUN por SQL como `opsrun_app`.
 *
 * `entregarEnvio` corre al final del ejecutor de un `send_*`; `reconciliarSiToca`
 * corre en cada llamada a `/api/tablero/cambios`, a lo sumo una vez cada 5 s
 * por proceso. Sin trabajos de fondo nuevos.
 */
import { obtenerBzzzbx } from "../bzzzbx";
import { BzzzbxNoDisponible } from "../bzzzbx/errores";
import type { InstruccionesBzzzbx } from "../bzzzbx/puertos";

import { crearDatosDeDespacho } from "./datos-sql";
import { crearReconciliador, entregarPorClave, type DependenciasDeDespacho, type Reconciliador } from "./despacho";

/**
 * El puerto de instrucciones, o uno que siempre responde "no disponible" si
 * BzzzBX no se pudo crear (hoy, el real en el servidor hasta OPR-6): lo guardado
 * queda `pending` y sale cuando BzzzBX vuelve.
 */
function instruccionesOAusente(): InstruccionesBzzzbx {
  try {
    return obtenerBzzzbx().instrucciones;
  } catch (e) {
    console.error("[opsRUN] despacho: BzzzBX no está disponible:", e instanceof Error ? e.message : e);
    const ausente = () => Promise.reject(new BzzzbxNoDisponible());
    return { entregar: ausente, resultadosDesde: ausente, estado: ausente };
  }
}

export function dependenciasDeDespacho(): DependenciasDeDespacho {
  return { instrucciones: instruccionesOAusente(), datos: crearDatosDeDespacho() };
}

const global = globalThis as typeof globalThis & { __opsrunReconciliador?: Reconciliador };

/** Una instancia por proceso, para que el límite de 5 s sea de verdad por proceso. */
const reconciliador = (): Reconciliador => (global.__opsrunReconciliador ??= crearReconciliador({ deps: dependenciasDeDespacho }));

/** Reconcilia si pasaron 5 s desde la última vez. Nunca lanza: lo que falle se ve en el log y se reintenta. */
export async function reconciliarSiToca(opciones: { forzar?: boolean } = {}): Promise<void> {
  try {
    await reconciliador()(opciones);
  } catch (e) {
    console.error("[opsRUN] despacho: no se pudo reconciliar:", e instanceof Error ? e.message : e);
  }
}

/** Entrega una instrucción recién guardada. Nunca lanza: si falla, queda `pending` y la reconciliación la reintenta. */
export async function entregarEnvio(idempotencyKey: string): Promise<void> {
  try {
    await entregarPorClave(dependenciasDeDespacho(), idempotencyKey);
  } catch (e) {
    console.error("[opsRUN] despacho: no se pudo entregar:", e instanceof Error ? e.message : e);
  }
}

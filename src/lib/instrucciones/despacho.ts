/**
 * Despacho mínimo de instrucciones (spec OPR-27 §7, P-1). PROVISIONAL hasta
 * OPR-23 (la instruction layer completa), que lo extiende: es genérico por
 * tipo, pero solo actúa sobre `send_email` y `send_text`.
 *
 *  - Entregar: una instrucción que YA existe en la base (la creó un operador por
 *    `opsrun.send_email` o `opsrun.send_text`) se entrega a BzzzBX con su
 *    `idempotency_key`; si acusa, se escribe el acuse (`sent`); si BzzzBX no
 *    responde, queda `pending` y se reintenta con la misma clave; si la rechaza,
 *    `failed`.
 *  - Reconciliar: las `send_*` abiertas (`pending` o `sent`) se contrastan con el
 *    `estado(clave)` de BzzzBX y se cierran como `confirmed`, `failed` o
 *    `timed_out` (Runbook §7.1, OPR-22 §4.3).
 *
 * Este código NO crea instrucciones: solo entrega y cierra las que existen, y
 * escribe como sistema por funciones SQL. Una instrucción nace solo de la
 * acción de un operador (principio 3). Sin estado: lee las abiertas de la base
 * y pregunta por clave, así que un reinicio no pierde nada. Un `failed` no se
 * reintenta solo: el operador usa Edit and resend.
 *
 * Los errores se reconocen por nombre, no con `instanceof` (Next empaqueta por
 * separado rutas y páginas).
 */
import { esInstruccionRechazada, esNoDisponible } from "../bzzzbx/errores";
import type { InstruccionesBzzzbx } from "../bzzzbx/puertos";
import { PASOS, type Instruccion, type Resultado } from "../bzzzbx/tipos";

export const TIPOS_QUE_DESPACHA = ["send_email", "send_text"] as const;
export type TipoDespachado = (typeof TIPOS_QUE_DESPACHA)[number];

/** Una instrucción `send_*` de la base que sigue abierta. */
export type InstruccionAbierta = {
  idempotency_key: string;
  type: TipoDespachado;
  payload: Record<string, unknown>;
  status: "pending" | "sent";
  request_id: string | null;
  actor_operator_id: string | null;
};

export type CierreDeInstruccion = {
  idempotency_key: string;
  status: "sent" | "confirmed" | "failed" | "timed_out";
  bzzzbx_reference: string | null;
  error_code: string | null;
  error_message: string | null;
  bzzzbx_message_id: string | null;
};

/** Lo que el despacho lee y escribe en opsRUN (por SQL, como `opsrun_app` y con actor de sistema). */
export type DatosDeDespacho = {
  /** Las `send_*` con estado `pending` o `sent`, la más vieja primero. */
  abiertas(): Promise<InstruccionAbierta[]>;
  /** Una por su clave, si sigue abierta; null si no existe o ya cerró. */
  abierta(idempotencyKey: string): Promise<InstruccionAbierta | null>;
  /** `opsrun.record_instruction_delivery`: pending → sent. */
  registrarEntrega(idempotencyKey: string, bzzzbxReference: string): Promise<void>;
  /** `opsrun.resolve_instruction`. */
  resolver(cierre: CierreDeInstruccion): Promise<void>;
};

export type DependenciasDeDespacho = {
  instrucciones: InstruccionesBzzzbx;
  datos: DatosDeDespacho;
};

export type ResultadoDeEntrega = "entregada" | "pendiente" | "rechazada";

function aInstruccion(abierta: InstruccionAbierta): Instruccion {
  return {
    idempotency_key: abierta.idempotency_key,
    tipo: abierta.type,
    payload: abierta.payload,
    actor: abierta.actor_operator_id
      ? { tipo: "operator", operator_id: abierta.actor_operator_id }
      : { tipo: "system", proceso: "despacho" },
    ...(abierta.request_id ? { sujeto: { request_id: abierta.request_id } } : {}),
  };
}

/**
 * Entrega una instrucción que ya existe. `pendiente`: BzzzBX no respondió y
 * queda `pending` para reintentar con la misma clave.
 */
export async function entregarInstruccion(deps: DependenciasDeDespacho, abierta: InstruccionAbierta): Promise<ResultadoDeEntrega> {
  try {
    const acuse = await deps.instrucciones.entregar(aInstruccion(abierta));
    await deps.datos.registrarEntrega(abierta.idempotency_key, acuse.bzzzbx_reference);
    return "entregada";
  } catch (e) {
    if (esNoDisponible(e)) return "pendiente";
    if (esInstruccionRechazada(e)) {
      const rechazo = e as { error_code?: unknown; error_message?: unknown };
      await deps.datos.resolver({
        idempotency_key: abierta.idempotency_key,
        status: "failed",
        bzzzbx_reference: null,
        error_code: typeof rechazo.error_code === "string" ? rechazo.error_code : "rejected",
        error_message: typeof rechazo.error_message === "string" ? rechazo.error_message : "BzzzBX rejected the message.",
        bzzzbx_message_id: null,
      });
      return "rechazada";
    }
    throw e;
  }
}

const PASO_DESPACHADO = PASOS.indexOf("dispatched");

/** La traducción de OPR-22 §4.3 del resultado de BzzzBX al cierre en opsRUN; null si no cambia nada. */
export function cierreDe(abierta: InstruccionAbierta, r: Resultado): CierreDeInstruccion | null {
  const base = { idempotency_key: abierta.idempotency_key, bzzzbx_reference: null, error_code: null, error_message: null, bzzzbx_message_id: null };
  switch (r.estado) {
    case "confirmada": {
      const id = r.datos?.bzzzbx_message_id;
      return { ...base, status: "confirmed", bzzzbx_reference: r.bzzzbx_reference, bzzzbx_message_id: typeof id === "string" ? id : null };
    }
    case "fallida":
      return { ...base, status: "failed", error_code: r.error_code, error_message: r.error_message };
    case "sin_confirmar":
      return { ...base, status: "timed_out", error_message: r.motivo };
    case "en_curso":
      // BzzzBX ya lo despachó y opsRUN no tiene el acuse: pasa a sent.
      return abierta.status === "pending" && PASOS.indexOf(r.paso) >= PASO_DESPACHADO ? { ...base, status: "sent" } : null;
  }
}

export type ResumenDeReconciliacion = { revisadas: number; entregadas: number; cerradas: number; bzzzbxCaido: boolean };

/**
 * Pone al día las `send_*` abiertas. Si BzzzBX no responde se detiene sin
 * tocar nada (todo sigue como estaba y se reintenta). Un error en una
 * instrucción no frena a las demás. Repetirla no escribe dos veces: lo que ya
 * cerró no está entre las abiertas, y las funciones SQL son idempotentes.
 */
export async function reconciliarInstrucciones(deps: DependenciasDeDespacho): Promise<ResumenDeReconciliacion> {
  const resumen: ResumenDeReconciliacion = { revisadas: 0, entregadas: 0, cerradas: 0, bzzzbxCaido: false };
  const abiertas = await deps.datos.abiertas();

  for (const abierta of abiertas) {
    resumen.revisadas += 1;
    try {
      let actual = abierta;
      if (abierta.status === "pending") {
        const entrega = await entregarInstruccion(deps, abierta);
        if (entrega === "pendiente") {
          resumen.bzzzbxCaido = true;
          return resumen;
        }
        if (entrega === "rechazada") {
          resumen.cerradas += 1;
          continue;
        }
        resumen.entregadas += 1;
        actual = { ...abierta, status: "sent" };
      }
      const resultado = await deps.instrucciones.estado(abierta.idempotency_key);
      if (!resultado) continue;
      const cierre = cierreDe(actual, resultado);
      if (!cierre) continue;
      await deps.datos.resolver(cierre);
      if (cierre.status !== "sent") resumen.cerradas += 1;
    } catch (e) {
      if (esNoDisponible(e)) {
        resumen.bzzzbxCaido = true;
        return resumen;
      }
      console.error(`[opsRUN] despacho: no se pudo reconciliar ${abierta.idempotency_key}:`, e instanceof Error ? e.message : e);
    }
  }
  return resumen;
}

/** Entrega una instrucción por su clave (al final del ejecutor de un envío). No hace nada si ya no está abierta o ya se entregó. */
export async function entregarPorClave(deps: DependenciasDeDespacho, idempotencyKey: string): Promise<ResultadoDeEntrega | "no_abierta"> {
  const abierta = await deps.datos.abierta(idempotencyKey);
  if (!abierta || abierta.status !== "pending") return "no_abierta";
  return entregarInstruccion(deps, abierta);
}

/**
 * El análisis de la request por IA, por adelantado (spec OPR-36 §9): una tarea del
 * ciclo de fondo único (ADR 0006) que abre el análisis de cada request nueva,
 * se lo pide a BzzzBX con crosswalk IDs, sigue los pendientes y guarda el
 * resultado por `opsrun.record_ai_analysis`. Nunca llama a Claude ni lee el correo:
 * no tiene puerto de lectura, y al puerto de IA solo le manda la clave, el ID del
 * mensaje original, el del hilo y los campos.
 *
 * Es pura respecto a sus dependencias (el puerto de IA, los datos y el reloj), que
 * es lo que prueban los unitarios. La vuelta la corre el ciclo; este módulo no abre
 * temporizadores y ninguna lectura lo importa (`solo-en-segundo-plano.test.ts`).
 *
 * Los errores del puerto se reconocen por nombre, no con `instanceof`.
 */
import { esIaLimitada, esIaRechazada, esNoDisponible } from "../bzzzbx/errores";
import type { IaBzzzbx } from "../bzzzbx/puertos";
import { CAMPOS_DE_IA } from "../bzzzbx/tipos-ia";

import { validarPropuestas, type PropuestaParaGuardar } from "./forma";

/** Cuánto espera un análisis una respuesta de BzzzBX (P-7). Cuenta desde `requested_at`. */
export const LIMITE_DEL_ANALISIS_MS = 120_000;
/** Cuántas requests nuevas y cuántos pendientes mira en una vuelta (S-7). */
export const POR_VUELTA = 20;
/** Cuántas requests despertadas recuerda a lo sumo (si la tarea se atrasa, el barrido las encuentra). */
const MAX_DESPERTADAS = 500;

export type PendienteDeAnalisis = {
  id: string;
  request_id: string;
  /** ISO. */
  requested_at: string;
  /** El correo original de la request: es lo único de PINCH que viaja a BzzzBX, y solo su ID. */
  bzzzbx_message_id: string;
  bzzzbx_thread_id: string | null;
};

export type CierreDeAnalisis = {
  analisisId: string;
  estado: "completed" | "failed" | "timed_out";
  modelo: string | null;
  propuestas: PropuestaParaGuardar[];
  errorCode: string | null;
  /** BzzzBX dijo que reintentar no sirve (S-8). */
  definitivo: boolean;
};

/** Lo que la tarea lee y escribe en opsRUN, por las funciones de la migración de OPR-36. */
export type DatosDeAnalisis = {
  /** `opsrun.start_ai_analysis`: el id del análisis nuevo, o null si la base decide que no toca. */
  iniciar(requestId: string): Promise<string | null>;
  /** El barrido: requests open recientes sin análisis en curso ni terminado bien (S-6). */
  candidatasDelBarrido(limite: number): Promise<string[]>;
  /** Los análisis pending con el original de su request, el más viejo primero. */
  pendientes(limite: number): Promise<PendienteDeAnalisis[]>;
  /** `opsrun.record_ai_analysis`. `duplicate`: ya no estaba pending, no escribió nada. */
  registrar(cierre: CierreDeAnalisis): Promise<"recorded" | "duplicate">;
};

export type DependenciasDeAnalisis = {
  ia: IaBzzzbx;
  datos: DatosDeAnalisis;
  reloj?: () => Date;
  log?: Pick<Console, "info" | "warn" | "error">;
};

export type ResultadoDeVuelta = {
  estado: "ok" | "no_disponible";
  iniciados: number;
  pedidos: number;
  completados: number;
  fallidos: number;
  vencidos: number;
};

const codigoDe = (e: unknown): string | undefined => (e as { code?: unknown } | null)?.code as string | undefined;

export function crearAnalisis(dependencias: DependenciasDeAnalisis | (() => DependenciasDeAnalisis)) {
  const deps = typeof dependencias === "function" ? dependencias : () => dependencias;
  const despertadas = new Set<string>();
  /** Para avisar una vez al caer y una al volver, no cada vuelta. */
  let caido = false;

  async function vuelta(): Promise<ResultadoDeVuelta> {
    const { ia, datos, reloj = () => new Date(), log = console } = deps();
    const cuenta: ResultadoDeVuelta = { estado: "ok", iniciados: 0, pedidos: 0, completados: 0, fallidos: 0, vencidos: 0 };
    let cayoEstaVuelta = false;

    /** Un error de la base en una request no frena a las otras: se reintenta en la vuelta siguiente (todo es idempotente). */
    const registrarError = (donde: string, e: unknown) => {
      const codigo = codigoDe(e);
      log.error(`[opsRUN] análisis de IA: ${donde} falló${codigo ? ` (${codigo})` : ""}:`, e instanceof Error ? e.message : e);
    };

    const cerrar = async (cierre: CierreDeAnalisis): Promise<boolean> => {
      try {
        await datos.registrar(cierre);
        return true;
      } catch (e) {
        registrarError(`cerrar el análisis ${cierre.analisisId}`, e);
        return false;
      }
    };

    // 1. Empezar: las despertadas por la entrada y después el barrido, hasta 20.
    const candidatas: string[] = [];
    for (const id of despertadas) {
      if (candidatas.length >= POR_VUELTA) break;
      candidatas.push(id);
      despertadas.delete(id);
    }
    if (candidatas.length < POR_VUELTA) {
      try {
        for (const id of await datos.candidatasDelBarrido(POR_VUELTA - candidatas.length)) {
          if (!candidatas.includes(id)) candidatas.push(id);
        }
      } catch (e) {
        registrarError("el barrido", e);
      }
    }
    for (const requestId of candidatas) {
      try {
        if (await datos.iniciar(requestId)) cuenta.iniciados += 1;
      } catch (e) {
        registrarError(`abrir el análisis de la request ${requestId}`, e);
      }
    }

    // 2. Seguir los pendientes.
    let pendientes: PendienteDeAnalisis[] = [];
    try {
      pendientes = await datos.pendientes(POR_VUELTA);
    } catch (e) {
      registrarError("leer los pendientes", e);
    }
    let limitada = false;
    for (const p of pendientes) {
      const vencido = reloj().getTime() - Date.parse(p.requested_at) >= LIMITE_DEL_ANALISIS_MS;
      const vencer = async () => {
        if (await cerrar({ analisisId: p.id, estado: "timed_out", modelo: null, propuestas: [], errorCode: null, definitivo: false })) {
          cuenta.vencidos += 1;
        }
      };

      // Con BzzzBX caído no se llama más: lo vencido igual termina a tiempo, porque esa escritura es solo de opsRUN.
      if (cayoEstaVuelta) {
        if (vencido) await vencer();
        continue;
      }

      try {
        const resultado = await ia.resultadoDeAnalisis(p.id);

        if (resultado === null) {
          // BzzzBX no lo conoce: se pide (idempotente por clave; si el pedido anterior se perdió, esto lo repite).
          if (vencido) {
            await vencer();
            continue;
          }
          if (limitada) continue;
          await ia.pedirAnalisis({
            clave: p.id,
            bzzzbx_message_id: p.bzzzbx_message_id,
            bzzzbx_thread_id: p.bzzzbx_thread_id,
            campos: [...CAMPOS_DE_IA],
          });
          cuenta.pedidos += 1;
        } else if (resultado.estado === "en_curso") {
          if (vencido) await vencer();
        } else if (resultado.estado === "fallido") {
          if (await cerrar({ analisisId: p.id, estado: "failed", modelo: null, propuestas: [], errorCode: resultado.error_code, definitivo: false })) {
            cuenta.fallidos += 1;
          }
        } else {
          const forma = validarPropuestas(resultado.propuestas, CAMPOS_DE_IA);
          if (forma.ok) {
            if (await cerrar({ analisisId: p.id, estado: "completed", modelo: resultado.modelo, propuestas: forma.propuestas, errorCode: null, definitivo: false })) {
              cuenta.completados += 1;
            }
          } else {
            // Se descarta entero (S-9). El log dice qué campo y por qué, nunca el valor: puede traer datos del correo.
            log.error(`[opsRUN] análisis de IA: el resultado de ${p.id} no sirve (campo ${forma.campo}: ${forma.motivo}); queda failed`);
            if (await cerrar({ analisisId: p.id, estado: "failed", modelo: null, propuestas: [], errorCode: "invalid_result", definitivo: false })) {
              cuenta.fallidos += 1;
            }
          }
        }
      } catch (e) {
        if (esNoDisponible(e)) {
          cayoEstaVuelta = true;
          if (vencido) await vencer();
        } else if (esIaLimitada(e)) {
          // No cuenta como fallo: el análisis sigue pending y se espera a la vuelta siguiente (venza o no).
          limitada = true;
          if (vencido) await vencer();
        } else if (esIaRechazada(e)) {
          const { error_code, definitivo } = e as { error_code: string; definitivo: boolean };
          if (await cerrar({ analisisId: p.id, estado: "failed", modelo: null, propuestas: [], errorCode: error_code, definitivo: definitivo === true })) {
            cuenta.fallidos += 1;
          }
        } else {
          registrarError(`seguir el análisis ${p.id}`, e);
        }
      }
    }

    if (cayoEstaVuelta) {
      cuenta.estado = "no_disponible";
      if (!caido) {
        caido = true;
        log.warn("[opsRUN] análisis de IA: BzzzBX no está disponible; los análisis esperan o vencen a los 120 s");
      }
    } else if (caido && pendientes.length > 0) {
      caido = false;
      log.info("[opsRUN] análisis de IA: BzzzBX volvió");
    }
    return cuenta;
  }

  return {
    vuelta,

    /**
     * La entrada de correo avisa que creó una request (spec §9.3). Solo la anota: la
     * vuelta de la entrada nunca llama a BzzzBX por la IA, y si el aviso se pierde
     * (el proceso cae) el barrido la encuentra.
     */
    despertar(requestId: string): void {
      if (despertadas.size < MAX_DESPERTADAS) despertadas.add(requestId);
    },
  };
}

export type Analisis = ReturnType<typeof crearAnalisis>;

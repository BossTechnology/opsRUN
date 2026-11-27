/**
 * Lo que la entrada de correo lee y escribe en opsRUN (spec OPR-15 §8.1), por
 * SQL como `opsrun_app` y con el actor de sistema `entrada_correo`: nunca
 * `opsrun.auth_user_id`. Escribe solo por `opsrun.ingest_request_email`, que
 * recibe el ID del mensaje, el del hilo y la hora, y nada más de PINCH. Las
 * lecturas van una tras otra, nunca en paralelo sobre el mismo cliente.
 */
import { comoOpsrunApp, type Actor, type Tx } from "../db/pool";

import type { DatosDeEntrada, Resultado } from "./entrada";

/** Cómo corre cada llamada: por defecto `comoOpsrunApp`; las pruebas pasan su propia transacción. */
export type Ejecutar = <T>(fn: (db: Tx) => Promise<T>, opciones?: { escritura?: boolean; actor?: Actor }) => Promise<T>;

/** Quién escribe (en Audit sale como actor de sistema). */
export const ACTOR_ENTRADA: Actor = { tipo: "sistema", proceso: "entrada_correo" };

export const CONSULTA_MARCA = `select to_char(max(r.received_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as marca from opsrun.request as r`;

export const LLAMADA_INGERIR = `select request_id::text as request_id, outcome from opsrun.ingest_request_email($1::text, $2::text, $3::timestamptz)`;

export function crearDatosDeEntrada(ejecutar: Ejecutar = (fn, opciones) => comoOpsrunApp(fn, opciones)): DatosDeEntrada {
  return {
    async marcaDeAgua() {
      const { rows } = await ejecutar((db) => db.query<{ marca: string | null }>(CONSULTA_MARCA));
      return rows[0]?.marca ?? null;
    },

    async ingerir(correo) {
      const { rows } = await ejecutar(
        (db) =>
          db.query<{ request_id: string; outcome: Resultado }>(LLAMADA_INGERIR, [
            correo.bzzzbx_message_id,
            correo.bzzzbx_thread_id,
            correo.received_at,
          ]),
        { escritura: true, actor: ACTOR_ENTRADA },
      );
      const fila = rows[0];
      if (!fila) throw new Error("ingest_request_email no devolvió nada");
      return fila;
    },
  };
}

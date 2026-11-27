/**
 * Lo que el despacho de instrucciones lee y escribe en opsRUN (spec OPR-27 §7),
 * por SQL como `opsrun_app`. Lee las `send_*` abiertas; escribe solo por las
 * funciones `opsrun.record_instruction_delivery` y `opsrun.resolve_instruction`,
 * con un actor de sistema: son escrituras del sistema, no del operador.
 */
import { comoOpsrunApp, type Actor, type Tx } from "../db/pool";

import type { CierreDeInstruccion, DatosDeDespacho, InstruccionAbierta } from "./despacho";

/** Cómo corre cada llamada: por defecto `comoOpsrunApp`; las pruebas pasan su propia transacción. */
export type Ejecutar = <T>(fn: (db: Tx) => Promise<T>, opciones?: { escritura?: boolean; actor?: Actor }) => Promise<T>;

/** Quién escribe: el despacho al entregar, el reconciliador al cerrar (en Audit sale como actor de sistema). */
export const ACTOR_DESPACHO: Actor = { tipo: "sistema", proceso: "despacho" };
export const ACTOR_RECONCILIADOR: Actor = { tipo: "sistema", proceso: "reconciliador" };

/** Cuántas abiertas mira como mucho en cada pasada. */
const MAXIMO_POR_PASADA = 200;

const COLUMNAS = `i.idempotency_key, i.type, i.payload, i.status::text as status,
       i.request_id::text as request_id, i.actor_operator_id::text as actor_operator_id`;

export const CONSULTA_ABIERTAS = `
select ${COLUMNAS}
from opsrun.instruction as i
where i.type in ('send_email', 'send_text') and i.status in ('pending', 'sent')
order by i.created_at, i.id
limit ${MAXIMO_POR_PASADA}`;

export const CONSULTA_ABIERTA = `
select ${COLUMNAS}
from opsrun.instruction as i
where i.idempotency_key = $1 and i.type in ('send_email', 'send_text') and i.status in ('pending', 'sent')`;

export function crearDatosDeDespacho(ejecutar: Ejecutar = (fn, opciones) => comoOpsrunApp(fn, opciones)): DatosDeDespacho {
  return {
    async abiertas() {
      const { rows } = await ejecutar((db) => db.query<InstruccionAbierta>(CONSULTA_ABIERTAS));
      return rows;
    },

    async abierta(idempotencyKey) {
      const { rows } = await ejecutar((db) => db.query<InstruccionAbierta>(CONSULTA_ABIERTA, [idempotencyKey]));
      return rows[0] ?? null;
    },

    async registrarEntrega(idempotencyKey, bzzzbxReference) {
      await ejecutar((db) => db.query("select opsrun.record_instruction_delivery($1::text, $2::text)", [idempotencyKey, bzzzbxReference]), {
        escritura: true,
        actor: ACTOR_DESPACHO,
      });
    },

    async resolver(c: CierreDeInstruccion) {
      await ejecutar(
        (db) =>
          db.query("select opsrun.resolve_instruction($1::text, $2::opsrun.instruction_status, $3::text, $4::text, $5::text, $6::text)", [
            c.idempotency_key,
            c.status,
            c.bzzzbx_reference,
            c.error_code,
            c.error_message,
            c.bzzzbx_message_id,
          ]),
        { escritura: true, actor: ACTOR_RECONCILIADOR },
      );
    },
  };
}

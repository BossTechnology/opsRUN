/**
 * Lo que la conversación lee de opsRUN (spec OPR-27 §4.1 y §5.5), como
 * `opsrun_app` y en solo lectura, en una sola transacción. La ranura no escribe
 * nada: las escrituras son de los ejecutores.
 */
import type { Tx } from "../db/pool";

import type { BorradorDeIA, EnvioDeOpsrun, NotaDeOpsrun, OperadorDeHilo, Vinculo } from "./tipos";

/** Un instante como ISO 8601 UTC con milisegundos. */
const ISO = (columna: string) => `to_char(${columna} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const CONSULTA_REQUEST = `
select r.bzzzbx_job_id, r.bzzzbx_team_id, r.change_seq::text as change_seq
from opsrun.request as r
where r.id = $1::uuid`;

/** Los vínculos de la request, el original primero. */
export const CONSULTA_VINCULOS = `
select rm.bzzzbx_message_id, rm.bzzzbx_thread_id, rm.channel::text as channel, rm.direction::text as direction,
       rm.is_original, rm.instruction_id::text as instruction_id, ${ISO("rm.linked_at")} as linked_at
from opsrun.request_message as rm
where rm.request_id = $1::uuid
order by rm.is_original desc, rm.linked_at, rm.id`;

/** Los envíos de la request (correos y textos) y si ya tienen su mensaje. */
export const CONSULTA_ENVIOS = `
select i.id::text as id, i.type as tipo, i.status::text as status,
       coalesce(i.payload ->> 'body', '') as body,
       i.payload ->> 'bzzzbx_thread_id' as bzzzbx_thread_id,
       i.payload ->> 'bzzzbx_team_id' as bzzzbx_team_id,
       i.error_message, ${ISO("i.created_at")} as created_at, i.actor_operator_id::text as actor_operator_id,
       exists (select 1 from opsrun.request_message as rm where rm.instruction_id = i.id) as "tieneMensaje"
from opsrun.instruction as i
where i.request_id = $1::uuid and i.type in ('send_email', 'send_text')
order by i.created_at, i.id`;

export const CONSULTA_NOTAS = `
select n.id::text as id, n.body, ${ISO("n.created_at")} as created_at, n.author_operator_id::text as author_operator_id
from opsrun.note as n
where n.request_id = $1::uuid
order by n.created_at, n.id`;

export const CONSULTA_OPERADORES = `
select o.id::text as id, o.display_name as nombre
from opsrun.operator as o
order by o.display_name, o.id`;

/** Los borradores de IA sin decidir de la request: el más reciente primero. */
export const CONSULTA_BORRADORES = `
select s.id::text as id, s.field, s.value ->> 'body' as body, s.reason
from opsrun.ai_suggestion as s
where s.request_id = $1::uuid
  and s.decision is null
  and s.rank = 1
  and s.field in ('draft_customer_reply', 'draft_cleaner_text')
  and jsonb_typeof(s.value -> 'body') = 'string'
order by s.created_at desc, s.id`;

export type LecturaDeConversacion = {
  /** El job y el equipo del borrador de la request, para elegir el cleaner. */
  request: { bzzzbx_job_id: string | null; bzzzbx_team_id: string | null; change_seq: string };
  vinculos: Vinculo[];
  envios: EnvioDeOpsrun[];
  notas: NotaDeOpsrun[];
  operadores: OperadorDeHilo[];
  /** A lo sumo uno por campo: el más reciente. */
  borradores: { customer: BorradorDeIA | null; cleaner: BorradorDeIA | null };
};

/** Todo lo de opsRUN que pide la conversación; null si la request no existe. */
export async function leerConversacionDeOpsrun(db: Tx, requestId: string): Promise<LecturaDeConversacion | null> {
  // Una tras otra: comparten el cliente de la transacción (pg no admite consultas concurrentes en él).
  const request = await db.query<LecturaDeConversacion["request"]>(CONSULTA_REQUEST, [requestId]);
  const vinculos = await db.query<Vinculo>(CONSULTA_VINCULOS, [requestId]);
  const envios = await db.query<EnvioDeOpsrun>(CONSULTA_ENVIOS, [requestId]);
  const notas = await db.query<NotaDeOpsrun>(CONSULTA_NOTAS, [requestId]);
  const operadores = await db.query<OperadorDeHilo>(CONSULTA_OPERADORES);
  const borradores = await db.query<BorradorDeIA & { field: BorradorDeIA["field"] }>(CONSULTA_BORRADORES, [requestId]);
  const fila = request.rows[0];
  if (!fila) return null;
  return {
    request: fila,
    vinculos: vinculos.rows,
    envios: envios.rows,
    notas: notas.rows,
    operadores: operadores.rows,
    borradores: {
      customer: borradores.rows.find((b) => b.field === "draft_customer_reply") ?? null,
      cleaner: borradores.rows.find((b) => b.field === "draft_cleaner_text") ?? null,
    },
  };
}

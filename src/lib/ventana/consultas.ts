/**
 * Lo que la Job window lee de opsRUN (spec OPR-26 §8.1), como `opsrun_app` y en
 * solo lectura, en una sola transacción. La ventana no escribe nada.
 */
import type { Tx } from "../db/pool";
import { COLUMNAS_FILA, DESDE_FILA } from "../tablero/consultas";

import type { Confirmaciones, FilaVentana, OperadorConCarga } from "./tipos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ¿Puede ser el id de una request? Lo que no, es "Job not found" sin tocar la base. */
export const esIdDeRequest = (valor: string) => UUID.test(valor);

/** La fila del tablero de OPR-25 con `where r.id = $1`, más lo propio de la ventana. */
export const CONSULTA_FILA_VENTANA = `
select ${COLUMNAS_FILA},
       r.bzzzbx_contact_id, r.bzzzbx_team_id, r.access_notes,
       r.change_seq::text as change_seq
${DESDE_FILA}
where r.id = $1::uuid`;

/** Los hilos de la request, el original primero. */
export const CONSULTA_HILOS = `
select rm.bzzzbx_thread_id
from opsrun.request_message as rm
where rm.request_id = $1::uuid and rm.bzzzbx_thread_id is not null
order by rm.is_original desc, rm.linked_at, rm.id`;

/** Operadores activos y su carga (S-5): requests suyas que aún no llegan a Validation. */
export const CONSULTA_OPERADORES = `
select o.id::text as id, o.display_name as nombre,
       count(r.id) filter (where r.approved_at is null)::int as abiertas
from opsrun.operator as o
left join opsrun.request as r on r.owner_operator_id = o.id
where o.active
group by o.id, o.display_name
order by o.display_name, o.id`;

export const CONSULTA_CONFIRMACIONES = `
select c.kind::text as kind
from opsrun.request_confirmation as c
where c.request_id = $1::uuid and c.superseded_at is null`;

/** La última instrucción abierta de la request (pending o sent). */
export const CONSULTA_INSTRUCCION_ABIERTA = `
select exists (
  select 1 from opsrun.instruction as i
  where i.request_id = $1::uuid and i.status in ('pending', 'sent')
) as abierta`;

export type LecturaDeOpsrun = {
  fila: FilaVentana;
  hilos: string[];
  operadores: OperadorConCarga[];
  confirmaciones: Confirmaciones;
  instruccionAbierta: boolean;
};

/** Todo lo de opsRUN que pide la ventana; null si la request no existe. */
export async function leerDeOpsrun(db: Tx, requestId: string): Promise<LecturaDeOpsrun | null> {
  const [filas, hilos, operadores, confirmaciones, abierta] = await Promise.all([
    db.query<FilaVentana>(CONSULTA_FILA_VENTANA, [requestId]),
    db.query<{ bzzzbx_thread_id: string }>(CONSULTA_HILOS, [requestId]),
    db.query<OperadorConCarga>(CONSULTA_OPERADORES),
    db.query<{ kind: keyof Confirmaciones }>(CONSULTA_CONFIRMACIONES, [requestId]),
    db.query<{ abierta: boolean }>(CONSULTA_INSTRUCCION_ABIERTA, [requestId]),
  ]);
  const fila = filas.rows[0];
  if (!fila) return null;
  const vigentes = new Set(confirmaciones.rows.map((c) => c.kind));
  return {
    fila,
    hilos: [...new Set(hilos.rows.map((h) => h.bzzzbx_thread_id))],
    operadores: operadores.rows,
    confirmaciones: { details: vigentes.has("details"), sender: vigentes.has("sender"), cleaner: vigentes.has("cleaner") },
    instruccionAbierta: abierta.rows[0]?.abierta === true,
  };
}

/**
 * Lo que la Job window lee de opsRUN (spec OPR-26 §8.1), como `opsrun_app` y en
 * solo lectura, en una sola transacción. La ventana no escribe nada.
 */
import { leerEsperasDeLaRequest } from "../alertas/consultas";
import type { EsperaDeOpsrun } from "../alertas/tipos";
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
       r.change_seq::text as change_seq,
       to_char(r.entered_po_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as entered_po_at,
       r.oss_source::text as oss_source,
       ap.display_name as approved_by_nombre,
       va.display_name as validated_by_nombre
${DESDE_FILA}
left join opsrun.operator as ap on ap.id = r.approved_by
left join opsrun.operator as va on va.id = r.validated_by
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
  /** Las preguntas abiertas al cleaner (Waiting de Alerts, OPR-34): dan la insignia gris de la pestaña. */
  esperas: EsperaDeOpsrun[];
};

/** Todo lo de opsRUN que pide la ventana; null si la request no existe. */
export async function leerDeOpsrun(db: Tx, requestId: string): Promise<LecturaDeOpsrun | null> {
  // Una tras otra: comparten el cliente de la transacción (pg no admite consultas concurrentes en él).
  const filas = await db.query<FilaVentana>(CONSULTA_FILA_VENTANA, [requestId]);
  const hilos = await db.query<{ bzzzbx_thread_id: string }>(CONSULTA_HILOS, [requestId]);
  const operadores = await db.query<OperadorConCarga>(CONSULTA_OPERADORES);
  const confirmaciones = await db.query<{ kind: keyof Confirmaciones }>(CONSULTA_CONFIRMACIONES, [requestId]);
  const abierta = await db.query<{ abierta: boolean }>(CONSULTA_INSTRUCCION_ABIERTA, [requestId]);
  const esperas = await leerEsperasDeLaRequest(db, requestId);
  const fila = filas.rows[0];
  if (!fila) return null;
  const vigentes = new Set(confirmaciones.rows.map((c) => c.kind));
  return {
    fila,
    hilos: [...new Set(hilos.rows.map((h) => h.bzzzbx_thread_id))],
    operadores: operadores.rows,
    confirmaciones: { details: vigentes.has("details"), sender: vigentes.has("sender"), cleaner: vigentes.has("cleaner") },
    instruccionAbierta: abierta.rows[0]?.abierta === true,
    esperas,
  };
}

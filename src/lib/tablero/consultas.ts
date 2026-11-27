/**
 * Lo que el tablero lee de opsRUN, como `opsrun_app` y en solo lectura. Las
 * fechas salen como texto para que `pg` no las pase por la zona del proceso.
 */
import type { Tx } from "../db/pool";

import type { FilaRequest } from "./tipos";

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const iso = (col: string) => `to_char(${col} at time zone 'UTC', ${ISO})`;

/** Las columnas del tablero y de dónde salen; la Job window (OPR-26) agrega las suyas. */
export const COLUMNAS_FILA = `r.id::text,
       r.r_number::int as r_number,
       r.status::text,
       ${iso("r.received_at")} as received_at,
       r.owner_operator_id::text,
       o.display_name as owner_display_name,
       r.bzzzbx_customer_id, r.bzzzbx_property_id, r.bzzzbx_space_id, r.unit, r.bzzzbx_service_id,
       r.service_date::text as service_date,
       to_char(r.window_start, 'HH24:MI') as window_start,
       to_char(r.window_end, 'HH24:MI') as window_end,
       r.po_number, r.bzzzbx_job_id, r.job_number,
       ${iso("r.ended_manually_at")} as ended_manually_at,
       r.oss_mark::text,
       ${iso("r.approved_at")} as approved_at,
       m.bzzzbx_thread_id`;

export const DESDE_FILA = `from opsrun.request as r
left join opsrun.operator as o on o.id = r.owner_operator_id
left join lateral (
  select rm.bzzzbx_thread_id from opsrun.request_message as rm
  where rm.request_id = r.id and rm.is_original
  limit 1
) as m on true`;

export const CONSULTA_FILAS = `
select ${COLUMNAS_FILA}
${DESDE_FILA}
order by r.r_number`;

/** Cambia con cada escritura de opsRUN: Audit es append-only y toda acción deja uno. */
export const CONSULTA_MARCA = `select coalesce(max(id), 0)::text as marca from opsrun.audit_event`;

export async function leerFilas(db: Tx): Promise<FilaRequest[]> {
  return (await db.query<FilaRequest>(CONSULTA_FILAS)).rows;
}

export async function leerMarca(db: Tx): Promise<string> {
  return (await db.query<{ marca: string }>(CONSULTA_MARCA)).rows[0]?.marca ?? "0";
}

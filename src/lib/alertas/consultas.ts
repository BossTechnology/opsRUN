/**
 * Lo que la pestaña Alerts lee de opsRUN (spec OPR-34 §3.1 y §7): el historial
 * (`alert_occurrence`, con el operador y el evento de Audit de su resolución) y
 * las preguntas abiertas al cleaner (`cleaner_confirmation`). Consultas
 * parametrizadas, como `opsrun_app`, en la transacción de solo lectura que
 * `comoOpsrunApp` abre por defecto (sin `escritura` ni actor): una lectura nunca
 * escribe. Una tras otra, nunca en paralelo sobre el mismo cliente (pg no admite
 * consultas concurrentes en él).
 */
import { comoOpsrunApp, type Actor, type Tx } from "../db/pool";

import type { EsperaDeOpsrun, OcurrenciaDeOpsrun } from "./tipos";

/** Cómo corre la lectura: por defecto `comoOpsrunApp`; las pruebas pasan un espía sobre el pool. */
export type Ejecutar = <T>(fn: (db: Tx) => Promise<T>, opciones?: { escritura?: boolean; actor?: Actor }) => Promise<T>;

// Propio, no el de `ventana/consultas`: esa lee de aquí las esperas de la request y no debe haber un ciclo.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const iso = (col: string) => `to_char(${col} at time zone 'UTC', ${ISO})`;

/**
 * Las ocurrencias de una request, abiertas y resueltas. De la resolución trae
 * quién la hizo y la etiqueta del evento que la arregló (el `alert_resolved` que
 * escribió `upsert_alert_occurrence` dice cuál fue en su `details`; el catálogo
 * `audit_event_type` pone la etiqueta). Usa `alert_occurrence_rule_idx`.
 */
export const CONSULTA_OCURRENCIAS = `
select a.bzzzbx_alert_id,
       a.request_id::text as request_id,
       a.rule_id,
       a.level::text as level,
       a.reason_text,
       a.bzzzbx_message_id,
       ${iso("a.opened_at")} as opened_at,
       ${iso("a.resolved_at")} as resolved_at,
       a.resolution::text as resolution,
       o.display_name as resolved_by_nombre,
       a.resolution_reason,
       (select t.label
          from opsrun.audit_event as e
          join opsrun.audit_event_type as t on t.code = e.details ->> 'fixing_event_type'
         where e.alert_occurrence_id = a.id and e.event_type = 'alert_resolved'
         order by e.id desc
         limit 1) as fixing_label
from opsrun.alert_occurrence as a
left join opsrun.operator as o on o.id = a.resolved_by
where a.request_id = $1::uuid
order by a.opened_at, a.bzzzbx_alert_id`;

/** Las preguntas al cleaner sin cerrar de una request. Usa `cleaner_confirmation_waiting_idx`. */
export const CONSULTA_ESPERAS_DE_LA_REQUEST = `
select c.id::text as id, c.request_id::text as request_id, c.purpose::text as purpose, c.bzzzbx_team_id,
       c.status::text as status,
       ${iso("c.asked_at")} as asked_at,
       c.new_service_date::text as new_service_date,
       to_char(c.new_window_start, 'HH24:MI') as new_window_start,
       to_char(c.new_window_end, 'HH24:MI') as new_window_end
from opsrun.cleaner_confirmation as c
where c.request_id = $1::uuid and c.status in ('asked', 'replied')
order by c.asked_at, c.id`;

export async function leerOcurrencias(db: Tx, requestId: string): Promise<OcurrenciaDeOpsrun[]> {
  return (await db.query<OcurrenciaDeOpsrun>(CONSULTA_OCURRENCIAS, [requestId])).rows;
}

export async function leerEsperasDeLaRequest(db: Tx, requestId: string): Promise<EsperaDeOpsrun[]> {
  return (await db.query<EsperaDeOpsrun>(CONSULTA_ESPERAS_DE_LA_REQUEST, [requestId])).rows;
}

export type LecturaDeAlertas = { ocurrencias: OcurrenciaDeOpsrun[]; esperas: EsperaDeOpsrun[] };

/**
 * Lo de opsRUN para la pestaña de una request. Un id que no es un uuid o una
 * request que no existe dan listas vacías, sin error.
 */
export async function leerAlertas(requestId: string, ejecutar: Ejecutar = comoOpsrunApp): Promise<LecturaDeAlertas> {
  if (!UUID.test(requestId)) return { ocurrencias: [], esperas: [] };
  return ejecutar(async (db) => {
    const ocurrencias = await leerOcurrencias(db, requestId);
    const esperas = await leerEsperasDeLaRequest(db, requestId);
    return { ocurrencias, esperas };
  });
}

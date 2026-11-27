/**
 * Lo que la pestaña Audit lee de opsRUN (spec OPR-35 §7.1): una consulta
 * parametrizada como `opsrun_app`, en la transacción de solo lectura que
 * `comoOpsrunApp` abre por defecto, sin actor y sin `escritura`. Sin service
 * role, sin supabase-js, sin PostgREST (ADR 0003) y sin migración: todo lo que
 * se une ya lo puede leer `opsrun_app` (SELECT y RLS de OPR-20).
 *
 * `audit_event` es la fuente (principio 5). Lo demás se une con `left join` para
 * poner nombres: el operador, la alerta, la sugerencia de IA y su campo, la
 * instrucción y el equipo de la confirmación. Nunca sale el `details` en crudo:
 * solo los pocos valores de opsRUN que la pestaña muestra (§2.4).
 */
import { comoOpsrunApp, type Actor, type Tx } from "../db/pool";
import { esIdDeRequest } from "../ventana/consultas";

import type { FilaDeAudit, IdentificadoresDeAudit, LecturaDeAudit } from "./tipos";

/** Cómo corre la lectura: por defecto `comoOpsrunApp`; las pruebas pasan un espía sobre el pool. */
export type Ejecutar = <T>(fn: (db: Tx) => Promise<T>, opciones?: { escritura?: boolean; actor?: Actor }) => Promise<T>;

/** Un uuid en el `details`, para no fallar al convertir un valor que no lo es. */
const UUID_SQL = "'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'";

/**
 * Los eventos de una request, del más viejo al más nuevo. Usa el índice
 * `audit_event_request_idx (request_id, occurred_at)`.
 */
export const CONSULTA_AUDIT = `
select a.id::text as id,
       a.event_type,
       t.label,
       a.source::text as source,
       a.actor_kind::text as actor_kind,
       actor.display_name as actor_nombre,
       a.reason,
       to_char(a.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as occurred_at,
       a_op.display_name as a_operador,
       de_op.display_name as de_operador,
       a.details ->> 'method' as metodo,
       a.details ->> 'mode' as modo,
       case when a.event_type = 'oss_marked' then a.details ->> 'mark' end as marca_oss,
       case when a.event_type = 'po_entered' then a.details ->> 'po_number' end as po_numero,
       a.details ->> 'job_number' as job_number,
       a.details ->> 'bzzzbx_job_id' as bzzzbx_job_id,
       case when a.details ->> 'ai_analysis_id' ~* ${UUID_SQL}
            then (select count(*)::int from opsrun.ai_suggestion as sa
                   where sa.ai_analysis_id = (a.details ->> 'ai_analysis_id')::uuid)
       end as sugerencias,
       al.rule_id as alerta_regla,
       al.level::text as alerta_nivel,
       al.reason_text as alerta_texto,
       al.resolution::text as alerta_resolucion,
       s.field as ia_campo,
       f.label as ia_campo_label,
       s.value as ia_valor,
       s.final_value as ia_valor_final,
       it.label as instruccion_label,
       i.error_message as instruccion_error,
       cc.bzzzbx_team_id as equipo_id
from opsrun.audit_event as a
join opsrun.audit_event_type as t on t.code = a.event_type
left join opsrun.operator as actor on actor.id = a.actor_operator_id
left join opsrun.operator as a_op
  on a_op.id = case when a.details ->> 'to_operator_id' ~* ${UUID_SQL} then (a.details ->> 'to_operator_id')::uuid end
left join opsrun.operator as de_op
  on de_op.id = case when a.details ->> 'from_operator_id' ~* ${UUID_SQL} then (a.details ->> 'from_operator_id')::uuid end
left join opsrun.alert_occurrence as al on al.id = a.alert_occurrence_id
left join opsrun.ai_suggestion as s on s.id = a.ai_suggestion_id
left join opsrun.ai_field as f on f.code = s.field
left join opsrun.instruction as i on i.id = a.instruction_id
left join opsrun.instruction_type as it on it.code = i.type
left join opsrun.cleaner_confirmation as cc on cc.id = a.cleaner_confirmation_id
where a.request_id = $1::uuid
order by a.occurred_at, a.id`;

export const CONSULTA_IDENTIFICADORES = `
select r.r_number::int as r_number, r.job_number
from opsrun.request as r
where r.id = $1::uuid`;

/** La lectura dentro de una transacción ya abierta (la usan las pruebas contra la seed). */
export async function leerAuditEn(db: Tx, requestId: string): Promise<LecturaDeAudit> {
  // Una tras otra: comparten el cliente de la transacción (pg no admite consultas concurrentes en él).
  const ids = await db.query<IdentificadoresDeAudit>(CONSULTA_IDENTIFICADORES, [requestId]);
  const filas = await db.query<FilaDeAudit>(CONSULTA_AUDIT, [requestId]);
  return { identificadores: ids.rows[0] ?? null, filas: filas.rows };
}

/**
 * El Audit de una request. Un id que no es un uuid o una request que no existe
 * dan la lista vacía, sin error. Sin límite de filas en V1.1 beta: un job tiene
 * decenas de eventos, no miles (S-13).
 */
export async function leerAudit(requestId: string, ejecutar: Ejecutar = comoOpsrunApp): Promise<LecturaDeAudit> {
  if (!esIdDeRequest(requestId)) return { identificadores: null, filas: [] };
  // Sin opciones: ni `escritura` ni `actor`, así que corre en `begin read only`.
  return ejecutar((db) => leerAuditEn(db, requestId));
}

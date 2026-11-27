/**
 * Lo que los paneles de Confirm leen de opsRUN y la ventana base no (spec
 * OPR-28 §7): la respuesta del cleaner que se puede aceptar y las sugerencias
 * de IA abiertas de los campos del borrador, para la marca AI. Como `leerDeOpsrun`,
 * corre como `opsrun_app` en solo lectura, en la misma transacción y una
 * consulta tras otra (un cliente de `pg` no corre dos a la vez).
 */
import type { Tx } from "../db/pool";

import type { RespuestaDelCleaner, SugerenciaAbierta } from "./tipos";

/**
 * La pregunta inicial contestada que espera una decisión: la más reciente. El
 * texto de la respuesta vive en BzzzBX; aquí solo su id y el equipo.
 */
export const CONSULTA_RESPUESTA_DEL_CLEANER = `
select cc.id::text as id, cc.bzzzbx_team_id as equipo_id,
       (select s.reason from opsrun.ai_suggestion as s
         where s.cleaner_confirmation_id = cc.id and s.field = 'cleaner_reply' and s.decision is null
         order by s.rank, s.created_at limit 1) as lectura
from opsrun.cleaner_confirmation as cc
where cc.request_id = $1::uuid and cc.purpose = 'initial' and cc.status = 'replied'
order by cc.asked_at desc, cc.id desc
limit 1`;

/**
 * Las sugerencias de rank 1 sin decidir de campos del borrador: no cuentan los
 * borradores de mensaje (`draft_*`), el aviso de varios jobs ni la lectura de la
 * respuesta del cleaner, que no son campos del borrador. La del cleaner
 * (`cleaner_team`) sí, y la marca AI del equipo sale de ella.
 */
export const CONSULTA_SUGERENCIAS_ABIERTAS = `
select s.field as campo, s.reason as razon
from opsrun.ai_suggestion as s
where s.request_id = $1::uuid
  and s.rank = 1
  and s.decision is null
  and s.field not in ('multiple_jobs', 'cleaner_reply')
  and s.field not like 'draft\\_%'
order by s.created_at, s.id`;

export type LecturaParaConfirmar = {
  respuestaDelCleaner: RespuestaDelCleaner | null;
  sugerencias: SugerenciaAbierta[];
};

export async function leerParaConfirmar(db: Tx, requestId: string): Promise<LecturaParaConfirmar> {
  const respuesta = await db.query<{ id: string; equipo_id: string; lectura: string | null }>(CONSULTA_RESPUESTA_DEL_CLEANER, [
    requestId,
  ]);
  const sugerencias = await db.query<SugerenciaAbierta>(CONSULTA_SUGERENCIAS_ABIERTAS, [requestId]);
  const fila = respuesta.rows[0];
  return {
    respuestaDelCleaner: fila ? { id: fila.id, equipoId: fila.equipo_id, lectura: fila.lectura } : null,
    sugerencias: sugerencias.rows,
  };
}

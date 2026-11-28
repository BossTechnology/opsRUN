/**
 * Lo que la tarea `analisis_ia` lee y escribe en opsRUN (spec OPR-36 §7 y §9.1), por
 * SQL como `opsrun_app` y con el actor de sistema `analisis_ia`: nunca
 * `opsrun.auth_user_id`. Escribe solo por `opsrun.start_ai_analysis` y
 * `opsrun.record_ai_analysis`. Lee el barrido y los pendientes con el ID del correo
 * original; nunca el correo. Las lecturas van una tras otra, nunca en paralelo sobre
 * el mismo cliente.
 */
import { comoOpsrunApp, type Actor, type Tx } from "../db/pool";

import type { CierreDeAnalisis, DatosDeAnalisis, PendienteDeAnalisis } from "./analisis";

/** Cómo corre cada llamada: por defecto `comoOpsrunApp`; las pruebas pasan su propia transacción. */
export type Ejecutar = <T>(fn: (db: Tx) => Promise<T>, opciones?: { escritura?: boolean; actor?: Actor }) => Promise<T>;

/** Quién escribe (en Audit el análisis completado sale como actor `ai`; el resto, como sistema). */
export const ACTOR_ANALISIS: Actor = { tipo: "sistema", proceso: "analisis_ia" };

/**
 * El barrido (§7, S-6): requests open de las últimas 24 h sin análisis en curso ni
 * terminado bien. Solo propone candidatas: `start_ai_analysis` decide si toca. No
 * propone las que ya tuvieron dos análisis ni las que BzzzBX rechazó para siempre,
 * porque la base nunca les abriría otro y ocuparían los 20 lugares de la vuelta.
 */
export const CONSULTA_BARRIDO = `
select r.id::text as id
from opsrun.request as r
where r.status = 'open'
  and r.created_at >= now() - interval '24 hours'
  and not exists (
    select 1 from opsrun.ai_analysis as a
    where a.request_id = r.id and a.status in ('pending', 'completed')
  )
  and (select count(*) from opsrun.ai_analysis as a where a.request_id = r.id) < 2
  and not exists (
    select 1 from opsrun.audit_event as e
    where e.request_id = r.id and e.event_type = 'ai_analysis_failed' and e.details -> 'definitive' = 'true'::jsonb
  )
order by r.received_at, r.id
limit $1::int`;

/** Los pendientes con el original de su request (§7): solo los IDs que BzzzBX necesita para leerlo. */
export const CONSULTA_PENDIENTES = `
select a.id::text as id, a.request_id::text as request_id,
       to_char(a.requested_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as requested_at,
       m.bzzzbx_message_id, m.bzzzbx_thread_id
from opsrun.ai_analysis as a
join opsrun.request_message as m on m.request_id = a.request_id and m.is_original
where a.status = 'pending'
order by a.requested_at, a.id
limit $1::int`;

export const LLAMADA_INICIAR = `select opsrun.start_ai_analysis($1::uuid)::text as id`;

export const LLAMADA_REGISTRAR = `select opsrun.record_ai_analysis($1::uuid, $2::opsrun.ai_analysis_status, $3, $4::jsonb, $5, $6::boolean) as resultado`;

export function crearDatosDeAnalisis(ejecutar: Ejecutar = (fn, opciones) => comoOpsrunApp(fn, opciones)): DatosDeAnalisis {
  return {
    async iniciar(requestId) {
      const { rows } = await ejecutar((db) => db.query<{ id: string | null }>(LLAMADA_INICIAR, [requestId]), {
        escritura: true,
        actor: ACTOR_ANALISIS,
      });
      return rows[0]?.id ?? null;
    },

    async candidatasDelBarrido(limite) {
      const { rows } = await ejecutar((db) => db.query<{ id: string }>(CONSULTA_BARRIDO, [limite]));
      return rows.map((r) => r.id);
    },

    async pendientes(limite) {
      const { rows } = await ejecutar((db) => db.query<PendienteDeAnalisis>(CONSULTA_PENDIENTES, [limite]));
      return rows;
    },

    async registrar(cierre: CierreDeAnalisis) {
      const { rows } = await ejecutar(
        (db) =>
          db.query<{ resultado: "recorded" | "duplicate" }>(LLAMADA_REGISTRAR, [
            cierre.analisisId,
            cierre.estado,
            cierre.modelo,
            JSON.stringify(cierre.propuestas),
            cierre.errorCode,
            cierre.definitivo,
          ]),
        { escritura: true, actor: ACTOR_ANALISIS },
      );
      const fila = rows[0];
      if (!fila) throw new Error("record_ai_analysis no devolvió nada");
      return fila.resultado;
    },
  };
}

/**
 * Lo que el registrador de alertas lee y escribe en opsRUN (spec OPR-34 §4 y §8.2),
 * por SQL como `opsrun_app` y con el actor de sistema `registrador_alertas`:
 * nunca `opsrun.auth_user_id`. Escribe solo por `opsrun.upsert_alert_occurrence`,
 * una transacción por alerta. Las lecturas van de a una, nunca en paralelo sobre
 * el mismo cliente. Sin `server-only`: la arranca el ciclo, no una ruta.
 */
import { comoOpsrunApp, type Actor, type Tx } from "../db/pool";

import type { DatosDelRegistrador } from "./registrador";

/** Cómo corre cada llamada: por defecto `comoOpsrunApp`; las pruebas pasan su propia transacción. */
export type Ejecutar = <T>(fn: (db: Tx) => Promise<T>, opciones?: { escritura?: boolean; actor?: Actor }) => Promise<T>;

/** Quién escribe (en Audit sale como actor de sistema). Nunca un operador. */
export const ACTOR_REGISTRADOR: Actor = { tipo: "sistema", proceso: "registrador_alertas" };

/** Las requests que no están en Paid ni canceladas: la pasada completa lee sus alertas por sujeto. */
export const CONSULTA_REQUESTS_ACTIVAS = `
select r.id::text as id, r.bzzzbx_job_id
from opsrun.request as r
where not exists (
  select 1 from opsrun.audit_event as e
  where e.request_id = r.id and e.event_type in ('job_paid', 'job_cancelled')
)
order by r.r_number`;

/** Los hilos de esas mismas requests: las alertas de sus mensajes se leen por el mensaje. */
export const CONSULTA_HILOS_ACTIVOS = `
select distinct rm.bzzzbx_thread_id
from opsrun.request_message as rm
join opsrun.request as r on r.id = rm.request_id
where rm.bzzzbx_thread_id is not null
  and not exists (
    select 1 from opsrun.audit_event as e
    where e.request_id = r.id and e.event_type in ('job_paid', 'job_cancelled')
  )
order by rm.bzzzbx_thread_id`;

export const CONSULTA_ALERTAS_ABIERTAS = `
select a.bzzzbx_alert_id
from opsrun.alert_occurrence as a
where a.resolved_at is null
order by a.opened_at, a.bzzzbx_alert_id`;

export const CONSULTA_REQUESTS_EXISTENTES = `select r.id::text as id from opsrun.request as r where r.id = any($1::uuid[])`;
export const CONSULTA_REQUESTS_DE_JOBS = `select r.bzzzbx_job_id as clave, r.id::text as request_id from opsrun.request as r where r.bzzzbx_job_id = any($1::text[])`;
export const CONSULTA_REQUESTS_DE_MENSAJES = `
select distinct on (rm.bzzzbx_message_id) rm.bzzzbx_message_id as clave, rm.request_id::text as request_id
from opsrun.request_message as rm
where rm.bzzzbx_message_id = any($1::text[])
order by rm.bzzzbx_message_id, rm.linked_at, rm.id`;
export const CONSULTA_REQUESTS_DE_HILOS = `
select distinct on (rm.bzzzbx_thread_id) rm.bzzzbx_thread_id as clave, rm.request_id::text as request_id
from opsrun.request_message as rm
where rm.bzzzbx_thread_id = any($1::text[])
order by rm.bzzzbx_thread_id, rm.is_original desc, rm.linked_at, rm.id`;

export const LLAMADA_UPSERT = `
select opsrun.upsert_alert_occurrence($1::text, $2::uuid, $3::text, $4::text, $5::opsrun.alert_level, $6::text, $7::text,
                                      $8::timestamptz, $9::timestamptz)::text as id`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function crearDatosDelRegistrador(ejecutar: Ejecutar = (fn, opciones) => comoOpsrunApp(fn, opciones)): DatosDelRegistrador {
  const mapa = async (sql: string, claves: string[]) => {
    if (claves.length === 0) return new Map<string, string>();
    const { rows } = await ejecutar((db) => db.query<{ clave: string; request_id: string }>(sql, [claves]));
    return new Map(rows.map((r) => [r.clave, r.request_id]));
  };

  return {
    async requestsActivas() {
      const { rows } = await ejecutar((db) => db.query<{ id: string; bzzzbx_job_id: string | null }>(CONSULTA_REQUESTS_ACTIVAS));
      return rows;
    },

    async hilosActivos() {
      const { rows } = await ejecutar((db) => db.query<{ bzzzbx_thread_id: string }>(CONSULTA_HILOS_ACTIVOS));
      return rows.map((r) => r.bzzzbx_thread_id);
    },

    async alertasAbiertas() {
      const { rows } = await ejecutar((db) => db.query<{ bzzzbx_alert_id: string }>(CONSULTA_ALERTAS_ABIERTAS));
      return rows.map((r) => r.bzzzbx_alert_id);
    },

    async requestsExistentes(ids) {
      // Un id que no es un uuid no es de ninguna request: no llega a la base (el cast lanzaría 22P02).
      const validos = ids.filter((id) => UUID.test(id));
      if (validos.length === 0) return new Set<string>();
      const { rows } = await ejecutar((db) => db.query<{ id: string }>(CONSULTA_REQUESTS_EXISTENTES, [validos]));
      return new Set(rows.map((r) => r.id));
    },

    requestsDeJobs: (jobIds) => mapa(CONSULTA_REQUESTS_DE_JOBS, jobIds),
    requestsDeMensajes: (messageIds) => mapa(CONSULTA_REQUESTS_DE_MENSAJES, messageIds),
    requestsDeHilos: (hilos) => mapa(CONSULTA_REQUESTS_DE_HILOS, hilos),

    async registrar(a) {
      const { rows } = await ejecutar(
        (db) =>
          db.query<{ id: string }>(LLAMADA_UPSERT, [
            a.bzzzbx_alert_id,
            a.request_id,
            a.rule_id,
            a.rule_version,
            a.level,
            a.reason_text,
            a.bzzzbx_message_id,
            a.opened_at,
            a.cleared_at,
          ]),
        { escritura: true, actor: ACTOR_REGISTRADOR },
      );
      const fila = rows[0];
      if (!fila) throw new Error("upsert_alert_occurrence no devolvió nada");
      return fila.id;
    },
  };
}

/**
 * Lo que el enlace de la Fase A lee y escribe en opsRUN, por SQL como
 * opsrun_app (spec Fase A §4 a §6). Las escrituras van por las funciones de la
 * migración `20261125120000_fase_a_enlace.sql`, con el actor de la
 * transacción; la base escribe el Audit.
 */
import type { DatabaseError } from "pg";

import { comoOpsrunApp, type Actor, type Tx } from "@/lib/db/pool";

import { EnlaceInvalido, type CodigoEnlaceInvalido, type DatosDeEnlace, type RequestParaEnlace } from "./enlace";

/** Cómo corre cada llamada: por defecto `comoOpsrunApp`; las pruebas pasan su propia transacción. */
export type Ejecutar = <T>(fn: (db: Tx) => Promise<T>, opciones?: { escritura?: boolean; actor?: Actor }) => Promise<T>;

/** Errores de las funciones SQL que el operador puede provocar, con su código de opsRUN. */
const CODIGOS_SQL: Record<string, CodigoEnlaceInvalido> = {
  OP005: "gate_incompleto",
  OP006: "request_no_encontrada",
  OP007: "request_no_abierta",
  OP008: "job_ya_enlazado",
};

/**
 * Las constraints únicas del job en `opsrun.request`. Dos operadores que
 * enlazan el mismo job a la vez pasan los dos el chequeo OP008 de la función;
 * el segundo choca aquí con un 23505.
 */
const UNICAS_DEL_JOB = new Set(["request_bzzzbx_job_id_key", "request_job_number_key"]);

async function traducirErrores<T>(promesa: Promise<T>): Promise<T> {
  try {
    return await promesa;
  } catch (e) {
    const error = e as Partial<DatabaseError> | undefined;
    if (error?.code === "23505" && UNICAS_DEL_JOB.has(error.constraint ?? "")) throw new EnlaceInvalido("job_ya_enlazado");
    const codigo = CODIGOS_SQL[error?.code ?? ""];
    if (codigo) throw new EnlaceInvalido(codigo);
    throw e;
  }
}

export function crearDatosDeEnlace(ejecutar: Ejecutar = (fn, opciones) => comoOpsrunApp(fn, opciones)): DatosDeEnlace {
  return {
    async leerRequest(requestId) {
      const filas = await ejecutar((db) =>
        db.query<RequestParaEnlace>(
          `select r.id,
                  r.status::text as status,
                  to_char(r.received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as received_at,
                  r.bzzzbx_customer_id,
                  r.bzzzbx_property_id,
                  to_char(r.service_date, 'YYYY-MM-DD') as service_date,
                  to_char(r.window_start, 'HH24:MI') as window_start,
                  to_char(r.window_end, 'HH24:MI') as window_end,
                  r.bzzzbx_team_id
             from opsrun.request as r
            where r.id = $1`,
          [requestId],
        ),
      );
      return filas.rows[0] ?? null;
    },

    async jobsEnlazadosAOtra(requestId, bzzzbxJobIds) {
      if (bzzzbxJobIds.length === 0) return new Set();
      const { rows } = await ejecutar((db) =>
        db.query<{ id: string }>(
          `select r.bzzzbx_job_id as id from opsrun.request as r
            where r.bzzzbx_job_id = any($2::text[]) and r.id <> $1`,
          [requestId, bzzzbxJobIds],
        ),
      );
      return new Set(rows.map((r) => r.id));
    },

    async jobsRechazados(requestId) {
      const { rows } = await ejecutar((db) =>
        db.query<{ id: string }>(
          `select distinct a.details ->> 'bzzzbx_job_id' as id from opsrun.audit_event as a
            where a.request_id = $1 and a.event_type = 'job_link_rejected'`,
          [requestId],
        ),
      );
      return new Set(rows.map((r) => r.id));
    },

    async enlazar({ requestId, bzzzbxJobId, jobNumber }, actor) {
      await traducirErrores(
        ejecutar((db) => db.query("select opsrun.link_observed_job($1, $2, $3)", [requestId, bzzzbxJobId, jobNumber]), {
          escritura: true,
          actor,
        }),
      );
    },

    async rechazar({ requestId, bzzzbxJobId, motivo }, actor) {
      await traducirErrores(
        ejecutar((db) => db.query("select opsrun.reject_job_link($1, $2, $3)", [requestId, bzzzbxJobId, motivo]), {
          escritura: true,
          actor,
        }),
      );
    },
  };
}

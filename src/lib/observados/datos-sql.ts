/**
 * Lo que el observador lee y escribe en opsRUN, por SQL como opsrun_app (spec
 * OPR-30 a OPR-32 §7.5): los jobs enlazados (solo lectura) y
 * `opsrun.record_observed_event` como actor de sistema `observador`.
 */
import { comoOpsrunApp, type Actor, type Tx } from "../db/pool";

import type { DatosDelObservador, HechoObservado } from "./observar";

export type Ejecutar = <T>(fn: (db: Tx) => Promise<T>, opciones?: { escritura?: boolean; actor?: Actor }) => Promise<T>;

/** El actor de sistema del observador (`opsrun.system_actor`). */
export const ACTOR_OBSERVADOR: Actor = { tipo: "sistema", proceso: "observador" };

export const CONSULTA_JOBS_ENLAZADOS = `
select r.bzzzbx_job_id
from opsrun.request as r
where r.status = 'scheduled' and r.bzzzbx_job_id is not null
order by r.r_number`;

export function crearDatosDelObservador(ejecutar: Ejecutar = (fn, opciones) => comoOpsrunApp(fn, opciones)): DatosDelObservador {
  return {
    async jobsEnlazados() {
      const { rows } = await ejecutar((db) => db.query<{ bzzzbx_job_id: string }>(CONSULTA_JOBS_ENLAZADOS));
      return rows.map((r) => r.bzzzbx_job_id);
    },

    async registrar(hecho: HechoObservado) {
      const { rows } = await ejecutar(
        (db) =>
          db.query<{ id: string | null }>("select opsrun.record_observed_event($1, $2, $3, $4::timestamptz)::text as id", [
            hecho.bzzzbxJobId,
            hecho.tipo,
            hecho.bzzzbxEventId,
            hecho.ocurridoEn,
          ]),
        { escritura: true, actor: ACTOR_OBSERVADOR },
      );
      return rows[0]?.id ?? null;
    },
  };
}

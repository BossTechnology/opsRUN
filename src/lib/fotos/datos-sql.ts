/**
 * Lo que la ruta de fotos lee de opsRUN (spec OPR-30 §7.3): el job de una
 * request, como `opsrun_app` y en solo lectura. Nunca escribe.
 */
import { comoOpsrunApp, type Actor, type Tx } from "../db/pool";

/** Cómo corre la lectura: por defecto `comoOpsrunApp`; las pruebas pasan un espía sobre el pool. */
export type Ejecutar = <T>(fn: (db: Tx) => Promise<T>, opciones?: { escritura?: boolean; actor?: Actor }) => Promise<T>;

export const CONSULTA_JOB_DE_LA_REQUEST = `
select r.bzzzbx_job_id
from opsrun.request as r
where r.id = $1::uuid`;

export function crearJobDeLaRequest(ejecutar: Ejecutar = (fn, opciones) => comoOpsrunApp(fn, opciones)) {
  // Sin opciones: ni `escritura` ni `actor`, así que corre en `begin read only`.
  return (requestId: string): Promise<string | null> =>
    ejecutar(async (db) => {
      const { rows } = await db.query<{ bzzzbx_job_id: string | null }>(CONSULTA_JOB_DE_LA_REQUEST, [requestId]);
      return rows[0]?.bzzzbx_job_id ?? null;
    });
}

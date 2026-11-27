/**
 * El observador mínimo de hechos de PINCH (spec OPR-30 a OPR-32 §7.5, P-9): lee
 * del puerto de BzzzBX los `JobTrackerEvent` y el `Payment` de los jobs enlazados
 * (Scheduled a Validation) y escribe en Audit solo el tipo, la hora de BzzzBX y
 * el crosswalk ID (`opsrun.record_observed_event`, como actor de sistema
 * `observador`). Deduplica por `bzzzbx_event_id`: la base lo hace con `unique` y
 * aquí se recuerdan los ya escritos para no llamarla otra vez. Provisional hasta
 * la read layer de OPR-22.
 *
 * Corre en segundo plano, **dentro del único ciclo de fondo de opsRUN** que
 * define OPR-15 (P-1, ADR 0006), como la tarea `observador_etapas` cada 15 s
 * (`./tarea`, registrada en `tareasDeOpsrun()`): nunca desde una consulta de
 * lectura como `/api/tablero/cambios` (lo vigila `solo-en-segundo-plano.test.ts`).
 * El ciclo garantiza una vuelta a la vez, así que aquí no hay límite propio de
 * cadencia ni de concurrencia; sí hay memoria entre vueltas (los ids ya
 * escritos), que vive en la tarea.
 *
 * Nada de lo leído de PINCH se copia a una columna de opsRUN: las duraciones, el
 * "running long" y el PO vigente se calculan al pintar.
 */
import { esNoDisponible } from "../bzzzbx/errores";
import type { LecturaBzzzbx } from "../bzzzbx/puertos";
import type { JobTrackerEvent } from "../bzzzbx/tipos";

/** El tipo de Audit de cada evento del Job Tracker (catálogo `audit_event_type` con source = bzzzbx_observed). */
export const TIPO_DE_AUDIT: Record<JobTrackerEvent["kind"], string> = {
  checked_in: "job_checked_in",
  started: "job_started",
  completed: "job_completed",
};

export type HechoObservado = {
  bzzzbxJobId: string;
  /** `job_checked_in`, `job_started`, `job_completed` o `job_paid`. */
  tipo: string;
  bzzzbxEventId: string;
  /** Hora de BzzzBX, ISO 8601 UTC. */
  ocurridoEn: string;
};

export type DatosDelObservador = {
  /** Los `bzzzbx_job_id` de las requests programadas. Solo lee. */
  jobsEnlazados(): Promise<string[]>;
  /** `record_observed_event` como actor de sistema; devuelve el id del evento o null si ya estaba. */
  registrar(hecho: HechoObservado): Promise<string | null>;
};

/** Lo que una vuelta usa. Se arma en cada vuelta: el stand-in de BzzzBX se reemplaza al reiniciarlo. */
export type DependenciasDelObservador = {
  lectura: LecturaBzzzbx;
  datos: DatosDelObservador;
};

export type OpcionesDelObservador = {
  /** Cuántos ids recuerda para no repetir la llamada. */
  maxRecordados?: number;
};

export type ResultadoDeVuelta =
  | { tipo: "bzzzbx_no_disponible" }
  | { tipo: "corrida"; jobs: number; escritos: number; repetidos: number; errores: number };

/**
 * El observador, con su memoria entre vueltas (los ids ya escritos). Quien lo
 * crea lo guarda todo el proceso (la tarea del ciclo); las dependencias se piden
 * en cada vuelta.
 */
export function crearObservador(dependencias: () => DependenciasDelObservador, { maxRecordados = 5000 }: OpcionesDelObservador = {}) {
  const recordados = new Set<string>();

  async function registrar(datos: DatosDelObservador, hecho: HechoObservado, cuenta: { escritos: number; repetidos: number }) {
    if (recordados.has(hecho.bzzzbxEventId)) {
      cuenta.repetidos += 1;
      return;
    }
    const id = await datos.registrar(hecho);
    // Escrito o ya estaba en la base: en los dos casos no hay que volver a llamar.
    if (recordados.size >= maxRecordados) recordados.clear();
    recordados.add(hecho.bzzzbxEventId);
    if (id === null) cuenta.repetidos += 1;
    else cuenta.escritos += 1;
  }

  return {
    /** Una vuelta; el ciclo decide cuándo y garantiza que no haya dos a la vez. */
    async vuelta(): Promise<ResultadoDeVuelta> {
      const { lectura, datos } = dependencias();
      const cuenta = { jobs: 0, escritos: 0, repetidos: 0, errores: 0 };
      const jobs = await datos.jobsEnlazados();
      cuenta.jobs = jobs.length;
      // Uno tras otro: las escrituras comparten el pool de la base.
      for (const jobId of jobs) {
        try {
          const eventos = await lectura.listarPor("jobtracker_event", { bzzzbx_job_id: jobId });
          for (const e of eventos) {
            await registrar(datos, { bzzzbxJobId: jobId, tipo: TIPO_DE_AUDIT[e.kind], bzzzbxEventId: e.bzzzbx_event_id, ocurridoEn: e.occurred_at }, cuenta);
          }
          const pago = await lectura.obtener("payment", jobId);
          if (pago?.paid && pago.paid_at && pago.bzzzbx_event_id) {
            await registrar(datos, { bzzzbxJobId: jobId, tipo: "job_paid", bzzzbxEventId: pago.bzzzbx_event_id, ocurridoEn: pago.paid_at }, cuenta);
          }
        } catch (e) {
          // BzzzBX caído: se deja la vuelta para la próxima, sin escribir nada más.
          if (esNoDisponible(e)) return { tipo: "bzzzbx_no_disponible" };
          cuenta.errores += 1;
          console.error(`[opsRUN] observador: falló un job:`, e instanceof Error ? e.message : e);
        }
      }
      return { tipo: "corrida", ...cuenta };
    },
  };
}

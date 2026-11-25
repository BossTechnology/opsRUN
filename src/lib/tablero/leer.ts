/**
 * Read layer del tablero (spec OPR-25 §2 y §3): lee del puerto de BzzzBX lo
 * que piden las requests de opsRUN y arma el tablero. Si BzzzBX no responde,
 * usa lo último leído (en memoria del proceso, nunca en la base) y lo avisa.
 */
import { esNoDisponible } from "../bzzzbx/errores";
import type { LecturaBzzzbx } from "../bzzzbx/puertos";

import { armarTablero } from "./armar";
import { LEIDOS_VACIOS, type FilaRequest, type Leidos, type Tablero } from "./tipos";

/** Lo último que respondió BzzzBX. */
export type MemoriaTablero = { leidos: Leidos | null; en: string | null };

const unicos = (valores: (string | null | undefined)[]) => [
  ...new Set(valores.filter((v): v is string => Boolean(v))),
];

export async function leerDeBzzzbx(filas: FilaRequest[], lectura: LecturaBzzzbx): Promise<Leidos> {
  const jobIds = unicos(filas.map((f) => f.bzzzbx_job_id));
  const hilos = unicos(filas.map((f) => f.bzzzbx_thread_id));

  const [jobs, pagos, salud, eventos, mensajes, alertas] = await Promise.all([
    lectura.obtenerVarios("job", jobIds),
    lectura.obtenerVarios("payment", jobIds),
    lectura.obtenerVarios("job_health", jobIds),
    Promise.all(jobIds.map((id) => lectura.listarPor("jobtracker_event", { bzzzbx_job_id: id }))),
    Promise.all(hilos.map((id) => lectura.listarPor("message", { bzzzbx_thread_id: id }))),
    Promise.all([
      ...filas.map((f) => lectura.listarPor("alert_result", { sujeto: { tipo: "request", request_id: f.id } })),
      ...jobIds.map((id) => lectura.listarPor("alert_result", { sujeto: { tipo: "job", bzzzbx_job_id: id } })),
    ]),
  ]);

  const [properties, customers, services] = await Promise.all([
    lectura.obtenerVarios("property", unicos([...filas.map((f) => f.bzzzbx_property_id), ...jobs.map((j) => j.bzzzbx_property_id)])),
    lectura.obtenerVarios("customer", unicos([...filas.map((f) => f.bzzzbx_customer_id), ...jobs.map((j) => j.bzzzbx_customer_id)])),
    lectura.obtenerVarios("service", unicos([...filas.map((f) => f.bzzzbx_service_id), ...jobs.map((j) => j.bzzzbx_service_id)])),
  ]);

  return {
    jobs,
    properties,
    customers,
    services,
    pagos,
    salud,
    eventos: eventos.flat(),
    mensajes: mensajes.flat(),
    alertas: alertas.flat(),
  };
}

export async function leerTablero({
  filas,
  lectura,
  ahora,
  zona,
  memoria,
}: {
  filas: FilaRequest[];
  lectura: LecturaBzzzbx;
  ahora: Date;
  zona: string;
  memoria: MemoriaTablero;
}): Promise<Tablero> {
  try {
    const leidos = await leerDeBzzzbx(filas, lectura);
    memoria.leidos = leidos;
    memoria.en = ahora.toISOString();
    return armarTablero({ filas, leidos, ahora, zona, bzzzbx: { disponible: true, actualizadoEn: memoria.en } });
  } catch (e) {
    if (!esNoDisponible(e)) throw e;
    return armarTablero({
      filas,
      leidos: memoria.leidos ?? LEIDOS_VACIOS,
      ahora,
      zona,
      bzzzbx: { disponible: false, actualizadoEn: memoria.en },
    });
  }
}

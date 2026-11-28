/**
 * Read layer del tablero (spec OPR-25 §2 y §3): lee del puerto de BzzzBX lo
 * que piden las requests de opsRUN y arma el tablero. Si BzzzBX no responde,
 * usa lo último leído (en memoria del proceso, nunca en la base) y lo avisa.
 */
import type { EsperaDeOpsrun } from "../alertas/tipos";
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

  // Las de sujeto mensaje no se piden por sujeto: opsRUN sabe cuáles están abiertas (`alert_occurrence`) y las
  // relee por id (OPR-34, P-3). Su estado sigue siendo el vivo de BzzzBX; la ocurrencia solo dice cuáles mirar.
  const idsDeMensaje = unicos(filas.flatMap((f) => f.alertas_de_mensaje));

  const [jobs, pagos, salud, eventos, mensajes, alertas, deMensaje] = await Promise.all([
    lectura.obtenerVarios("job", jobIds),
    lectura.obtenerVarios("payment", jobIds),
    lectura.obtenerVarios("job_health", jobIds),
    Promise.all(jobIds.map((id) => lectura.listarPor("jobtracker_event", { bzzzbx_job_id: id }))),
    Promise.all(hilos.map((id) => lectura.listarPor("message", { bzzzbx_thread_id: id }))),
    Promise.all([
      ...filas.map((f) => lectura.listarPor("alert_result", { sujeto: { tipo: "request", request_id: f.id } })),
      ...jobIds.map((id) => lectura.listarPor("alert_result", { sujeto: { tipo: "job", bzzzbx_job_id: id } })),
    ]),
    idsDeMensaje.length > 0 ? lectura.obtenerVarios("alert_result", idsDeMensaje) : [],
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
    alertas: [...new Map([...alertas.flat(), ...deMensaje].map((a) => [a.bzzzbx_alert_id, a])).values()],
  };
}

export async function leerTablero({
  filas,
  lectura,
  ahora,
  zona,
  memoria,
  esperas,
  operadores,
}: {
  filas: FilaRequest[];
  lectura: LecturaBzzzbx;
  ahora: Date;
  zona: string;
  memoria: MemoriaTablero;
  /** Lo de opsRUN para el panel de Alerts (OPR-34): preguntas abiertas al cleaner y operadores activos. */
  esperas?: EsperaDeOpsrun[];
  operadores?: { id: string; nombre: string }[];
}): Promise<Tablero> {
  try {
    const leidos = await leerDeBzzzbx(filas, lectura);
    memoria.leidos = leidos;
    memoria.en = ahora.toISOString();
    return armarTablero({ filas, leidos, ahora, zona, bzzzbx: { disponible: true, actualizadoEn: memoria.en }, esperas, operadores });
  } catch (e) {
    if (!esNoDisponible(e)) throw e;
    return armarTablero({
      filas,
      leidos: memoria.leidos ?? LEIDOS_VACIOS,
      ahora,
      zona,
      bzzzbx: { disponible: false, actualizadoEn: memoria.en },
      esperas,
      operadores,
    });
  }
}

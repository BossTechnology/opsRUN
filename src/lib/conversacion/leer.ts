/**
 * Arma lo que la ranura de conversación pinta (spec OPR-27 §4, §5 y §10): lo de
 * opsRUN que ya leyó `consultas.ts`, más los mensajes y el cleaner de BzzzBX por
 * su puerto, dentro del mismo presupuesto de 1,5 s que la Job window (OPR-26
 * S-2). Pasado eso, o con BzzzBX caído, se pinta con lo último leído de esa
 * request (en memoria del proceso, nunca en la base) y el aviso. Nada de lo que
 * viene de PINCH se guarda.
 */
import { BzzzbxNoDisponible, esNoDisponible } from "../bzzzbx/errores";
import type { LecturaBzzzbx } from "../bzzzbx/puertos";
import type { CleanerTeam, Job, Message, Property } from "../bzzzbx/tipos";
import { plantillasDelJob, type PlantillasDelJob } from "../plantillas/disponibles";

import { armarHilo } from "./armar-hilo";
import { disponibilidadDelComposer, type DisponibilidadDelModo } from "./composer";
import type { LecturaDeConversacion } from "./consultas";
import type { BorradorDeIA, EntradaDeHilo, ModoComposer } from "./tipos";

export const PRESUPUESTO_BZZZBX_MS = 1500;
export const SIN_CC = "— —";

/** Lo último que respondió BzzzBX por request, y cuándo. */
export type MemoriaConversacion = Map<string, { leidos: LeidosDeConversacion; en: string }>;
const MAX_RECORDADAS = 200;

/** Lo que se lee de BzzzBX para una request. */
export type LeidosDeConversacion = {
  mensajes: Message[];
  /** El equipo elegido (el del job desde Scheduled, el del borrador antes) y lo que BzzzBX sabe de él. */
  equipoId: string | null;
  equipo: CleanerTeam | null;
  /** El remitente del original del hilo: el "To" de Customer. */
  remitente: string | null;
  /** El job de la request (null en Requests o si BzzzBX no lo conoce) y la propiedad que llena las plantillas (OPR-18 §5). */
  job: Job | null;
  propiedad: Property | null;
};

export type DatosDeConversacion = {
  requestId: string;
  version: string;
  etapa: string;
  entradas: EntradaDeHilo[];
  mensajesNoDisponibles: boolean;
  /** BzzzBX respondió ahora o se pinta lo último leído. */
  bzzzbx: { disponible: boolean; actualizadoEn: string | null };
  modos: Record<ModoComposer, DisponibilidadDelModo>;
  /** Lo que se ve en To y Cc (solo lectura, §5.2). Nada de esto viaja en una instrucción. */
  para: { customer: { to: string | null; cc: string }; cleaner: { nombre: string | null; telefono: string | null } };
  borradores: { customer: BorradorDeIA | null; cleaner: BorradorDeIA | null };
  /** Las plantillas que se ofrecen por modo y los avisos del panel Notices (OPR-18): ya llenas; nada de esto se guarda. */
  plantillas: PlantillasDelJob;
  /** Envíos de correo o texto sin cerrar (pending o sent): lo que espera el reconciliador. */
  abiertos: number;
};

function conPresupuesto<T>(trabajo: Promise<T>, ms: number): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout>;
  const vencido = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new BzzzbxNoDisponible("BzzzBX tardó más que el presupuesto")), ms);
  });
  trabajo.catch(() => {});
  return Promise.race([trabajo, vencido]).finally(() => clearTimeout(temporizador));
}

async function leerDeBzzzbx(opsrun: LecturaDeConversacion, lectura: LecturaBzzzbx): Promise<LeidosDeConversacion> {
  const idsVinculados = opsrun.vinculos.map((v) => v.bzzzbx_message_id);
  const hilos = [...new Set(opsrun.vinculos.map((v) => v.bzzzbx_thread_id).filter((h): h is string => h !== null))];
  const { bzzzbx_job_id: jobId, bzzzbx_team_id: equipoDelBorrador } = opsrun.request;

  const [vinculados, delHilo, job] = await Promise.all([
    idsVinculados.length > 0 ? lectura.obtenerVarios("message", idsVinculados) : [],
    Promise.all(hilos.map((h) => lectura.listarPor("message", { bzzzbx_thread_id: h }))),
    jobId ? lectura.obtener("job", jobId) : null,
  ]);

  // Desde Scheduled manda el cleaner del job; en Requests, el del borrador (§5.1).
  const equipoId = jobId ? (job?.bzzzbx_team_id ?? null) : equipoDelBorrador;
  // Desde Scheduled la propiedad es la del job; en Requests, la del borrador. Se lee junto al equipo.
  const propiedadId = jobId ? (job?.bzzzbx_property_id ?? null) : opsrun.request.bzzzbx_property_id;
  const [equipo, propiedad] = await Promise.all([
    equipoId ? lectura.obtener("cleaner_team", equipoId) : null,
    propiedadId ? lectura.obtener("property", propiedadId) : null,
  ]);

  const porId = new Map<string, Message>();
  for (const m of [...vinculados, ...delHilo.flat()]) porId.set(m.bzzzbx_message_id, m);

  const original = opsrun.vinculos.find((v) => v.is_original);
  const mensajeOriginal = original ? porId.get(original.bzzzbx_message_id) : undefined;
  return { mensajes: [...porId.values()], equipoId, equipo, remitente: mensajeOriginal?.from ?? null, job, propiedad };
}

export type EntradaDeLeer = {
  requestId: string;
  etapa: string;
  hilos: string[];
  puedeEnviar: boolean;
  zona: string;
  opsrun: LecturaDeConversacion;
  lectura: LecturaBzzzbx;
  ahora: Date;
  memoria: MemoriaConversacion;
  presupuestoMs?: number;
};

export async function leerConversacion(e: EntradaDeLeer): Promise<DatosDeConversacion> {
  const { opsrun, ahora, requestId } = e;

  let leidos: LeidosDeConversacion | null = null;
  let vivo = false;
  try {
    leidos = await conPresupuesto(leerDeBzzzbx(opsrun, e.lectura), e.presupuestoMs ?? PRESUPUESTO_BZZZBX_MS);
    vivo = true;
    e.memoria.delete(requestId); // se vuelve a insertar al final: la más reciente
    e.memoria.set(requestId, { leidos, en: ahora.toISOString() });
    if (e.memoria.size > MAX_RECORDADAS) e.memoria.delete(e.memoria.keys().next().value!);
  } catch (error) {
    if (!esNoDisponible(error)) throw error;
    leidos = e.memoria.get(requestId)?.leidos ?? null;
  }
  const recordado = e.memoria.get(requestId);
  const actualizadoEn = recordado?.en ?? null;

  const hilo = armarHilo({
    vinculos: opsrun.vinculos,
    mensajes: leidos?.mensajes ?? [],
    instrucciones: opsrun.envios,
    notas: opsrun.notas,
    operadores: opsrun.operadores,
    ahora,
    zona: e.zona,
    lectura: vivo ? "vivo" : leidos ? "recordado" : "ninguno",
    equiposPorTelefono: leidos?.equipo?.phone ? { [leidos.equipo.phone]: leidos.equipo.name } : {},
  });

  // El cleaner: lo leído ahora o, si no, lo último leído; sin nada, el del borrador de la request.
  const equipoId = leidos ? leidos.equipoId : opsrun.request.bzzzbx_job_id ? null : opsrun.request.bzzzbx_team_id;
  const modos = disponibilidadDelComposer({
    etapa: e.etapa,
    bzzzbxDisponible: e.puedeEnviar && vivo,
    hilos: e.hilos,
    equipoId,
  });

  return {
    requestId,
    version: opsrun.request.change_seq,
    etapa: e.etapa,
    entradas: hilo.entradas,
    mensajesNoDisponibles: hilo.mensajesNoDisponibles,
    bzzzbx: { disponible: vivo, actualizadoEn },
    modos,
    para: {
      customer: { to: leidos?.remitente ?? null, cc: SIN_CC },
      cleaner: { nombre: leidos?.equipo?.name ?? null, telefono: leidos?.equipo?.phone ?? null },
    },
    borradores: opsrun.borradores,
    plantillas: plantillasDelJob({
      filas: opsrun.plantillas,
      etapa: e.etapa,
      modos,
      fuente: leidos
        ? {
            fuente: opsrun.request.bzzzbx_job_id ? "job" : "borrador",
            borrador: opsrun.request,
            job: leidos.job,
            propiedad: leidos.propiedad,
          }
        : null,
    }),
    abiertos: opsrun.envios.filter((x) => x.status === "pending" || x.status === "sent").length,
  };
}
